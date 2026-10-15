// Team vision. Strict fog of war: snapshots and bot views only contain enemies a team can see.
// Bush rule: a unit inside a bush is visible to an enemy only if that enemy stands in the same bush
// (or a ward/true-sight source covers it - wards arrive with Phase 3).

import { query } from 'bitecs';
import type { Sim } from './sim';
import { inBush } from './map';
import { Team } from './types';
import { isRevealed } from './buffs';

/** visible[team][eid] = 1 if team sees eid this tick. Recomputed once per tick by computeVision. */
export interface VisionState {
  visible: [Uint8Array, Uint8Array];
  bush: Int16Array;
  /** Vision source eids per team (alive units with Vision.r > 0), refreshed each tick. */
  sources: [number[], number[]];
}

export function visionState(sim: Sim): VisionState {
  let v = sim.state.vision as VisionState | undefined;
  if (!v) {
    const n = sim.c.Pos.x.length;
    v = { visible: [new Uint8Array(n), new Uint8Array(n)], bush: new Int16Array(n), sources: [[], []] };
    sim.state.vision = v;
  }
  return v;
}

export function computeVision(sim: Sim): VisionState {
  const v = visionState(sim);
  const { Pos, Unit, Vision } = sim.c;
  const ents = query(sim.world, [Unit]);
  v.visible[0].fill(0);
  v.visible[1].fill(0);
  const sources: number[] = [];
  v.sources[0].length = 0;
  v.sources[1].length = 0;
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i]!;
    v.bush[e] = Unit.alive[e] ? inBush(sim.map, Pos.x[e]!, Pos.y[e]!) : -1;
    if (Unit.alive[e] && Vision.r[e]! > 0 && Unit.team[e]! !== Team.Neutral) {
      sources.push(e);
      v.sources[Unit.team[e] as 0 | 1].push(e);
    }
  }
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i]!;
    if (!Unit.alive[e]) continue;
    const team = Unit.team[e]!;
    if (team === Team.Blue || team === Team.Red) v.visible[team][e] = 1; // own units
    for (const viewer of [Team.Blue, Team.Red] as const) {
      if (v.visible[viewer][e]) continue;
      if (isRevealed(sim, viewer, e)) {
        v.visible[viewer][e] = 1; // reveal (e.g. Mira W) ignores range and bushes
        continue;
      }
      for (const s of sources) {
        if (Unit.team[s] !== viewer) continue;
        const dx = Pos.x[e]! - Pos.x[s]!;
        const dy = Pos.y[e]! - Pos.y[s]!;
        const r = Vision.r[s]!;
        if (dx * dx + dy * dy > r * r) continue;
        if (v.bush[e]! >= 0 && v.bush[s] !== v.bush[e]) continue;
        v.visible[viewer][e] = 1;
        break;
      }
    }
  }
  return v;
}

export function sees(sim: Sim, team: number, eid: number): boolean {
  if (team !== Team.Blue && team !== Team.Red) return true;
  return visionState(sim).visible[team][eid] === 1;
}

/** Is a map point inside the team's vision (same bush rule as units)? Used for projectiles and ground effects. */
export function pointVisible(sim: Sim, team: number, x: number, y: number): boolean {
  if (team !== Team.Blue && team !== Team.Red) return true;
  const v = visionState(sim);
  const { Pos, Vision } = sim.c;
  const bush = inBush(sim.map, x, y);
  for (const s of v.sources[team]) {
    const dx = x - Pos.x[s]!;
    const dy = y - Pos.y[s]!;
    const r = Vision.r[s]!;
    if (dx * dx + dy * dy <= r * r && (bush < 0 || v.bush[s] === bush)) return true;
  }
  return false;
}
