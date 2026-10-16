// Harness for the utility-model tests (docs/BRAIN-REWORK.md §10 tests 7 and 8): a headless bot game with the
// utility flag set on every bot's static data (no environment variable, so other test files are not affected).
// The harness reads the Sim for measurements only; the brains stay fog-restricted.

import { createSim, step, type Sim } from '../src/sim/sim';
import type { SimConfig, TickInput } from '../src/sim/types';
import { BotRunner } from '../src/ai/runner';

export interface UtilityGame {
  sim: Sim;
  bots: BotRunner;
}

export function runUtilityGame(config: SimConfig, ticks: number, onTick?: (sim: Sim, inputs: TickInput[], bots: BotRunner) => void): UtilityGame {
  const sim = createSim(config);
  const bots = new BotRunner(config);
  for (const b of bots.bots) (b.ctx as { utility?: boolean }).utility = true;
  while (sim.tick < ticks && sim.state.winner === undefined) {
    const inputs = bots.tick(sim);
    step(sim, inputs);
    onTick?.(sim, inputs, bots);
  }
  return { sim, bots };
}
