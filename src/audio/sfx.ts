// Procedural sound (Web Audio, no assets). Every ability gets a distinct cue derived from its id, played at cast
// start, i.e. during the wind-up and 100-450 ms before the projectile/effect (the audio cue predictive dodges use).
//
// This file holds the sound table and the synthesis; routing (buses, spatial mix, voice limits, node cleanup) is in
// manager.ts, voices.ts and spatial.ts. See docs/AUDIO.md for how to add a sound.
import { AudioManager, type CueDef, type PlayOpts, type Voice, type Volumes } from './manager';
import { Cat } from './voices';
import { Rel } from './spatial';
import { startAmbient } from './ambient';
import { emitTrigger, onTrigger } from './triggers';
import { settings, onSettingsChange } from '../settings';

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
  | 'plate'
  | 'ui'
  | 'footstep'
  | 'killConfirm';

export type { PlayOpts } from './manager';
export { Rel } from './spatial';

/** The one audio manager of the client (tests may `configure` it with a mock context before the first unlock). */
export const audioManager = new AudioManager();

let nextId = 1;
function def(cat: number, bus: CueDef['bus'], priority: number, cooldown: number, opts: { perSource?: boolean; gain?: number; spatial?: boolean } = {}): CueDef {
  return { id: nextId++, cat, bus, priority, cooldown, perSource: opts.perSource ?? false, gain: opts.gain ?? 0.8, spatial: opts.spatial ?? true };
}

/** Sound table: category (voice cap), bus, base priority (0..99), dedupe cooldown in seconds. */
const CUES: Record<Cue, CueDef> = {
  lastHit: def(Cat.Event, 'ui', 45, 0.03, { gain: 1, spatial: false }),
  auto: def(Cat.Auto, 'sfx', 25, 0.05, { perSource: true }),
  autoHeavy: def(Cat.Auto, 'sfx', 25, 0.05, { perSource: true }),
  minionAuto: def(Cat.Minion, 'sfx', 5, 0.05),
  tower: def(Cat.Structure, 'sfx', 20, 0.15, { perSource: true }),
  hit: def(Cat.Auto, 'sfx', 15, 0.04),
  death: def(Cat.Minion, 'sfx', 8, 0.05),
  champDeath: def(Cat.Event, 'sfx', 35, 0.2),
  levelUp: def(Cat.Event, 'ui', 45, 0.3, { gain: 1, spatial: false }),
  gold: def(Cat.Event, 'ui', 35, 0.1, { gain: 1, spatial: false }),
  wave: def(Cat.Event, 'sfx', 30, 1, { spatial: false }),
  recall: def(Cat.Event, 'sfx', 25, 0.5),
  ping: def(Cat.Ui, 'ui', 45, 0.08, { spatial: false }),
  plate: def(Cat.Structure, 'sfx', 20, 0.15),
  ui: def(Cat.Ui, 'ui', 40, 0.03, { gain: 1, spatial: false }),
  footstep: def(Cat.Minion, 'sfx', 3, 0.12, { perSource: true, gain: 0.35 }),
  killConfirm: def(Cat.Event, 'ui', 60, 0.3, { gain: 1, spatial: false }),
};
const CAST = def(Cat.Cast, 'sfx', 30, 0.06, { perSource: true, gain: 0.85 });
const FIZZLE = def(Cat.Cast, 'sfx', 15, 0.1, { perSource: true, gain: 0.7 });
const ANNOUNCE = def(Cat.Ui, 'ui', 50, 0.2, { gain: 0.9, spatial: false });

const LEVEL_NOTES = [523, 659, 784, 1047];

const m = audioManager;
const tone = (v: Voice, type: OscillatorType, f0: number, f1: number, dur: number, peak = 0.3, attack = 0.005, delay = 0): void => m.tone(v, type, f0, f1, dur, peak, attack, delay);
const noise = (v: Voice, dur: number, freq: number, q: number, peak = 0.3, type: BiquadFilterType = 'bandpass', delay = 0): void => m.noise(v, dur, freq, q, peak, type, delay);

// ---- lifecycle -----------------------------------------------------------------------------------------------------

let bound = false;
let ambientStop: (() => void) | null = null;
let ambientWanted = false;

/** Volumes from the settings (master + the four buses). */
export function applyAudioSettings(): void {
  const v: Partial<Volumes> = { master: settings.volume, sfx: settings.volumeSfx, ui: settings.volumeUi, ambient: settings.volumeAmbient, music: settings.volumeMusic };
  m.setVolumes(v);
}

function exposeDebug(): void {
  if (typeof window === 'undefined' || typeof location === 'undefined') return;
  if (import.meta.env.DEV || location.search.includes('bench')) (window as unknown as { __vgAudio?: unknown }).__vgAudio = { stats: () => m.stats(), manager: m, stress: stressCues };
}

/** Debug only (`?bench`): fire `n` random world sounds around the camera, like a big teamfight, to exercise the caps. */
function stressCues(n: number): void {
  const names = Object.keys(CUES) as Cue[];
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * 2400;
    const rel = [Rel.Neutral, Rel.Own, Rel.Ally, Rel.Enemy][i % 4]!;
    const x = m.listener.x + Math.cos(a) * d;
    const y = m.listener.y + Math.sin(a) * d;
    const src = i % 40;
    if (i % 3 === 0) playCast('stress' + (i % 9), 'skillshot_line', x, y, i % 17 === 0, { rel, src });
    else play(names[i % names.length]!, x, y, { rel, src });
  }
}

/** Create / resume the context. Call from any input handler (browsers need a user gesture first); safe to call often. */
export function audioUnlock(): void {
  if (!bound) {
    bound = true;
    onSettingsChange(applyAudioSettings);
    installDefaultTriggers();
    exposeDebug();
  }
  ambientWanted = true;
  m.unlock();
  applyAudioSettings();
  m.whenRunning(() => {
    if (ambientWanted && !ambientStop) ambientStop = startAmbient(m);
  });
}

/** Match ended: stop the ambience (the context stays for the menus). */
export function audioStop(): void {
  ambientWanted = false;
  if (ambientStop) ambientStop();
  ambientStop = null;
}

/** Master volume (0..1). The bus volumes come from the settings (`applyAudioSettings`). */
export function setVolume(v: number): void {
  m.setVolumes({ master: v });
}

/** Listener position in map units (camera centre). */
export function setListener(x: number, y: number): void {
  m.setListener(x, y);
}

// ---- cues ----------------------------------------------------------------------------------------------------------

export function play(cue: Cue, x?: number, y?: number, opts?: PlayOpts): void {
  const v = m.begin(CUES[cue], x, y, opts);
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
      for (let i = 0; i < LEVEL_NOTES.length; i++) tone(v, 'triangle', LEVEL_NOTES[i]!, LEVEL_NOTES[i]!, 0.22, 0.14, 0.005, i * 0.07);
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
      tone(v, 'sine', 1318, 1318, 0.2, 0.18, 0.005, 0.12);
      break;
    case 'plate':
      noise(v, 0.3, 400, 0.8, 0.35, 'lowpass');
      tone(v, 'square', 110, 60, 0.3, 0.1);
      break;
    case 'ui':
      tone(v, 'triangle', 880, 660, 0.06, 0.1);
      break;
    case 'footstep': // dull thud + a little scuff
      noise(v, 0.05, 260, 0.9, 0.5, 'lowpass');
      noise(v, 0.03, 2200, 1.2, 0.05);
      break;
    case 'killConfirm': // bright two-note "ding" above the fight
      tone(v, 'triangle', 988, 988, 0.1, 0.16);
      tone(v, 'sine', 1319, 1319, 0.26, 0.18, 0.005, 0.07);
      tone(v, 'sine', 1976, 1976, 0.2, 0.06, 0.005, 0.07);
      break;
  }
  m.finish(v);
}

/** FNV hash -> 0..1 values so every ability id gets its own stable timbre. */
function hash01(s: string, salt: number): number {
  let h = 0x811c9dc5 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return ((h >>> 0) % 10000) / 10000;
}

const WAVES: OscillatorType[] = ['sine', 'triangle', 'square', 'sawtooth'];

export type AnnounceTone = 'good' | 'bad' | 'neutral' | 'epic' | 'victory' | 'defeat';

const ANNOUNCE_NOTES: Record<AnnounceTone, number[]> = {
  good: [392, 523, 659],
  bad: [440, 349, 262],
  neutral: [523, 523, 659],
  epic: [196, 294, 392, 587],
  victory: [392, 523, 659, 784, 1047],
  defeat: [392, 330, 262, 196],
};

/** Announcer banner cue (no voice): a short brass-like motif; rising for good news, falling for bad news. */
export function playAnnounce(kind: AnnounceTone): void {
  const v = m.begin(ANNOUNCE);
  if (!v) return;
  const step = kind === 'victory' || kind === 'defeat' ? 0.16 : 0.11;
  const sag = kind === 'bad' || kind === 'defeat' ? 0.98 : 1;
  const notes = ANNOUNCE_NOTES[kind];
  for (let i = 0; i < notes.length; i++) {
    const f = notes[i]!;
    tone(v, 'sawtooth', f, f * sag, 0.28, 0.07, 0.02, i * step);
    tone(v, 'triangle', f * 2, f * 2 * sag, 0.24, 0.05, 0.02, i * step);
  }
  if (kind === 'epic' || kind === 'victory') noise(v, 0.5, 300, 0.7, 0.18, 'lowpass');
  m.finish(v);
}

/** Fake cast cancelled during its wind-up (Gorvam Q, Sev Q): a short falling fizzle instead of a second cast cue. */
export function playFizzle(x?: number, y?: number, opts?: PlayOpts): void {
  const v = m.begin(FIZZLE, x, y, opts);
  if (!v) return;
  tone(v, 'triangle', 520, 140, 0.16, 0.12);
  noise(v, 0.12, 900, 1.5, 0.06, 'lowpass');
  m.finish(v);
}

/** Distinct cast cue per ability id; shape follows the ability type (line = rising whoosh, circle = drop, ...). */
export function playCast(abilityId: string, type: string, x?: number, y?: number, ultimate = false, opts?: PlayOpts): void {
  const v = m.begin(CAST, x, y, ultimate ? { ...opts, boost: (opts?.boost ?? 0) + 10 } : opts);
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
      tone(v, 'sine', base * 3, base * 2, len, 0.08, 0.005, 0.05);
      break;
    default: // self, summon
      tone(v, wave, base, base * 1.5, len, 0.14, 0.03);
  }
  if (ultimate) tone(v, 'sine', base / 2, base / 4, len + 0.4, 0.18, 0.04);
  m.finish(v);
}

// ---- triggers (animation events, game feel) ------------------------------------------------------------------------

let defaultsInstalled = false;

/** Default sounds for the triggers in triggers.ts. Other code may add handlers with `onTrigger`. */
export function installDefaultTriggers(): void {
  if (defaultsInstalled) return;
  defaultsInstalled = true;
  onTrigger('footstep', (p) => play('footstep', p.x, p.y, p));
  onTrigger('hitFrame', (p) => play('hit', p.x, p.y, p));
  onTrigger('release', (p) => {
    if (p.abilityId) playCast(p.abilityId, p.abilityType ?? 'self', p.x, p.y, p.ultimate === true, p);
  });
  onTrigger('killConfirm', () => play('killConfirm'));
}

export { emitTrigger, onTrigger };
export type { TriggerName, TriggerPayload } from './triggers';

/** True for sounds of the local player's own champion (helper for callers that only know entity ids). */
export function relOf(entityId: number, entityTeam: number, myId: number, myTeam: number): PlayOpts['rel'] {
  return entityId === myId ? Rel.Own : entityTeam === myTeam ? Rel.Ally : Rel.Enemy;
}
