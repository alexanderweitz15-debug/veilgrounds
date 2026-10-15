// Last-hit planner (spec-bots §7 "Last-Hitting", main spec Table B lastHitJitterMs). Predicts each enemy minion's
// HP over the next ~2.5 s from what a player sees: own minions' and towers' attack animations (the 'attack' events
// of the fog-filtered snapshot give the exact wind-up start), their attack rates and projectile flight times, and
// the damage they were seen dealing. The bot times its own auto (wind-up + projectile travel + walk) into the
// window in which its hit kills the minion.
//
// Tick convention (src/sim/sim.ts step()): events of a step are tagged with the post-step tick ("recorded" tick,
// the snapshot tick at the next decision). A wind-up started at recorded R fires at R + wind-up ticks; melee damage
// lands then, a homing projectile k ticks later (it moves in the same tick it is fired: + k - 1). A command issued
// at decision tick T starts its wind-up at recorded T + 1 at the earliest.
//
// Rank: the bot sees every window shifted by a per-minion timing error ~ N(0, lastHitJitterMs) (consistent per
// minion, not resampled per decision), and lets a minion go entirely with errorInjectionPct (attention lapse,
// rolled once per minion). Nothing here reads the Sim.

import { Kind } from '../../sim/types';
import { MINION_STATS, minionScale } from '../../sim/systems/minions';
import { TOWER_AS } from '../../sim/systems/towers';
import type { Rng } from '../../sim/rng';
import type { RankBehavior } from '../profiles/schema';
import type { BotAction, BotStatic, SnapEntity } from './types';
import type { View } from './perception';
import { dst } from './geo';
import { ready } from './combat';

/** Minion auto wind-up (s at 1 AS; spawnUnit default) and projectile speeds of the sim's unit kinds. */
const MINION_WINDUP = 0.3;
const PROJ_SPEED: Partial<Record<number, number>> = { [Kind.MinionCaster]: 650, [Kind.MinionSiege]: 1200, [Kind.Tower]: 1200 };
/** Share of the profile's errorInjectionPct that becomes a per-minion attention lapse (the rest of the rank's CS gap
 *  comes from the timing error, trades, recalls and deaths; calibrated with npm run bot-sim against Table A). */
const LAPSE_SHARE = 0.5;
/** Prediction horizon (ticks). */
const HORIZON = 75;

export interface LastHitMem {
  /** Own attacker id -> last observed wind-up start (recorded tick) and its target. */
  atk: Map<number, { at: number; target: number }>;
  /** Own attacker id -> last damage seen dealt to an enemy minion (exact amount incl. minion scaling). */
  dmg: Map<number, number>;
  /** Swings replaced by a newer one of the same attacker that still land (caster/tower projectiles in flight). */
  inflight: { target: number; land: number; dmg: number }[];
  /** Own champion: last wind-up start (recorded tick). */
  ownStart: number;
  /** Enemy minion id -> rolled timing error (ticks) and attention lapse. */
  roll: Map<number, { bias: number; skip: boolean }>;
  lastTick: number;
  /** Diagnostics (bot-sim / tests): minion id -> outcome of the latest plan ('skip', 'noWindow', 'tooLate', 'wait', 'go'). */
  why: Map<number, { s: string; t: number }>;
}

export const newLastHitMem = (): LastHitMem => ({ atk: new Map(), dmg: new Map(), inflight: [], ownStart: -1e9, roll: new Map(), lastTick: -1, why: new Map() });

export interface LastHitPlan {
  /** Attack command (possibly delayed) or null when no last hit is due within this decision. */
  action: BotAction | null;
  /** Earliest recorded tick a kill window of a minion the bot goes for opens (Infinity = none in the horizon). */
  nextWindow: number;
  /** Own attack period (ticks) and wind-up (ticks) at the current AS. */
  period: number;
  windup: number;
  /** Minion whose window opens soon but which is out of reach: stand at reach before the window opens. */
  approach?: SnapEntity;
  /** Debug: chosen minion and its window. */
  target?: { id: number; a: number; b: number; land: number };
}

const windupTicksOf = (windup: number, as: number): number => (windup <= 0 ? 0 : Math.max(1, Math.round((30 * windup) / as)));
const travelTicks = (d: number, targetRadius: number, speed: number): number => (speed <= 0 ? 0 : Math.max(1, Math.ceil((d - targetRadius) / (speed / 30))));

/** Read the 'attack' / 'damage' events since the last decision (own minions, towers and own champion). */
export function observeAttacks(v: View, mem: LastHitMem): void {
  const snap = v.snap;
  const byId = new Map<number, SnapEntity>();
  for (const e of snap.entities) byId.set(e.id, e);
  snap.events.forEach((ev, i) => {
    const at = snap.eventTicks?.[i] ?? snap.tick;
    if (ev.e === 'attack') {
      if (ev.src < 0) return; // unseen attacker (fog-masked)
      if (ev.src === v.me.eid) mem.ownStart = Math.max(mem.ownStart, at);
      const s = byId.get(ev.src);
      if (s && s.team === v.self.team && s.id !== v.me.eid) {
        // the previous swing of a ranged attacker may still be flying to its old target
        const prev = mem.atk.get(ev.src);
        const tgt = prev ? byId.get(prev.target) : undefined;
        if (prev && tgt && tgt.alive) {
          const sh = swing(s, tgt, snap.tick, mem);
          if (sh && sh.flight > 0 && prev.at + sh.wt + sh.flight > at - 1) mem.inflight.push({ target: prev.target, land: prev.at + sh.wt + sh.flight, dmg: sh.hit });
        }
        mem.atk.set(ev.src, { at, target: ev.dst });
      }
    } else if (ev.e === 'damage') {
      const d = byId.get(ev.dst);
      if (d && ev.src >= 0 && d.team !== v.self.team && MINION_STATS[d.kind] && ev.src !== v.me.eid) mem.dmg.set(ev.src, ev.amount);
    }
  });
  mem.inflight = mem.inflight.filter((f) => f.land > snap.tick);
  // forget dead attackers / minions
  if (snap.tick - mem.lastTick > 30 || mem.atk.size > 200) {
    for (const id of mem.atk.keys()) if (!byId.get(id)?.alive) mem.atk.delete(id);
    for (const id of mem.dmg.keys()) if (!byId.get(id)?.alive) mem.dmg.delete(id);
    for (const id of mem.roll.keys()) if (!byId.get(id)?.alive) mem.roll.delete(id);
    for (const id of mem.why.keys()) if (!byId.get(id)?.alive) mem.why.delete(id);
    mem.lastTick = snap.tick;
  }
}

/** Wind-up ticks, projectile flight (ticks after the fire tick), period and damage of an own attacker's swing at m. */
function swing(a: SnapEntity, m: SnapEntity, T: number, mem: LastHitMem): { wt: number; flight: number; period: number; hit: number } | null {
  const isTower = a.kind === Kind.Tower;
  const st = MINION_STATS[a.kind];
  if (!isTower && !st) return null;
  const as = isTower ? TOWER_AS : st!.as;
  const wt = isTower ? 0 : windupTicksOf(MINION_WINDUP, as);
  const flight = Math.max(0, travelTicks(dst(a, m), m.radius, PROJ_SPEED[a.kind] ?? 0) - 1);
  // towers deal a share of the minion's max HP (kind-dependent): never reuse a learned amount for them
  const hit = isTower ? (MINION_STATS[m.kind]?.towerPct ?? 0.1) * m.maxHp : mem.dmg.get(a.id) ?? st!.ad * minionScale(T);
  return { wt, flight, period: 30 / as, hit };
}

/** Incoming damage instances (recorded tick, amount) on minion `m` from own minions and towers within the horizon. */
export function incomingHits(v: View, mem: LastHitMem, m: SnapEntity): { at: number; dmg: number }[] {
  const T = v.tick;
  const out: { at: number; dmg: number }[] = [];
  const attackers = [...v.ownMinions, ...v.ownTowers];
  for (const a of attackers) {
    const rec = mem.atk.get(a.id);
    const onM = a.atkTarget === m.id;
    if (!onM && rec?.target !== m.id) continue;
    const sw = swing(a, m, T, mem);
    if (!sw) continue;
    const { wt, flight, period, hit } = sw;
    const isTower = a.kind === Kind.Tower;
    const st = MINION_STATS[a.kind];
    let start: number;
    if (rec && rec.target === m.id) {
      // the observed swing: lands unless it is still winding up and the attacker switched targets
      const land = rec.at + wt + flight;
      const fired = rec.at + wt <= T;
      if (land > T && (fired || onM)) out.push({ at: land, dmg: hit });
      start = rec.at + period;
    } else {
      // attacking m without an observed swing (walked up, or swung before the bot looked): starts about now
      start = a.atkPhase === 1 ? T - Math.floor(wt / 2) : T + 1;
      const gap = isTower ? 0 : dst(a, m) - (st!.range + a.radius + m.radius);
      if (a.atkPhase !== 1 && gap > 10) start += Math.ceil(gap / 10); // still walking up (minion speed 300 = 10/tick)
    }
    if (!onM) continue;
    for (let s = start; s + wt <= T + HORIZON; s += period) {
      const land = Math.ceil(s) + wt + flight;
      if (land > T) out.push({ at: land, dmg: hit });
    }
  }
  for (const f of mem.inflight) if (f.target === m.id && f.land > T) out.push({ at: f.land, dmg: f.dmg });
  return out.sort((p, q) => p.at - q.at);
}

/**
 * Kill window [a, b) in recorded ticks for an own hit of `dmg` on `m`: a = first tick at which the HP left before
 * that tick's hits is <= dmg, b = tick of the killing minion/tower hit (Infinity if none in the horizon).
 */
export function killWindow(m: SnapEntity, hits: { at: number; dmg: number }[], dmg: number, T: number): { a: number; b: number } {
  // own hit at Y kills iff hp - hits(< Y) <= dmg and hp - hits(<= Y) > 0 (same-tick hits may resolve either way)
  let hp = m.hp;
  let a = hp <= dmg ? T + 1 : Infinity;
  for (const h of hits) {
    hp -= h.dmg;
    if (hp <= 0) return { a, b: h.at };
    if (a === Infinity && hp <= dmg) a = h.at + 1;
  }
  return { a, b: Infinity };
}

/** Mana share a spell last hit must leave (farm axis: farmers spend more, fighters keep mana for trades). */
const SPELL_LH_KEEP_MANA = 0.45;
const SPELL_LH_KEEP_PER_FARM = 0.05;

/**
 * Spell last hit (mages and low-AD champions farm with Q, spec §7 "Farm-Prioritaet"): a targeted or line damage
 * ability that lands while the minion's HP is within its damage, for a minion the auto cannot get. Line shots only
 * when no other enemy minion sits on the line before the target (blocked_by_minions hits the first one).
 */
function spellLastHit(v: View, ctx: BotStatic, m: SnapEntity, hits: { at: number; dmg: number }[], bias: number, farm: number): BotAction | null {
  const T = v.tick;
  const keep = SPELL_LH_KEEP_MANA - SPELL_LH_KEEP_PER_FARM * farm;
  for (const slot of [0, 1, 2] as const) {
    const ab = ctx.champ.abilities[slot];
    const h = v.me.abilities[slot];
    if (!ab || !h || (ab.type !== 'targeted' && ab.type !== 'skillshot_line') || !ready(v, ctx, slot)) continue;
    const eff = ab.effects.find((e) => e.kind === 'damage');
    if (!eff || eff.kind !== 'damage') continue;
    if (ab.costType === 'mana' && v.self.maxMana > 0 && (v.self.mana - h.cost) / v.self.maxMana < keep) continue;
    const rv = (x: number | number[]): number => (typeof x === 'number' ? x : x[Math.max(0, Math.min(x.length - 1, h.rank - 1))] ?? 0);
    const a = eff.amount;
    const dmg = rv(a.base) + (a.ad ?? 0) * v.me.stats.ad + (a.ap ?? 0) * v.me.stats.ap;
    const range = rv(ab.range);
    const d = dst(v.self, m);
    if (d > range + m.radius * 0.5) continue;
    if (ab.type === 'skillshot_line' && ab.flags?.includes('blocked_by_minions')) {
      const blocked = v.enemyMinions.some((o) => {
        if (o.id === m.id) return false;
        const t = ((o.x - v.self.x) * (m.x - v.self.x) + (o.y - v.self.y) * (m.y - v.self.y)) / (d * d || 1);
        if (t <= 0 || t >= 1) return false;
        const px = v.self.x + (m.x - v.self.x) * t - o.x;
        const py = v.self.y + (m.y - v.self.y) * t - o.y;
        return px * px + py * py < (o.radius + (ab.width ?? 60) / 2) ** 2;
      });
      if (blocked) continue;
    }
    const land = T + 1 + Math.round(ab.castTime * 30) + (ab.speed ? Math.ceil(d / (ab.speed / 30)) : 0);
    let before = m.hp;
    let after = m.hp;
    for (const x of hits) {
      if (x.at < land + bias) before -= x.dmg;
      if (x.at <= land + bias) after -= x.dmg;
    }
    if (after > 0 && before <= dmg) return { cmd: { t: 'cast', slot, x: Math.round(m.x), y: Math.round(m.y), ...(ab.type === 'targeted' ? { target: m.id } : {}) } };
  }
  return null;
}

/**
 * Plan the bot's next last hit. Returns an attack now, a delayed attack within this decision interval, or nothing
 * (plus the next window so the caller keeps the attack timer free).
 */
export function planLastHit(v: View, ctx: BotStatic, mem: LastHitMem, rng: Rng, intervalTicks: number, b: RankBehavior = ctx.profile.behavior): LastHitPlan {
  observeAttacks(v, mem);
  const T = v.tick;
  const as = Math.max(0.1, v.me.stats.as);
  const period = 30 / as;
  const windup = windupTicksOf(ctx.champ.base.windup, as);
  const proj = ctx.champ.attackType === 'ranged' ? ctx.champ.base.projectileSpeed ?? 2000 : 0;
  const ms = Math.max(100, v.me.stats.ms);
  // own wind-up can start (recorded tick): attack timer from the own last swing
  const ready = Math.max(T + 1, mem.ownStart + Math.floor(period));
  let best: { m: SnapEntity; delay: number; a: number; b: number; land: number; urgency: number } | null = null;
  let nextWindow = Infinity;
  let approach: { m: SnapEntity; a: number } | null = null;
  let spell: BotAction | null = null;
  for (const m of v.enemyMinions) {
    const d = dst(v.self, m);
    const reach = v.reach + m.radius;
    if (d > reach + 700) continue;
    let r = mem.roll.get(m.id);
    if (!r) {
      r = { bias: (rng.normal() * b.lastHitJitterMs * 30) / 1000, skip: rng.chance((b.errorInjectionPct / 100) * LAPSE_SHARE) };
      mem.roll.set(m.id, r);
    }
    if (r.skip) {
      mem.why.set(m.id, { s: 'skip', t: T });
      continue;
    }
    const dmg = (v.me.stats.ad * 100) / (100 + (MINION_STATS[m.kind]?.armor ?? 0));
    const hits = incomingHits(v, mem, m);
    const w = killWindow(m, hits, dmg, T);
    if (w.a === Infinity || w.a >= w.b) {
      if (!spell && w.b - T < 40) spell = spellLastHit(v, ctx, m, hits, r.bias, ctx.params.playstyle.farmPriority);
      mem.why.set(m.id, { s: w.a === Infinity ? 'noWindow' : 'emptyWindow', t: T });
      continue;
    }
    // the bot's belief: the true window shifted by its timing error
    const a = w.a + r.bias;
    const bb = w.b + r.bias;
    const walk = d > reach ? Math.ceil((d - reach) / (ms / 30)) : 0;
    const land = ready + walk + windup + Math.max(0, travelTicks(Math.min(d, reach), m.radius, proj) - 1);
    nextWindow = Math.min(nextWindow, a);
    if (walk > 0 && a - T < 45 && (!approach || a < approach.a)) approach = { m, a };
    if (land >= bb) {
      // the auto cannot make it: a damage spell might (only for a minion about to die)
      if (!spell && bb - T < 40) {
        const c = spellLastHit(v, ctx, m, hits, r.bias, ctx.params.playstyle.farmPriority);
        if (c) spell = c;
      }
      mem.why.set(m.id, { s: `tooLate:${walk > 0 ? 'walk' : ready > T + 1 ? 'timer' : 'windup'}`, t: T });
      continue; // cannot make it before the minion dies
    }
    mem.why.set(m.id, { s: 'wait', t: T });
    // aim a little into the window (never at its last tick: same-tick hits are a coin flip)
    const margin = bb === Infinity ? 1 : Math.max(0, Math.min(2, Math.floor((bb - a - 1) / 2)));
    const delay = land >= a ? 0 : Math.ceil(a + margin - land);
    const urgency = (bb === Infinity ? 1e6 : bb) - (MINION_STATS[m.kind] && m.kind === Kind.MinionSiege ? 20 : 0);
    if (!best || delay < best.delay || (delay === best.delay && urgency < best.urgency)) best = { m, delay, a, b: bb, land: land + delay, urgency };
  }
  const plan: LastHitPlan = { action: null, nextWindow, period, windup, ...(approach ? { approach: approach.m } : {}) };
  if (!best || (spell && best.delay > 0)) {
    if (spell) plan.action = spell;
    return plan;
  }
  plan.target = { id: best.m.id, a: best.a, b: best.b, land: best.land };
  mem.why.set(best.m.id, { s: best.delay <= intervalTicks ? `go:${best.delay}` : 'wait', t: T });
  if (best.delay === 0) plan.action = { cmd: { t: 'attack', target: best.m.id } };
  else if (best.delay <= intervalTicks) plan.action = { cmd: { t: 'attack', target: best.m.id }, delay: best.delay, tag: 'lh' };
  return plan;
}
