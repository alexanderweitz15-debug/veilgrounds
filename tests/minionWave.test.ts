// structuresHelpers first: it imports sim.ts before any system module (systems <-> sim import cycle).
import { newSim, stepA } from './structuresHelpers';
import { describe, expect, it } from 'vitest';
import { Kind, Lane } from '../src/sim/types';
import { minionSpeed, spawnMinion } from '../src/sim/systems/minions';
import { spawnWave, nextWaveInfo } from '../src/sim/systems/waves';
import { MINION_MS } from '../src/sim/systems/minions';

const lane = (sim: ReturnType<typeof newSim>, m: number, ticks: number): number => {
  const x0 = sim.c.Pos.x[m]!;
  const y0 = sim.c.Pos.y[m]!;
  for (let i = 0; i < ticks; i++) stepA(sim);
  return Math.hypot(sim.c.Pos.x[m]! - x0, sim.c.Pos.y[m]! - y0);
};

describe('minion wave mechanics', () => {
  it('a straggler far behind its wave front catches up faster, a minion in formation does not', () => {
    const sim = newSim(false);
    const front = spawnMinion(sim, Kind.MinionMelee, 0, Lane.Mid, 8000, 8000);
    const slow = spawnMinion(sim, Kind.MinionMelee, 0, Lane.Mid, 5000, 5000);
    const formed = spawnMinion(sim, Kind.MinionMelee, 0, Lane.Mid, 7800, 7800);
    stepA(sim); // first tick sets the lane path
    stepA(sim);
    expect(minionSpeed(sim)[slow]).toBeGreaterThan(1.2);
    expect(minionSpeed(sim)[formed]).toBe(1);
    expect(minionSpeed(sim)[front]).toBe(1);
    const dSlow = lane(sim, slow, 30);
    expect(dSlow).toBeGreaterThan(MINION_MS * 1.1); // 1 s walked; a bent lane / separation eats some of the +25 %
    expect(dSlow).toBeLessThan(MINION_MS * 1.3);
  });

  it('a spawned wave spreads out instead of stacking on one point', () => {
    const sim = newSim(false);
    const ids = spawnWave(sim, 0, Lane.Mid, true, false);
    for (let i = 0; i < 90; i++) stepA(sim);
    let min = Infinity;
    for (const a of ids) for (const b of ids) if (a < b) min = Math.min(min, Math.hypot(sim.c.Pos.x[a]! - sim.c.Pos.x[b]!, sim.c.Pos.y[a]! - sim.c.Pos.y[b]!));
    expect(min).toBeGreaterThan(60);
  });

  it('cannon wave cadence: 3rd wave, then every 2nd from 15:00, every wave from 25:00', () => {
    const sim = newSim(true);
    const seen = [nextWaveInfo(sim).siege];
    while (seen.length < 3) {
      const before = nextWaveInfo(sim).index;
      stepA(sim);
      if (nextWaveInfo(sim).index !== before) seen.push(nextWaveInfo(sim).siege);
    }
    expect(seen).toEqual([false, false, true]);
  });
});
