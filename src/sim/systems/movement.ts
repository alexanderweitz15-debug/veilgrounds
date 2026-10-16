// Movement: path following (mode 1), chasing the attack target (mode 2), unit collision (champions + minions).
// Units do not move during attack windup (phase 1) or while rooted/stunned (Stats.ms === 0).

import { query } from 'bitecs';
import type { Sim } from '../sim';
import type { System } from './index';
import { DT, Kind, isMinion, isStructure } from '../types';
import { findPath, lineWalkable, nearestWalkable, walkable } from '../map';
import { isRef } from '../sim';
import { MAX_ENT } from '../ecs';
import { hasBuff } from '../buffs';
import { isDisplacing } from './abilities';

const REPATH_TICKS = 15;

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
        const dx = Pos.x[t]! - Pos.x[eid]!;
        const dy = Pos.y[t]! - Pos.y[eid]!;
        if (dx * dx + dy * dy <= reach * reach) continue; // in range: attack system takes over
        // chase: straight if clear, otherwise path (refreshed periodically)
        if (lineWalkable(sim.map.nav, Pos.x[eid]!, Pos.y[eid]!, Pos.x[t]!, Pos.y[t]!)) {
          sim.paths.set(eid, [{ x: Pos.x[t]!, y: Pos.y[t]! }]);
        } else if (!sim.paths.has(eid) || (sim.tick + eid) % REPATH_TICKS === 0) {
          sim.paths.set(eid, findPath(sim.map.nav, Pos.x[eid]!, Pos.y[eid]!, Pos.x[t]!, Pos.y[t]!));
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
      // coincident: push apart along a fixed axis derived from eid order (deterministic)
      const ux = d > 0 ? dx / d : 1;
      const uy = d > 0 ? dy / d : 0;
      if (!aChamp && !bChamp) {
        const push = (min - d) * 0.25;
        nudge(sim, a, Pos.x[a]! - ux * push, Pos.y[a]! - uy * push);
        nudge(sim, b, Pos.x[b]! + ux * push, Pos.y[b]! + uy * push);
        continue;
      }
      const over = (min - d) * BODY_RATE;
      if (aChamp && bChamp) {
        nudge(sim, a, Pos.x[a]! - ux * over * 0.5, Pos.y[a]! - uy * over * 0.5);
        nudge(sim, b, Pos.x[b]! + ux * over * 0.5, Pos.y[b]! + uy * over * 0.5);
        continue;
      }
      // champion vs minion: the minion yields; sideways off a walking champion's path
      const c = aChamp ? a : b;
      const m = aChamp ? b : a;
      const s = aChamp ? 1 : -1; // (ux, uy) * s points from champion to minion
      let mx = ux * s;
      let my = uy * s;
      if (walked[c] === sim.tick + 1) {
        const fx = Face.x[c]!;
        const fy = Face.y[c]!;
        const ahead = mx * fx + my * fy;
        if (ahead > 0) {
          // minion ahead of the champion: add the perpendicular toward the minion's side of the walking line
          const side = mx * fy - my * fx >= 0 ? 1 : -1;
          mx += fy * side * ahead;
          my += -fx * side * ahead;
          const l = Math.sqrt(mx * mx + my * my);
          mx /= l;
          my /= l;
        }
      }
      const mp = over * MINION_YIELD;
      const cp = over * (1 - MINION_YIELD);
      nudge(sim, m, Pos.x[m]! + mx * mp, Pos.y[m]! + my * mp);
      nudge(sim, c, Pos.x[c]! - ux * s * cp, Pos.y[c]! - uy * s * cp);
    }
  }
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
    }
  }
}
