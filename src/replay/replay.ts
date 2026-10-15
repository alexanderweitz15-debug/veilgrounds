// Replays = config (incl. seed) + inputs per tick. Re-simulating reproduces the game bit for bit.
import { createSim, step, stateHash, type Sim } from '../sim/sim';
import type { SimConfig, TickInput } from '../sim/types';

export interface Replay {
  version: 1;
  config: SimConfig;
  /** Sparse: tick -> inputs applied on that tick. */
  inputs: Record<number, TickInput[]>;
  ticks: number;
  /** State hash at the end, to verify reproduction. */
  hash: string;
}

export class Recorder {
  readonly inputs: Record<number, TickInput[]> = {};
  constructor(readonly config: SimConfig) {}
  record(tick: number, inputs: TickInput[]): void {
    if (inputs.length) this.inputs[tick] = inputs.map((i) => structuredClone(i));
  }
  finish(sim: Sim): Replay {
    return { version: 1, config: this.config, inputs: this.inputs, ticks: sim.tick, hash: stateHash(sim) };
  }
}

/** Re-run a replay headless. Optional callback per tick (for analysis or the replay viewer). */
export function playReplay(r: Replay, onTick?: (sim: Sim) => void, untilTick = r.ticks): Sim {
  const sim = createSim(structuredClone(r.config));
  while (sim.tick < untilTick) {
    step(sim, r.inputs[sim.tick] ?? []);
    onTick?.(sim);
  }
  return sim;
}
