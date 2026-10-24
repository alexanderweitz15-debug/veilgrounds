// Movement: path following (mode 1), chasing the attack target (mode 2), unit collision (champions + minions).
// Units do not move during attack windup (phase 1) or while rooted/stunned (Stats.ms === 0).

import { query } from 'bitecs';
import type { Sim } from '../sim';
import type { System } from './index';
import { DT, Kind, isMinion, isStructure } from '../types';
import { findPath, lineWalkable, nearestWalkable, walkable } from '../map';
import { isRef } from '../sim';
import { MAX_ENT } from '../ecs';
import { fearSource, hasBuff } from '../buffs';
import { isDisplacing } from './abilities';
import { dist2 } from '../vec';

/** Chase path is recomputed once the target moved this far from the path's end (no eid-phased timer: mirror-symmetric). */
const REPATH_DIST = 100;

/** Per-unit tick (sim.tick + 1, i.e. the tick number after this step) of the last own walking step. */
function walkTicks(sim: Sim): Int32Array {
  return (sim.state.walked ??= new Int32Array(MAX_ENT)) as Int32Array;
}

/**
 * True if the unit walked (path / chase step) in the last completed tick. Collision pushes, dashes, Flash and
 * knockbacks do not count: render plays the run cycle only for real walking (snapshot `moving`).
 */
export const walkedLastTick = (sim: Sim, eid: number): boolean => (sim.state.walked as Int32Array | undefined)?.[eid] === sim.tick;

export const movementSystem: System = {
  name: 'movement',
  update(sim) {
    const { Move, Pos, Unit, Stats, Atk, Face } = sim.c;
    const ents = query(sim.world, [Move]);
    const walked = walkTicks(sim);
    // chase targets are read from the positions at the start of the pass: units move in eid order, so reading the
    // live position let high eids (red) chase where low eids (blue) already stepped to this tick (side bias)
    const tx0 = ((sim.state.chaseX as Float64Array | undefined) ??= new Float64Array(MAX_ENT));
    const ty0 = ((sim.state.chaseY as Float64Array | undefined) ??= new Float64Array(MAX_ENT));
    tx0.set(Pos.x);
    ty0.set(Pos.y);
    // Furcht (fear): feared units walk straight away from the source, overriding orders given this tick
    for (let i = 0; i < ents.length; i++) {
      const eid = ents[i]!;
      if (!Unit.alive[eid]) continue;
      const src = fearSource(sim, eid);
      if (src >= 0) flee(sim, eid, src);
    }
    for (let i = 0; i < ents.length; i++) {
      const eid = ents[i]!;
      if (!Unit.alive[eid] || Move.mode[eid] === 0 || Atk.phase[eid] === 1) continue;
      let step = Stats.ms[eid]! * DT;
      if (step <= 0) continue;
      const sx = Pos.x[eid]!;
      const sy = Pos.y[eid]!;

      if (Move.mode[eid] === 2) {
        const t = Atk.target[eid]!;
        if (!isRef(sim, t, Atk.targetSerial[eid]!)) {
          Move.mode[eid] = 0;
          continue;
        }
        const reach = Stats.range[eid]! + Unit.radius[eid]! + Unit.radius[t]!;
        const px = tx0[t]!;
        const py = ty0[t]!;
        const dx = px - Pos.x[eid]!;
        const dy = py - Pos.y[eid]!;
        if (dx * dx + dy * dy <= reach * reach) continue; // in range: attack system takes over
        // chase: straight if clear, otherwise path (refreshed periodically)
        if (lineWalkable(sim.map.nav, Pos.x[eid]!, Pos.y[eid]!, px, py)) {
          sim.paths.set(eid, [{ x: px, y: py }]);
        } else if (chaseStale(sim.paths.get(eid), px, py)) {
          sim.paths.set(eid, findPath(sim.map.nav, Pos.x[eid]!, Pos.y[eid]!, px, py));
        }
        // never walk past the point where the target enters range
        step = Math.min(step, Math.sqrt(dx * dx + dy * dy) - reach + 1);
      }

      const path = sim.paths.get(eid);
      if (!path || path.length === 0) {
        Move.mode[eid] = 0;
        continue;
      }
      // walk along waypoints, consuming `step` distance
      while (step > 0 && path.length > 0) {
        const wp = path[0]!;
        const dx = wp.x - Pos.x[eid]!;
        const dy = wp.y - Pos.y[eid]!;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 0) {
          Face.x[eid] = dx / d;
          Face.y[eid] = dy / d;
        }
        if (d <= step) {
          Pos.x[eid] = wp.x;
          Pos.y[eid] = wp.y;
          step -= d;
          path.shift();
        } else {
          const nx = Pos.x[eid]! + (dx / d) * step;
          const ny = Pos.y[eid]! + (dy / d) * step;
          if (!walkable(sim.map.nav, nx, ny) && walkable(sim.map.nav, Pos.x[eid]!, Pos.y[eid]!)) {
            // slide along the wall on one axis; if both are blocked, repath next tick
            if (walkable(sim.map.nav, nx, Pos.y[eid]!)) Pos.x[eid] = nx;
            else if (walkable(sim.map.nav, Pos.x[eid]!, ny)) Pos.y[eid] = ny;
            else path.length = 0;
            sim.paths.delete(eid); // stale straight segment: get a fresh path from here
            if (Move.mode[eid] === 1) sim.paths.set(eid, findPath(sim.map.nav, Pos.x[eid]!, Pos.y[eid]!, Move.tx[eid]!, Move.ty[eid]!));
            break;
          }
          Pos.x[eid] = nx;
          Pos.y[eid] = ny;
          step = 0;
        }
      }
      if (path.length === 0 && Move.mode[eid] === 1) Move.mode[eid] = 0;
      if (Pos.x[eid] !== sx || Pos.y[eid] !== sy) walked[eid] = sim.tick + 1;
    }
    separateUnits(sim, ents);
    collideStructures(sim, ents);
  },
};

/** Distance of the flee waypoint (re-set every tick while feared). */
const FLEE_AHEAD = 300;

function flee(sim: Sim, eid: number, src: number): void {
  const { Pos, Move, Atk, Face } = sim.c;
  let dx = Pos.x[eid]! - Pos.x[src]!;
  let dy = Pos.y[eid]! - Pos.y[src]!;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > 0) (dx /= d), (dy /= d);
  else (dx = -Face.x[eid]!), (dy = -Face.y[eid]!);
  const p = nearestWalkable(sim.map.nav, Pos.x[eid]! + dx * FLEE_AHEAD, Pos.y[eid]! + dy * FLEE_AHEAD);
  Atk.target[eid] = -1;
  Move.mode[eid] = 1;
  Move.tx[eid] = p.x;
  Move.ty[eid] = p.y;
  sim.paths.set(eid, [p]);
}

function chaseStale(path: { x: number; y: number }[] | undefined, x: number, y: number): boolean {
  const end = path?.[path.length - 1];
  if (!end) return true;
  const dx = end.x - x;
  const dy = end.y - y;
  return dx * dx + dy * dy > REPATH_DIST * REPATH_DIST;
}

/**
 * Champion pairs (champion-champion, champion-minion) keep this fraction of the radius sum apart: LoL pathing radii
 * are smaller than the hit radii, so bodies may touch and overlap a little, but never stand inside each other.
 */
export const BODY_OVERLAP = 0.75;
/** Share of a champion-minion overlap the minion resolves (minions step aside, champions keep walking). */
const MINION_YIELD = 0.8;
/** Fraction of a champion overlap resolved per tick (soft: no jitter, a few ticks to separate). */
const BODY_RATE = 0.5;

/** Collision body: champions and lane minions; dashing/knocked-back units and Ghost (Geist) pass through. */
function isBody(sim: Sim, e: number): boolean {
  const k = sim.c.Unit.kind[e]!;
  if (!sim.c.Unit.alive[e] || (k !== Kind.Champion && !isMinion(k))) return false;
  if (isDisplacing(sim, e)) return false;
  return !(k === Kind.Champion && hasBuff(sim, e, 'stat', 'geist'));
}

/**
 * Soft unit collision. Minions separate fully (waves spread instead of stacking on one point); champions and minions
 * / other champions keep BODY_OVERLAP of their radius sum apart. A minion in a walking champion's way is pushed
 * aside (away from the champion's line of travel), so the champion walks around/through the wave instead of
 * shoving it ahead. Pushes never go into walls (nudge). Deterministic: ascending entity order, fixed tie axis.
 * ponytail: O(n^2) over ~100 bodies; spatial hash if bot-sim profiling shows it.
 */
function separateUnits(sim: Sim, ents: ArrayLike<number>): void {
  const { Pos, Unit, Face } = sim.c;
  const bodies: number[] = [];
  for (let i = 0; i < ents.length; i++) if (isBody(sim, ents[i]!)) bodies.push(ents[i]!);
  bodies.sort((p, q) => p - q);
  const walked = walkTicks(sim);
  const walking = (e: number): boolean => walked[e] === sim.tick + 1;
  // Pushes are computed from the positions at the start of the pass and applied together afterwards (Jacobi):
  // resolving pairs one after another moved low eids (blue spawns first) before high ones, so mirrored waves did
  // not stay mirrored (side bias).
  const acc = pushAcc(sim);
  for (const b of bodies) acc[b * 2] = acc[b * 2 + 1] = 0;
  const push = (e: number, dx: number, dy: number): void => {
    acc[e * 2] = acc[e * 2]! + dx;
    acc[e * 2 + 1] = acc[e * 2 + 1]! + dy;
  };
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i]!;
    const aChamp = Unit.kind[a] === Kind.Champion;
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j]!;
      const bChamp = Unit.kind[b] === Kind.Champion;
      const dx = Pos.x[b]! - Pos.x[a]!;
      const dy = Pos.y[b]! - Pos.y[a]!;
      const min = (Unit.radius[a]! + Unit.radius[b]!) * (aChamp || bChamp ? BODY_OVERLAP : 1);
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2);
      // coincident: push apart along a fixed axis (deterministic)
      const ux = d > 0 ? dx / d : 1;
      const uy = d > 0 ? dy / d : 0;
      if (!aChamp && !bChamp) {
        const p = (min - d) * 0.25;
        push(a, -ux * p, -uy * p);
        push(b, ux * p, uy * p);
        continue;
      }
      const over = (min - d) * BODY_RATE;
      if (aChamp && bChamp) {
        // A walking champion with the other one ahead slides around it (tangential resolution, like LoL pathing
        // around a standing unit) and takes most of the correction; two walkers each slide to their own side.
        const aw = walking(a);
        const bw = walking(b);
        const wa = aw === bw ? 0.5 : aw ? SLIDE_SHARE : 1 - SLIDE_SHARE;
        const [ax, ay] = aw ? sideStep(Face.x[a]!, Face.y[a]!, ux, uy) : [ux, uy];
        const [bx, by] = bw ? sideStep(Face.x[b]!, Face.y[b]!, -ux, -uy) : [-ux, -uy];
        push(a, -ax * over * wa, -ay * over * wa);
        push(b, -bx * over * (1 - wa), -by * over * (1 - wa));
        continue;
      }
      // champion vs minion: the minion yields, sideways off a walking champion's path
      const c = aChamp ? a : b;
      const m = aChamp ? b : a;
      const s = aChamp ? 1 : -1; // (ux, uy) * s points from champion to minion
      const [mx, my] = walking(c) ? sideStep(Face.x[c]!, Face.y[c]!, ux * s, uy * s) : [ux * s, uy * s];
      const mp = over * MINION_YIELD;
      const cp = over * (1 - MINION_YIELD);
      push(m, mx * mp, my * mp);
      push(c, -ux * s * cp, -uy * s * cp);
    }
  }
  for (const b of bodies) {
    const px = acc[b * 2]!;
    const py = acc[b * 2 + 1]!;
    if (px !== 0 || py !== 0) nudge(sim, b, Pos.x[b]! + px, Pos.y[b]! + py);
  }
}

/** Champion share of a champion-champion overlap taken by the one walking into a standing one. */
const SLIDE_SHARE = 0.8;

/**
 * Direction that pushes a body at unit offset (tx, ty) from a walker facing (fx, fy) out of the walker's way: if
 * it is ahead, the perpendicular toward its side of the walking line is added (so the walker, pushed the opposite
 * way, slides around it instead of stalling head-on). Exactly head-on picks a fixed side of the walking direction,
 * which is mirror-symmetric (a point mirror keeps the sign of the cross product).
 */
function sideStep(fx: number, fy: number, tx: number, ty: number): [number, number] {
  const ahead = tx * fx + ty * fy;
  if (ahead <= 0) return [tx, ty];
  const side = tx * fy - ty * fx >= 0 ? 1 : -1;
  const x = tx + fy * side * ahead;
  const y = ty - fx * side * ahead;
  const l = Math.sqrt(x * x + y * y);
  return [x / l, y / l];
}

/** Per-entity push accumulator (x, y interleaved) for separateUnits. */
function pushAcc(sim: Sim): Float64Array {
  return (sim.state.pushAcc ??= new Float64Array(MAX_ENT * 2)) as Float64Array;
}

/** Soft push: never into a wall or off the map (a blocked push is dropped; a unit already inside is let through). */
function nudge(sim: Sim, e: number, x: number, y: number): void {
  const { Pos } = sim.c;
  const nav = sim.map.nav;
  if (!walkable(nav, x, y) && walkable(nav, Pos.x[e]!, Pos.y[e]!)) return;
  Pos.x[e] = x;
  Pos.y[e] = y;
}

/** Hard push (structure rim): must move the unit, so a blocked target point snaps to the nearest walkable one. */
function shove(sim: Sim, e: number, x: number, y: number): void {
  const { Pos } = sim.c;
  const p = walkable(sim.map.nav, x, y) ? { x, y } : nearestWalkable(sim.map.nav, x, y);
  Pos.x[e] = p.x;
  Pos.y[e] = p.y;
}

/**
 * Units cannot overlap alive structures (towers, inhibitors, nexus). Overlapping units are pushed to the rim;
 * this also covers dash/blink endpoints. Sliding along the rim comes from the push-out plus continued movement.
 * ponytail: O(units x structures) (~120 x 22); fine until profiling says otherwise.
 */
function collideStructures(sim: Sim, ents: ArrayLike<number>): void {
  const { Pos, Unit } = sim.c;
  const structs: number[] = [];
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i]!;
    const k = Unit.kind[e]!;
    if (Unit.alive[e] && isStructure(k)) structs.push(e);
  }
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i]!;
    if (!Unit.alive[e] || isStructure(Unit.kind[e]!)) continue;
    for (const s of structs) {
      const dx = Pos.x[e]! - Pos.x[s]!;
      const dy = Pos.y[e]! - Pos.y[s]!;
      const min = Unit.radius[s]! + Unit.radius[e]!;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2);
      // exactly centred: push toward own side (deterministic)
      const ux = d > 0 ? dx / d : Unit.team[e] === 1 ? 0.7071 : -0.7071;
      const uy = d > 0 ? dy / d : Unit.team[e] === 1 ? 0.7071 : -0.7071;
      // tangential nudge so units walking straight at a structure slide around instead of sticking
      const side = ux * sim.c.Face.y[e]! - uy * sim.c.Face.x[e]! >= 0 ? 1 : -1; // slide toward facing side
      shove(sim, e, Pos.x[s]! + ux * min - uy * 2 * side, Pos.y[s]! + uy * min + ux * 2 * side);
      // A waypoint inside the structure's collision circle can never be reached: walking in and the push-out cancel
      // each other for ever (a siege minion stood at its own tower from 2:41 on, champions kept a move order onto a
      // tower, A2 bug hunt BUG-02). Standing at the rim counts as arrived.
      if (sim.c.Move.mode[e] === 1) {
        const path = sim.paths.get(e);
        const wp = path?.[0];
        if (path && wp && dist2(wp.x, wp.y, Pos.x[s]!, Pos.y[s]!) < min * min && dist2(Pos.x[e]!, Pos.y[e]!, Pos.x[s]!, Pos.y[s]!) <= (min + 4) * (min + 4)) {
          path.shift();
          if (path.length === 0) sim.c.Move.mode[e] = 0;
        }
      }
    }
  }
}
