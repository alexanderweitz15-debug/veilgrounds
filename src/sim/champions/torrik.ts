// Torrik Wetterreiter hooks (storm rider on a wolf). Contract: ./hooks.ts, behaviour list: docs/champion-hooks.md.
// Mounted/afoot state machine (passive), chain lightning (Q, R), Charge mark consumed by E.
import { query } from 'bitecs';
import type { Sim } from '../sim';
import { Kind, sec } from '../types';
import { dealDamage } from '../damage';
import { addBuff, addShield, buffs, hasBuff, removeBuffs } from '../buffs';
import { dist2 } from '../vec';
import { effectAmount, enemiesInRadius } from '../systems/abilities';
import { sees } from '../vision';
import type { ChampionHooks, ChampionVisuals, EffectCtx, UnitMark, VisualObject } from './hooks';
import { byLevel, ctxFor, hookState, peekState } from './util';

export const CHARGE = 'torrik_charge';
/** Under this HP share the wolf throws him. */
export const DISMOUNT_HP = 0.3;
export const REMOUNT_TICKS = sec(30);
export const MOUNT_MS_MULT = 1.08;
export const AFOOT_AS_PCT = 25;
/** Chain lightning: reach per jump, damage kept per jump, jumps mounted / afoot. */
export const CHAIN_RANGE = 450;
export const CHAIN_MULT = 0.6;
export const CHAIN_MOUNTED = 2;
export const CHAIN_AFOOT = 3;
export const LEAP_MOUNTED = 550;
export const LEAP_AFOOT = 350;
export const FRONT_TICKS = sec(4);
export const FRONT_PERIOD = sec(0.8);
export const FRONT_RANGE = 600;
export const FRONT_MULT = 0.5;
export const E_STUN_TICKS = sec(0.75);
export const E_BONUS = 0.5;
const BURST_RADIUS = 350;
const ARC_TICKS = 8;

interface Arc {
  x: number;
  y: number;
  x2: number;
  y2: number;
  until: number;
}

interface TorrikState {
  mounted: boolean;
  remountAt: number;
  pending: boolean;
  front: { until: number; next: number; rank: number } | null;
  arcs: Arc[];
  burst: { x: number; y: number; until: number } | null;
}

const KEY = 'torrik';
const state = (sim: Sim, eid: number): TorrikState => {
  const m = hookState<TorrikState>(sim, KEY);
  let s = m.get(eid);
  if (!s) m.set(eid, (s = { mounted: true, remountAt: -1, pending: false, front: null, arcs: [], burst: null }));
  return s;
};

/** Mounted? (tests / HUD) */
export const isMounted = (sim: Sim, eid: number): boolean => peekState<TorrikState>(sim, KEY)?.get(eid)?.mounted ?? true;

function mount(sim: Sim, eid: number): void {
  const s = state(sim, eid);
  s.mounted = true;
  s.pending = false;
  s.remountAt = -1;
  removeBuffs(sim, eid, (b) => b.id === 'torrik_afoot');
}

function dismount(sim: Sim, eid: number): void {
  const { Pos } = sim.c;
  const s = state(sim, eid);
  s.mounted = false;
  s.pending = false;
  s.remountAt = sim.tick + REMOUNT_TICKS;
  addShield(sim, eid, byLevel(sim, eid, 90, 350), sec(3), 'torrik_dismount', eid);
  addBuff(sim, eid, { kind: 'stat', stat: 'as', id: 'torrik_afoot', src: eid, pct: AFOOT_AS_PCT, ticks: REMOUNT_TICKS });
  const x = Pos.x[eid]!;
  const y = Pos.y[eid]!;
  const dmg = byLevel(sim, eid, 70, 260);
  for (const t of enemiesInRadius(sim, eid, x, y, BURST_RADIUS)) {
    dealDamage(sim, eid, t, dmg, 'magic');
    addBuff(sim, t, { kind: 'slow', id: 'torrik_dismount', src: eid, pct: 40, ticks: sec(1.5) });
  }
  s.burst = { x, y, until: sim.tick + ARC_TICKS };
}

/**
 * Lightning jumps from `first` to the nearest other enemy within CHAIN_RANGE of the previous one, `jumps` times, each
 * hit for CHAIN_MULT of `amount * mult` and marked with Charge. `hitFirst`: the first target is damaged by the call too
 * (Storm Front strikes, `mult` = FRONT_MULT); Q's first target is hit by the generic effects.
 */
function chain(sim: Sim, eid: number, first: number, amount: number, jumps: number, hitFirst: boolean, mult: number): void {
  const base = amount * mult;
  const { Pos } = sim.c;
  const s = state(sim, eid);
  const hit = new Set<number>([first]);
  let from = first;
  if (hitFirst) {
    dealDamage(sim, eid, first, base, 'magic');
    addBuff(sim, first, { kind: 'mark', id: CHARGE, src: eid, ticks: sec(4) });
  }
  for (let j = 0; j < jumps; j++) {
    let best = -1;
    let bestD = Infinity;
    const fx = Pos.x[from]!;
    const fy = Pos.y[from]!;
    for (const t of enemiesInRadius(sim, eid, fx, fy, CHAIN_RANGE)) {
      if (hit.has(t)) continue;
      const d = dist2(Pos.x[t]!, Pos.y[t]!, fx, fy);
      if (d < bestD) (bestD = d), (best = t);
    }
    if (best < 0) return;
    hit.add(best);
    s.arcs.push({ x: fx, y: fy, x2: Pos.x[best]!, y2: Pos.y[best]!, until: sim.tick + ARC_TICKS });
    dealDamage(sim, eid, best, base * CHAIN_MULT, 'magic');
    addBuff(sim, best, { kind: 'mark', id: CHARGE, src: eid, ticks: sec(4) });
    from = best;
  }
}

const jumpsOf = (sim: Sim, eid: number): number => (state(sim, eid).mounted ? CHAIN_MOUNTED : CHAIN_AFOOT);

/** Snapshot (read-only): HUD badge (mounted / remount timer), Charge pips on marked enemies, arcs and the burst ring. */
function torrikVisuals(sim: Sim, eid: number): ChampionVisuals {
  const s = peekState<TorrikState>(sim, KEY)?.get(eid);
  const out: ChampionVisuals = {};
  out.passive = s && !s.mounted ? { ready: false, cdLeft: Math.max(0, s.remountAt - sim.tick), cdTotal: REMOUNT_TICKS } : { ready: true };
  if (s?.front && s.front.until > sim.tick) out.aura = 3;
  if (!sim.c.Unit.alive[eid]) return out;
  const objects: VisualObject[] = [];
  s?.arcs.forEach((a, i) => {
    if (a.until > sim.tick) objects.push({ key: `${eid}:arc${a.until}:${i}`, tag: 'torrik_arc', x: a.x, y: a.y, x2: a.x2, y2: a.y2, r: 24, shape: 'line', left: a.until - sim.tick, total: ARC_TICKS });
  });
  if (s?.burst && s.burst.until > sim.tick) objects.push({ key: `${eid}:burst`, tag: 'torrik_burst', x: s.burst.x, y: s.burst.y, r: BURST_RADIUS, shape: 'ring', left: s.burst.until - sim.tick, total: ARC_TICKS });
  if (objects.length) out.objects = objects;
  const team = sim.c.Unit.team[eid]!;
  const marks: UnitMark[] = [];
  for (const t of query(sim.world, [sim.c.Unit])) {
    if (!sim.c.Unit.alive[t] || sim.c.Unit.team[t] === team || !hasBuff(sim, t, 'mark', CHARGE) || !sees(sim, team, t)) continue;
    const b = buffs(sim, t).find((x) => x.kind === 'mark' && x.id === CHARGE);
    marks.push({ target: t, id: CHARGE, left: b ? b.until - sim.tick : 0 });
  }
  if (marks.length) out.marks = marks;
  return out;
}

export const hooks: ChampionHooks = {
  visuals: torrikVisuals,
  passive: {
    torrik_wolf_ride: {
      onSpawn(sim, eid) {
        state(sim, eid);
      },
      onComputeStats(sim, eid) {
        const { Stats } = sim.c;
        if (state(sim, eid).mounted && Stats.ms[eid]! > 0) Stats.ms[eid] = Stats.ms[eid]! * MOUNT_MS_MULT;
      },
      onDamageTaken(sim, eid) {
        const { Hp } = sim.c;
        const s = state(sim, eid);
        if (s.mounted && Hp.cur[eid]! > 0 && Hp.cur[eid]! < Hp.max[eid]! * DISMOUNT_HP) s.pending = true; // resolved in onTick (not inside the damage call)
      },
      onTakedown(sim, eid) {
        if (!state(sim, eid).mounted) mount(sim, eid);
      },
    },
  },
  onTick(sim, eid) {
    const { Unit, Pos } = sim.c;
    const s = state(sim, eid);
    s.arcs = s.arcs.filter((a) => a.until > sim.tick);
    if (!Unit.alive[eid]) {
      // death: the wolf waits at the fountain
      if (!s.mounted) mount(sim, eid);
      s.front = null;
      s.pending = false;
      return;
    }
    if (s.pending && s.mounted && sim.c.Hp.cur[eid]! > 0) dismount(sim, eid);
    s.pending = false;
    if (!s.mounted && sim.tick >= s.remountAt) mount(sim, eid);
    const f = s.front;
    if (!f) return;
    if (sim.tick >= f.until) return void (s.front = null);
    if (sim.tick < f.next) return;
    f.next += FRONT_PERIOD;
    // strike the nearest enemy within reach, champions first
    let best = -1;
    let bestScore = Infinity;
    for (const t of enemiesInRadius(sim, eid, Pos.x[eid]!, Pos.y[eid]!, FRONT_RANGE)) {
      const score = dist2(Pos.x[t]!, Pos.y[t]!, Pos.x[eid]!, Pos.y[eid]!) + (Unit.kind[t] === Kind.Champion ? 0 : 1e8);
      if (score < bestScore) (bestScore = score), (best = t);
    }
    if (best < 0) return;
    const ctx = ctxFor(sim, eid, 3, f.rank, Pos.x[best]!, Pos.y[best]!, [best]);
    chain(sim, eid, best, effectAmount(sim, ctx, best, 0).amount, 1, true, FRONT_MULT);
  },
  effects: {
    // Q: lightning jumps on from the target (2 mounted, 3 afoot); the target itself is hit by the generic effects.
    torrik_q_chain(sim, ctx: EffectCtx) {
      if (ctx.phase !== 'cast') return;
      const first = ctx.hits[0] ?? ctx.target;
      if (first < 0 || !sim.c.Unit.alive[first]) return;
      chain(sim, ctx.caster, first, effectAmount(sim, ctx, first, 0).amount, jumpsOf(sim, ctx.caster), false, 1);
    },
    // W: afoot the leap is shorter.
    torrik_w_reach(sim, ctx) {
      if (ctx.phase === 'dashStart' && ctx.dash && !state(sim, ctx.caster).mounted) ctx.dash.distance = Math.min(ctx.dash.distance, LEAP_AFOOT);
    },
    // E: every hit enemy with Charge loses it, is stunned and takes bonus damage.
    torrik_e_discharge(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      for (const t of ctx.hits) {
        if (!hasBuff(sim, t, 'mark', CHARGE)) continue;
        removeBuffs(sim, t, (b) => b.kind === 'mark' && b.id === CHARGE);
        addBuff(sim, t, { kind: 'stun', id: 'torrik_e', src: ctx.caster, ticks: E_STUN_TICKS });
        dealDamage(sim, ctx.caster, t, effectAmount(sim, ctx, t, 0).amount * E_BONUS, 'magic');
      }
    },
    // R: after the instant strike the storm front follows for 4 s (strikes in onTick).
    torrik_r_front(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      state(sim, ctx.caster).front = { until: sim.tick + FRONT_TICKS, next: sim.tick + FRONT_PERIOD, rank: ctx.rank };
    },
  },
};
