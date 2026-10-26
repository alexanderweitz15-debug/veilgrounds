// Client settings, persisted in IndexedDB. Loaded once at startup (await loadSettings()) then read synchronously.
import { kvGet, kvSet } from './store/kv';
import type { CastKey, CastMode } from './input/castMode';
import type { LevelUpMod, SelfCastMod } from './input/keybinds';

export type ColorMode = 'normal' | 'deuteranopia' | 'protanopia' | 'tritanopia';
export type GraphicsPreset = 'veryLow' | 'low' | 'medium' | 'high' | 'veryHigh';
/** A preset, or 'custom' = the individual gfx* fields below decide. */
export type GraphicsQuality = GraphicsPreset | 'custom';
export const GRAPHICS_QUALITIES: readonly GraphicsQuality[] = ['veryLow', 'low', 'medium', 'high', 'veryHigh', 'custom'];

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
  /** Individual video options (used when graphics is 'custom'; the panel shows the preset's values otherwise). */
  gfxShadows: boolean;
  gfxShadowMap: number;
  /** Full 17-tap shadow filter instead of the fast 5-tap one (next match). */
  gfxSoftShadows: boolean;
  /** Max device pixel ratio. */
  gfxPixelRatio: number;
  /** MSAA (next match). */
  gfxAntialias: boolean;
  /** Particle density in percent. */
  gfxParticles: number;
  /** Detailed ground texture, ground detail shader, more border trees (next match). */
  gfxTerrainDetail: boolean;
  /** Render scale in percent on top of the pixel ratio. */
  renderScale: number;
  /** Frame cap in fps, 0 = uncapped (display refresh). */
  fpsCap: number;
  /** FPS / frame-time overlay (key: fpsOverlay). */
  showFps: boolean;
  /** The 3 s auto-detect benchmark ran (false = it runs at the start of the next match). */
  gfxAutoDetected: boolean;
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
  /** Beta: new bot brain (reflex layer + utility model). */
  newBrain: boolean;
  /** Master volume 0..1 (procedural sound). */
  volume: number;
  /** Last picked rune preset id per champion id (lobby). */
  runePresets: Record<string, string>;
  /** Minimap size in percent (80..150) on top of the HUD scale (C7). */
  minimapScale: number;
  /** Minimap at the bottom left instead of the bottom right (C7). */
  minimapLeft: boolean;
  /** Cast mode per ability key (C7, src/input/castMode.ts); missing keys follow castIndicator. */
  castModes: Partial<Record<CastKey, CastMode>>;
  /** Hold with an ability / summoner / item key to cast on yourself (keybinds editor; LoL: Alt). */
  selfCastMod: SelfCastMod;
  /** Hold with Q/W/E/R to level the ability up (LoL: Ctrl; default Ctrl or Shift, Ctrl+W/Q close tabs outside fullscreen). */
  levelUpMod: LevelUpMod;
  /** Champion HP bar ticks (C7, src/ui/overlay.ts): every 100 + 1000 HP (LoL), only 1000, or none. */
  hpBarStyle: 'segmented' | 'thousands' | 'plain';
  /** LoL "Player Attack Move Click": attack-move picks the enemy nearest to the cursor first (B5 command flag). */
  attackMoveNearCursor: boolean;
  /** Outline enemy skillshots more strongly (C7 data; drawn by the render telegraphs, agent D). */
  enemySkillshotOutline: boolean;
  /** Champion voice lines as text: speech bubbles in the match and the pick line in the lobby (src/ui/voiceBubbles.ts). */
  voiceLines: boolean;
  /** Tab scoreboard: extra "Bot-Info" column with the ten playstyle mini-scales per bot (FEATURE-GAP 1.7). */
  scoreBotInfo: boolean;
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
  gfxShadows: true,
  gfxShadowMap: 2048,
  gfxSoftShadows: false,
  gfxPixelRatio: 1,
  gfxAntialias: true,
  gfxParticles: 100,
  gfxTerrainDetail: true,
  renderScale: 100,
  fpsCap: 0,
  showFps: false,
  gfxAutoDetected: false,
  damageNumbers: true,
  attackMoveOnCursor: false,
  castIndicator: true,
  edgeScroll: true,
  cameraLocked: false,
  fullscreenLock: true,
  volume: 0.6,
  botToxicity: true,
  newBrain: false,
  runePresets: {},
  minimapScale: 100,
  minimapLeft: false,
  castModes: {},
  selfCastMod: 'alt',
  levelUpMod: 'ctrlOrShift',
  hpBarStyle: 'segmented',
  enemySkillshotOutline: false,
  attackMoveNearCursor: true,
  voiceLines: true,
  scoreBotInfo: false,
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
  // saves from before the auto-detect: the player already has a graphics choice, no benchmark
  if (saved && saved.gfxAutoDetected === undefined) settings.gfxAutoDetected = true;
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
