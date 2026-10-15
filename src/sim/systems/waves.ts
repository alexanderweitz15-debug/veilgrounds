// OWNER: agent A (minion waves).
// First wave 1:05 (tick 1950); every 30 s, from 15:00 every 25 s, from 25:00 every 20 s.
// Wave = 3 melee + 3 casters; siege every 3rd wave (from 15:00 every 2nd, from 25:00 every wave);
// one super minion per wave in a lane whose enemy inhibitor is down.
// ponytail: LoL sends 2 supers per lane when all 3 inhibitors are down and replaces the siege minion; add both
// here if late-game pushing feels too weak.

import type { Sim } from '../sim';
import type { System } from './index';
import { Kind, Lane, enemyOf, sec, type LaneId } from '../types';
import { laneDir, laneGeo, lanePoint, setLanePath, spawnMinion } from './minions';
import { inhibitorDown } from './towers';

export const FIRST_WAVE_TICK = 1950;
const T15 = sec(15 * 60);
const T25 = sec(25 * 60);

/** Interval to the next wave after a wave spawned at `tick`. */
export const waveInterval = (tick: number): number => (tick < T15 ? sec(30) : tick < T25 ? sec(25) : sec(20));
/** Siege minion every n-th wave at `tick`. */
const siegeEvery = (tick: number): number => (tick < T15 ? 3 : tick < T25 ? 2 : 1);

/**
 * Distance along the lane (from own nexus) where the front row spawns. Tuned with MINION_MS = 300 so the
 * fronts meet at ~1:35 mid and ~1:45 side (tests/waves.test.ts). Negative = behind the nexus centre.
 */
export const SPAWN_DIST = { mid: -250, side: 750 };
const ROW_GAP = 130;
const COL_GAP = 100;

interface WaveSt {
  next: number;
  index: number;
  sinceSiege: number;
}

function st(sim: Sim): WaveSt {
  let s = sim.state.waves as WaveSt | undefined;
  if (!s) {
    s = { next: FIRST_WAVE_TICK, index: 0, sinceSiege: 0 };
    sim.state.waves = s;
  }
  return s;
}

/** Time to the next wave and whether it carries a siege minion. */
export function nextWaveInfo(sim: Sim): { tick: number; inSeconds: number; siege: boolean; index: number } {
  const s = st(sim);
  return { tick: s.next, inSeconds: Math.max(0, (s.next - sim.tick) / 30), siege: s.sinceSiege + 1 >= siegeEvery(s.next), index: s.index };
}

/** Spawn one wave for `team` in `lane` (rows front to back: super, 3 melee, siege, 3 casters). */
export function spawnWave(sim: Sim, team: number, lane: LaneId, siege: boolean, superMinion: boolean): number[] {
  const g = laneGeo(sim, team, lane);
  const d0 = lane === Lane.Mid ? SPAWN_DIST.mid : SPAWN_DIST.side;
  const rows: number[][] = [];
  if (superMinion) rows.push([Kind.MinionSuper]);
  rows.push([Kind.MinionMelee, Kind.MinionMelee, Kind.MinionMelee]);
  if (siege) rows.push([Kind.MinionSiege]);
  rows.push([Kind.MinionCaster, Kind.MinionCaster, Kind.MinionCaster]);
  const out: number[] = [];
  rows.forEach((row, r) => {
    const d = d0 - r * ROW_GAP;
    const p = lanePoint(g, d);
    const dir = laneDir(g, Math.max(0, d));
    row.forEach((kind, i) => {
      const off = (i - (row.length - 1) / 2) * COL_GAP;
      const eid = spawnMinion(sim, kind, team, lane, p.x - dir.y * off, p.y + dir.x * off);
      setLanePath(sim, eid);
      out.push(eid);
    });
  });
  return out;
}

export const wavesSystem: System = {
  name: 'waves',
  update(sim) {
    const s = st(sim);
    if (sim.tick < s.next) return;
    const tick = sim.tick;
    s.sinceSiege++;
    const siege = s.sinceSiege >= siegeEvery(tick);
    if (siege) s.sinceSiege = 0;
    // The schedule advances even with minions off, so toggling them back on stays in sync.
    if (sim.flags.minions) {
      const lanes = sim.config.minionLanes ?? [Lane.Top, Lane.Mid, Lane.Bot];
      for (const team of [0, 1]) {
        for (const lane of [Lane.Top, Lane.Mid, Lane.Bot] as LaneId[]) {
          if (!lanes.includes(lane)) continue;
          spawnWave(sim, team, lane, siege, inhibitorDown(sim, enemyOf(team), lane));
          sim.events.push({ e: 'wave', lane, team, index: s.index });
        }
      }
    }
    s.index++;
    s.next = tick + waveInterval(tick);
  },
};
