// Champion spawn from data (src/data/champions/<id>.json) and practice dummies.

import type { Sim } from '../sim';
import type { System } from './index';
import { addComp, spawnUnit } from '../sim';
import { Kind, type PlayerSetup, type TeamId } from '../types';
import { nearestWalkable } from '../map';
import { CHAMPION_DATA, FALLBACK_CHAMPION, championData, passiveHooksOf } from '../champions';
import { computeChampionStats } from './stats';
import { champAbil } from './abilities';

export const championsSystem: System = {
  name: 'champions',
  init(sim) {
    for (const p of sim.config.players) spawnChampion(sim, p);
    for (const d of sim.config.dummies ?? []) spawnDummy(sim, d.x, d.y, d.team, d.armor, d.mr);
  },
  update() {}, // respawn is Agent A's economy; buffs/cooldowns survive death (see buffs.ts / abilities.ts)
};

/** Spawn offsets around the fountain center per slot within the team (0..4). */
const SLOT_OFFSETS: [number, number][] = [
  [0, 0],
  [160, -60],
  [-60, 160],
  [260, 60],
  [60, 260],
];

export function spawnChampion(sim: Sim, p: PlayerSetup): number {
  const id = CHAMPION_DATA[p.champion] ? p.champion : FALLBACK_CHAMPION; // unknown ids fall back for now
  const d = championData(id);
  const f = sim.map.sides[p.team === 1 ? 1 : 0].fountain;
  const [ox, oy] = SLOT_OFFSETS[p.slot % 5]!;
  const sign = p.team === 1 ? -1 : 1; // red fountain is point-mirrored
  const pos = nearestWalkable(sim.map.nav, f.x + sign * ox, f.y + sign * oy);
  const eid = spawnUnit(sim, Kind.Champion, p.team, pos.x, pos.y, d.base.radius || (d.attackType === 'melee' ? 65 : 55));
  addComp(sim, sim.c.Champ, eid);
  const { Unit, Champ, Vision } = sim.c;
  Unit.champ[eid] = sim.championIds.push(id) - 1;
  Unit.slot[eid] = p.slot;
  sim.slots[p.slot] = eid;
  Champ.level[eid] = 1;
  Champ.xp[eid] = 0;
  Champ.skillPoints[eid] = 1;
  Champ.respawnAt[eid] = 0;
  Champ.recallAt[eid] = 0;
  Vision.r[eid] = 1200;
  computeChampionStats(sim, eid, true);
  champAbil(sim, eid);
  for (const h of passiveHooksOf(sim, eid)) h.onSpawn?.(sim, eid);
  return eid;
}

/** Practice dummy (scarecrow): 1000 HP, never dies (damage.ts resets HP), does not attack or move. */
export function spawnDummy(sim: Sim, x: number, y: number, team: TeamId, armor = 0, mr = 0): number {
  const eid = spawnUnit(sim, Kind.Dummy, team, x, y, 65);
  const { Hp, Stats, Vision } = sim.c;
  Hp.max[eid] = Hp.cur[eid] = 1000;
  Stats.armor[eid] = armor;
  Stats.mr[eid] = mr;
  Vision.r[eid] = 0;
  return eid;
}
