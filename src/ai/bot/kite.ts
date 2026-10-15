// Kiting, orbwalking, spacing and teamfight positioning (docs/spec-bots.md §7).
//   Orbwalk cycle: the bot issues the auto itself when the attack timer is ready (so it knows the windup start),
//   then a move at hit point + margin + rank jitter (profile lastHitJitterMs: Iron 220 ms .. Challenger 35 ms).
//   Offset < 0 = the move lands before the hit point and cancels the auto (lost), offset > window = backswing
//   wasted. The kiting axis is the orbwalk chance per auto (knob orbwalkChance); without it the bot stands and
//   lets the sim repeat the auto.
//   Spacing: own range - spacingBuffer; vs melee gap-closers dash range + 100 while the dash is believed ready.
//   Kite direction: lowest threat (PerceptionView.threat) among 8 directions, never into an unwarded bush, never
//   past the enemy wave.

import type { Pt } from '../../sim/map';
import type { Rng } from '../../sim/rng';
import { championData } from '../../sim/champions';
import type { BotAction, SnapEntity } from './types';
import type { NodeCtx } from '../bt/types';
import { dst, unit } from './geo';
import { hpPct } from './combat';
import treeData from '../../data/bots/tree.json';

export const ORBWALK = treeData.params.orbwalk as { marginMs: number; windowMs: number };

export type OrbOutcome = 'ok' | 'cancelled' | 'wasted' | 'stood';

/**
 * One auto's orbwalk decision: attempt with probability `chance`; the move lands at hit point + margin + N(0, jitter).
 * Returns the outcome and the offset (ms after the hit point; NaN when standing).
 */
export function planOrbwalk(rng: Rng, chance: number, jitterMs: number): { outcome: OrbOutcome; offsetMs: number } {
  if (!(chance > 0) || !rng.chance(chance)) return { outcome: 'stood', offsetMs: NaN };
  const off = ORBWALK.marginMs + rng.normal() * jitterMs;
  return { outcome: off < 0 ? 'cancelled' : off > ORBWALK.windowMs ? 'wasted' : 'ok', offsetMs: off };
}

/** Attack period / windup in ticks at the bot's current attack speed. */
export function attackTicks(n: NodeCtx): { period: number; windup: number } {
  const as = Math.max(0.1, n.v.me.stats.as);
  return { period: Math.max(1, Math.round(30 / as)), windup: Math.max(1, Math.round((30 * n.ctx.champ.base.windup) / as)) };
}

const inReach = (n: NodeCtx, t: SnapEntity, extra = 0): boolean => dst(n.v.self, t) <= n.v.reach + t.radius + extra;

/** Gap closer of an enemy champion (dash/blink) and its distance, from champion data. */
function gapCloser(e: SnapEntity): number {
  const c = championData(e.champ ?? '');
  let best = 0;
  for (const ab of c.abilities) if (ab.type === 'dash' || ab.type === 'blink') best = Math.max(best, ab.distance ?? (typeof ab.range === 'number' ? ab.range : ab.range[0] ?? 0));
  return c.attackType === 'melee' ? best : 0;
}

/** Desired distance to `t` (spacing, §7). */
export function spacing(n: NodeCtx, t: SnapEntity): number {
  const range = n.v.me.stats.range + n.v.self.radius + t.radius;
  let want = range - n.p.knobs.spacingBuffer;
  if (n.ctx.champ.attackType === 'ranged' && n.p.knobs.kiteBack) {
    const dash = gapCloser(t);
    if (dash > 0) {
      // ponytail: dash cooldown tracking comes with L's EnemyTrack.cds; until then aggression decides the fear
      const fear = n.p.playstyle.aggression <= 0 ? 1 : 0.5;
      want = Math.max(want, Math.min(range - 30, (dash + 100) * fear));
    }
  }
  return Math.max(n.ctx.champ.attackType === 'melee' ? 0 : 150, want);
}

/** Bush without own vision (wards in the snapshot). */
function blindBush(n: NodeCtx, p: Pt): boolean {
  for (const b of n.ctx.map.bushes) {
    if (Math.hypot(b.x - p.x, b.y - p.y) > b.r) continue;
    return !n.snap.entities.some((e) => e.ward && e.team === n.ctx.team && Math.hypot(e.x - b.x, e.y - b.y) < 900) && !n.v.allies.some((a) => Math.hypot(a.x - b.x, a.y - b.y) < b.r);
  }
  return false;
}

/** Kite step: a point `step` away along the lowest-threat direction that keeps the desired distance to `t`. */
export function kitePoint(n: NodeCtx, t: SnapEntity, step = 160): Pt {
  const want = spacing(n, t);
  const d = dst(n.v.self, t);
  const [ax, ay] = unit(t, n.v.self); // away from target
  const enemyWaveFront = n.v.enemyMinions.length ? n.v.enemyMinions.reduce((a, m) => (dst(m, n.v.self) < dst(a, n.v.self) ? m : a)) : null;
  let best: Pt = { x: n.v.self.x + ax * step, y: n.v.self.y + ay * step };
  let bestScore = Infinity;
  for (let i = 0; i < 8; i++) {
    const ang = (i * Math.PI) / 4;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const p = { x: n.v.self.x + dx * step, y: n.v.self.y + dy * step };
    const nd = dst(p, t);
    let s = Math.abs(nd - want) / 100 + n.pv.threat(p.x, p.y);
    if (d < want) s -= (dx * ax + dy * ay) * 0.5; // backing off
    if (blindBush(n, p)) s += 3;
    if (enemyWaveFront && dst(p, enemyWaveFront) < 250 && dst(enemyWaveFront, t) < dst(p, t)) s += 1.5; // past the enemy wave
    if (s < bestScore) (bestScore = s), (best = p);
  }
  return best;
}

/**
 * Auto-attack step against `t` with orbwalking (§7). Issues the auto when the timer is ready (scheduled within this
 * decision window), and per auto the kite move (tag 'orb'). Returns true if it issued anything or is mid-attack.
 */
export function orbwalkAttack(n: NodeCtx, t: SnapEntity, interval: number): boolean {
  const ext = n.mem.ext;
  const { period, windup } = attackTicks(n);
  const now = n.v.tick;
  if (!inReach(n, t, 20)) {
    // walk in (attack command paths into range); the cycle starts once in reach
    if (n.v.self.atkTarget !== t.id) n.out.push({ cmd: { t: 'attack', target: t.id } });
    n.mem.lastMove = null;
    return true;
  }
  const readyAt = Math.max(now, ext.orbPlanned >= 0 ? ext.orbPlanned : now);
  if (n.v.self.atkPhase === 1) return true; // own windup running (not planned by us): never cancel it
  if (readyAt - now > interval + 1) return true; // next auto belongs to a later decision
  const delay = readyAt - now;
  n.out.push({ cmd: { t: 'attack', target: t.id }, ...(delay > 0 ? { delay, tag: 'orb' } : {}) });
  n.mem.lastMove = null;
  const plan = planOrbwalk(n.rng, n.p.knobs.orbwalkChance, n.ctx.profile.behavior.lastHitJitterMs);
  ext.orb.autos++;
  ext.orb[plan.outcome === 'ok' ? 'ok' : plan.outcome]++;
  if (plan.outcome === 'stood') {
    ext.orbPlanned = readyAt + period;
    return true;
  }
  const moveAt = delay + windup + Math.floor(plan.offsetMs / (1000 / 30));
  const p = kitePoint(n, t);
  n.out.push({ cmd: { t: 'move', x: p.x, y: p.y }, delay: Math.max(0, moveAt), tag: 'orb' });
  // a cancelled auto keeps the attack timer (sim: timer not consumed): retry right after the move
  ext.orbPlanned = plan.outcome === 'cancelled' ? readyAt + windup + 2 : readyAt + period;
  return true;
}

/** Drop queued orbwalk orders (dodge, retreat, mode change). */
export const cancelOrbwalk = (n: NodeCtx): void => {
  n.mem.cancelTags.add('orb');
  n.mem.ext.orbPlanned = -1;
};

// ------------------------------------------------------------------ teamfight positioning (§7)

export type FightRole = 'carry' | 'frontline' | 'assassin' | 'support';

export function fightRole(n: NodeCtx): FightRole {
  const a = n.ctx.champ.archetype;
  if (n.ctx.role === 'support' && !/tank|engage/.test(a)) return 'support';
  if (/tank|juggernaut|bruiser|engage|battlemage/.test(a)) return 'frontline';
  if (/assassin/.test(a)) return 'assassin';
  return 'carry';
}

/** Focus score (§7): killProb x threat x reachability; player focus ping +0.3 (team axis via obedience). */
export function focusScore(n: NodeCtx, e: SnapEntity, focusSerial: number): number {
  const reach = Math.max(0.2, 1 - Math.max(0, dst(n.v.self, e) - n.v.reach) / 1200);
  const c = championData(e.champ ?? '');
  const threat = 0.5 + 0.1 * c.scores.range + (/marksman|mage|assassin/.test(c.archetype) ? 0.3 : 0);
  const kill = 1.2 - hpPct(e);
  return kill * threat * reach + (e.serial === focusSerial ? 0.3 * n.p.knobs.pingObedience : 0);
}

/** Where a carry stands: behind the closest frontliner relative to the enemy centroid, at spacing range. */
export function carrySpot(n: NodeCtx, enemies: SnapEntity[], target: SnapEntity, tooFar: number): Pt {
  const cx = enemies.reduce((s, e) => s + e.x, 0) / enemies.length;
  const cy = enemies.reduce((s, e) => s + e.y, 0) / enemies.length;
  const front = n.v.allies.filter((a) => dst(a, { x: cx, y: cy }) < dst(n.v.self, { x: cx, y: cy }) + 200);
  const want = spacing(n, target) - tooFar;
  const [ux, uy] = unit({ x: cx, y: cy }, front[0] ?? n.v.self); // from enemies toward own side
  const base = { x: target.x + ux * want, y: target.y + uy * want };
  return base;
}

/** Peel spot: next to the ally carry with the most damage potential, between it and the closest enemy. */
export function peelSpot(n: NodeCtx, enemies: SnapEntity[]): Pt | null {
  const carries = n.v.allies.filter((a) => {
    const c = championData(a.champ ?? '');
    return /marksman|mage/.test(c.archetype);
  });
  const c = carries.sort((a, b) => b.level - a.level)[0];
  if (!c || !enemies.length) return null;
  const e = enemies.reduce((a, x) => (dst(x, c) < dst(a, c) ? x : a));
  const [ux, uy] = unit(c, e);
  return { x: c.x + ux * 200, y: c.y + uy * 200 };
}

export const moveCmd = (p: Pt): BotAction => ({ cmd: { t: 'move', x: p.x, y: p.y } });
