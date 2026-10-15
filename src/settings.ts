// Client settings, persisted in IndexedDB. Loaded once at startup (await loadSettings()) then read synchronously.
import { kvGet, kvSet } from './store/kv';

export interface Settings {
  lang: 'de' | 'en';
  /** Multiplier for edge scroll / keyboard pan speed. */
  cameraSpeed: number;
  /** HUD scale in percent (80..150). */
  uiScale: number;
  damageNumbers: boolean;
  /** A immediately attack-moves to the cursor instead of arming a left-click. */
  attackMoveOnCursor: boolean;
  edgeScroll: boolean;
  /** Modifier for ability level-up (Ctrl+W closes browser tabs, so Shift is offered). */
  levelMod: 'ctrl' | 'shift';
  cameraLocked: boolean;
  /** Last picked rune preset id per champion id (lobby). */
  runePresets: Record<string, string>;
}

const DEFAULTS: Settings = {
  lang: 'de',
  cameraSpeed: 1,
  uiScale: 100,
  damageNumbers: true,
  attackMoveOnCursor: false,
  edgeScroll: true,
  levelMod: 'ctrl',
  cameraLocked: false,
  runePresets: {},
};

export const settings: Settings = { ...DEFAULTS };
const listeners: (() => void)[] = [];

export async function loadSettings(): Promise<void> {
  const saved = await kvGet<Partial<Settings>>('settings');
  if (saved) Object.assign(settings, saved);
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
