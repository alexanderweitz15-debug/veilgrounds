// Projectiles: own entities with Pos + Proj only (removed via sim.doomed).
// kind 0 homing auto, kind 2 homing targeted ability: chase target, hit on contact, vanish if it died.
// kind 1 line skillshot: swept segment (previous -> new position) vs unit circles; hit if the segment passes
// within radius + width/2 (edge inclusive = visible area, no tolerance). Earliest hit along the sweep wins,
// ties by lower eid. Line projectiles reaching max range call the ability hooks with phase 'expire'; returning
// projectiles (fireAbilityProjectile { returning }) fly back to the caster instead and may hit every unit once more.
// Units with the stat buff 'projImmune' are passed through by enemy line projectiles and dodge homing ones.

import { addEntity, query } from 'bitecs';
import type { Sim } from '../sim';
import type { System } from './index';
import { addComp, isRef } from '../sim';
import { DT, Kind, isStructure } from '../types';
import { dir, dist, segDist2 } from '../vec';
import { hasStat } from '../buffs';
import type { EffectCtx } from '../champions/hooks';
import { resolveAutoHit, type AutoPayload } from './attack';
import { resolveAbilityExpire, resolveAbilityHit, rv, type AbilityPayload } from './abilities';
import { trainerShotHit, type TrainerPayload } from '../trainer/dodge';

export type Payload = AutoPayload | AbilityPayload | TrainerPayload;

interface ProjState {
  next: number;
  payloads: Map<number, Payload>;
}

function projState(sim: Sim): ProjState {
  let s = sim.state.projectiles as ProjState | undefined;
  if (!s) sim.state.projectiles = s = { next: 0, payloads: new Map() };
  return s;
}

export interface ProjSpec {
  kind: 0 | 1 | 2;
  src: number;
  team: number;
  x: number;
  y: number;
  /** Homing target (kind 0/2). */
  target?: number;
  /** Line direction, unit vector (kind 1). */
  dx?: number;
  dy?: number;
  speed: number;
  width?: number;
  maxDist?: number;
  payload: Payload;
}

export function spawnProjectile(sim: Sim, p: ProjSpec): number {
  const { Pos, Proj, Unit } = sim.c;
  const eid = addEntity(sim.world);
  addComp(sim, Pos, eid);
  addComp(sim, Proj, eid);
  Pos.x[eid] = Pos.px[eid] = p.x;
  Pos.y[eid] = Pos.py[eid] = p.y;
  // reset every field: bitecs recycles eids and SoA arrays keep the previous occupant's values
  const t = p.target ?? -1;
  Proj.kind[eid] = p.kind;
  Proj.src[eid] = p.src;
  Proj.srcSerial[eid] = p.src >= 0 ? Unit.serial[p.src]! : 0;
  Proj.target[eid] = t;
  Proj.targetSerial[eid] = t >= 0 ? Unit.serial[t]! : 0;
  Proj.team[eid] = p.team;
  Proj.speed[eid] = p.speed;
  Proj.dx[eid] = p.dx ?? 0;
  Proj.dy[eid] = p.dy ?? 0;
  Proj.width[eid] = p.width ?? 0;
  Proj.maxDist[eid] = p.maxDist ?? 0;
  Proj.travelled[eid] = 0;
  const s = projState(sim);
  Proj.payload[eid] = ++s.next;
  s.payloads.set(eid, p.payload);
  if (t >= 0) aimAt(sim, eid, t);
  return eid;
}

function aimAt(sim: Sim, eid: number, t: number): void {
  const { Pos, Proj } = sim.c;
  const dx = Pos.x[t]! - Pos.x[eid]!;
  const dy = Pos.y[t]! - Pos.y[eid]!;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > 0) {
    Proj.dx[eid] = dx / d;
    Proj.dy[eid] = dy / d;
  }
}

function remove(sim: Sim, eid: number): void {
  if (!projState(sim).payloads.delete(eid)) return;
  sim.doomed.push(eid);
}

/** Remove a projectile without effect (blocked, destroyed). */
export const destroyProjectile = remove;

export interface AbilityProjectileOpts {
  /** Start (default caster position) and direction (default ctx.dx/dy) of a line projectile. */
  x?: number;
  y?: number;
  dx?: number;
  dy?: number;
  /** Homing at this unit instead of a line. */
  target?: number;
  /** Defaults: ability speed/width/range. */
  speed?: number;
  width?: number;
  range?: number;
  /** Default: the ability flags (pierce, blocked_by_minions). */
  flags?: string[];
  /** Passed back to hooks as ctx.tag. */
  tag?: string;
  /** Fly back to the caster at max range (each unit can be hit once per direction). */
  returning?: boolean;
  /** Home back to the caster right away (tag 'return'), e.g. a return flight spawned at an 'expire' point. */
  returnNow?: boolean;
}

/** Ability projectile owned by ctx (hits resolve like the ability's own projectile: generic effects + hooks). */
export function fireAbilityProjectile(sim: Sim, ctx: EffectCtx, o: AbilityProjectileOpts = {}): number {
  const { Pos, Unit } = sim.c;
  const ab = ctx.ability;
  const payload: AbilityPayload = {
    t: 'ability', caster: ctx.caster, casterSerial: Unit.serial[ctx.caster]!, slot: ctx.slot, rank: ctx.rank,
    flags: o.flags ?? ab.flags ?? [], hit: [], dx: o.dx ?? ctx.dx, dy: o.dy ?? ctx.dy, cx: ctx.cursorX, cy: ctx.cursorY,
    tag: o.tag ?? (o.returnNow ? 'return' : ''), ret: o.returnNow ? 2 : o.returning ? 1 : 0,
  };
  const x = o.x ?? Pos.x[ctx.caster]!;
  const y = o.y ?? Pos.y[ctx.caster]!;
  const speed = o.speed ?? ab.speed ?? 1500;
  if (o.target !== undefined) return spawnProjectile(sim, { kind: 2, src: ctx.caster, team: Unit.team[ctx.caster]!, x, y, target: o.target, speed, width: o.width ?? ab.width ?? 0, payload });
  return spawnProjectile(sim, { kind: 1, src: ctx.caster, team: Unit.team[ctx.caster]!, x, y, dx: payload.dx, dy: payload.dy, speed, width: o.width ?? ab.width ?? 60, maxDist: o.range ?? rv(ab.range, ctx.rank), payload });
}

export const projectilesSystem: System = {
  name: 'projectiles',
  update(sim) {
    const { Proj } = sim.c;
    const s = projState(sim);
    for (const eid of [...query(sim.world, [Proj])]) {
      const payload = s.payloads.get(eid);
      if (!payload) continue;
      if (Proj.kind[eid] === 1) updateLine(sim, eid, payload);
      else updateHoming(sim, eid, payload);
    }
  },
};

function updateHoming(sim: Sim, eid: number, payload: Payload): void {
  const { Pos, Proj, Unit } = sim.c;
  const t = Proj.target[eid]!;
  if (!isRef(sim, t, Proj.targetSerial[eid]!)) return remove(sim, eid);
  if (Unit.team[t] !== Proj.team[eid] && hasStat(sim, t, 'projImmune')) return remove(sim, eid); // dodged
  const step = Proj.speed[eid]! * DT;
  const dx = Pos.x[t]! - Pos.x[eid]!;
  const dy = Pos.y[t]! - Pos.y[eid]!;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d - Unit.radius[t]! <= step) {
    Pos.x[eid] = Pos.x[t]!;
    Pos.y[eid] = Pos.y[t]!;
    remove(sim, eid);
    hit(sim, payload, t, Pos.x[t]!, Pos.y[t]!);
    return;
  }
  Proj.dx[eid] = dx / d;
  Proj.dy[eid] = dy / d;
  Pos.x[eid] = Pos.x[eid]! + (dx / d) * step;
  Pos.y[eid] = Pos.y[eid]! + (dy / d) * step;
  Proj.travelled[eid] = Proj.travelled[eid]! + step;
}

function hit(sim: Sim, payload: Payload, t: number, x: number, y: number): void {
  if (payload.t === 'auto') resolveAutoHit(sim, payload, t);
  else if (payload.t === 'trainer') trainerShotHit(sim, t);
  else resolveAbilityHit(sim, payload, t, x, y);
}

/** Can a line skillshot hit unit e? Not blocked by minions: champions (and practice dummies) only. */
function lineCandidate(sim: Sim, team: number, e: number, anyUnit: boolean): boolean {
  const { Unit } = sim.c;
  const k = Unit.kind[e]!;
  if (!Unit.alive[e] || Unit.untargetable[e] || Unit.team[e] === team) return false;
  if (k === Kind.Projectile || k === Kind.Ward || k === Kind.Plant || isStructure(k)) return false;
  if (hasStat(sim, e, 'projImmune')) return false;
  return anyUnit || k === Kind.Champion || k === Kind.Dummy;
}

/** Earliest parameter t in [0,1] where segment A->B comes within r of C, or -1. */
export function sweepHit(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): number {
  if (segDist2(cx, cy, ax, ay, bx, by) > r * r) return -1;
  const dx = bx - ax;
  const dy = by - ay;
  const fx = ax - cx;
  const fy = ay - cy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  if (a === 0) return 0;
  const b = 2 * (fx * dx + fy * dy);
  const disc = Math.max(0, b * b - 4 * a * c);
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function updateLine(sim: Sim, eid: number, payload: Payload): void {
  const { Pos, Proj, Unit } = sim.c;
  if (payload.t === 'auto') return remove(sim, eid);
  if (payload.t === 'ability' && payload.ret === 2) {
    // returning: home on the caster
    const c = payload.caster;
    if (Unit.serial[c] !== payload.casterSerial || !Unit.alive[c]) return remove(sim, eid);
    const d = dist(Pos.x[eid]!, Pos.y[eid]!, Pos.x[c]!, Pos.y[c]!);
    [Proj.dx[eid], Proj.dy[eid]] = dir(Pos.x[eid]!, Pos.y[eid]!, Pos.x[c]!, Pos.y[c]!);
    Proj.maxDist[eid] = Proj.travelled[eid]! + d;
  }
  const remaining = Proj.maxDist[eid]! - Proj.travelled[eid]!;
  const step = Math.min(Proj.speed[eid]! * DT, remaining);
  const ax = Pos.x[eid]!;
  const ay = Pos.y[eid]!;
  const bx = ax + Proj.dx[eid]! * step;
  const by = ay + Proj.dy[eid]! * step;
  const half = Proj.width[eid]! / 2;
  const pierce = payload.flags.includes('pierce');
  const anyUnit = pierce || payload.flags.includes('blocked_by_minions');
  const hits: { t: number; e: number }[] = [];
  const ents = query(sim.world, [Unit]);
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i]!;
    if (!lineCandidate(sim, Proj.team[eid]!, e, anyUnit) || payload.hit.includes(e)) continue;
    const t = sweepHit(ax, ay, bx, by, Pos.x[e]!, Pos.y[e]!, Unit.radius[e]! + half);
    if (t >= 0) hits.push({ t, e });
  }
  hits.sort((p, q) => p.t - q.t || p.e - q.e);
  for (const h of hits) {
    payload.hit.push(h.e);
    const hx = ax + (bx - ax) * h.t;
    const hy = ay + (by - ay) * h.t;
    hit(sim, payload, h.e, hx, hy);
    if (!pierce) {
      Pos.x[eid] = hx;
      Pos.y[eid] = hy;
      return remove(sim, eid);
    }
  }
  Pos.x[eid] = bx;
  Pos.y[eid] = by;
  Proj.travelled[eid] = Proj.travelled[eid]! + step;
  if (Proj.travelled[eid]! >= Proj.maxDist[eid]! - 1e-9) {
    if (payload.t === 'ability' && payload.ret === 1) {
      payload.ret = 2;
      payload.hit = [];
      payload.tag = 'return';
      return;
    }
    remove(sim, eid);
    if (payload.t === 'ability' && payload.ret === 0) resolveAbilityExpire(sim, payload, bx, by);
  }
}
