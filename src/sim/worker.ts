// Sim worker: fixed 30 Hz accumulator, frame clamp 250 ms, posts one fog-filtered snapshot per tick.
// ponytail: postMessage structured clone (no SharedArrayBuffer). SAB needs COOP/COEP headers that static
// hosts like GitHub Pages do not send; switch only if profiling shows clone cost matters.
import { createSim, step, type Sim } from './sim';
import { buildSnapshot } from './snapshot';
import { Recorder } from '../replay/replay';
import type { FromWorker, ToWorker } from './protocol';
import type { TickInput } from './types';

let sim: Sim | null = null;
let rec: Recorder | null = null;
let slot = 0;
let queued: TickInput[] = [];
let paused = false;
let speed = 1;
let acc = 0;
let last = performance.now();
const TICK_MS = 1000 / 30;

const post = (m: FromWorker): void => postMessage(m);

onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  switch (m.type) {
    case 'start':
      sim = createSim(m.config);
      rec = new Recorder(m.config);
      slot = m.slot;
      queued = [];
      acc = 0;
      last = performance.now();
      break;
    case 'cmd':
      queued.push({ slot, cmd: m.cmd });
      break;
    case 'pause':
      paused = m.paused;
      break;
    case 'speed':
      speed = m.speed;
      break;
    case 'getReplay':
      if (sim && rec) post({ type: 'replay', replay: rec.finish(sim) });
      break;
  }
};

setInterval(() => {
  const now = performance.now();
  acc += Math.min(250, now - last) * speed;
  last = now;
  if (!sim || paused) {
    acc = 0;
    return;
  }
  while (acc >= TICK_MS) {
    acc -= TICK_MS;
    const inputs = queued;
    queued = [];
    rec!.record(sim.tick, inputs);
    step(sim, inputs);
    post({ type: 'snap', snap: buildSnapshot(sim, sim.config.players.find((p) => p.slot === slot)?.team ?? 0, slot) });
  }
}, 4);
