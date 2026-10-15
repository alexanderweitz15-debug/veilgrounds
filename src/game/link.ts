// Transport between client and simulation. The real game runs the sim in a worker; the mock link produces
// synthetic snapshots on the main thread for render/UI testing while the simulation is still being built.
import type { FromWorker, ToWorker } from '../sim/protocol';
import type { Snapshot } from '../sim/snapshot';
import type { Command, SimConfig } from '../sim/types';
import type { BotDebugRow } from '../ai/log';

export interface SimLink {
  send(cmd: Command): void;
  pause(paused: boolean): void;
  /** Called for EVERY snapshot (several may arrive per frame; events must not be dropped). */
  onSnap: ((s: Snapshot) => void) | null;
  dispose(): void;
  /** F9 bot overlay (worker link only): ask for the latest bot decision rows, answered via onBotDebug. */
  requestBotDebug?(): void;
  onBotDebug?: ((rows: BotDebugRow[], tick: number) => void) | null;
}

export function workerLink(config: SimConfig, slot: number): SimLink {
  const worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
  const post = (m: ToWorker): void => worker.postMessage(m);
  const link: SimLink = {
    onSnap: null,
    send: (cmd) => post({ type: 'cmd', cmd }),
    pause: (paused) => post({ type: 'pause', paused }),
    dispose: () => worker.terminate(),
    requestBotDebug: () => post({ type: 'getBotDebug' }),
    onBotDebug: null,
  };
  worker.onmessage = (ev: MessageEvent<FromWorker>) => {
    if (ev.data.type === 'snap') link.onSnap?.(ev.data.snap);
    else if (ev.data.type === 'botDebug') link.onBotDebug?.(ev.data.rows, ev.data.tick);
  };
  worker.onerror = (ev) => console.error('sim worker error', ev.message);
  post({ type: 'start', config, slot });
  return link;
}
