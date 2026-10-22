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
import { GHOST_MODES, GhostRunner } from '../ai/ghost';

let sim: Sim | null = null;
let rec: Recorder | null = null;
/** Bot slots of the running game (null if there are none). Bot inputs are merged after the human's. */
let bots: BotRunner | null = null;
let slot = 0;
/** Challenger-Geist (src/ai/ghost.ts): shadow brain on the player's own snapshot; never sends commands. */
let ghost: GhostRunner | null = null;
let ghostPosted = -1;
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
      bots = m.config.players.some(isBotSlot) ? new BotRunner(m.config, undefined, { reflex: !!m.config.botReflex }) : null;
      slot = m.slot;
      ghost = GHOST_MODES.has(m.config.mode) && m.config.players.some((p) => p.slot === m.slot && p.isHuman) ? new GhostRunner(m.config, m.slot) : null;
      ghostPosted = -1;
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
    const human = queued;
    const inputs = bots ? [...queued, ...bots.tick(sim)] : queued;
    queued = [];
    rec!.record(sim.tick, inputs);
    step(sim, inputs);
    const snap = buildSnapshot(sim, sim.config.players.find((p) => p.slot === slot)?.team ?? 0, slot);
    post({ type: 'snap', snap });
    // after posting (the client got its clone): the ghost reads the same snapshot, never the sim
    if (ghost) postGhost(ghost, snap, human);
  }
}, 4);

/** Feed the ghost one tick; post its moments when they change (and every 3 s while a farm bucket is open). */
function postGhost(g: GhostRunner, snap: import('./snapshot').Snapshot, human: TickInput[]): void {
  g.observe(snap, human.map((i) => i.cmd));
  const over = snap.events.some((e) => e.e === 'gameOver') || !!snap.trainer?.done;
  if (g.tracker.version !== ghostPosted || over || (g.tracker.openFarm && snap.tick % 90 === 0)) {
    ghostPosted = g.tracker.version;
    post({ type: 'ghost', moments: over ? g.finish(snap.tick) : g.tracker.moments(snap.tick) });
    if (over) ghost = null; // final list sent
  }
}
