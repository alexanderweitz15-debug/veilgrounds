// Main thread <-> replay worker messages (src/replay/worker.ts, src/replay/replayLink.ts).
import type { Snapshot } from '../sim/snapshot';
import type { Replay } from './replay';

export type ToReplay =
  | { t: 'load'; replay: Replay; slot: number; start: number }
  | { t: 'play'; playing: boolean }
  | { t: 'speed'; speed: number }
  | { t: 'seek'; tick: number }
  /** Look through another player's eyes (their team's fog, their HUD). */
  | { t: 'view'; slot: number };

export type FromReplay =
  /** reset: not a successor of the previous snapshot (seek / view change): the client forgets its derived state first. */
  | { t: 'snap'; snap: Snapshot; reset?: boolean }
  /** Background checkpoint pass: 0..1 and number of checkpoints so far. */
  | { t: 'index'; progress: number; checkpoints: number }
  /** A seek finished: target tick, wall ms it took, ticks re-simulated. */
  | { t: 'seeked'; tick: number; ms: number; steps: number }
  | { t: 'end' };
