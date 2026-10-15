// Wave state per lane derived from the bot's snapshot only (the sim's waveState is sim-side and off limits).
// Only team-visible minions count, so the result is partial in the fog: that is correct, a player knows no more.

import { LANES, type LaneName, type MapData, type Pt } from '../../sim/map';
import { Kind, isMinion } from '../../sim/types';
import type { SnapEntity, Snapshot } from '../../sim/snapshot';
import { dst, laneProgress } from '../bot/geo';
import type { WaveInfo } from './types';

/** Max distance from the lane polyline for a minion to count to that lane. */
const LANE_OFF = 500;
/** Tower shot reach used for crashed / at-tower checks (TOWER_RANGE + radius + margin). */
const TOWER_REACH = 950;

const laneLen = new WeakMap<Pt[], number>();
export function laneLength(pts: Pt[]): number {
  let l = laneLen.get(pts);
  if (l === undefined) {
    l = 0;
    for (let i = 0; i + 1 < pts.length; i++) l += dst(pts[i]!, pts[i + 1]!);
    laneLen.set(pts, l);
  }
  return l;
}

/** Normalised lane position (0 own nexus .. 1 enemy nexus) and polyline offset of a point, from `team`'s side. */
export function lanePos(map: MapData, team: number, lane: LaneName, p: Pt): { t: number; off: number } {
  const pts = map.sides[team as 0 | 1].lanes[lane];
  const { s, off } = laneProgress(pts, p);
  return { t: s / laneLength(pts), off };
}

/** Lane a point belongs to (nearest polyline within `maxOff`), or null. */
export function laneOf(map: MapData, team: number, p: Pt, maxOff = 900): LaneName | null {
  let best: LaneName | null = null;
  let bo = maxOff;
  for (const l of LANES) {
    const { off } = lanePos(map, team, l, p);
    if (off < bo) (bo = off), (best = l);
  }
  return best;
}

/** Outer-most alive tower of `towerTeam` in a lane (from visible structures; structures are always in the snapshot). */
export function frontTower(map: MapData, snap: Snapshot, towerTeam: number, lane: LaneName): SnapEntity | null {
  for (const p of map.sides[towerTeam as 0 | 1].towers[lane]) {
    const t = snap.entities.find((e) => e.kind === Kind.Tower && e.alive && e.team === towerTeam && dst(e, p) < 200);
    if (t) return t;
  }
  return null;
}

export function waveStates(map: MapData, snap: Snapshot, team: number): Record<LaneName, WaveInfo> {
  const out = {} as Record<LaneName, WaveInfo>;
  const enemy = team === 0 ? 1 : 0;
  for (const lane of LANES) {
    let own = 0;
    let foe = 0;
    let sum = 0;
    let siege = false;
    const ownM: SnapEntity[] = [];
    for (const e of snap.entities) {
      if (!e.alive || !isMinion(e.kind)) continue;
      const { t, off } = lanePos(map, team, lane, e);
      if (off > LANE_OFF) continue;
      sum += t;
      if (e.team === team) {
        own++;
        ownM.push(e);
        if (e.kind === Kind.MinionSiege) siege = true;
      } else foe++;
    }
    const n = own + foe;
    const pos = n > 0 ? sum / n : NaN;
    const et = frontTower(map, snap, enemy, lane);
    const ot = frontTower(map, snap, team, lane);
    out[lane] = {
      visible: n > 0,
      ownCount: own,
      enemyCount: foe,
      pos,
      enemySide: n > 0 && pos > 0.5,
      crashed: !!et && ownM.some((m) => dst(m, et) < TOWER_REACH),
      atOwnTower: n > 0 && !!ot && foe > 0 && snap.entities.some((e) => e.alive && isMinion(e.kind) && e.team === enemy && dst(e, ot) < TOWER_REACH),
      pushing: own >= foe + 3,
      siege,
    };
  }
  return out;
}
