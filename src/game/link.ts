// Transport between client and simulation. The real game runs the sim in a worker; the mock link produces
// synthetic snapshots on the main thread for render/UI testing while the simulation is still being built.
import type { FromWorker, ToWorker } from '../sim/protocol';
import type { Snapshot } from '../sim/snapshot';
import type { Command, SimConfig } from '../sim/types';

export interface SimLink {
  send(cmd: Command): void;
  pause(paused: boolean): void;
  /** Called for EVERY snapshot (several may arrive per frame; events must not be dropped). */
  onSnap: ((s: Snapshot) => void) | null;
  dispose(): void;
}

export function workerLink(config: SimConfig, slot: number): SimLink {
  const worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
  const post = (m: ToWorker): void => worker.postMessage(m);
  const link: SimLink = {
    onSnap: null,
    send: (cmd) => post({ type: 'cmd', cmd }),
    pause: (paused) => post({ type: 'pause', paused }),
    dispose: () => worker.terminate(),
  };
  worker.onmessage = (ev: MessageEvent<FromWorker>) => {
    if (ev.data.type === 'snap') link.onSnap?.(ev.data.snap);
  };
  worker.onerror = (ev) => console.error('sim worker error', ev.message);
  post({ type: 'start', config, slot });
  return link;
}
