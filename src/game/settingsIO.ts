// Settings export / import as JSON (C7, FEATURE-GAP 3.13): settings + keybinds in one file. Import accepts only known
// keys with the type of their default (and known enum values), so a hand-edited or old file cannot break the client.
import type { Settings } from '../settings';
import { LEVEL_UP_MODS, SELF_CAST_MODS, type Action } from '../input/keybinds';
import { CAST_KEYS, CAST_MODES } from '../input/castMode';

export const SETTINGS_FILE_VERSION = 1;

export interface SettingsFile {
  version: number;
  settings: Partial<Settings>;
  keybinds: Partial<Record<Action, string>>;
}

const ENUMS: Partial<Record<keyof Settings, readonly string[]>> = {
  lang: ['de', 'en'],
  colorMode: ['normal', 'deuteranopia', 'protanopia', 'tritanopia'],
  graphics: ['low', 'medium', 'high'],
  hpBarStyle: ['segmented', 'thousands', 'plain'],
  selfCastMod: SELF_CAST_MODS,
  levelUpMod: LEVEL_UP_MODS,
};

/** Slider ranges (settingsPanel.ts): imported numbers are clamped to them. */
const RANGES: Partial<Record<keyof Settings, [number, number]>> = {
  cameraSpeed: [0.3, 3],
  uiScale: [80, 150],
  minimapScale: [80, 150],
  volume: [0, 1],
};

export function exportSettings(settings: Settings, binds: Record<Action, string>): string {
  const file: SettingsFile = { version: SETTINGS_FILE_VERSION, settings: { ...settings }, keybinds: { ...binds } };
  return JSON.stringify(file, null, 2);
}

/** Parse an exported file; unknown keys and wrong types are dropped (listed in `skipped`). Throws on invalid JSON. */
export function parseSettingsFile(text: string, defaults: Readonly<Settings>, actions: readonly Action[]): { settings: Partial<Settings>; keybinds: Partial<Record<Action, string>>; skipped: string[] } {
  const raw = JSON.parse(text) as Partial<SettingsFile> | null;
  if (!raw || typeof raw !== 'object') throw new Error('not an object');
  const out: Partial<Settings> = {};
  const skipped: string[] = [];
  for (const [k, v] of Object.entries(raw.settings ?? {})) {
    const key = k as keyof Settings;
    const d = defaults[key];
    const ok = d !== undefined && typeof v === typeof d && (typeof d !== 'object' || (v !== null && !Array.isArray(v))) && (!ENUMS[key] || ENUMS[key]!.includes(v as string)) && (typeof v !== 'number' || Number.isFinite(v));
    if (key === 'castModes' && ok) {
      // per-key cast modes: only known keys and modes survive
      const cm: Settings['castModes'] = {};
      for (const [ck, cv] of Object.entries(v as object)) if ((CAST_KEYS as readonly string[]).includes(ck) && (CAST_MODES as readonly string[]).includes(cv as string)) cm[ck as 'q'] = cv as 'quick';
      out.castModes = cm;
      continue;
    }
    const range = RANGES[key];
    if (ok) (out as Record<string, unknown>)[key] = range ? Math.min(range[1], Math.max(range[0], v as number)) : v;
    else skipped.push(k);
  }
  const keybinds: Partial<Record<Action, string>> = {};
  for (const [k, v] of Object.entries(raw.keybinds ?? {})) {
    if (actions.includes(k as Action) && typeof v === 'string' && v.length <= 32) keybinds[k as Action] = v;
    else skipped.push(`keybind:${k}`);
  }
  return { settings: out, keybinds, skipped };
}
