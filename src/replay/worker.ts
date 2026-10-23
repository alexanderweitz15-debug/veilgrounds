// Replay worker: re-simulates a Replay from its recorded inputs (no bots, no input), posts fog-filtered snapshots of the
// viewed player at the replay speed, seeks via checkpoints and builds the checkpoint index in the background.
import { ReplayEngine } from './engine';
import type { FromReplay, ToReplay } from './protocol';

let eng: ReplayEngine | null = null;
let slot = 0;
let playing = false;
let speed = 1;
let acc = 0;
let last = performance.now();
let pendingSeek = -1;
let pendingView = -1;
let lastIndexPost = 0;
const TICK_MS = 1000 / 30;
/** Wall ms per timer turn spent on the index pass (messages wait at most this long). */
const INDEX_SLICE_MS = 15;

const post = (m: FromReplay): void => postMessage(m);
const postSnap = (reset: boolean): void => post({ t: 'snap', snap: eng!.snapshot(slot), ...(reset ? { reset: true } : {}) });

onmessage = (ev: MessageEvent<ToReplay>) => {
  const m = ev.data;
  switch (m.t) {
    case 'load':
      eng = new ReplayEngine(m.replay);
      slot = m.slot;
      pendingSeek = m.start;
      acc = 0;
      last = performance.now();
      break;
    case 'play':
      playing = m.playing;
      last = performance.now();
      break;
    case 'speed':
      speed = m.speed;
      break;
    case 'seek':
      pendingSeek = m.tick; // later seeks replace earlier ones (dragging the playhead)
      break;
    case 'view':
      pendingView = m.slot;
      break;
  }
};

setInterval(() => {
  if (!eng) return;
  const now = performance.now();
  const dt = Math.min(250, now - last);
  last = now;
  if (pendingView >= 0) {
    slot = pendingView;
    pendingView = -1;
    postSnap(true);
  }
  if (pendingSeek >= 0) {
    const t0 = performance.now();
    const steps = eng.seek(pendingSeek);
    pendingSeek = -1;
    acc = 0;
    postSnap(true);
    post({ t: 'seeked', tick: eng.tick, ms: Math.round(performance.now() - t0), steps });
  } else if (playing) {
    acc += dt * speed;
    // fast-forward: every stride-th tick is posted (events of skipped ticks are not shown)
    const stride = Math.max(1, Math.round(speed / 2));
    while (acc >= TICK_MS && eng.tick < eng.ticks) {
      acc -= TICK_MS;
      eng.stepOnce();
      if (eng.tick % stride === 0 || eng.tick >= eng.ticks) postSnap(false);
    }
    if (eng.tick >= eng.ticks) {
      playing = false;
      post({ t: 'end' });
    }
  }
  if (!eng.indexed) {
    const t1 = performance.now();
    while (!eng.indexed && performance.now() - t1 < INDEX_SLICE_MS) eng.advanceIndex(30);
    if (eng.indexed || now - lastIndexPost > 250) {
      lastIndexPost = now;
      post({ t: 'index', progress: eng.indexProgress, checkpoints: eng.checkpoints.size });
    }
  }
}, 4);
