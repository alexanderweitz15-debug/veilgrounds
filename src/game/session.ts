// Per-match extras (Phase 5), kept out of game.ts: post-game stats recorder, trainer panel + result dialog,
// sandbox+ cheat panel. game.ts only forwards snapshots/frames and hands the result to the exit callback.
import type { Snapshot } from '../sim/snapshot';
import type { Command, SimConfig } from '../sim/types';
import { MatchStats, type MatchSummary } from './matchStats';
import { TrainerPanel } from '../ui/trainerHud';
import { SandboxPanel } from '../ui/sandboxPanel';

export interface SessionResult {
  summary: MatchSummary;
  /** Player asked for the same setup again (trainer result dialog). */
  retry?: boolean;
  /** Player asked for the post-game analysis. */
  analysis?: boolean;
}

export type ExitOpts = Omit<SessionResult, 'summary'>;

const TRAINER_MODES = new Set(['lastHit', 'dodge', 'kite', 'laneDuel', 'jungleDuel', 'arena']);
export const isTrainerMode = (mode: string | undefined): boolean => !!mode && TRAINER_MODES.has(mode);

export class SessionExtras {
  readonly stats: MatchStats;
  private readonly trainer: TrainerPanel | null = null;
  private readonly sandbox: SandboxPanel | null = null;
  private finished = false;

  constructor(
    root: HTMLElement,
    config: SimConfig | null,
    send: (cmd: Command) => void,
    private readonly pause: (p: boolean) => void,
    exit: (o: ExitOpts) => void,
    /** Arms a cursor-targeted sandbox cheat (teleport / practice dummy at the cursor). */
    arm?: (a: 'teleport' | 'spawnDummy') => void,
  ) {
    this.stats = new MatchStats(config);
    if (config && isTrainerMode(config.mode)) {
      this.trainer = new TrainerPanel(root, config.mode, {
        retry: () => exit({ retry: true }),
        analysis: () => exit({ analysis: true }),
        quit: () => exit({}),
      });
    }
    if (config?.mode === 'sandbox') this.sandbox = new SandboxPanel(root, (op, value) => send({ t: 'cheat', op, ...(value !== undefined ? { value } : {}) }), arm);
  }

  ingest(s: Snapshot): void {
    this.stats.ingest(s);
  }

  /** Trainer run finished: the sim stays paused behind the result dialog (F10 must not resume it). */
  get over(): boolean {
    return this.finished;
  }

  frame(snap: Snapshot | null): void {
    this.sandbox?.update(snap?.me);
    if (this.trainer?.update(snap?.trainer) && !this.finished) {
      this.finished = true;
      this.pause(true); // the run is over: freeze the sim behind the result dialog
    }
  }

  result(o: ExitOpts = {}): SessionResult {
    return { summary: this.stats.summary(), ...o };
  }

  dispose(): void {
    this.trainer?.dispose();
    this.sandbox?.dispose();
  }
}
