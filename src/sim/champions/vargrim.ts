// Vargrim Nebelhuf hooks (cavalry juggernaut). Contract: ./hooks.ts, behaviour list: docs/champion-hooks.md.
// Passive: bonus AD from bonus move speed. Q: whirl with stacks and cooldown refund. W: damaging, healing mist aura.
// E: charge (move speed ramp, knock-back auto scaled by distance). R: spectral riders + charge, fear at the end.
import type { Sim } from '../sim';
import { CHAMP_ABILITY_DMG_MULT, Kind, sec } from '../types';
import { dealDamage } from '../damage';
import { addBuff, healUnit } from '../buffs';
import { effectAmount, enemiesInRadius, reduceCooldown, rideAlong, rv } from '../systems/abilities';
import type { ChampionHooks, ChampionVisuals, VisualObject } from './hooks';
import { ctxFor, hookState, isChampLike, peekState } from './util';
import { championData } from './index';

/** Passive: share of the total move speed converted to bonus AD (user 26 Oct: total speed, not bonus speed). */
const GALLOP_RATIO = 0.06;
const Q_STACK_MAX = 3;
const Q_STACK_SECS = 4;
const Q_STACK_BONUS = 0.15;
const Q_CDR_SECS = 0.6;
const Q_CDR_UNITS = 3;
const W_PERIOD = 15; // ticks (0.5 s)
const W_HEAL_CHAMP = 0.25;
const W_HEAL_OTHER = 0.12;
const E_RAMP_SECS = 3;
const E_RAMP_PCT = 40;
const E_DIST_MAX = 1000;
const R_RIDER_DMG = 0.35;
const R_RIDER_RADIUS = 110;
const R_OFFSETS: [number, number][] = [
  [-130, 0],
  [0, -70],
  [130, 0],
];

interface Rider {
  /** Lateral offset and lead (negative = behind) relative to the path point. */
  side: number;
  lead: number;
  x: number;
  y: number;
}
interface VState {
  stacks: number;
  stackUntil: number;
  /** W mist. */
  wUntil: number;
  wNext: number;
  wRank: number;
  /** E charge: window, start tick, distance travelled, last position, armed for the empowered auto. */
  eUntil: number;
  eStart: number;
  eDist: number;
  eX: number;
  eY: number;
  /** R riders. */
  riders: Rider[];
  /** Enemies already struck by any rider of this charge (each is hit once). */
  riderHit: Set<number>;
  rOx: number;
  rOy: number;
  rDx: number;
  rDy: number;
  rDist: number;
  rSpeed: number;
  rT: number;
  rRank: number;
  /** Distance of the last completed R dash (fear scaling). */
  rFrom: [number, number];
}

const KEY = 'vargrim';
const state = (sim: Sim, eid: number): VState => {
  const m = hookState<VState>(sim, KEY);
  let s = m.get(eid);
  if (!s)
    m.set(
      eid,
      (s = {
        stacks: 0, stackUntil: 0, wUntil: -1, wNext: 0, wRank: 1, eUntil: -1, eStart: 0, eDist: 0, eX: 0, eY: 0,
        riders: [], riderHit: new Set<number>(), rOx: 0, rOy: 0, rDx: 1, rDy: 0, rDist: 0, rSpeed: 1700, rT: -1, rRank: 1, rFrom: [0, 0],
      }),
    );
  return s;
};

const champMult = (sim: Sim, t: number): number => (sim.c.Unit.kind[t] === Kind.Champion ? CHAMP_ABILITY_DMG_MULT : 1);

/** Q stacks currently active (read by tests / HUD). */
export const vargrimStacks = (sim: Sim, eid: number): number => {
  const s = peekState<VState>(sim, KEY)?.get(eid);
  return s && sim.tick <= s.stackUntil ? s.stacks : 0;
};

/** E charge window open (ramping, auto not yet used). */
export const vargrimCharging = (sim: Sim, eid: number): boolean => {
  const s = peekState<VState>(sim, KEY)?.get(eid);
  return !!s && sim.tick <= s.eUntil;
};

/** Distance travelled during the current/last E charge. */
export const vargrimChargeDist = (sim: Sim, eid: number): number => peekState<VState>(sim, KEY)?.get(eid)?.eDist ?? 0;

function tickW(sim: Sim, eid: number, s: VState): void {
  if (s.wUntil < 0) return;
  if (sim.tick > s.wUntil) return void (s.wUntil = -1);
  if (sim.tick < s.wNext) return;
  s.wNext = sim.tick + W_PERIOD;
  const { Pos } = sim.c;
  const ab = championData('vargrim').abilities[1]!;
  const ctx = ctxFor(sim, eid, 1, s.wRank, Pos.x[eid]!, Pos.y[eid]!);
  for (const t of enemiesInRadius(sim, eid, Pos.x[eid]!, Pos.y[eid]!, ab.radius ?? 450)) {
    const d = effectAmount(sim, ctx, t, 0);
    const dealt = dealDamage(sim, eid, t, d.amount * 0.5 * champMult(sim, t), d.type);
    if (dealt > 0) healUnit(sim, eid, dealt * (isChampLike(sim, t) ? W_HEAL_CHAMP : W_HEAL_OTHER));
  }
}

function tickE(sim: Sim, eid: number, s: VState): void {
  if (s.eUntil < 0) return;
  const { Pos } = sim.c;
  if (sim.tick > s.eUntil) return void (s.eUntil = -1);
  s.eDist += Math.hypot(Pos.x[eid]! - s.eX, Pos.y[eid]! - s.eY);
  s.eX = Pos.x[eid]!;
  s.eY = Pos.y[eid]!;
  const k = Math.min(1, (sim.tick - s.eStart) / sec(E_RAMP_SECS));
  addBuff(sim, eid, { kind: 'stat', stat: 'ms', id: 'vargrim_e', src: eid, pct: E_RAMP_PCT * k, ticks: 2 });
}

/** Rider position on the path (side/lead offsets in the frame of the charge direction). */
function riderPos(s: VState, r: Rider, prog: number): [number, number] {
  const p = Math.max(0, Math.min(s.rDist, prog + r.lead));
  return [s.rOx + s.rDx * p - s.rDy * r.side, s.rOy + s.rDy * p + s.rDx * r.side];
}

function tickRiders(sim: Sim, eid: number, s: VState): void {
  if (s.rT < 0) return;
  const t = sim.tick - s.rT;
  const prog = (t * s.rSpeed) / 30;
  const ctx = ctxFor(sim, eid, 3, s.rRank, s.rOx, s.rOy);
  for (const r of s.riders) {
    [r.x, r.y] = riderPos(s, r, prog);
    for (const e of enemiesInRadius(sim, eid, r.x, r.y, R_RIDER_RADIUS)) {
      if (s.riderHit.has(e)) continue;
      s.riderHit.add(e);
      const d = effectAmount(sim, ctx, e, 0);
      dealDamage(sim, eid, e, d.amount * R_RIDER_DMG * champMult(sim, e), d.type);
    }
  }
  if (prog >= s.rDist + 200) {
    s.rT = -1;
    s.riders = [];
  }
}

function vargrimTick(sim: Sim, eid: number): void {
  const s = hookState<VState>(sim, KEY).get(eid);
  if (!s) return;
  if (!sim.c.Unit.alive[eid]) {
    s.wUntil = s.eUntil = s.rT = -1;
    s.riders = [];
    s.stacks = 0;
    return;
  }
  if (s.stacks > 0 && sim.tick > s.stackUntil) s.stacks = 0;
  tickW(sim, eid, s);
  tickE(sim, eid, s);
  tickRiders(sim, eid, s);
}

/** Snapshot (read-only): bonus AD on the passive badge, Q stacks as a mark on himself, W mist ring, E aura, riders. */
function vargrimVisuals(sim: Sim, eid: number): ChampionVisuals {
  const { Pos, Unit } = sim.c;
  const bonus = Math.round(gallopBonus(sim, eid));
  const v: ChampionVisuals = { passive: { stacks: bonus, max: 60, ready: bonus >= 25 } };
  const s = peekState<VState>(sim, KEY)?.get(eid);
  if (!s || !Unit.alive[eid]) return v;
  if (s.stacks > 0 && sim.tick <= s.stackUntil) v.marks = [{ target: eid, id: 'vargrim_q', n: s.stacks, max: Q_STACK_MAX, left: s.stackUntil - sim.tick }];
  const objs: VisualObject[] = [];
  if (sim.tick <= s.wUntil) {
    objs.push({ key: `${eid}:mist`, tag: 'vargrim_w_mist', x: Pos.x[eid]!, y: Pos.y[eid]!, r: championData('vargrim').abilities[1]!.radius ?? 450, shape: 'dome', left: s.wUntil - sim.tick, total: sec(4), hue: 165 });
    v.aura = 1;
  }
  if (sim.tick <= s.eUntil) {
    v.aura = 2;
    v.empowered = 2;
  }
  if (s.rT >= 0)
    s.riders.forEach((r, i) => objs.push({ key: `${eid}:rider${i}`, tag: 'vargrim_rider', x: r.x, y: r.y, r: 60, shape: 'pin', x2: r.x + s.rDx * 100, y2: r.y + s.rDy * 100, hue: 165 }));
  if (objs.length) v.objects = objs;
  return v;
}

/** Bonus AD from total move speed: 6 % of the current move speed (~21 AD at 345 MS, ~30 AD at 500 MS). */
function gallopBonus(sim: Sim, eid: number): number {
  return Math.max(0, sim.c.Stats.ms[eid]!) * GALLOP_RATIO;
}

export const hooks: ChampionHooks = {
  visuals: vargrimVisuals,
  onTick: vargrimTick,
  ownsHits: ['vargrim_w'],
  passive: {
    vargrim_gallop: {
      onSpawn(sim, eid) {
        state(sim, eid);
      },
      // Stats are rebuilt every tick before this runs: no compounding.
      onComputeStats(sim, eid) {
        const { Stats } = sim.c;
        const bonus = gallopBonus(sim, eid);
        Stats.ad[eid] = Stats.ad[eid]! + bonus;
        Stats.bonusAd[eid] = Stats.bonusAd[eid]! + bonus;
      },
    },
  },
  effects: {
    // Q (before the damage effect): +15 % per Whirl stack.
    vargrim_q_rampage(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      ctx.dmgMult = (ctx.dmgMult ?? 1) * (1 + Q_STACK_BONUS * vargrimStacks(sim, ctx.caster));
    },
    // Q (after the damage effect): cooldown refund per enemy hit, stack for a champion/monster hit.
    vargrim_q_refund(sim, ctx) {
      if (ctx.phase !== 'cast' || !ctx.hits.length) return;
      const s = state(sim, ctx.caster);
      reduceCooldown(sim, ctx.caster, 0, sec(Q_CDR_SECS * Math.min(Q_CDR_UNITS, ctx.hits.length)));
      if (ctx.hits.some((t) => sim.c.Unit.kind[t] === Kind.Monster || isChampLike(sim, t))) {
        s.stacks = Math.min(Q_STACK_MAX, vargrimStacks(sim, ctx.caster) + 1);
        s.stackUntil = sim.tick + sec(Q_STACK_SECS);
      }
    },
    // W: start the mist (damage and healing tick in onTick; the generic damage effect is read as per-second data).
    vargrim_w_dread(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      const s = state(sim, ctx.caster);
      s.wUntil = sim.tick + sec(rv(ctx.ability.duration, ctx.rank) || 4);
      s.wNext = sim.tick + W_PERIOD;
      s.wRank = ctx.rank;
    },
    // E: *_next_auto (arms the next auto for `duration`). Cast: start the ramp. Empowered: damage scales with distance.
    vargrim_e_next_auto(sim, ctx) {
      const { Pos } = sim.c;
      const s = state(sim, ctx.caster);
      if (ctx.phase === 'cast') {
        s.eStart = sim.tick;
        s.eUntil = sim.tick + sec(rv(ctx.ability.duration, ctx.rank) || 4);
        s.eDist = 0;
        s.eX = Pos.x[ctx.caster]!;
        s.eY = Pos.y[ctx.caster]!;
      } else if (ctx.phase === 'empowered') {
        // distance up to the moment of the hit
        s.eDist += Math.hypot(Pos.x[ctx.caster]! - s.eX, Pos.y[ctx.caster]! - s.eY);
        ctx.dmgMult = (ctx.dmgMult ?? 1) * (1 + Math.min(1, s.eDist / E_DIST_MAX));
        s.eUntil = -1;
        // LoL Hecarim: he rides after the knocked-back target and lands right behind it
        const t = ctx.target;
        if (t >= 0 && sim.c.Unit.alive[t]) {
          const dx = Pos.x[t]! - Pos.x[ctx.caster]!;
          const dy = Pos.y[t]! - Pos.y[ctx.caster]!;
          const l = Math.hypot(dx, dy) || 1;
          const knock = (ctx.ability.effects.find((x) => x.kind === 'knockback') as { distance: number } | undefined)?.distance ?? 0;
          rideAlong(sim, ctx.caster, dx / l, dy / l, knock);
        }
      }
    },
    // R: dashStart spawns the riders along the path; the landing (phase cast) frightens champions.
    vargrim_r_legion(sim, ctx) {
      const { Pos } = sim.c;
      const e = ctx.caster;
      const s = state(sim, e);
      if (ctx.phase === 'dashStart' && ctx.dash) {
        s.rOx = Pos.x[e]!;
        s.rOy = Pos.y[e]!;
        const l = Math.hypot(ctx.dash.dx, ctx.dash.dy) || 1;
        s.rDx = ctx.dash.dx / l;
        s.rDy = ctx.dash.dy / l;
        s.rDist = ctx.dash.distance;
        s.rSpeed = ctx.dash.speed;
        s.rRank = ctx.rank;
        s.rT = sim.tick;
        s.rFrom = [Pos.x[e]!, Pos.y[e]!];
        s.riders = R_OFFSETS.map(([side, lead]) => ({ side, lead, x: s.rOx, y: s.rOy }));
        s.riderHit = new Set<number>();
        return;
      }
      if (ctx.phase !== 'cast') return;
      const travelled = Math.hypot(Pos.x[e]! - s.rFrom[0], Pos.y[e]! - s.rFrom[1]);
      const secs = rv(ctx.ability.duration, ctx.rank) * (0.6 + 0.4 * Math.min(1, travelled / 800));
      for (const t of ctx.hits) if (isChampLike(sim, t) && sim.c.Unit.alive[t]) addBuff(sim, t, { kind: 'fear', id: 'vargrim_r', src: e, ticks: sec(secs) });
    },
  },
};
