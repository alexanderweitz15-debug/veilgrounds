// Sev Aschenblick hooks (Fassung 3, docs/champions/sev.md). Contract: ./hooks.ts, behaviour list: docs/champion-hooks.md.
// Passive Rabenblick (Gaze stacks -> genjutsu stun), Q Feuerball (fake recast, explosion, burning ground), W Krähendoppel
// (blink + crow clone decoy that bursts), E Bannblick (eye contact: stun if facing Sev, else slow), R = choice of
// Amaterasu (uncleansable black flames, jump on death) / Susanoo (shield, sweeps, thrust recast) / Tsukuyomi
// (suppression, Sev rooted, missing-HP execute). All numbers live in sev.json except the hook constants below.

import { query } from 'bitecs';
import type { Sim } from '../sim';
import { CHAMP_ABILITY_DMG_MULT, Kind, sec } from '../types';
import { addBuff, buffs, hasBuff, removeBuffs } from '../buffs';
import { dealDamage } from '../damage';
import { cancelCast, closeRecast, effectAmount, enemiesInRadius, enemiesOnSegment, openRecast, rv, ultChoiceOf } from '../systems/abilities';
import { extendPet, petOwner, petTag, petsOf, removePet, spawnPet } from '../summons';
import type { ChampionHooks, ChampionVisuals, EffectCtx, UnitMark, VisualObject } from './hooks';
import { ctxFor, hookState, isChampLike, peekState } from './util';
import type { Effect } from './schema';

export const BLICK = 'sev_blick';
export const GENJUTSU = 'sev_genjutsu';
export const DECOY = 'sev_decoy';
export const AMATERASU = 'sev_r1';
export const MOON = 'sev_r3_moon';

// hook constants (not ability numbers)
const BLICK_MAX = 3;
const BLICK_TICKS = sec(6);
const GENJUTSU_TICKS = sec(0.75);
const GENJUTSU_CD = sec(12);
const FIRE_TICK = sec(0.5);
const GRIEVOUS_PCT = 40;
const SWEEP_RADIUS = 300;
const BURST_SHOW = sec(0.6);

// ------------------------------------------------------------------ state

interface Blick {
  t: number;
  serial: number;
  n: number;
  until: number;
  /** Genjutsu ready again at this tick. */
  cdUntil: number;
}
interface Ground {
  x: number;
  y: number;
  r: number;
  start: number;
  until: number;
  rank: number;
}
interface Clone {
  eid: number;
  serial: number;
  until: number;
  rank: number;
}
interface Flame {
  t: number;
  serial: number;
  amount: number;
  start: number;
  until: number;
  x: number;
  y: number;
  jumped: boolean;
  rank: number;
}
interface Moon {
  t: number;
  serial: number;
  rank: number;
  start: number;
  end: number;
}
interface SevState {
  blick: Blick[];
  grounds: Ground[];
  clone: Clone | null;
  bursts: { x: number; y: number; r: number; until: number }[];
  flames: Flame[];
  susanooUntil: number;
  susanooRank: number;
  /** Last sword thrust (visual): segment + end tick. */
  thrust: { ax: number; ay: number; bx: number; by: number; until: number } | null;
  moon: Moon | null;
}

const states = (sim: Sim): Map<number, SevState> => hookState<SevState>(sim, 'sev3');
function st(sim: Sim, sev: number): SevState {
  let s = states(sim).get(sev);
  if (!s) states(sim).set(sev, (s = { blick: [], grounds: [], clone: null, bursts: [], flames: [], susanooUntil: 0, susanooRank: 1, thrust: null, moon: null }));
  return s;
}
const peek = (sim: Sim, sev: number): SevState | undefined => peekState<SevState>(sim, 'sev3')?.get(sev);

const champMult = (sim: Sim, t: number): number => (sim.c.Unit.kind[t] === Kind.Champion ? CHAMP_ABILITY_DMG_MULT : 1);
const effOf = (e: Effect[], kind: Effect['kind']): Effect | undefined => e.find((x) => x.kind === kind);

// ------------------------------------------------------------------ passive: Rabenblick

/** Gaze stacks of `sev` on `t` (0 if none / expired). */
export function blickStacks(sim: Sim, sev: number, t: number): number {
  const b = peek(sim, sev)?.blick.find((x) => x.t === t && x.serial === sim.c.Unit.serial[t]);
  return b && b.until > sim.tick ? b.n : 0;
}

/** One Gaze stack on an enemy champion (or dummy); at 3 the genjutsu stun fires (per-target cooldown). */
export function addBlick(sim: Sim, sev: number, t: number): void {
  const { Unit } = sim.c;
  if (t < 0 || !Unit.alive[t] || Unit.team[t] === Unit.team[sev] || !isChampLike(sim, t)) return;
  const s = st(sim, sev);
  let b = s.blick.find((x) => x.t === t && x.serial === Unit.serial[t]);
  if (!b) s.blick.push((b = { t, serial: Unit.serial[t]!, n: 0, until: 0, cdUntil: 0 }));
  if (b.until <= sim.tick) b.n = 0;
  b.n = Math.min(BLICK_MAX, b.n + 1);
  b.until = sim.tick + BLICK_TICKS;
  if (b.n >= BLICK_MAX && sim.tick >= b.cdUntil) {
    addBuff(sim, t, { kind: 'stun', id: GENJUTSU, src: sev, ticks: GENJUTSU_TICKS });
    b.n = 0;
    b.cdUntil = sim.tick + GENJUTSU_CD;
  }
}

// ------------------------------------------------------------------ Q Feuerball

function explode(sim: Sim, ctx: EffectCtx, x: number, y: number): void {
  const sev = ctx.caster;
  const r = ctx.ability.radius ?? 300;
  for (const t of enemiesInRadius(sim, sev, x, y, r)) {
    if (sim.c.Unit.kind[t] === Kind.Pet) continue;
    const d = effectAmount(sim, ctx, t, 0);
    dealDamage(sim, sev, t, d.amount * champMult(sim, t), d.type);
    addBlick(sim, sev, t);
  }
  const dur = sec(rv(ctx.ability.duration, ctx.rank) || 1.5);
  st(sim, sev).grounds.push({ x, y, r, start: sim.tick, until: sim.tick + dur, rank: ctx.rank });
}

function tickGrounds(sim: Sim, sev: number, s: SevState): void {
  if (!s.grounds.length) return;
  s.grounds = s.grounds.filter((g) => g.until > sim.tick);
  for (const g of s.grounds) {
    const age = sim.tick - g.start;
    if (age <= 0 || age % FIRE_TICK !== 0) continue;
    const ctx = ctxFor(sim, sev, 0, g.rank, g.x, g.y);
    for (const t of enemiesInRadius(sim, sev, g.x, g.y, g.r)) {
      if (sim.c.Unit.kind[t] === Kind.Pet) continue;
      const d = effectAmount(sim, ctx, t, 1); // per second
      dealDamage(sim, sev, t, ((d.amount * FIRE_TICK) / sec(1)) * champMult(sim, t), d.type);
    }
  }
}

// ------------------------------------------------------------------ W Krähendoppel

function spawnClone(sim: Sim, ctx: EffectCtx): void {
  const sev = ctx.caster;
  const s = st(sim, sev);
  if (s.clone) burst(sim, sev, s);
  const { Pos, Hp, Mana, Stats, Unit, Face } = sim.c;
  // start position = position at the start of this tick (the blink already moved Sev)
  const x = Pos.px[sev]!;
  const y = Pos.py[sev]!;
  const life = sec(rv(ctx.ability.duration, ctx.rank) || 1.5);
  const d = spawnPet(sim, {
    owner: sev, tag: DECOY, x, y, ticks: life + 2, radius: Unit.radius[sev]!, hp: Hp.cur[sev]!, ad: 0, as: Stats.as[sev]!,
    range: Stats.range[sev]!, armor: Stats.armor[sev]!, mr: Stats.mr[sev]!, projectileSpeed: 1600,
  });
  Hp.max[d] = Hp.max[sev]!; // fake health bar: Sev's numbers
  Mana.max[d] = Mana.max[sev]!;
  Mana.cur[d] = Mana.cur[sev]!;
  Pos.px[d] = x;
  Pos.py[d] = y;
  Face.x[d] = Face.x[sev]!;
  Face.y[d] = Face.y[sev]!;
  s.clone = { eid: d, serial: Unit.serial[d]!, until: sim.tick + life, rank: ctx.rank };
  // substitution: enemy homing projectiles (autos, targeted abilities) already flying at Sev switch to the clone
  const { Proj } = sim.c;
  for (const p of query(sim.world, [Proj])) {
    if (Proj.kind[p] === 1 || Proj.target[p] !== sev || Proj.team[p] === Unit.team[sev]) continue;
    Proj.target[p] = d;
    Proj.targetSerial[p] = Unit.serial[d]!;
  }
}

/** The clone bursts into crows: AoE damage + slow + Gaze stacks, then disappears. */
function burst(sim: Sim, sev: number, s: SevState): void {
  const c = s.clone;
  s.clone = null;
  if (!c) return;
  const { Unit, Pos } = sim.c;
  if (Unit.serial[c.eid] !== c.serial) return;
  const x = Pos.x[c.eid]!;
  const y = Pos.y[c.eid]!;
  removePet(sim, c.eid);
  const ctx = ctxFor(sim, sev, 1, c.rank, x, y);
  const slow = effOf(ctx.ability.effects, 'slow') as Extract<Effect, { kind: 'slow' }> | undefined;
  for (const t of enemiesInRadius(sim, sev, x, y, ctx.ability.radius ?? 350)) {
    if (Unit.kind[t] === Kind.Pet) continue;
    const d = effectAmount(sim, ctx, t, 0);
    dealDamage(sim, sev, t, d.amount * champMult(sim, t), d.type);
    if (slow) addBuff(sim, t, { kind: 'slow', id: 'sev_w', src: sev, pct: rv(slow.pct, c.rank), ticks: sec(rv(slow.duration, c.rank)) });
    addBlick(sim, sev, t);
  }
  s.bursts.push({ x, y, r: ctx.ability.radius ?? 350, until: sim.tick + BURST_SHOW });
}

function tickClone(sim: Sim, sev: number, s: SevState): void {
  if (s.bursts.length) s.bursts = s.bursts.filter((b) => b.until > sim.tick);
  const c = s.clone;
  if (!c) return;
  const { Unit, Atk, Face, Pos } = sim.c;
  if (Unit.serial[c.eid] !== c.serial || !Unit.alive[c.eid]) return void (s.clone = null);
  if (sim.tick >= c.until) return burst(sim, sev, s);
  // the clone mirrors Sev's attack target (harmless autos: 0 AD)
  const t = Atk.target[sev]!;
  if (t >= 0 && Atk.targetSerial[sev] === Unit.serial[t] && Unit.alive[t] && Unit.team[t] !== Unit.team[sev]) {
    if (Atk.target[c.eid] !== t) (Atk.target[c.eid] = t), (Atk.targetSerial[c.eid] = Unit.serial[t]!);
    const dx = Pos.x[t]! - Pos.x[c.eid]!;
    const dy = Pos.y[t]! - Pos.y[c.eid]!;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0) (Face.x[c.eid] = dx / len), (Face.y[c.eid] = dy / len);
  } else Atk.target[c.eid] = -1;
}

export const sevClone = (sim: Sim, sev: number): number => {
  const c = peek(sim, sev)?.clone;
  return c && sim.c.Unit.serial[c.eid] === c.serial && sim.c.Unit.alive[c.eid] ? c.eid : -1;
};

// ------------------------------------------------------------------ E Bannblick

/** True if `t` looks toward `sev` (angle between its facing and the direction to Sev below 90 degrees). */
export function facesSev(sim: Sim, t: number, sev: number): boolean {
  const { Pos, Face } = sim.c;
  const dx = Pos.x[sev]! - Pos.x[t]!;
  const dy = Pos.y[sev]! - Pos.y[t]!;
  return Face.x[t]! * dx + Face.y[t]! * dy > 0;
}

// ------------------------------------------------------------------ R1 Amaterasu

function igniteFlames(sim: Sim, sev: number, t: number, amount: number, ticks: number, jumped: boolean, rank: number): void {
  const { Unit, Pos } = sim.c;
  addBuff(sim, t, { kind: 'dot', id: AMATERASU, src: sev, amount: amount * champMult(sim, t), period: sec(1), dmgType: 'magic', ticks, uncleansable: true });
  addBuff(sim, t, { kind: 'grievous', id: AMATERASU, src: sev, pct: GRIEVOUS_PCT, ticks, uncleansable: true });
  const s = st(sim, sev);
  s.flames = s.flames.filter((f) => f.t !== t);
  s.flames.push({ t, serial: Unit.serial[t]!, amount, start: sim.tick, until: sim.tick + ticks, x: Pos.x[t]!, y: Pos.y[t]!, jumped, rank });
}

function tickFlames(sim: Sim, sev: number, s: SevState): void {
  if (!s.flames.length) return;
  const { Unit, Pos } = sim.c;
  const keep: Flame[] = [];
  for (const f of s.flames) {
    if (sim.tick >= f.until) continue;
    if (Unit.serial[f.t] === f.serial && Unit.alive[f.t]) {
      f.x = Pos.x[f.t]!;
      f.y = Pos.y[f.t]!;
      keep.push(f);
      continue;
    }
    // died burning: jump once to the nearest enemy (champion, minion, monster) within the ability radius
    if (f.jumped) continue;
    const r = ctxFor(sim, sev, 3, f.rank, 0, 0).ability.radius ?? 400;
    let best = -1;
    let bestD = Infinity;
    for (const e of enemiesInRadius(sim, sev, f.x, f.y, r)) {
      if (e === f.t || Unit.kind[e] === Kind.Pet) continue;
      const d = (Pos.x[e]! - f.x) * (Pos.x[e]! - f.x) + (Pos.y[e]! - f.y) * (Pos.y[e]! - f.y);
      if (d < bestD) (bestD = d), (best = e);
    }
    if (best < 0) continue;
    igniteFlames(sim, sev, best, f.amount, f.until - sim.tick, true, f.rank);
    keep.push(st(sim, sev).flames.pop()!);
  }
  s.flames = keep;
}

export const isAmaterasuBurning = (sim: Sim, t: number): boolean => hasBuff(sim, t, 'dot', AMATERASU);

// ------------------------------------------------------------------ R2 Susanoo

export const susanooActive = (sim: Sim, sev: number): boolean => (peek(sim, sev)?.susanooUntil ?? 0) > sim.tick;

// ------------------------------------------------------------------ R3 Tsukuyomi

function tickMoon(sim: Sim, sev: number, s: SevState): void {
  const m = s.moon;
  if (!m) return;
  const { Unit, Pos } = sim.c;
  if (Unit.serial[m.t] !== m.serial || !Unit.alive[m.t]) return void (s.moon = null);
  if (sim.tick < m.end) return;
  s.moon = null;
  const ctx = ctxFor(sim, sev, 3, m.rank, Pos.x[m.t]!, Pos.y[m.t]!, [m.t]);
  const d = effectAmount(sim, ctx, m.t);
  dealDamage(sim, sev, m.t, d.amount * champMult(sim, m.t), d.type);
  addBlick(sim, sev, m.t);
}

export const tsukuyomiTarget = (sim: Sim, sev: number): number => peek(sim, sev)?.moon?.t ?? -1;

// ------------------------------------------------------------------ visuals (read-only)

interface CastView {
  slot: number;
  target: number;
}
function castOf(sim: Sim, eid: number): CastView | null {
  const a = (sim.state.abilities as { champs: Map<number, { serial: number; cast: CastView | null }> } | undefined)?.champs.get(eid);
  return a && a.serial === sim.c.Unit.serial[eid] ? a.cast : null;
}

function sevVisuals(sim: Sim, eid: number): ChampionVisuals {
  const { Unit, Pos } = sim.c;
  const s = peek(sim, eid);
  const v: ChampionVisuals = {};
  const marks: UnitMark[] = [];
  const objects: VisualObject[] = [];
  let flare = false;
  for (const b of s?.blick ?? []) {
    if (b.until <= sim.tick || Unit.serial[b.t] !== b.serial || !Unit.alive[b.t] || b.n <= 0) continue;
    marks.push({ target: b.t, id: BLICK, n: b.n, max: BLICK_MAX, left: b.until - sim.tick });
    if (b.n >= BLICK_MAX - 1) flare = true;
  }
  for (const g of s?.grounds ?? []) {
    if (g.until > sim.tick) objects.push({ key: `${eid}:q${g.start}:${g.x | 0}`, tag: 'sev_q_fire', x: g.x, y: g.y, r: g.r, shape: 'disc', left: g.until - sim.tick, total: g.until - g.start, hue: 22 });
  }
  for (const b of s?.bursts ?? []) objects.push({ key: `${eid}:w${b.until}`, tag: 'sev_w_crows', x: b.x, y: b.y, r: b.r, shape: 'ring', left: b.until - sim.tick, total: BURST_SHOW, hue: 270 });
  for (const f of s?.flames ?? []) {
    if (f.until <= sim.tick) continue;
    objects.push({ key: `${eid}:r1:${f.t}`, tag: 'sev_r1_flames', x: f.x, y: f.y, r: 110, shape: 'disc', left: f.until - sim.tick, total: f.until - f.start, hue: 350 });
    marks.push({ target: f.t, id: AMATERASU, left: f.until - sim.tick });
  }
  if (s && s.susanooUntil > sim.tick && Unit.alive[eid]) {
    objects.push({ key: `${eid}:r2`, tag: 'sev_r2_susanoo', x: Pos.x[eid]!, y: Pos.y[eid]!, r: 240, shape: 'dome', left: s.susanooUntil - sim.tick, total: sec(6), hue: 14 });
  }
  if (s?.thrust && s.thrust.until > sim.tick) {
    const th = s.thrust;
    objects.push({ key: `${eid}:r2t`, tag: 'sev_r2_thrust', x: th.ax, y: th.ay, x2: th.bx, y2: th.by, r: 60, shape: 'wall', left: th.until - sim.tick, total: sec(0.35), hue: 14 });
  }
  if (s?.moon && Unit.alive[s.moon.t]) {
    const m = s.moon;
    objects.push({ key: `${eid}:r3`, tag: 'sev_r3_moon', x: Pos.x[m.t]!, y: Pos.y[m.t]!, r: 200, shape: 'disc', left: Math.max(0, m.end - sim.tick), total: m.end - m.start, hue: 355 });
  }
  // E eye contact during the wind-up: a gaze line Sev -> target (telegraph)
  const c = castOf(sim, eid);
  if (c && c.slot === 2 && c.target >= 0 && Unit.alive[c.target]) {
    objects.push({ key: `${eid}:e`, tag: 'sev_e_gaze', x: Pos.x[eid]!, y: Pos.y[eid]!, x2: Pos.x[c.target]!, y2: Pos.y[c.target]!, follow: c.target, r: 12, shape: 'line', hue: 0 });
    flare = true;
  }
  if (marks.length) v.marks = marks;
  if (objects.length) v.objects = objects;
  const ult = ultChoiceOf(sim, eid);
  v.passive = { stacks: Math.max(0, ...(s?.blick ?? []).filter((b) => b.until > sim.tick).map((b) => b.n)), max: BLICK_MAX, ready: flare };
  if (flare) v.aura = 4; // eyes flare
  if (ult === 1 && s && s.susanooUntil > sim.tick) v.empowered = 3; // sword sweeps
  return v;
}

// ------------------------------------------------------------------ hooks

export const hooks: ChampionHooks = {
  visuals: sevVisuals,
  ownsHits: ['sev_q', 'sev_w', 'sev_e', AMATERASU, 'sev_r2', 'sev_r3'],
  onTick(sim, eid) {
    const s = states(sim).get(eid);
    if (!s) return;
    if (s.blick.length) s.blick = s.blick.filter((b) => b.until > sim.tick || b.cdUntil > sim.tick);
    tickGrounds(sim, eid, s);
    tickClone(sim, eid, s);
    tickFlames(sim, eid, s);
    tickMoon(sim, eid, s);
    if (s.susanooUntil > sim.tick) removeBuffs(sim, eid, (b) => b.kind === 'slow'); // slow immunity
    else if (s.susanooUntil > 0 && s.susanooUntil <= sim.tick) {
      s.susanooUntil = 0;
      closeRecast(sim, eid, 3);
    }
  },
  // Tsukuyomi only on champions (and practice dummies)
  targetOk(sim, _caster, a, t, base) {
    return a.id === 'sev_r3' ? base && isChampLike(sim, t) : base;
  },
  passive: {
    sev_rabenblick: {
      onAbilityHit(sim, eid, target) {
        addBlick(sim, eid, target);
      },
      // the crow clone bursts when hit by anything
      onPetDamaged(sim, eid, pet) {
        const s = states(sim).get(eid);
        if (s?.clone && s.clone.eid === pet && petTag(sim, pet) === DECOY && petOwner(sim, pet) === eid) burst(sim, eid, s);
      },
      // Susanoo: basic attacks become sword sweeps around the target
      onAutoHit(sim, eid, target) {
        const s = states(sim).get(eid);
        if (!s || s.susanooUntil <= sim.tick) return;
        const { Pos, Unit } = sim.c;
        const ctx = ctxFor(sim, eid, 3, s.susanooRank, Pos.x[target]!, Pos.y[target]!);
        for (const t of enemiesInRadius(sim, eid, Pos.x[target]!, Pos.y[target]!, SWEEP_RADIUS)) {
          if (Unit.kind[t] === Kind.Pet) continue;
          const d = effectAmount(sim, ctx, t, 1); // damage effects: [thrust, sweep]
          dealDamage(sim, eid, t, d.amount * champMult(sim, t), d.type);
        }
      },
    },
  },
  effects: {
    // Projectile hit (first unit) or max range ('expire'): explosion + burning ground.
    sev_q_fireball(sim, ctx) {
      if (ctx.phase === 'expire') return explode(sim, ctx, ctx.x, ctx.y);
      if (ctx.phase === 'cast' && ctx.hits.length) explode(sim, ctx, sim.c.Pos.x[ctx.hits[0]!]!, sim.c.Pos.y[ctx.hits[0]!]!);
    },
    // Recast during the 0.4 s wind-up: cancel (fake), refund the mana, 2 s cooldown.
    sev_q_fake_cancel(sim, ctx) {
      if (ctx.phase === 'recast') cancelCast(sim, ctx.caster, { refund: true, cooldownTicks: sec(2) });
    },
    sev_w_crow_clone(sim, ctx) {
      if (ctx.phase === 'cast') spawnClone(sim, ctx);
    },
    sev_e_bannblick(sim, ctx) {
      if (ctx.phase !== 'cast' || ctx.target < 0 || !sim.c.Unit.alive[ctx.target]) return;
      const t = ctx.target;
      const sev = ctx.caster;
      if (facesSev(sim, t, sev)) {
        const stun = effOf(ctx.ability.effects, 'stun') as { duration: number | number[] };
        addBuff(sim, t, { kind: 'stun', id: 'sev_e', src: sev, ticks: sec(rv(stun.duration, ctx.rank)) });
      } else {
        const slow = effOf(ctx.ability.effects, 'slow') as Extract<Effect, { kind: 'slow' }>;
        addBuff(sim, t, { kind: 'slow', id: 'sev_e', src: sev, pct: rv(slow.pct, ctx.rank), ticks: sec(rv(slow.duration, ctx.rank)) });
      }
      addBlick(sim, sev, t);
    },
    sev_r1_amaterasu(sim, ctx) {
      if (ctx.phase !== 'cast' || ctx.target < 0 || !sim.c.Unit.alive[ctx.target]) return;
      const t = ctx.target;
      igniteFlames(sim, ctx.caster, t, effectAmount(sim, ctx, t).amount, sec(rv(ctx.ability.duration, ctx.rank) || 5), false, ctx.rank);
      addBlick(sim, ctx.caster, t);
    },
    sev_r2_susanoo(sim, ctx) {
      const sev = ctx.caster;
      const s = st(sim, sev);
      if (ctx.phase === 'cast') {
        const dur = sec(rv(ctx.ability.duration, ctx.rank) || 6);
        s.susanooUntil = sim.tick + dur;
        s.susanooRank = ctx.rank;
        removeBuffs(sim, sev, (b) => b.kind === 'slow');
        openRecast(sim, sev, 3, sim.tick + 1, sim.tick + dur);
      } else if (ctx.phase === 'recast' && s.susanooUntil > sim.tick) {
        // sword thrust: the spectral blade stabs along the cast direction at once (line 1000 x 120, every enemy once).
        // Instant on purpose: a projectile resolution would re-apply the generic self shield on every hit.
        const { Pos } = sim.c;
        const ax = Pos.x[sev]!;
        const ay = Pos.y[sev]!;
        const len = rv(ctx.ability.range, s.susanooRank);
        const bx = ax + ctx.dx * len;
        const by = ay + ctx.dy * len;
        const rctx = ctxFor(sim, sev, 3, s.susanooRank, bx, by);
        for (const t of enemiesOnSegment(sim, sev, ax, ay, bx, by, (ctx.ability.width ?? 120) / 2)) {
          if (sim.c.Unit.kind[t] === Kind.Pet) continue;
          const d = effectAmount(sim, rctx, t, 0);
          dealDamage(sim, sev, t, d.amount * champMult(sim, t), d.type);
          addBlick(sim, sev, t);
        }
        s.thrust = { ax, ay, bx, by, until: sim.tick + sec(0.35) };
      }
    },
    sev_r3_tsukuyomi(sim, ctx) {
      if (ctx.phase !== 'cast' || ctx.target < 0 || !sim.c.Unit.alive[ctx.target]) return;
      const t = ctx.target;
      const sev = ctx.caster;
      const ticks = sec(rv(ctx.ability.duration, ctx.rank) || 1.5);
      if (!addBuff(sim, t, { kind: 'suppress', id: 'sev_r3', src: sev, ticks })) return;
      addBuff(sim, t, { kind: 'mark', id: MOON, src: sev, ticks }); // the target's own HUD: red-black tint
      addBuff(sim, sev, { kind: 'root', id: 'sev_r3', src: sev, ticks });
      st(sim, sev).moon = { t, serial: sim.c.Unit.serial[t]!, rank: ctx.rank, start: sim.tick, end: sim.tick + ticks };
    },
  },
};

/** Test helper: give a W clone more life (e.g. to observe substitution). */
export function _extendClone(sim: Sim, sev: number, ticks: number): void {
  const c = peek(sim, sev)?.clone;
  if (c) (c.until += ticks), extendPet(sim, c.eid, c.until + 2);
}
export const sevPets = (sim: Sim, sev: number): number[] => petsOf(sim, sev, DECOY);
export const sevBuffs = (sim: Sim, t: number) => buffs(sim, t);
