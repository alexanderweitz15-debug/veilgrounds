// Sev Aschenblick hooks. Contract: ./hooks.ts, behaviour list: docs/champion-hooks.md, spec: docs/champions/sev.md.
// Passive Nachbild (afterimage mark), Q Glutblick fake recast, W Schwarzglut (uncleansable ember, jumps once on death,
// burning decoy), E Trugbild (decoy pet with a fake HP bar), R Augenbann (0.5 s eye contact, then fear).

import type { Sim } from '../sim';
import { CHAMP_ABILITY_DMG_MULT, Kind, sec } from '../types';
import { addBuff, buffs, extendBuff, hasBuff, reveal } from '../buffs';
import { dealDamage } from '../damage';
import { cancelCast, champAbil, effectAmount, enemiesInRadius, rv } from '../systems/abilities';
import { extendPet, petOwner, petTag, petsOf, removePet, spawnPet } from '../summons';
import { sees } from '../vision';
import type { ChampionHooks, ChampionVisuals, UnitMark, VisualObject } from './hooks';
import { byLevel, ctxFor, hookState, isChampLike, peekState } from './util';

export const NACHBILD = 'sev_nachbild';
export const EMBER = 'sev_w';
export const DECOY = 'sev_decoy';
export const FEAR = 'sev_r';

const NACHBILD_TICKS = sec(3);
/** Passive auto bonus: 10-30 by level (+15 % AP) magic; extends a running ember by 0.5 s (cap: 8 s in total). */
const AUTO_LO = 10;
const AUTO_HI = 30;
const AUTO_AP = 0.15;
const EMBER_EXTEND = sec(0.5);
const EMBER_MAX = sec(8);
const GRIEVOUS_PCT = 40;
const JUMP_RANGE = 300;
/** Ember on the own decoy: 50 % of the ember damage per second to enemies within 250. */
const DECOY_BURN_PCT = 0.5;
const DECOY_BURN_RADIUS = 250;
const R_SLOW_PCT = 50;
const R_EMBER_BONUS = 1.5;
/** R eye contact lost during the wind-up: cast cancelled, mana refunded, this cooldown. */
const R_BREAK_CD = sec(2);
/** Phantoms the feared target sees around itself (visual only). */
const PHANTOM_DIST = 170;

// ------------------------------------------------------------------ state

interface Ember {
  t: number;
  serial: number;
  /** Per-second pre-multiplier damage (rank + AP at cast). */
  amount: number;
  start: number;
  until: number;
  x: number;
  y: number;
  jumped: boolean;
  /** Burning own decoy (no buff, Sev deals the aura damage). */
  decoy: boolean;
}

interface Bann {
  t: number;
  serial: number;
  rank: number;
  start: number;
  end: number;
  ember: boolean;
}

const embers = (sim: Sim): Map<number, Ember[]> => hookState<Ember[]>(sim, 'sevEmbers');
const banns = (sim: Sim): Map<number, Bann> => hookState<Bann>(sim, 'sevBann');

/** Sev's (or any Sev's if eid < 0) Nachbild on `t`. */
export function hasNachbild(sim: Sim, t: number, sev = -1): boolean {
  for (const b of buffs(sim, t)) if (b.kind === 'mark' && b.id === NACHBILD && b.until > sim.tick && (sev < 0 || b.src === sev)) return true;
  return false;
}

function markNachbild(sim: Sim, sev: number, t: number): void {
  const { Unit } = sim.c;
  if (t < 0 || !Unit.alive[t] || Unit.team[t] === Unit.team[sev] || Unit.kind[t] === Kind.Pet) return;
  addBuff(sim, t, { kind: 'mark', id: NACHBILD, src: sev, ticks: NACHBILD_TICKS });
}

export const isEmbered = (sim: Sim, t: number): boolean => hasBuff(sim, t, 'dot', EMBER);

/** Live decoy of this Sev, -1 if none. */
export function sevDecoy(sim: Sim, sev: number): number {
  return petsOf(sim, sev, DECOY)[0] ?? -1;
}

/** Ember dot + grievous wounds on an enemy unit for `ticks` (both uncleansable). */
function applyEmber(sim: Sim, sev: number, t: number, amount: number, ticks: number, jumped: boolean): void {
  const { Unit, Pos } = sim.c;
  const champMult = Unit.kind[t] === Kind.Champion ? CHAMP_ABILITY_DMG_MULT : 1;
  addBuff(sim, t, { kind: 'dot', id: EMBER, src: sev, amount: amount * champMult, period: sec(1), dmgType: 'magic', ticks, uncleansable: true });
  addBuff(sim, t, { kind: 'grievous', id: EMBER, src: sev, pct: GRIEVOUS_PCT, ticks, uncleansable: true });
  const list = embers(sim).get(sev) ?? [];
  const rest = list.filter((e) => e.t !== t || e.decoy);
  rest.push({ t, serial: Unit.serial[t]!, amount, start: sim.tick, until: sim.tick + ticks, x: Pos.x[t]!, y: Pos.y[t]!, jumped, decoy: false });
  embers(sim).set(sev, rest);
}

/** Nearest living enemy unit (champion, minion, monster) of Sev within r of (x, y), excluding `not`; ties: lower eid. */
function nearestEnemy(sim: Sim, sev: number, x: number, y: number, r: number, not: number): number {
  const { Pos, Unit } = sim.c;
  let best = -1;
  let bestD = Infinity;
  for (const e of enemiesInRadius(sim, sev, x, y, r)) {
    if (e === not || Unit.kind[e] === Kind.Pet) continue;
    const dx = Pos.x[e]! - x;
    const dy = Pos.y[e]! - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) (bestD = d), (best = e);
  }
  return best;
}

// ------------------------------------------------------------------ per tick

function tickEmbers(sim: Sim, sev: number): void {
  const list = embers(sim).get(sev);
  if (!list || list.length === 0) return;
  const { Unit, Pos } = sim.c;
  const keep: Ember[] = [];
  for (const e of list) {
    if (sim.tick >= e.until) continue;
    const alive = Unit.serial[e.t] === e.serial && Unit.alive[e.t] === 1;
    if (e.decoy) {
      if (alive) (e.x = Pos.x[e.t]!), (e.y = Pos.y[e.t]!);
      const age = sim.tick - e.start;
      if (age > 0 && age % sec(1) === 0) {
        for (const t of enemiesInRadius(sim, sev, e.x, e.y, DECOY_BURN_RADIUS)) {
          if (Unit.kind[t] === Kind.Pet) continue;
          const mult = Unit.kind[t] === Kind.Champion ? CHAMP_ABILITY_DMG_MULT : 1;
          dealDamage(sim, sev, t, e.amount * DECOY_BURN_PCT * mult, 'magic');
        }
      }
      keep.push(e);
      continue;
    }
    if (alive) {
      e.x = Pos.x[e.t]!;
      e.y = Pos.y[e.t]!;
      keep.push(e);
      continue;
    }
    // target died (or its eid was recycled) while burning: the ember jumps once with the remaining duration
    if (e.jumped) continue;
    const next = nearestEnemy(sim, sev, e.x, e.y, JUMP_RANGE, e.t);
    if (next < 0) continue;
    const left = e.until - sim.tick;
    const champMult = Unit.kind[next] === Kind.Champion ? CHAMP_ABILITY_DMG_MULT : 1;
    addBuff(sim, next, { kind: 'dot', id: EMBER, src: sev, amount: e.amount * champMult, period: sec(1), dmgType: 'magic', ticks: left, uncleansable: true });
    addBuff(sim, next, { kind: 'grievous', id: EMBER, src: sev, pct: GRIEVOUS_PCT, ticks: left, uncleansable: true });
    keep.push({ t: next, serial: Unit.serial[next]!, amount: e.amount, start: sim.tick, until: sim.tick + left, x: Pos.x[next]!, y: Pos.y[next]!, jumped: true, decoy: false });
  }
  embers(sim).set(sev, keep);
}

function tickBann(sim: Sim, sev: number): void {
  const b = banns(sim).get(sev);
  if (!b) return;
  const { Unit, Pos } = sim.c;
  if (Unit.serial[b.t] !== b.serial || !Unit.alive[b.t]) return void banns(sim).delete(sev);
  if (isEmbered(sim, b.t)) b.ember = true;
  // the fear ends earlier with tenacity / cleansing immunity: the ward ends with it
  const fear = buffs(sim, b.t).find((x) => x.kind === 'fear' && x.id === FEAR && x.src === sev);
  const end = fear ? Math.min(b.end, fear.until) : sim.tick;
  if (sim.tick < end) return;
  banns(sim).delete(sev);
  const ctx = ctxFor(sim, sev, 3, b.rank, Pos.x[b.t]!, Pos.y[b.t]!, [b.t]);
  const { amount, type } = effectAmount(sim, ctx, b.t);
  const mult = (b.ember ? R_EMBER_BONUS : 1) * (Unit.kind[b.t] === Kind.Champion ? CHAMP_ABILITY_DMG_MULT : 1);
  dealDamage(sim, sev, b.t, amount * mult, type);
  markNachbild(sim, sev, b.t);
}

/** R wind-up = eye contact: losing sight of the target cancels it (refund, short cooldown). */
function tickEyeContact(sim: Sim, sev: number): void {
  const c = champAbil(sim, sev).cast;
  if (!c || c.slot !== 3 || c.target < 0) return;
  const { Unit } = sim.c;
  if (Unit.serial[c.target] !== c.targetSerial || !Unit.alive[c.target] || !sees(sim, Unit.team[sev]!, c.target)) {
    cancelCast(sim, sev, { refund: true, cooldownTicks: R_BREAK_CD });
  }
}

/** The decoy mirrors Sev's attack target (harmless autos: it has 0 AD). */
function tickDecoy(sim: Sim, sev: number): void {
  const d = sevDecoy(sim, sev);
  if (d < 0) return;
  const { Atk, Unit, Pos, Face } = sim.c;
  const t = Atk.target[sev]!;
  const valid = t >= 0 && Atk.targetSerial[sev] === Unit.serial[t] && Unit.alive[t] && Unit.team[t] !== Unit.team[sev];
  if (valid) {
    if (Atk.target[d] !== t) (Atk.target[d] = t), (Atk.targetSerial[d] = Unit.serial[t]!);
    const dx = Pos.x[t]! - Pos.x[d]!;
    const dy = Pos.y[t]! - Pos.y[d]!;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0) (Face.x[d] = dx / len), (Face.y[d] = dy / len);
  } else Atk.target[d] = -1;
}

// ------------------------------------------------------------------ visuals

function sevVisuals(sim: Sim, eid: number): ChampionVisuals {
  const { Unit, Pos } = sim.c;
  const v: ChampionVisuals = {};
  const marks: UnitMark[] = [];
  const objects: VisualObject[] = [];
  let marked = 0;
  // Nachbild / ember marks Sev put on enemies (read-only scan of the units that have buffs)
  const withBuffs = (sim.state.buffs as { ents: Map<number, unknown> } | undefined)?.ents;
  for (const e of withBuffs ? withBuffs.keys() : []) {
    if (!Unit.alive[e] || Unit.team[e] === Unit.team[eid]) continue;
    for (const b of buffs(sim, e)) {
      if (b.until <= sim.tick || b.src !== eid) continue;
      if (b.kind === 'mark' && b.id === NACHBILD) (marks.push({ target: e, id: NACHBILD, left: b.until - sim.tick }), (marked += isChampLike(sim, e) ? 1 : 0));
      else if (b.kind === 'dot' && b.id === EMBER) marks.push({ target: e, id: EMBER, left: b.until - sim.tick });
    }
  }
  for (const e of peekState<Ember[]>(sim, 'sevEmbers')?.get(eid) ?? []) {
    if (e.decoy && e.until > sim.tick) objects.push({ key: `${eid}:ember`, tag: 'sev_w_decoy', x: e.x, y: e.y, r: DECOY_BURN_RADIUS, shape: 'disc', left: e.until - sim.tick, total: e.until - e.start, hue: 14 });
  }
  const b = peekState<Bann>(sim, 'sevBann')?.get(eid);
  if (b && Unit.serial[b.t] === b.serial && Unit.alive[b.t]) {
    // three phantoms of Sev around the warded target (what it "sees")
    const dirs: [number, number][] = [[1, 0], [-0.5, 0.866], [-0.5, -0.866]];
    dirs.forEach(([dx, dy], i) => objects.push({ key: `${eid}:ph${i}`, tag: 'sev_r_phantom', x: Pos.x[b.t]! + dx * PHANTOM_DIST, y: Pos.y[b.t]! + dy * PHANTOM_DIST, r: 45, shape: 'pin', left: Math.max(0, b.end - sim.tick), total: b.end - b.start }));
    objects.push({ key: `${eid}:bann`, tag: 'sev_r_bann', x: Pos.x[b.t]!, y: Pos.y[b.t]!, r: 110, shape: 'ring', follow: b.t, left: Math.max(0, b.end - sim.tick), total: b.end - b.start });
  }
  if (marks.length) v.marks = marks;
  if (objects.length) v.objects = objects;
  v.passive = { stacks: marked, ready: marked > 0 };
  return v;
}

// ------------------------------------------------------------------ hooks

export const hooks: ChampionHooks = {
  visuals: sevVisuals,
  ownsHits: ['sev_w', 'sev_r'],
  onTick(sim, eid) {
    tickEmbers(sim, eid);
    tickBann(sim, eid);
    tickEyeContact(sim, eid);
    tickDecoy(sim, eid);
  },
  // W: enemy champions/minions/monsters, or Sev's own decoy. R: only enemy champions with Sev's Nachbild.
  targetOk(sim, caster, ab, t, base) {
    if (ab.id === 'sev_w') return base || (petTag(sim, t) === DECOY && petOwner(sim, t) === caster);
    if (ab.id === 'sev_r') return base && isChampLike(sim, t) && hasNachbild(sim, t, caster);
    return base;
  },
  passive: {
    sev_nachbild: {
      onAbilityHit(sim, eid, target) {
        markNachbild(sim, eid, target);
      },
      onAutoHit(sim, eid, target) {
        if (!hasNachbild(sim, target, eid) || !sim.c.Unit.alive[target]) return;
        dealDamage(sim, eid, target, byLevel(sim, eid, AUTO_LO, AUTO_HI) + AUTO_AP * sim.c.Stats.ap[eid]!, 'magic');
        if (extendBuff(sim, target, EMBER, EMBER_EXTEND, EMBER_MAX)) {
          for (const e of embers(sim).get(eid) ?? []) if (e.t === target && !e.decoy) e.until = Math.min(e.until + EMBER_EXTEND, e.start + EMBER_MAX);
        }
      },
      // an enemy ability (not an auto) hitting the decoy gives the attacker a Nachbild
      onPetDamaged(sim, eid, pet, src, info) {
        if (info.isAuto || src < 0 || petTag(sim, pet) !== DECOY) return;
        markNachbild(sim, eid, src);
      },
    },
  },
  effects: {
    // Recast during the 0.4 s wind-up: cancel (fake), refund the mana, 2 s cooldown.
    sev_q_fake_cancel(sim, ctx) {
      if (ctx.phase === 'recast') cancelCast(sim, ctx.caster, { refund: true, cooldownTicks: sec(2) });
    },
    sev_w_ember(sim, ctx) {
      if (ctx.phase !== 'cast' || ctx.target < 0) return;
      const t = ctx.target;
      const ticks = sec(rv(ctx.ability.duration, ctx.rank) || 4);
      const amount = effectAmount(sim, ctx, t).amount;
      if (petTag(sim, t) === DECOY) {
        // burning decoy: lasts as long as the ember, Sev deals the aura damage
        extendPet(sim, t, sim.tick + ticks);
        const list = (embers(sim).get(ctx.caster) ?? []).filter((e) => !e.decoy);
        const { Pos, Unit } = sim.c;
        list.push({ t, serial: Unit.serial[t]!, amount, start: sim.tick, until: sim.tick + ticks, x: Pos.x[t]!, y: Pos.y[t]!, jumped: true, decoy: true });
        embers(sim).set(ctx.caster, list);
        return;
      }
      applyEmber(sim, ctx.caster, t, amount, ticks, false);
      markNachbild(sim, ctx.caster, t);
    },
    sev_e_decoy(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      const sev = ctx.caster;
      const { Pos, Hp, Stats, Unit, Face } = sim.c;
      for (const old of petsOf(sim, sev, DECOY)) removePet(sim, old);
      // start position = position at the start of this tick (the blink already moved Sev)
      const x = Pos.px[sev]!;
      const y = Pos.py[sev]!;
      const d = spawnPet(sim, {
        owner: sev, tag: DECOY, x, y, ticks: sec(rv(ctx.ability.duration, ctx.rank) || 2.5), radius: Unit.radius[sev]!,
        hp: Hp.cur[sev]!, ad: 0, as: Stats.as[sev]!, range: Stats.range[sev]!, armor: Stats.armor[sev]!, mr: Stats.mr[sev]!,
        projectileSpeed: 1600,
      });
      Hp.max[d] = Hp.max[sev]!; // fake health bar: the same numbers as Sev
      sim.c.Mana.max[d] = sim.c.Mana.max[sev]!;
      sim.c.Mana.cur[d] = sim.c.Mana.cur[sev]!;
      Pos.px[d] = x;
      Pos.py[d] = y;
      Face.x[d] = Face.x[sev]!;
      Face.y[d] = Face.y[sev]!;
    },
    sev_r_bann(sim, ctx) {
      if (ctx.phase !== 'cast' || ctx.target < 0) return;
      const t = ctx.target;
      const sev = ctx.caster;
      const ticks = sec(rv(ctx.ability.duration, ctx.rank) || 1.5);
      if (!addBuff(sim, t, { kind: 'fear', id: FEAR, src: sev, ticks })) return; // unstoppable / immune
      addBuff(sim, t, { kind: 'slow', id: FEAR, src: sev, pct: R_SLOW_PCT, ticks, uncleansable: true });
      reveal(sim, sim.c.Unit.team[sev]!, t, ticks);
      const fear = buffs(sim, t).find((b) => b.kind === 'fear' && b.id === FEAR && b.src === sev)!;
      banns(sim).set(sev, { t, serial: sim.c.Unit.serial[t]!, rank: ctx.rank, start: sim.tick, end: fear.until, ember: isEmbered(sim, t) });
    },
  },
};

/** Active ward (R) of this Sev: target and end tick (tests, bots). */
export const sevBann = (sim: Sim, sev: number): { t: number; end: number } | undefined => peekState<Bann>(sim, 'sevBann')?.get(sev);
