// Client settings, persisted in IndexedDB. Loaded once at startup (await loadSettings()) then read synchronously.
import { kvGet, kvSet } from './store/kv';

export type ColorMode = 'normal' | 'deuteranopia' | 'protanopia' | 'tritanopia';
export type GraphicsQuality = 'low' | 'medium' | 'high';

export interface Settings {
  lang: 'de' | 'en';
  /** Multiplier for edge scroll / keyboard pan speed. */
  cameraSpeed: number;
  /** HUD scale in percent (80..150); used when uiScaleAuto is off. */
  uiScale: number;
  /** HUD scale follows the window height (innerHeight / 720); moving the slider turns it off. */
  uiScaleAuto: boolean;
  /** Colour-blind palette for team/relation colours (bars, rings, minimap, pings, telegraphs). */
  colorMode: ColorMode;
  /** Fewer flashes, pulses and animations (hit flash, cast/death pulses, HUD animations). */
  reduceMotion: boolean;
  /** Opaque HUD panels, bolder text outlines and outlined health bars. */
  highContrast: boolean;
  /** On-screen cues for important sounds: off-screen ping arrows, tower fire warning, captions. */
  visualCues: boolean;
  /** Render quality: shadows, shadow filter, resolution, antialiasing. */
  graphics: GraphicsQuality;
  damageNumbers: boolean;
  /** A immediately attack-moves to the cursor instead of arming a left-click. */
  attackMoveOnCursor: boolean;
  /** LoL "quick cast with indicator": hold an ability key to aim (range + shape at the cursor), release to cast. */
  castIndicator: boolean;
  edgeScroll: boolean;
  cameraLocked: boolean;
  /** Enter fullscreen + Keyboard Lock on game start so Ctrl+W/Q reach the game (Chromium). */
  fullscreenLock: boolean;
  /** Bots may flame in chat and spam '?' pings (spec-bots §9 Toxizität). */
  botToxicity: boolean;
  /** Master volume 0..1 (procedural sound). */
  volume: number;
  /** Last picked rune preset id per champion id (lobby). */
  runePresets: Record<string, string>;
  /** Minimap size in percent (80..150) on top of the HUD scale (C7). */
  minimapScale: number;
  /** Minimap at the bottom left instead of the bottom right (C7). */
  minimapLeft: boolean;
}

const DEFAULTS: Settings = {
  lang: 'de',
  cameraSpeed: 1,
  uiScale: 100,
  uiScaleAuto: true,
  colorMode: 'normal',
  reduceMotion: false,
  highContrast: false,
  visualCues: true,
  graphics: 'medium',
  damageNumbers: true,
  attackMoveOnCursor: false,
  castIndicator: true,
  edgeScroll: true,
  cameraLocked: false,
  fullscreenLock: true,
  volume: 0.6,
  botToxicity: true,
  runePresets: {},
  minimapScale: 100,
  minimapLeft: false,
};

/** Default values (settings import validates keys and types against them). */
export const DEFAULT_SETTINGS: Readonly<Settings> = DEFAULTS;

export const settings: Settings = { ...DEFAULTS };
const listeners: (() => void)[] = [];

export async function loadSettings(): Promise<void> {
  const saved = await kvGet<Partial<Settings>>('settings');
  // first start: follow the OS "reduce motion" preference
  if (saved?.reduceMotion === undefined) settings.reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (saved) Object.assign(settings, saved);
  delete (settings as unknown as Record<string, unknown>).levelMod; // removed setting (old saves still carry it)
  // saves from before auto scaling: a customised scale stays manual
  if (saved && saved.uiScaleAuto === undefined && saved.uiScale !== undefined && saved.uiScale !== 100) settings.uiScaleAuto = false;
}

/** Effective HUD scale factor (1 = 100 %). Auto: window height / 720 (720p = 1.0, 1080p = 1.5), clamped. */
export function uiScaleFactor(): number {
  if (!settings.uiScaleAuto) return settings.uiScale / 100;
  const h = typeof window === 'undefined' ? 720 : window.innerHeight;
  return Math.min(2, Math.max(0.8, h / 720));
}

export function updateSettings(patch: Partial<Settings>): void {
  Object.assign(settings, patch);
  void kvSet('settings', { ...settings });
  for (const l of listeners) l();
}

export function onSettingsChange(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}
