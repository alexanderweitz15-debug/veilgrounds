// Placeholder ambience (procedural, no files): a low wind bed with a slow swell. Runs on the Ambient bus, so it
// follows its own volume slider and never counts against the voice caps. Five nodes, created once per match.
import type { AudioManager } from './manager';

/** Starts the loop; returns a function that fades it out and releases its nodes. Null when the context is not running. */
export function startAmbient(mgr: AudioManager): (() => void) | null {
  const ctx = mgr.ctx;
  const bus = mgr.bus('ambient');
  if (!ctx || !bus || ctx.state !== 'running') return null;
  // 3 s of brown-ish noise (leaky integrator); the loop seam is cross-faded so it does not click
  const len = Math.floor(ctx.sampleRate * 3);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    d[i] = last * 6;
  }
  const fade = Math.floor(ctx.sampleRate * 0.1);
  for (let i = 0; i < fade; i++) {
    const w = i / fade;
    d[len - fade + i] = d[len - fade + i]! * (1 - w) + d[i]! * w;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.loopEnd = (len - fade) / ctx.sampleRate;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 420;
  const level = ctx.createGain();
  level.gain.value = 0.05;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const depth = ctx.createGain();
  depth.gain.value = 0.025;
  lfo.connect(depth);
  depth.connect(level.gain);
  src.connect(lp);
  lp.connect(level);
  level.connect(bus);
  src.start();
  lfo.start();
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    const t = ctx.currentTime;
    level.gain.cancelScheduledValues(t);
    level.gain.setTargetAtTime(0, t, 0.15);
    src.stop(t + 1);
    lfo.stop(t + 1);
    src.onended = () => {
      src.disconnect();
      lp.disconnect();
      level.disconnect();
      lfo.disconnect();
      depth.disconnect();
    };
  };
}
