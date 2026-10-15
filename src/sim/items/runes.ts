// Rune presets per champion: the lobby offers them so players never have to assemble runes by hand.

import presetsJson from '../../data/runePresets.json';
import runesJson from '../../data/runes.json';
import type { L10n } from '../champions/schema';
import type { RuneData } from './schema';
import type { Rng } from '../rng';

export interface RuneChoice {
  keystone: string;
  minor: [string, string, string];
}

export interface RunePreset extends RuneChoice {
  id: string;
  name: L10n;
  desc: L10n;
}

export const RUNES = runesJson.runes as unknown as RuneData[];
const PRESETS = presetsJson.presets as unknown as Record<string, RunePreset[]>;

/** Presets for a champion; first entry is the recommended default. */
export function runePresets(champion: string): RunePreset[] {
  return PRESETS[champion] ?? PRESETS.mira!;
}

export function defaultRunes(champion: string): RuneChoice {
  const p = runePresets(champion)[0]!;
  return { keystone: p.keystone, minor: p.minor };
}

/** Lobby: resolve a stored preset id (last pick per champion) back to runes; falls back to the default. */
export function runesFromPreset(champion: string, presetId: string | undefined): RuneChoice {
  const p = runePresets(champion).find((x) => x.id === presetId) ?? runePresets(champion)[0]!;
  return { keystone: p.keystone, minor: p.minor };
}

/**
 * Bot pick (spec §7 "Prägungen optimal %"): with optimalPct the standard preset, otherwise a random
 * other preset — a plausible but not ideal choice, never an invalid page.
 */
export function botRunes(champion: string, optimalPct: number, rng: Rng): RuneChoice {
  const ps = runePresets(champion);
  const p = rng.chance(optimalPct / 100) ? ps[0]! : ps[1 + rng.int(ps.length - 1)]!;
  return { keystone: p.keystone, minor: p.minor };
}
