// Team vision. Strict fog of war: snapshots and bot views only contain enemies a team can see.
// Bush rule: a unit inside a bush is visible to an enemy only if that enemy stands in the same bush
// (or a ward/true-sight source covers it - wards arrive with Phase 3).
// Invisible units (stat buff 'invisible') are hidden from the enemy team unless revealed (reveal beats invisibility)
// or an enemy tower's true sight (towers.json trueSightR) covers them.
// Exposure (wards.json exposure, LoL-like): a unit attacking/casting from a bush, and a champion that damages an enemy
// champion, is visible to the enemy team for a short time (ignores range and bushes, not invisibility). Separate from
// buffs.reveal so the "revealed" UI marker stays reserved for real reveal effects.

import { query } from 'bitecs';
import type { Sim } from './sim';
import { inBush } from './map';
import { Kind, Team, enemyOf, sec } from './types';
import { hasStat, isRevealed } from './buffs';
import WARDS from '../data/wards.json';
import TOWERS from '../data/towers.json';

export const EXPOSE = { bushTicks: sec(WARDS.exposure.bushAttackS), hitTicks: sec(WARDS.exposure.championHitS) };
/** Tower true sight radius (centre distance, plus the target's radius); 0 = off. */
export const TOWER_TRUE_SIGHT = TOWERS.trueSightR;

/** visible[team][eid] = 1 if team sees eid this tick. Recomputed once per tick by computeVision. */
export interface VisionState {
  visible: [Uint8Array, Uint8Array];
  bush: Int16Array;
  /** Vision source eids per team (alive units with Vision.r > 0), refreshed each tick. */
  sources: [number[], number[]];
  /** Alive towers per team (true sight). */
  towers: [number[], number[]];
}

/** Exposure end tick per viewing team and unit (serial guards eid reuse). Lives in sim.state.expose (hashed, cloned). */
type Expose = [Map<number, { until: number; serial: number }>, Map<number, { until: number; serial: number }>];
const exposeState = (sim: Sim): Expose => (sim.state.expose ??= [new Map(), new Map()]) as Expose;

/** Make unit `eid` visible to `team` for `ticks` (ignores range and bushes). Invisible units stay hidden. */
export function exposeTo(sim: Sim, team: number, eid: number, ticks: number): void {
  if ((team !== Team.Blue && team !== Team.Red) || ticks <= 0 || hasStat(sim, eid, 'invisible')) return;
  const m = exposeState(sim)[team]!;
  const until = sim.tick + ticks;
  const serial = sim.c.Unit.serial[eid]!;
  const cur = m.get(eid);
  m.set(eid, { until: cur && cur.serial === serial ? Math.max(cur.until, until) : until, serial });
}

/** A unit that attacks or casts while standing in a bush is exposed to the enemy team for EXPOSE.bushTicks. */
export function bushAttackExpose(sim: Sim, eid: number): void {
  if (inBush(sim.map, sim.c.Pos.x[eid]!, sim.c.Pos.y[eid]!) >= 0) exposeTo(sim, enemyOf(sim.c.Unit.team[eid]!), eid, EXPOSE.bushTicks);
}

function isExposed(sim: Sim, team: number, eid: number): boolean {
  const e = exposeState(sim)[team as 0 | 1].get(eid);
  return !!e && e.until > sim.tick && e.serial === sim.c.Unit.serial[eid];
}

/** Does an alive tower of `team` cover the circle (x, y, r) with true sight? */
export function towerTrueSight(sim: Sim, team: number, x: number, y: number, r = 0): boolean {
  if (TOWER_TRUE_SIGHT <= 0 || (team !== Team.Blue && team !== Team.Red)) return false;
  const { Pos } = sim.c;
  const rr = TOWER_TRUE_SIGHT + r;
  for (const t of visionState(sim).towers[team]) {
    const dx = x - Pos.x[t]!;
    const dy = y - Pos.y[t]!;
    if (dx * dx + dy * dy <= rr * rr) return true;
  }
  return false;
}

export function visionState(sim: Sim): VisionState {
  let v = sim.state.vision as VisionState | undefined;
  if (!v) {
    const n = sim.c.Pos.x.length;
    v = { visible: [new Uint8Array(n), new Uint8Array(n)], bush: new Int16Array(n), sources: [[], []], towers: [[], []] };
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
  v.sources[0].length = 0;
  v.sources[1].length = 0;
  v.towers[0].length = 0;
  v.towers[1].length = 0;
  for (const m of exposeState(sim)) for (const [k, x] of m) if (x.until <= sim.tick) m.delete(k);
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i]!;
    v.bush[e] = Unit.alive[e] ? inBush(sim.map, Pos.x[e]!, Pos.y[e]!) : -1;
    if (Unit.alive[e] && Vision.r[e]! > 0 && Unit.team[e]! !== Team.Neutral) {
      v.sources[Unit.team[e] as 0 | 1].push(e);
    }
    if (Unit.alive[e] && Unit.kind[e] === Kind.Tower && Unit.team[e]! !== Team.Neutral) v.towers[Unit.team[e] as 0 | 1].push(e);
  }
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i]!;
    if (!Unit.alive[e]) continue;
    const team = Unit.team[e]!;
    if (team === Team.Blue || team === Team.Red) v.visible[team][e] = 1; // own units
    for (const viewer of [Team.Blue, Team.Red] as const) {
      if (v.visible[viewer][e]) continue;
      if (isRevealed(sim, viewer, e)) {
        v.visible[viewer][e] = 1; // reveal (e.g. Mira W) ignores range, bushes and invisibility
        continue;
      }
      if (hasStat(sim, e, 'invisible')) {
        if (!towerTrueSight(sim, viewer, Pos.x[e]!, Pos.y[e]!, Unit.radius[e]!)) continue;
      } else if (isExposed(sim, viewer, e)) {
        v.visible[viewer][e] = 1;
        continue;
      }
      if (sourceSees(sim, v, viewer, e, -1)) v.visible[viewer][e] = 1;
    }
  }
  return v;
}

function sourceSees(sim: Sim, v: VisionState, viewer: number, e: number, exclude: number): boolean {
  const { Pos, Vision } = sim.c;
  for (const s of v.sources[viewer as 0 | 1]) {
    if (s === exclude) continue;
    const dx = Pos.x[e]! - Pos.x[s]!;
    const dy = Pos.y[e]! - Pos.y[s]!;
    const r = Vision.r[s]!;
    if (dx * dx + dy * dy > r * r) continue;
    if (v.bush[e]! >= 0 && v.bush[s] !== v.bush[e]) continue;
    return true;
  }
  return false;
}

/** Does any vision source of `team` other than `exclude` see eid (range/bush/invisibility rules, reveals ignored)? */
export function seenByOthers(sim: Sim, team: number, eid: number, exclude: number): boolean {
  if (team !== Team.Blue && team !== Team.Red) return false;
  if (hasStat(sim, eid, 'invisible')) return false;
  return sourceSees(sim, visionState(sim), team, eid, exclude);
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
