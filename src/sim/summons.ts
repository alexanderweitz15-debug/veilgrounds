// Hook-spawned temporary things, one small module (upkeep: abilities system, every tick):
// - pets: units that fight (Kind.Pet, or minions spawned elsewhere and registered with trackLifetime);
//   behaviours 'static' | 'follow' (owner's / focus target, else stay near the owner) | 'walk' (to a point, then stay).
// - ground objects: plain records (blades, seeds, traps); hooks poll them, nothing renders them yet.
// - terrain: temporary impassable nav cells (walls, domes); units standing inside are pushed out.
// ponytail: minions/towers ignore pets, ground objects are not in snapshots. Upgrade: snapshot entries + render.

import { query } from 'bitecs';
import type { Sim } from './sim';
import { despawn, spawnUnit } from './sim';
import { Kind, isStructure } from './types';
import { CELL, findPath, lineWalkable, nearestWalkable } from './map';
import { dist2, segDist2 } from './vec';
import { canTarget, setAttackProjectileSpeed } from './systems/attack';

export type PetBehaviour = 'static' | 'follow' | 'walk';

export interface PetSpec {
  owner: number;
  tag: string;
  x: number;
  y: number;
  /** Lifetime in ticks (0 = until killed/removed). */
  ticks: number;
  radius?: number;
  hp?: number;
  ad?: number;
  as?: number;
  range?: number;
  ms?: number;
  armor?: number;
  mr?: number;
  vision?: number;
  /** Ranged auto projectile speed (0 = melee). */
  projectileSpeed?: number;
  behaviour?: PetBehaviour;
  tx?: number;
  ty?: number;
  /** Untargetable for everyone except the owner's autos (e.g. a powder keg); no attacks of its own. */
  ownerOnly?: boolean;
}

interface PetRec {
  serial: number;
  owner: number;
  ownerSerial: number;
  tag: string;
  until: number;
  behaviour: PetBehaviour;
  tx: number;
  ty: number;
  focus: number;
  focusSerial: number;
  ownerOnly: boolean;
}

export interface GroundObject {
  id: number;
  owner: number;
  team: number;
  tag: string;
  x: number;
  y: number;
  r: number;
  until: number;
  /** Free hook data. */
  data: number;
}

interface Terrain {
  cells: number[];
  until: number;
}

interface SummonState {
  pets: Map<number, PetRec>;
  objects: GroundObject[];
  nextId: number;
  terrain: Terrain[];
  /** Original walkability (copied on first terrain change). */
  baseWalk: Uint8Array | null;
}

function st(sim: Sim): SummonState {
  let s = sim.state.summons as SummonState | undefined;
  if (!s) sim.state.summons = s = { pets: new Map(), objects: [], nextId: 1, terrain: [], baseWalk: null };
  return s;
}

const forever = 1 << 30;

// ------------------------------------------------------------------ pets

export function spawnPet(sim: Sim, p: PetSpec): number {
  const { Unit, Hp, Stats, Vision } = sim.c;
  const eid = spawnUnit(sim, Kind.Pet, Unit.team[p.owner]!, p.x, p.y, p.radius ?? 45);
  Hp.max[eid] = Hp.cur[eid] = p.hp ?? 1;
  Stats.ad[eid] = p.ad ?? 0;
  Stats.as[eid] = p.as ?? 1;
  Stats.range[eid] = p.range ?? 125;
  Stats.ms[eid] = p.ms ?? 0;
  Stats.armor[eid] = p.armor ?? 0;
  Stats.mr[eid] = p.mr ?? 0;
  Vision.r[eid] = p.vision ?? 0;
  if (p.projectileSpeed) setAttackProjectileSpeed(sim, eid, p.projectileSpeed);
  if (p.ownerOnly) Unit.untargetable[eid] = 1; // attack.canTarget lets the owner through
  register(sim, eid, p.owner, p.tag, p.ticks, p.behaviour ?? 'static', p.tx ?? p.x, p.ty ?? p.y, !!p.ownerOnly);
  return eid;
}

function register(sim: Sim, eid: number, owner: number, tag: string, ticks: number, behaviour: PetBehaviour, tx: number, ty: number, ownerOnly: boolean): void {
  const { Unit } = sim.c;
  st(sim).pets.set(eid, {
    serial: Unit.serial[eid]!, owner, ownerSerial: Unit.serial[owner]!, tag, until: ticks > 0 ? sim.tick + ticks : forever,
    behaviour, tx, ty, focus: -1, focusSerial: 0, ownerOnly,
  });
  if (behaviour === 'walk') walkTo(sim, eid, tx, ty);
}

/** Register an existing unit (e.g. a minion from spawnMinion) as a timed summon of `owner` (keeps its own AI). */
export function trackLifetime(sim: Sim, eid: number, owner: number, tag: string, ticks: number): void {
  register(sim, eid, owner, tag, ticks, 'static', 0, 0, false);
}

/** Live summons of `owner` (optionally by tag), ascending eid. */
export function petsOf(sim: Sim, owner: number, tag?: string): number[] {
  const out: number[] = [];
  for (const [eid, r] of st(sim).pets) if (r.owner === owner && (tag === undefined || r.tag === tag) && live(sim, eid, r)) out.push(eid);
  return out.sort((a, b) => a - b);
}

export function setPetBehaviour(sim: Sim, eid: number, behaviour: PetBehaviour, o: { tx?: number; ty?: number; focus?: number } = {}): void {
  const r = st(sim).pets.get(eid);
  if (!r) return;
  r.behaviour = behaviour;
  if (o.focus !== undefined) (r.focus = o.focus), (r.focusSerial = o.focus >= 0 ? sim.c.Unit.serial[o.focus]! : 0);
  if (behaviour === 'walk') {
    r.tx = o.tx ?? r.tx;
    r.ty = o.ty ?? r.ty;
    sim.c.Atk.target[eid] = -1;
    walkTo(sim, eid, r.tx, r.ty);
  }
}

export function removePet(sim: Sim, eid: number): void {
  const s = st(sim);
  const r = s.pets.get(eid);
  if (r && live(sim, eid, r)) despawn(sim, eid);
  s.pets.delete(eid);
}

/** Owner eid if `t` is an owner-only target (keg), else -1. */
export function ownerOnlyTarget(sim: Sim, t: number): number {
  const s = sim.state.summons as SummonState | undefined;
  const r = s?.pets.get(t);
  return r && r.ownerOnly && r.serial === sim.c.Unit.serial[t] ? r.owner : -1;
}

const live = (sim: Sim, eid: number, r: PetRec): boolean => sim.c.Unit.serial[eid] === r.serial && sim.c.Unit.alive[eid] === 1;

function walkTo(sim: Sim, eid: number, x: number, y: number): void {
  const { Pos, Move } = sim.c;
  sim.paths.set(eid, lineWalkable(sim.map.nav, Pos.x[eid]!, Pos.y[eid]!, x, y) ? [nearestWalkable(sim.map.nav, x, y)] : findPath(sim.map.nav, Pos.x[eid]!, Pos.y[eid]!, x, y));
  Move.mode[eid] = 1;
  Move.tx[eid] = x;
  Move.ty[eid] = y;
}

const FOLLOW_DIST = 250;
const LEASH = 1000;

function follow(sim: Sim, eid: number, r: PetRec): void {
  const { Unit, Atk, Pos, Move } = sim.c;
  const o = r.owner;
  if (!Unit.alive[o]) return;
  const near = (t: number): boolean => dist2(Pos.x[t]!, Pos.y[t]!, Pos.x[o]!, Pos.y[o]!) <= LEASH * LEASH;
  let t = r.focus >= 0 && Unit.serial[r.focus] === r.focusSerial && canTarget(sim, eid, r.focus) && near(r.focus) ? r.focus : -1;
  const ot = Atk.target[o]!;
  if (t < 0 && ot >= 0 && Atk.targetSerial[o] === Unit.serial[ot] && canTarget(sim, eid, ot) && near(ot)) t = ot;
  if (t >= 0) {
    if (Atk.target[eid] !== t) (Atk.target[eid] = t), (Atk.targetSerial[eid] = Unit.serial[t]!);
    Move.mode[eid] = 2;
    return;
  }
  Atk.target[eid] = -1;
  if (dist2(Pos.x[eid]!, Pos.y[eid]!, Pos.x[o]!, Pos.y[o]!) > FOLLOW_DIST * FOLLOW_DIST) {
    if (Move.mode[eid] !== 1 || (sim.tick + eid) % 15 === 0) walkTo(sim, eid, Pos.x[o]!, Pos.y[o]!);
  } else Move.mode[eid] = 0;
}

// ------------------------------------------------------------------ ground objects

export function addGroundObject(sim: Sim, o: { owner: number; tag: string; x: number; y: number; r: number; ticks: number; data?: number }): number {
  const s = st(sim);
  const id = s.nextId++;
  s.objects.push({ id, owner: o.owner, team: sim.c.Unit.team[o.owner]!, tag: o.tag, x: o.x, y: o.y, r: o.r, until: o.ticks > 0 ? sim.tick + o.ticks : forever, data: o.data ?? 0 });
  return id;
}

/** Active ground objects (optionally filtered), oldest first. */
export function groundObjects(sim: Sim, tag?: string, owner?: number): GroundObject[] {
  const s = sim.state.summons as SummonState | undefined; // read-only: snapshots call this, it must not create state
  if (!s) return [];
  return s.objects.filter((o) => o.until > sim.tick && (tag === undefined || o.tag === tag) && (owner === undefined || o.owner === owner));
}

export function removeGroundObject(sim: Sim, id: number): void {
  const s = st(sim);
  s.objects = s.objects.filter((o) => o.id !== id);
}

// ------------------------------------------------------------------ terrain

/** Nav cells whose centre is within thickness/2 of segment A-B. */
export function wallCells(sim: Sim, ax: number, ay: number, bx: number, by: number, thickness: number): number[] {
  const h = thickness / 2;
  return cellsIn(sim, Math.min(ax, bx) - h, Math.min(ay, by) - h, Math.max(ax, bx) + h, Math.max(ay, by) + h, (x, y) => segDist2(x, y, ax, ay, bx, by) <= h * h);
}

/** Nav cells of a ring (dome edge) of radius r and the given thickness. */
export function ringCells(sim: Sim, cx: number, cy: number, r: number, thickness: number): number[] {
  const lo = Math.max(0, r - thickness / 2);
  const hi = r + thickness / 2;
  return cellsIn(sim, cx - hi, cy - hi, cx + hi, cy + hi, (x, y) => {
    const d = dist2(x, y, cx, cy);
    return d >= lo * lo && d <= hi * hi;
  });
}

function cellsIn(sim: Sim, x0: number, y0: number, x1: number, y1: number, test: (x: number, y: number) => boolean): number[] {
  const nav = sim.map.nav;
  const out: number[] = [];
  for (let cy = Math.max(0, Math.floor(y0 / CELL)); cy <= Math.min(nav.h - 1, Math.floor(y1 / CELL)); cy++)
    for (let cx = Math.max(0, Math.floor(x0 / CELL)); cx <= Math.min(nav.w - 1, Math.floor(x1 / CELL)); cx++)
      if (test((cx + 0.5) * CELL, (cy + 0.5) * CELL)) out.push(cy * nav.w + cx);
  return out;
}

/** Make cells impassable for `ticks`; units inside are pushed to the nearest walkable cell. */
export function blockTerrain(sim: Sim, cells: number[], ticks: number): void {
  const s = st(sim);
  const nav = sim.map.nav;
  s.baseWalk ??= nav.walk.slice();
  s.terrain.push({ cells, until: sim.tick + ticks });
  for (const c of cells) nav.walk[c] = 0;
  const { Unit, Pos } = sim.c;
  for (const e of query(sim.world, [Unit])) {
    if (!Unit.alive[e] || isStructure(Unit.kind[e]!) || Unit.kind[e] === Kind.Projectile) continue;
    const cell = Math.floor(Pos.y[e]! / CELL) * nav.w + Math.floor(Pos.x[e]! / CELL);
    if (nav.walk[cell] || !s.baseWalk[cell]) continue;
    const p = nearestWalkable(nav, Pos.x[e]!, Pos.y[e]!);
    Pos.x[e] = p.x;
    Pos.y[e] = p.y;
    sim.paths.delete(e);
  }
}

// ------------------------------------------------------------------ upkeep

export function updateSummons(sim: Sim): void {
  const s = sim.state.summons as SummonState | undefined;
  if (!s) return;
  for (const [eid, r] of [...s.pets]) {
    if (!live(sim, eid, r)) {
      s.pets.delete(eid);
      continue;
    }
    if (sim.tick >= r.until || sim.c.Unit.serial[r.owner] !== r.ownerSerial) {
      despawn(sim, eid);
      s.pets.delete(eid);
      continue;
    }
    if (r.behaviour === 'follow') follow(sim, eid, r);
  }
  if (s.objects.some((o) => o.until <= sim.tick)) s.objects = s.objects.filter((o) => o.until > sim.tick);
  if (s.terrain.some((t) => t.until <= sim.tick)) {
    const nav = sim.map.nav;
    const gone = s.terrain.filter((t) => t.until <= sim.tick);
    s.terrain = s.terrain.filter((t) => t.until > sim.tick);
    const still = new Set<number>();
    for (const t of s.terrain) for (const c of t.cells) still.add(c);
    for (const t of gone) for (const c of t.cells) if (!still.has(c)) nav.walk[c] = s.baseWalk![c]!;
  }
}
