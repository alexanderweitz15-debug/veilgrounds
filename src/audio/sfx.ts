// Procedural sound (Web Audio, no assets). Every ability gets a distinct cue derived from its id, played at cast
// start, i.e. during the wind-up and 100-450 ms before the projectile/effect (the audio cue predictive dodges use).
// Positional: volume and stereo pan from the distance to the camera centre.

export type Cue =
  | 'lastHit'
  | 'auto'
  | 'autoHeavy'
  | 'minionAuto'
  | 'tower'
  | 'hit'
  | 'death'
  | 'champDeath'
  | 'levelUp'
  | 'gold'
  | 'wave'
  | 'recall'
  | 'ping'
  | 'pingDanger'
  | 'pingBack'
  | 'pingGo'
  | 'pingAsk'
  | 'pingHelp'
  | 'pingObjective'
  | 'pingOk'
  | 'plate'
  | 'ui'
  /** Shop (G/B8): purchase clink / sale */
  | 'buy'
  | 'sell';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.6;

/** Lazily create the context (browsers require a user gesture first; call from any input handler). */
export function audioUnlock(): void {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = volume;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

export function setVolume(v: number): void {
  volume = v;
  if (master) master.gain.value = v;
}

/** Listener position in map units (camera centre) and the hearing radius. */
const listener = { x: 0, y: 0, r: 2600 };
export function setListener(x: number, y: number): void {
  listener.x = x;
  listener.y = y;
}

interface Voice {
  out: AudioNode;
  t: number;
}

function voice(x?: number, y?: number, gain = 1): Voice | null {
  if (!ctx || !master || ctx.state !== 'running') return null;
  let g = gain;
  let pan = 0;
  if (x !== undefined && y !== undefined) {
    const dx = x - listener.x;
    const dy = y - listener.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > listener.r) return null;
    g *= 1 - d / listener.r;
    pan = Math.max(-1, Math.min(1, dx / 1400));
  }
  const vol = ctx.createGain();
  vol.gain.value = g;
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  vol.connect(p).connect(master);
  return { out: vol, t: ctx.currentTime };
}

function env(v: Voice, peak: number, attack: number, decay: number): GainNode {
  const g = ctx!.createGain();
  g.gain.setValueAtTime(0.0001, v.t);
  g.gain.exponentialRampToValueAtTime(peak, v.t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, v.t + attack + decay);
  g.connect(v.out);
  return g;
}

function tone(v: Voice, type: OscillatorType, f0: number, f1: number, dur: number, peak = 0.3, attack = 0.005): void {
  const o = ctx!.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, v.t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), v.t + dur);
  o.connect(env(v, peak, attack, dur));
  o.start(v.t);
  o.stop(v.t + attack + dur + 0.02);
}

let noiseBuf: AudioBuffer | null = null;
function noise(v: Voice, dur: number, freq: number, q: number, peak = 0.3, type: BiquadFilterType = 'bandpass'): void {
  if (!noiseBuf) {
    noiseBuf = ctx!.createBuffer(1, ctx!.sampleRate, ctx!.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = ctx!.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx!.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  s.connect(f).connect(env(v, peak, 0.004, dur));
  s.start(v.t);
  s.stop(v.t + dur + 0.05);
}

export function play(cue: Cue, x?: number, y?: number): void {
  const v = voice(x, y, cue === 'ui' || cue === 'levelUp' || cue === 'gold' || cue === 'lastHit' ? 1 : 0.8);
  if (!v) return;
  switch (cue) {
    case 'lastHit': // the satisfying click (spec §11)
      noise(v, 0.04, 3200, 2, 0.5);
      tone(v, 'square', 1800, 900, 0.05, 0.12);
      tone(v, 'sine', 1320, 1320, 0.12, 0.12, 0.01);
      break;
    case 'gold':
      tone(v, 'triangle', 1568, 1568, 0.12, 0.12);
      tone(v, 'triangle', 2093, 2093, 0.18, 0.08, 0.04);
      break;
    case 'buy': // coin clink + short confirm chime
      noise(v, 0.03, 5200, 2, 0.35);
      tone(v, 'sine', 2349, 2349, 0.1, 0.1, 0.01);
      tone(v, 'sine', 3136, 3136, 0.16, 0.07, 0.06);
      break;
    case 'sell': // coins dropped, falling
      noise(v, 0.05, 2600, 2, 0.3);
      tone(v, 'triangle', 1760, 1175, 0.14, 0.09, 0.02);
      break;
    case 'auto':
      noise(v, 0.06, 1800, 3, 0.18);
      tone(v, 'triangle', 420, 180, 0.08, 0.12);
      break;
    case 'autoHeavy':
      noise(v, 0.09, 900, 2, 0.25);
      tone(v, 'sawtooth', 160, 70, 0.12, 0.12);
      break;
    case 'minionAuto': // soft clack: a wave fight is many of these at once
      noise(v, 0.035, 1400, 2.5, 0.06);
      break;
    case 'tower':
      tone(v, 'sawtooth', 220, 55, 0.35, 0.28);
      noise(v, 0.25, 600, 1, 0.25, 'lowpass');
      break;
    case 'hit':
      noise(v, 0.05, 2500, 1.5, 0.15);
      break;
    case 'death':
      tone(v, 'triangle', 300, 90, 0.25, 0.12);
      break;
    case 'champDeath':
      tone(v, 'sawtooth', 330, 60, 0.9, 0.22, 0.02);
      tone(v, 'sine', 165, 40, 1.2, 0.2, 0.02);
      break;
    case 'levelUp':
      [523, 659, 784, 1047].forEach((f, i) => {
        const vv = { out: v.out, t: v.t + i * 0.07 };
        tone(vv, 'triangle', f, f, 0.22, 0.14);
      });
      break;
    case 'wave': // distant horn, globally audible
      tone(v, 'sawtooth', 147, 147, 0.9, 0.12, 0.15);
      tone(v, 'sawtooth', 220, 220, 0.9, 0.08, 0.2);
      break;
    case 'recall':
      tone(v, 'sine', 392, 784, 1.2, 0.12, 0.3);
      break;
    case 'ping':
      tone(v, 'sine', 1046, 1046, 0.15, 0.2);
      tone({ out: v.out, t: v.t + 0.12 }, 'sine', 1318, 1318, 0.2, 0.18);
      break;
    // distinct ping voices (kind -> cue: pingCue below): danger = two harsh falling saws, back =
    // falling triangle pair, go = rising triplet, ask = rising question glide, help = urgent triple beep,
    // objective = bell fifth, ok = soft low-high
    case 'pingDanger':
      tone(v, 'sawtooth', 880, 620, 0.12, 0.16);
      tone({ out: v.out, t: v.t + 0.1 }, 'sawtooth', 880, 620, 0.16, 0.16);
      break;
    case 'pingBack':
      tone(v, 'triangle', 700, 520, 0.14, 0.2);
      tone({ out: v.out, t: v.t + 0.13 }, 'triangle', 520, 350, 0.2, 0.2);
      break;
    case 'pingGo':
      for (let i = 0; i < 3; i++) tone({ out: v.out, t: v.t + i * 0.07 }, 'square', 660 + i * 165, 660 + i * 165, 0.08, 0.1);
      break;
    case 'pingAsk':
      tone(v, 'sine', 600, 900, 0.2, 0.18);
      break;
    case 'pingHelp':
      for (let i = 0; i < 3; i++) tone({ out: v.out, t: v.t + i * 0.09 }, 'square', 990, 990, 0.06, 0.12);
      break;
    case 'pingObjective':
      tone(v, 'sine', 784, 784, 0.4, 0.2);
      tone({ out: v.out, t: v.t + 0.05 }, 'sine', 1176, 1176, 0.45, 0.14);
      break;
    case 'pingOk':
      tone(v, 'sine', 523, 523, 0.1, 0.16);
      tone({ out: v.out, t: v.t + 0.09 }, 'sine', 784, 784, 0.16, 0.16);
      break;
    case 'plate':
      noise(v, 0.3, 400, 0.8, 0.35, 'lowpass');
      tone(v, 'square', 110, 60, 0.3, 0.1);
      break;
    case 'ui':
      tone(v, 'triangle', 880, 660, 0.06, 0.1);
      break;
  }
}

/** FNV hash -> 0..1 values so every ability id gets its own stable timbre. */
function hash01(s: string, salt: number): number {
  let h = 0x811c9dc5 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return ((h >>> 0) % 10000) / 10000;
}

const WAVES: OscillatorType[] = ['sine', 'triangle', 'square', 'sawtooth'];

export type AnnounceTone = 'good' | 'bad' | 'neutral' | 'epic' | 'victory' | 'defeat';

/** Announcer banner cue (no voice): a short brass-like motif; rising for good news, falling for bad news. */
export function playAnnounce(kind: AnnounceTone): void {
  const v = voice(undefined, undefined, 0.9);
  if (!v) return;
  const notes: Record<AnnounceTone, number[]> = {
    good: [392, 523, 659],
    bad: [440, 349, 262],
    neutral: [523, 523, 659],
    epic: [196, 294, 392, 587],
    victory: [392, 523, 659, 784, 1047],
    defeat: [392, 330, 262, 196],
  };
  const step = kind === 'victory' || kind === 'defeat' ? 0.16 : 0.11;
  const sag = kind === 'bad' || kind === 'defeat' ? 0.98 : 1;
  notes[kind].forEach((f, i) => {
    const vv = { out: v.out, t: v.t + i * step };
    tone(vv, 'sawtooth', f, f * sag, 0.28, 0.07, 0.02);
    tone(vv, 'triangle', f * 2, f * 2 * sag, 0.24, 0.05, 0.02);
  });
  if (kind === 'epic' || kind === 'victory') noise(v, 0.5, 300, 0.7, 0.18, 'lowpass');
}

/** Refused action (ping spam lockout): a short falling fizzle. */
export function playFizzle(x?: number, y?: number): void {
  const v = voice(x, y, 0.7);
  if (!v) return;
  tone(v, 'triangle', 520, 140, 0.16, 0.12);
  noise(v, 0.12, 900, 1.5, 0.06, 'lowpass');
}

/** Distinct cast cue per ability id; shape follows the ability type (line = rising whoosh, circle = drop, ...). */
export function playCast(abilityId: string, type: string, x?: number, y?: number, ultimate = false): void {
  const v = voice(x, y, ultimate ? 1 : 0.85);
  if (!v) return;
  const base = 180 + hash01(abilityId, 1) * 520;
  const wave = WAVES[Math.floor(hash01(abilityId, 2) * WAVES.length)]!;
  const len = 0.12 + hash01(abilityId, 3) * 0.18 + (ultimate ? 0.25 : 0);
  switch (type) {
    case 'skillshot_line':
      tone(v, wave, base, base * 2.4, len, 0.16);
      noise(v, len, base * 4, 4, 0.1);
      break;
    case 'skillshot_circle':
    case 'zone':
      tone(v, wave, base * 2, base * 0.6, len + 0.1, 0.16);
      break;
    case 'cone':
      noise(v, len, base * 3, 1.2, 0.22);
      tone(v, wave, base * 1.5, base, len, 0.1);
      break;
    case 'dash':
    case 'blink':
      noise(v, len, 1500 + base * 2, 0.7, 0.2, 'highpass');
      break;
    case 'targeted':
      tone(v, wave, base * 1.5, base * 1.5, len * 0.6, 0.16);
      tone({ out: v.out, t: v.t + 0.05 }, 'sine', base * 3, base * 2, len, 0.08);
      break;
    default: // self, summon
      tone(v, wave, base, base * 1.5, len, 0.14, 0.03);
  }
  if (ultimate) tone(v, 'sine', base / 2, base / 4, len + 0.4, 0.18, 0.04);
}

/** Sound per ping kind (alert keeps the classic two-tone ping). */
export function pingCue(kind: string): Cue {
  switch (kind) {
    case 'danger':
      return 'pingDanger';
    case 'back':
      return 'pingBack';
    case 'onMyWay':
    case 'group':
      return 'pingGo';
    case 'missing':
    case 'question':
    case 'vision':
      return 'pingAsk';
    case 'help':
      return 'pingHelp';
    case 'objective':
    case 'focus':
      return 'pingObjective';
    case 'ok':
    case 'myBad':
      return 'pingOk';
    default:
      return 'ping';
  }
}
