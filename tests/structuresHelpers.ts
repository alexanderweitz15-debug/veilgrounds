// Test helpers for agent A's systems: step only structures/waves/minions/movement/economy/vision, so these tests
// do not depend on the combat systems (attack/projectiles/abilities/stats).
import { addComp, createSim, spawnUnit, type Sim } from '../src/sim/sim';
import { removeEntity } from 'bitecs';
import { Kind } from '../src/sim/types';
import { towersSystem } from '../src/sim/systems/towers';
import { wavesSystem } from '../src/sim/systems/waves';
import { minionsSystem } from '../src/sim/systems/minions';
import { movementSystem } from '../src/sim/systems/movement';
import { economySystem } from '../src/sim/systems/economy';
import { computeVision } from '../src/sim/vision';

export const newSim = (minions = true): Sim => createSim({ seed: 7, mode: 'sandbox', players: [], minionsEnabled: minions });

const mine = [towersSystem, wavesSystem, minionsSystem, movementSystem, economySystem, { name: 'vision', update: computeVision }];

export function stepA(sim: Sim): void {
  sim.events.length = 0;
  const { Pos } = sim.c;
  Pos.px.set(Pos.x);
  Pos.py.set(Pos.y);
  for (const s of mine) s.update(sim);
  for (const e of sim.doomed) removeEntity(sim.world, e);
  sim.doomed.length = 0;
  sim.tick++;
}

export function stepUntil(sim: Sim, tick: number): void {
  while (sim.tick < tick) stepA(sim);
}

/** Bare champion (no champion data): Champ component, level 1, 600 HP, 60 AD. */
export function spawnChamp(sim: Sim, team: number, x: number, y: number, slot = -1): number {
  const e = spawnUnit(sim, Kind.Champion, team, x, y, 65);
  addComp(sim, sim.c.Champ, e);
  const { Champ, Hp, Stats, Unit, Vision } = sim.c;
  Unit.slot[e] = slot;
  Champ.level[e] = 1;
  Champ.xp[e] = 0;
  Hp.max[e] = Hp.cur[e] = 600;
  Stats.ad[e] = 60;
  Stats.ms[e] = 330;
  Stats.range[e] = 550;
  Vision.r[e] = 1200;
  return e;
}
