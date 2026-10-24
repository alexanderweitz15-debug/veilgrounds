// A2 bug hunt (docs/BUGS.md): respawn / death timers.
// structuresHelpers first: it imports sim.ts before any system module (systems <-> sim import cycle).
import { newSim } from './structuresHelpers';
import { describe, expect, it } from 'vitest';
import { createSim, step } from '../src/sim/sim';
import { CHAMPION_DATA } from '../src/sim/champions';
import { kill } from '../src/sim/damage';
import { deathTimerTicks } from '../src/sim/systems/economy';

void newSim;

describe('respawn resets every champion', () => {
  it('after the death timer each champion stands in the fountain, healthy, able to move (all kits)', () => {
    const bad: string[] = [];
    for (const id of Object.keys(CHAMPION_DATA)) {
      const sim = createSim({ seed: 5, mode: 'sandbox', minionsEnabled: false, players: [{ slot: 0, team: 0, champion: id, role: 'mid', summoners: ['sprung', 'heilen'], isHuman: true }] });
      const e = sim.slots[0]!;
      for (let i = 0; i < 60; i++) step(sim);
      const diedAt = sim.tick;
      kill(sim, e, -1);
      expect(sim.c.Unit.alive[e]).toBe(0);
      let guard = 0;
      while (!sim.c.Unit.alive[e] && guard++ < 30 * 40) step(sim);
      const respawnTick = sim.tick;
      for (let i = 0; i < 3; i++) step(sim);
      if (Math.abs(respawnTick - (diedAt + deathTimerTicks(1, diedAt))) > 2) bad.push(`${id}: respawned at ${respawnTick}, died at ${diedAt}`);
      if (!sim.c.Unit.alive[e] || sim.c.Stats.ms[e]! <= 0 || sim.c.Hp.cur[e]! <= 0) bad.push(`${id}: alive ${sim.c.Unit.alive[e]} ms ${sim.c.Stats.ms[e]} hp ${sim.c.Hp.cur[e]}`);
    }
    expect(bad).toEqual([]);
  });
});
