// Harness for the utility-model tests (docs/BRAIN-REWORK.md §10 tests 7 and 8): a headless bot game with the
// utility flag set in the game config (SimConfig.botUtility; no environment variable, so other test files are not
// affected).
// The harness reads the Sim for measurements only; the brains stay fog-restricted.

import { createSim, step, type Sim } from '../src/sim/sim';
import type { SimConfig, TickInput } from '../src/sim/types';
import { BotRunner } from '../src/ai/runner';

export interface UtilityGame {
  sim: Sim;
  bots: BotRunner;
}

export function runUtilityGame(config: SimConfig, ticks: number, onTick?: (sim: Sim, inputs: TickInput[], bots: BotRunner) => void): UtilityGame {
  // the flag must be in the config: the runner reads utilityOn(ctx) while constructing the bots (attention model,
  // A3 wiring) and utilityOn caches its answer per bot
  const cfg: SimConfig = { ...config, botUtility: true };
  const sim = createSim(cfg);
  const bots = new BotRunner(cfg);
  while (sim.tick < ticks && sim.state.winner === undefined) {
    const inputs = bots.tick(sim);
    step(sim, inputs);
    onTick?.(sim, inputs, bots);
  }
  return { sim, bots };
}
