// SimLink for the replay viewer: the same Game / renderer / HUD runs on snapshots from the replay worker instead of a
// live sim. Commands are ignored (read-only). Also owns the virtual clock (wall clock x speed) the client uses.
import type { SimLink } from '../game/link';
import type { Snapshot } from '../sim/snapshot';
import type { FromReplay, ToReplay } from './protocol';
import type { Replay } from './replay';

export interface ReplayLink extends SimLink {
  readonly replay: Replay;
  speed: number;
  paused: boolean;
  /** Slot whose eyes the viewer looks through. */
  slot: number;
  /** Virtual game clock: advances with wall time x speed, frozen while paused. Idempotent for equal inputs. */
  clock(realNow: number): number;
  seek(tick: number): void;
  setSpeed(speed: number): void;
  view(slot: number): void;
  /** A snapshot that is not the successor of the last (seek / view change) is about to be delivered. */
  onReset: ((tick: number) => void) | null;
  onIndex: ((progress: number, checkpoints: number) => void) | null;
  /** Last seek: tick, wall ms, re-simulated ticks (timing report). */
  onSeeked: ((tick: number, ms: number, steps: number) => void) | null;
  onEnd: (() => void) | null;
}

export function replayLink(replay: Replay, slot: number, start = 0): ReplayLink {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const post = (m: ToReplay): void => worker.postMessage(m);
  let vnow = 0;
  let lastReal = -1;
  const link: ReplayLink = {
    replay,
    speed: 1,
    paused: true,
    slot,
    onSnap: null,
    onReset: null,
    onIndex: null,
    onSeeked: null,
    onEnd: null,
    onError: null,
    send: () => undefined, // read-only
    pause: (p) => {
      link.paused = p;
      post({ t: 'play', playing: !p });
    },
    clock: (real) => {
      if (lastReal >= 0 && !link.paused) vnow += (real - lastReal) * link.speed;
      lastReal = real;
      return vnow;
    },
    seek: (tick) => post({ t: 'seek', tick }),
    setSpeed: (s) => {
      link.speed = s;
      post({ t: 'speed', speed: s });
    },
    view: (s) => {
      link.slot = s;
      post({ t: 'view', slot: s });
    },
    dispose: () => worker.terminate(),
  };
  worker.onmessage = (ev: MessageEvent<FromReplay>) => {
    const m = ev.data;
    if (m.t === 'snap') {
      if (m.reset) link.onReset?.(m.snap.tick);
      link.onSnap?.(m.snap as Snapshot);
    } else if (m.t === 'index') link.onIndex?.(m.progress, m.checkpoints);
    else if (m.t === 'seeked') link.onSeeked?.(m.tick, m.ms, m.steps);
    else if (m.t === 'end') link.onEnd?.();
  };
  worker.onerror = (ev) => link.onError?.(ev.message || 'replay worker error');
  post({ t: 'load', replay, slot, start });
  return link;
}
