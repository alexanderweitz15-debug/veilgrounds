// Movement: path following (mode 1), chasing the attack target (mode 2), minion separation.
// Units do not move during attack windup (phase 1) or while rooted/stunned (Stats.ms === 0).

import { query } from 'bitecs';
import type { Sim } from '../sim';
import type { System } from './index';
import { DT, isMinion, isStructure } from '../types';
import { findPath, lineWalkable, walkable } from '../map';
import { isRef } from '../sim';

const REPATH_TICKS = 15;

export const movementSystem: System = {
  name: 'movement',
  update(sim) {
    const { Move, Pos, Unit, Stats, Atk, Face } = sim.c;
    const ents = query(sim.world, [Move]);
    for (let i = 0; i < ents.length; i++) {
      const eid = ents[i]!;
      if (!Unit.alive[eid] || Move.mode[eid] === 0 || Atk.phase[eid] === 1) continue;
      let step = Stats.ms[eid]! * DT;
      if (step <= 0) continue;

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
    }
    separateMinions(sim, ents);
    collideStructures(sim, ents);
  },
};

/**
 * Soft separation so minion waves do not stack on one point. Champions pass through units.
 * ponytail: O(n^2) over minions (~90 max); spatial hash if bot-sim profiling shows it.
 */
function separateMinions(sim: Sim, ents: ArrayLike<number>): void {
  const { Pos, Unit } = sim.c;
  const ms: number[] = [];
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i]!;
    if (Unit.alive[e] && isMinion(Unit.kind[e]!)) ms.push(e);
  }
  for (let i = 0; i < ms.length; i++) {
    const a = ms[i]!;
    for (let j = i + 1; j < ms.length; j++) {
      const b = ms[j]!;
      const dx = Pos.x[b]! - Pos.x[a]!;
      const dy = Pos.y[b]! - Pos.y[a]!;
      const min = Unit.radius[a]! + Unit.radius[b]!;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2);
      // coincident: push apart along a fixed axis derived from eid order (deterministic)
      const ux = d > 0 ? dx / d : 1;
      const uy = d > 0 ? dy / d : 0;
      const push = (min - d) * 0.25;
      Pos.x[a] = Pos.x[a]! - ux * push;
      Pos.y[a] = Pos.y[a]! - uy * push;
      Pos.x[b] = Pos.x[b]! + ux * push;
      Pos.y[b] = Pos.y[b]! + uy * push;
    }
  }
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
      Pos.x[e] = Pos.x[s]! + ux * min - uy * 2 * side;
      Pos.y[e] = Pos.y[s]! + uy * min + ux * 2 * side;
    }
  }
}
