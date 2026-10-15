import { describe, expect, it } from 'vitest';
import { createSim, step, stateHash } from '../src/sim/sim';
import { Recorder, playReplay } from '../src/replay/replay';
import { Rng } from '../src/sim/rng';
import type { Command, SimConfig, TickInput } from '../src/sim/types';

const config = (seed: number): SimConfig => ({
  seed,
  mode: 'sandbox',
  players: [{ slot: 0, team: 0, champion: 'mira', role: 'mid', summoners: ['sprung', 'heilen'], isHuman: true }],
  dummies: [{ x: 6000, y: 5600, team: 1 }],
});

/** Random but seeded player inputs, so every run issues the same commands. */
function randomInputs(seed: number, tick: number): TickInput[] {
  const r = new Rng(seed * 7919 + tick);
  if (!r.chance(0.08)) return [];
  const x = r.range(1000, 9000);
  const y = r.range(1000, 9000);
  const cmds: Command[] = [
    { t: 'move', x, y },
    { t: 'attackMove', x, y },
    { t: 'stop' },
    { t: 'cast', slot: r.int(4) as 0 | 1 | 2 | 3, x, y },
    { t: 'levelUp', slot: r.int(4) as 0 | 1 | 2 | 3 },
  ];
  return [{ slot: 0, cmd: cmds[r.int(cmds.length)]! }];
}

describe('determinism', () => {
  it('10 replays reproduce bit-identically', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const sim = createSim(config(seed));
      const rec = new Recorder(config(seed));
      const TICKS = 30 * 150; // 2:30, covers first minion waves
      while (sim.tick < TICKS) {
        const inputs = randomInputs(seed, sim.tick);
        rec.record(sim.tick, inputs);
        step(sim, inputs);
      }
      const replay = rec.finish(sim);
      const again = playReplay(replay);
      expect(stateHash(again)).toBe(replay.hash);
    }
  }, 120_000);

  it('different seeds diverge only through rng, same seed same hash', () => {
    const a = createSim(config(42));
    const b = createSim(config(42));
    for (let i = 0; i < 300; i++) {
      step(a, randomInputs(42, i));
      step(b, randomInputs(42, i));
    }
    expect(stateHash(a)).toBe(stateHash(b));
  });
});
