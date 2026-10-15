// Sim worker: fixed 30 Hz accumulator, frame clamp 250 ms, posts one fog-filtered snapshot per tick.
// ponytail: postMessage structured clone (no SharedArrayBuffer). SAB needs COOP/COEP headers that static
// hosts like GitHub Pages do not send; switch only if profiling shows clone cost matters.
import { createSim, step, type Sim } from './sim';
import { buildSnapshot } from './snapshot';
import { Recorder } from '../replay/replay';
import type { FromWorker, ToWorker } from './protocol';
import type { TickInput } from './types';
import { BotRunner, isBotSlot } from '../ai/runner';
import { matchOver } from './systems/towers';

let sim: Sim | null = null;
let rec: Recorder | null = null;
/** Bot slots of the running game (null if there are none). Bot inputs are merged after the human's. */
let bots: BotRunner | null = null;
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
      bots = m.config.players.some(isBotSlot) ? new BotRunner(m.config) : null;
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
      if (sim && rec) post({ type: 'replay', replay: rec.finish(sim, bots?.log.toNDJSON()) });
      break;
    case 'getBotDebug':
      post({ type: 'botDebug', tick: sim?.tick ?? 0, rows: bots?.debugRows() ?? [] });
      break;
  }
};

setInterval(() => {
  const now = performance.now();
  acc += Math.min(250, now - last) * speed;
  last = now;
  // a decided match stops ticking (no bots playing on, no commands behind the victory screen)
  if (!sim || paused || matchOver(sim)) {
    acc = 0;
    return;
  }
  while (acc >= TICK_MS && !matchOver(sim)) {
    acc -= TICK_MS;
    // human first, then bots: the merge order is part of the replay
    const inputs = bots ? [...queued, ...bots.tick(sim)] : queued;
    queued = [];
    rec!.record(sim.tick, inputs);
    step(sim, inputs);
    post({ type: 'snap', snap: buildSnapshot(sim, sim.config.players.find((p) => p.slot === slot)?.team ?? 0, slot) });
  }
}, 4);
