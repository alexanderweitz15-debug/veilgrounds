// Fenna Staubflügel hooks: Lightbond (passive tether to one ally), Wingdust (Q, ally<->enemy bounce), Chosen Flame (W,
// redirectable shield + bond switch), Duskpool (E), Cocoon Light (R). Behaviour list: docs/champion-hooks.md.
// Tunables that the ability schema cannot hold: fenna.values.json. All state lives in sim.state (stateMap).

import type { Sim } from '../sim';
import { Kind, isStructure, sec } from '../types';
import { addBuff, addShield, buffs, hasStat, healUnit, removeBuffs } from '../buffs';
import { dir, dist2, segDist2 } from '../vec';
import { applyEffects, openRecast, rv, scaleAmount } from '../systems/abilities';
import type { AbilityPayload } from '../systems/abilities';
import { destroyProjectile, fireAbilityProjectile, sweepHit } from '../systems/projectiles';
import type { ChampionHooks, ChampionVisuals, EffectCtx, VisualObject } from './hooks';
import { abilityOf, alliedChamps, byLevel, isChamp, stateMap, unitsWhere } from './dagny';
import { peekState } from './util';
import V from '../../data/champions/fenna.values.json';

// ------------------------------------------------------------------ state

interface Bond {
  partner: number;
  serial: number;
  rebindAt: number;
  /** Enemy eid -> tick the next tether slow may land (per-enemy internal cooldown). */
  crossed: Map<number, number>;
}
interface Pool { x: number; y: number; r: number; until: number; total: number; rank: number }
interface Cocoon { x: number; y: number; r: number; start: number; end: number; rank: number }
/** Short-lived visual line from a point to a unit (bounce, shield redirect). */
interface Arc { tag: string; x: number; y: number; to: number; until: number; total: number }

const bonds = (sim: Sim): Map<number, Bond> => stateMap<Bond>(sim, 'fennaBond');
const pools = (sim: Sim): Map<number, Pool> => stateMap<Pool>(sim, 'fennaPool');
const cocoons = (sim: Sim): Map<number, Cocoon[]> => stateMap<Cocoon[]>(sim, 'fennaCocoon');
const arcs = (sim: Sim): Map<number, Arc[]> => stateMap<Arc[]>(sim, 'fennaArc');
/** Holder of the redirectable W shield per Fenna. */
const holders = (sim: Sim): Map<number, { ally: number; until: number }> => stateMap(sim, 'fennaHolder');

const dist = (sim: Sim, a: number, b: number): number => Math.sqrt(dist2(sim.c.Pos.x[a]!, sim.c.Pos.y[a]!, sim.c.Pos.x[b]!, sim.c.Pos.y[b]!));
const alive = (sim: Sim, e: number): boolean => e >= 0 && !!sim.c.Unit.alive[e];

/** Bonded ally if the bond holds (partner alive, same entity, within break range), else -1. */
export function fennaPartner(sim: Sim, eid: number): number {
  const b = peekState<Bond>(sim, 'fennaBond')?.get(eid);
  if (!b || b.partner < 0 || !alive(sim, eid) || !alive(sim, b.partner) || sim.c.Unit.serial[b.partner] !== b.serial) return -1;
  return dist(sim, eid, b.partner) <= V.bond.breakRange ? b.partner : -1;
}

function setPartner(sim: Sim, eid: number, ally: number): void {
  let b = bonds(sim).get(eid);
  if (!b) bonds(sim).set(eid, (b = { partner: -1, serial: 0, rebindAt: 0, crossed: new Map() }));
  b.partner = ally;
  b.serial = sim.c.Unit.serial[ally]!;
}

const enemyChamps = (sim: Sim, eid: number): number[] =>
  unitsWhere(sim, (e) => isChamp(sim, e) && !!sim.c.Unit.alive[e] && !sim.c.Unit.untargetable[e] && sim.c.Unit.team[e] !== sim.c.Unit.team[eid]);

// ------------------------------------------------------------------ passive: Lightbond

function bondTick(sim: Sim, eid: number): void {
  const { Pos, Unit } = sim.c;
  let b = bonds(sim).get(eid);
  if (!b) bonds(sim).set(eid, (b = { partner: -1, serial: 0, rebindAt: 0, crossed: new Map() }));
  if (!Unit.alive[eid]) {
    b.partner = -1;
    b.rebindAt = sim.tick;
    return;
  }
  if (fennaPartner(sim, eid) < 0) {
    if (b.partner >= 0) {
      b.partner = -1;
      b.rebindAt = sim.tick + sec(V.bond.rebindDelaySec);
    }
    if (sim.tick < b.rebindAt) return;
    let best = -1;
    let bestD = V.bond.rebindRange * V.bond.rebindRange;
    for (const a of alliedChamps(sim, eid)) {
      const d = dist2(Pos.x[a]!, Pos.y[a]!, Pos.x[eid]!, Pos.y[eid]!);
      if (a !== eid && d < bestD) (bestD = d), (best = a);
    }
    if (best < 0) return;
    setPartner(sim, eid, best);
  }
  const p = b.partner;
  if (dist(sim, eid, p) > V.bond.tautRange) return;
  const fx = Pos.x[eid]!;
  const fy = Pos.y[eid]!;
  for (const e of enemyChamps(sim, eid)) {
    const hw = V.bond.crossHalfWidth + Unit.radius[e]! * V.bond.crossRadiusFrac;
    if ((b.crossed.get(e) ?? 0) > sim.tick || segDist2(Pos.x[e]!, Pos.y[e]!, fx, fy, Pos.x[p]!, Pos.y[p]!) > hw * hw) continue;
    b.crossed.set(e, sim.tick + sec(V.bond.icdSec));
    addBuff(sim, e, { kind: 'slow', id: 'fenna_bond', src: eid, pct: Math.round(byLevel(sim, eid, V.bond.slowPctByLevel[0]!, V.bond.slowPctByLevel[1]!)), ticks: sec(V.bond.slowSec) });
  }
}

/** The bonded ally's shield `id` from Fenna is mirrored on Fenna (passive: 40 %). */
function mirrorShield(sim: Sim, eid: number, ally: number, id: string): void {
  if (ally === eid || ally !== fennaPartner(sim, eid)) return;
  const s = buffs(sim, ally).find((b) => b.kind === 'shield' && b.id === id && b.src === eid && b.until > sim.tick);
  if (s) addShield(sim, eid, s.amount * V.bond.mirror, s.until - sim.tick, `${id}_bond`, eid);
}

function addArc(sim: Sim, eid: number, tag: string, x: number, y: number, to: number): void {
  let l = arcs(sim).get(eid);
  if (!l) arcs(sim).set(eid, (l = []));
  l.push({ tag, x, y, to, until: sim.tick + 9, total: 9 });
}

// ------------------------------------------------------------------ Q: Wingdust (own collision, allies included)

const payloads = (sim: Sim): Map<number, AbilityPayload | { t: 'auto' }> | undefined =>
  (sim.state.projectiles as { payloads: Map<number, AbilityPayload | { t: 'auto' }> } | undefined)?.payloads;

/** Ally the dust bounces to after an enemy hit: the bonded ally, else the nearest allied champion near the impact, else Fenna. */
function bounceAlly(sim: Sim, eid: number, x: number, y: number): number {
  const { Pos } = sim.c;
  const p = fennaPartner(sim, eid);
  const r2 = V.dust.allySeek * V.dust.allySeek;
  if (p >= 0 && dist2(Pos.x[p]!, Pos.y[p]!, x, y) <= r2) return p;
  let best = eid;
  let bestD = r2;
  for (const a of alliedChamps(sim, eid)) {
    const d = dist2(Pos.x[a]!, Pos.y[a]!, x, y);
    if (a !== eid && d < bestD) (bestD = d), (best = a);
  }
  return best;
}

/** Enemy the dust bounces to from an ally: nearest enemy champion within 700, else nearest other enemy unit within 450. */
function bounceEnemy(sim: Sim, eid: number, x: number, y: number): number {
  const { Pos, Unit } = sim.c;
  const pick = (cands: number[], r: number): number => {
    let best = -1;
    let bestD = r * r;
    for (const e of cands) {
      const d = dist2(Pos.x[e]!, Pos.y[e]!, x, y);
      if (d < bestD) (bestD = d), (best = e);
    }
    return best;
  };
  const c = pick(enemyChamps(sim, eid), V.dust.enemySeekChampion);
  if (c >= 0) return c;
  return pick(unitsWhere(sim, (e) => hitUnit(sim, eid, e, true)), V.dust.enemySeekUnit);
}

/** Valid enemy for dust: champions/dummies, or with `any` every fighting unit (minions, monsters, pets). */
function hitUnit(sim: Sim, eid: number, e: number, any: boolean): boolean {
  const { Unit } = sim.c;
  const k = Unit.kind[e]!;
  if (!Unit.alive[e] || Unit.untargetable[e] || Unit.team[e] === Unit.team[eid] || hasStat(sim, e, 'projImmune')) return false;
  return any ? k !== Kind.Projectile && k !== Kind.Ward && k !== Kind.Plant && !isStructure(k) : k === Kind.Champion || k === Kind.Dummy;
}

/** Ally touched by the dust: shield + move speed (the ability's `ally` effects), bonded ally mirrors a share to Fenna. */
function touchAlly(sim: Sim, ctx: EffectCtx, ally: number): void {
  applyEffects(sim, { ...ctx, hits: [], target: ally }, 'self');
  mirrorShield(sim, ctx.caster, ally, ctx.ability.id);
}

function dustHit(sim: Sim, eid: number, pl: AbilityPayload, t: number, x: number, y: number): void {
  const { Pos, Unit } = sim.c;
  const ctx: EffectCtx = { caster: eid, slot: 0, rank: pl.rank, ability: abilityOf(sim, eid, 0), hits: [t], x, y, target: t, phase: 'cast', dx: pl.dx, dy: pl.dy, cursorX: pl.cx, cursorY: pl.cy, tag: pl.tag };
  if (Unit.team[t] !== Unit.team[eid]) {
    const bounce = pl.tag === 'bounce';
    applyEffects(sim, bounce ? { ...ctx, dmgMult: V.dust.bounceDmgMult } : ctx, 'hit');
    if (bounce) return;
    const a = bounceAlly(sim, eid, x, y);
    touchAlly(sim, ctx, a);
    addArc(sim, eid, 'fenna_q_arc', x, y, a);
    return;
  }
  // ally first: it gets the dust, which then flies on to the nearest enemy
  touchAlly(sim, ctx, t);
  const ax = Pos.x[t]!;
  const ay = Pos.y[t]!;
  const e = bounceEnemy(sim, eid, ax, ay);
  if (e < 0) return;
  const [dx, dy] = dir(ax, ay, Pos.x[e]!, Pos.y[e]!);
  const p = fireAbilityProjectile(sim, ctx, { x: ax, y: ay, dx, dy, range: V.dust.bounceRange, speed: V.dust.bounceSpeed, tag: 'bounce' });
  const bp = payloads(sim)?.get(p);
  if (bp?.t === 'ability') sweepDust(sim, eid, p, bp);
}

/**
 * One projectile of Q this tick: its next swept segment is tested against enemies and (for the first flight) allied
 * champions; the earliest unit wins and the engine projectile is destroyed. Also runs right after the cast and after a
 * bounce is fired, so the engine never resolves a Q hit itself.
 * ponytail: ally collision follows Oda's stone (champions only, no minion blocking); upgrade = an engine pre-hit hook.
 */
function sweepDust(sim: Sim, eid: number, p: number, pl: AbilityPayload): void {
  const { Pos, Proj, Unit } = sim.c;
  const bounce = pl.tag === 'bounce';
  const ax = Pos.x[p]!;
  const ay = Pos.y[p]!;
  const step = Math.min(Proj.speed[p]! / 30, Proj.maxDist[p]! - Proj.travelled[p]!);
  const bx = ax + Proj.dx[p]! * step;
  const by = ay + Proj.dy[p]! * step;
  const half = Proj.width[p]! / 2;
  let best = -1;
  let bestT = Infinity;
  const cands = unitsWhere(sim, (e) =>
    hitUnit(sim, eid, e, bounce) || (!bounce && e !== eid && !!Unit.alive[e] && !Unit.untargetable[e] && Unit.team[e] === Unit.team[eid] && Unit.kind[e] === Kind.Champion),
  );
  for (const e of cands) {
    const t = sweepHit(ax, ay, bx, by, Pos.x[e]!, Pos.y[e]!, Unit.radius[e]! + half);
    if (t >= 0 && t < bestT) (bestT = t), (best = e);
  }
  if (best < 0) return;
  destroyProjectile(sim, p);
  dustHit(sim, eid, pl, best, ax + (bx - ax) * bestT, ay + (by - ay) * bestT);
}

function dustTick(sim: Sim, eid: number): void {
  const ps = payloads(sim);
  if (!ps) return;
  for (const [p, pl] of [...ps]) if (ps.has(p) && pl.t === 'ability' && pl.caster === eid && pl.slot === 0 && sim.c.Proj.kind[p] === 1) sweepDust(sim, eid, p, pl);
}

// ------------------------------------------------------------------ E: Duskpool, R: Cocoon Light

function poolTick(sim: Sim, eid: number): void {
  const pool = pools(sim).get(eid);
  if (!pool) return;
  if (sim.tick >= pool.until) return void pools(sim).delete(eid);
  if (sim.tick % V.pool.everyTicks !== 0) return;
  const { Pos, Unit } = sim.c;
  const ab = abilityOf(sim, eid, 2);
  for (const eff of ab.effects) {
    if (eff.kind === 'buff' && eff.target === 'allies') {
      for (const a of alliedChamps(sim, eid)) {
        if (dist2(Pos.x[a]!, Pos.y[a]!, pool.x, pool.y) <= pool.r * pool.r) addBuff(sim, a, { kind: 'stat', stat: eff.stat, id: ab.id, src: eid, pct: rv(eff.pct, pool.rank), flat: rv(eff.flat, pool.rank), ticks: V.pool.refreshTicks });
      }
    } else if (eff.kind === 'slow') {
      for (const e of enemyChamps(sim, eid)) {
        const r = pool.r + Unit.radius[e]!;
        if (dist2(Pos.x[e]!, Pos.y[e]!, pool.x, pool.y) <= r * r) addBuff(sim, e, { kind: 'slow', id: ab.id, src: eid, pct: rv(eff.pct, pool.rank), ticks: V.pool.refreshTicks });
      }
    }
  }
}

function cocoonTick(sim: Sim, eid: number): void {
  const list = cocoons(sim).get(eid);
  if (!list?.length) return;
  const { Pos, Unit } = sim.c;
  const keep: Cocoon[] = [];
  for (const c of list) {
    const inside = alliedChamps(sim, eid).filter((a) => dist2(Pos.x[a]!, Pos.y[a]!, c.x, c.y) <= c.r * c.r);
    if (sim.tick >= c.end) {
      for (const a of inside) {
        removeBuffs(sim, a, (b) => b.id === 'fenna_r');
        healUnit(sim, a, scaleAmount(sim, V.cocoon.heal, eid, a, c.rank));
      }
      continue;
    }
    for (const a of inside) addBuff(sim, a, { kind: 'stat', stat: 'untargetable', id: 'fenna_r', src: eid, ticks: 4 });
    for (const e of enemyChamps(sim, eid)) {
      const r = c.r + Unit.radius[e]!;
      if (dist2(Pos.x[e]!, Pos.y[e]!, c.x, c.y) <= r * r) addBuff(sim, e, { kind: 'slow', id: 'fenna_r', src: eid, pct: V.cocoon.enemySlowPct, ticks: 4 });
    }
    keep.push(c);
  }
  cocoons(sim).set(eid, keep);
}

// ------------------------------------------------------------------ W: Chosen Flame

/** Recast: the remaining W shield (amount and time) moves to another ally and the bond follows. */
function redirect(sim: Sim, ctx: EffectCtx): void {
  const { caster, ability: ab } = ctx;
  const h = holders(sim).get(caster);
  if (!h || h.until <= sim.tick || !alive(sim, h.ally)) return;
  const reach = rv(ab.range, ctx.rank) + 120;
  const ok = (a: number): boolean => a !== caster && a !== h.ally && !sim.c.Unit.untargetable[a]! && dist(sim, caster, a) <= reach;
  const cands = alliedChamps(sim, caster).filter(ok);
  let t = ctx.target >= 0 && cands.includes(ctx.target) ? ctx.target : -1;
  if (t < 0) {
    let bestD = Infinity;
    for (const a of cands) {
      const d = dist2(sim.c.Pos.x[a]!, sim.c.Pos.y[a]!, ctx.cursorX, ctx.cursorY);
      if (d < bestD) (bestD = d), (t = a);
    }
  }
  if (t < 0) return void openRecast(sim, caster, 1, sim.tick, h.until); // no valid ally: keep the window
  const s = buffs(sim, h.ally).find((b) => b.kind === 'shield' && b.id === ab.id && b.src === caster && b.until > sim.tick);
  if (s) {
    const [amount, ticks] = [s.amount, s.until - sim.tick]; // removeBuffs ends the old shield (until = now)
    removeBuffs(sim, h.ally, (b) => b === s);
    addShield(sim, t, amount, ticks, ab.id, caster);
  }
  addArc(sim, caster, 'fenna_w_arc', sim.c.Pos.x[h.ally]!, sim.c.Pos.y[h.ally]!, t);
  setPartner(sim, caster, t);
  holders(sim).set(caster, { ally: t, until: h.until });
}

// ------------------------------------------------------------------ snapshot visuals (read-only)

function fennaVisuals(sim: Sim, eid: number): ChampionVisuals {
  const { Pos, Unit } = sim.c;
  const objects: VisualObject[] = [];
  const p = fennaPartner(sim, eid);
  let taut = false;
  if (p >= 0) {
    taut = dist(sim, eid, p) <= V.bond.tautRange;
    objects.push({ key: `${eid}:bond`, tag: taut ? 'fenna_p_bond' : 'fenna_p_slack', x: Pos.x[eid]!, y: Pos.y[eid]!, r: taut ? 26 : 8, shape: 'line', x2: Pos.x[p]!, y2: Pos.y[p]!, follow: p, hue: taut ? 45 : 270 });
  }
  const pool = peekState<Pool>(sim, 'fennaPool')?.get(eid);
  if (pool && pool.until > sim.tick) objects.push({ key: `${eid}:pool`, tag: 'fenna_e_pool', x: pool.x, y: pool.y, r: pool.r, shape: 'disc', left: pool.until - sim.tick, total: pool.total });
  (peekState<Cocoon[]>(sim, 'fennaCocoon')?.get(eid) ?? []).forEach((c, i) => {
    objects.push({ key: `${eid}:cocoon${i}`, tag: 'fenna_r_cocoon', x: c.x, y: c.y, r: c.r, shape: 'dome', left: c.end - sim.tick, total: c.end - c.start });
  });
  (peekState<Arc[]>(sim, 'fennaArc')?.get(eid) ?? []).forEach((a, i) => {
    if (a.until > sim.tick && Unit.alive[a.to]) objects.push({ key: `${eid}:arc${i}`, tag: a.tag, x: a.x, y: a.y, r: 14, shape: 'line', x2: Pos.x[a.to]!, y2: Pos.y[a.to]!, follow: a.to, left: a.until - sim.tick, total: a.total, hue: a.tag === 'fenna_w_arc' ? 48 : 40 });
  });
  return { objects, ...(p >= 0 ? { marks: [{ target: p, id: 'fenna_bond' }] } : {}), passive: { ready: taut } };
}

export const hooks: ChampionHooks = {
  visuals: fennaVisuals,
  ownsHits: ['fenna_q'],
  onTick(sim, eid) {
    bondTick(sim, eid);
    dustTick(sim, eid);
    poolTick(sim, eid);
    cocoonTick(sim, eid);
    const l = arcs(sim).get(eid);
    if (l?.length) arcs(sim).set(eid, l.filter((a) => a.until > sim.tick));
  },
  passive: {
    fenna_lightbond: {
      // the Q projectile exists now and has not moved yet: sweep its first segment too
      onCast(sim, eid, slot) {
        if (slot === 0) dustTick(sim, eid);
      },
    },
  },
  effects: {
    // collisions are resolved by sweepDust; the engine only calls this at max range (phase 'expire'), nothing to do
    fenna_q_dust() {},
    fenna_w_choose(sim, ctx) {
      if (ctx.phase === 'recast') return redirect(sim, ctx);
      if (ctx.phase !== 'cast' || ctx.target < 0) return;
      setPartner(sim, ctx.caster, ctx.target);
      mirrorShield(sim, ctx.caster, ctx.target, ctx.ability.id);
      const until = sim.tick + sec(rv(ctx.ability.duration, ctx.rank));
      holders(sim).set(ctx.caster, { ally: ctx.target, until });
      openRecast(sim, ctx.caster, 1, sim.tick, until);
    },
    fenna_e_pool(sim, ctx) {
      const total = sec(rv(ctx.ability.duration, ctx.rank));
      pools(sim).set(ctx.caster, { x: ctx.x, y: ctx.y, r: ctx.ability.radius ?? 300, until: sim.tick + total, total, rank: ctx.rank });
    },
    fenna_r_cocoon(sim, ctx) {
      let l = cocoons(sim).get(ctx.caster);
      if (!l) cocoons(sim).set(ctx.caster, (l = []));
      l.push({ x: ctx.x, y: ctx.y, r: ctx.ability.radius ?? 450, start: sim.tick, end: sim.tick + sec(rv(V.cocoon.durationSec, ctx.rank)), rank: ctx.rank });
    },
  },
};
