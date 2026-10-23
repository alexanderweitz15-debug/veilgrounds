// Replay engine (headless, no worker or DOM): re-simulates a Replay deterministically from its recorded inputs,
// with random access. Seeking = nearest checkpoint (a compact deep copy of the sim, src/replay/cloneSim.ts, one every
// CHECKPOINT_EVERY ticks) + re-simulation of the gap, so a seek costs at most CHECKPOINT_EVERY ticks (~0.6 ms each)
// once the index is built. The index is built in slices by advanceIndex() (background in the replay worker) and
// extended for free by every seek that passes a checkpoint tick. The engine only reads the replay; it never feeds
// anything back into a sim, so state hashes at tick t always equal a straight run.
import { createSim, step, stateHash, type Sim } from '../sim/sim';
import { buildSnapshot, type Snapshot } from '../sim/snapshot';
import { freezeSim, thawSim, type FrozenSim } from './cloneSim';
import type { Replay } from './replay';

/** Ticks between checkpoints (20 s of game time). */
export const CHECKPOINT_EVERY = 600;

export class ReplayEngine {
  /** The sim the viewer looks at (advanced by stepOnce / seek). */
  sim: Sim;
  readonly checkpoints = new Map<number, FrozenSim>();
  /** Background index pass: its own sim, always at a checkpoint tick boundary or between. */
  private idx: Sim;

  constructor(readonly replay: Replay, readonly every = CHECKPOINT_EVERY) {
    this.sim = createSim(structuredClone(replay.config));
    this.checkpoints.set(0, freezeSim(this.sim));
    this.idx = thawSim(this.checkpoints.get(0)!);
  }

  get tick(): number {
    return this.sim.tick;
  }

  get ticks(): number {
    return this.replay.ticks;
  }

  /** Highest tick covered by the checkpoint index (contiguous from 0 is not required: seeks add checkpoints too). */
  get indexedUntil(): number {
    let m = 0;
    for (const t of this.checkpoints.keys()) m = Math.max(m, t);
    return m;
  }

  /** True when the background pass reached the end. */
  get indexed(): boolean {
    return this.idx.tick >= this.replay.ticks;
  }

  /** Progress of the background index pass, 0..1. */
  get indexProgress(): number {
    return this.replay.ticks <= 0 ? 1 : Math.min(1, this.idx.tick / this.replay.ticks);
  }

  private nearest(target: number): number {
    let best = 0;
    for (const t of this.checkpoints.keys()) if (t <= target && t > best) best = t;
    return best;
  }

  private stepSim(sim: Sim): void {
    step(sim, this.replay.inputs[sim.tick] ?? []);
  }

  /** One tick forward (no-op at the end). Returns false at the end. */
  stepOnce(): boolean {
    if (this.sim.tick >= this.replay.ticks) return false;
    this.stepSim(this.sim);
    if (this.sim.tick % this.every === 0 && !this.checkpoints.has(this.sim.tick)) this.checkpoints.set(this.sim.tick, freezeSim(this.sim));
    return true;
  }

  /**
   * Jump to `target` (clamped to the replay). Starts from the nearest checkpoint, or from the current sim when that
   * is closer and not past the target. Returns the number of ticks re-simulated.
   */
  seek(target: number): number {
    const to = Math.max(0, Math.min(this.replay.ticks, Math.round(target)));
    const cp = this.nearest(to);
    let steps = 0;
    if (this.sim.tick > to || to - this.sim.tick > to - cp) {
      this.sim = thawSim(this.checkpoints.get(cp)!);
    }
    while (this.sim.tick < to) {
      this.stepOnce();
      steps++;
    }
    return steps;
  }

  /**
   * Build the index in the background: simulate at most `maxTicks` more ticks of the index pass, storing checkpoints.
   * Skips ahead to an existing checkpoint when a seek already created one further on. Returns true when done.
   */
  advanceIndex(maxTicks: number): boolean {
    let left = maxTicks;
    const far = this.indexedUntil;
    if (far - this.idx.tick >= this.every * 2) this.idx = thawSim(this.checkpoints.get(far)!);
    while (left-- > 0 && this.idx.tick < this.replay.ticks) {
      this.stepSim(this.idx);
      if (this.idx.tick % this.every === 0 && !this.checkpoints.has(this.idx.tick)) this.checkpoints.set(this.idx.tick, freezeSim(this.idx));
    }
    return this.indexed;
  }

  /** Fog-filtered snapshot of the current tick for the viewer of `slot` (reads the sim, never changes it). */
  snapshot(slot: number): Snapshot {
    const p = this.sim.config.players.find((q) => q.slot === slot);
    return buildSnapshot(this.sim, p?.team ?? 0, slot);
  }

  /** Slot -> champion eid of the current sim (viewer camera). */
  get slots(): number[] {
    return this.sim.slots;
  }

  hash(): string {
    return stateHash(this.sim);
  }
}
