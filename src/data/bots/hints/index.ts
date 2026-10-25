// Typed loader of the per-champion combat hints (schema.ts). The entries (<id>.json, listed in the generated
// registry.ts) are validated against the champion data on first use; a champion without an entry, or an entry that
// fails validateHints, falls back to deriveHints(champion) - the brain always gets usable, data-derived hints.
// tests/a13Hints.test.ts fails for any invalid or missing entry, so the fallback is a safety net, not a mode.

import type { ChampionData } from '../../../sim/champions/schema';
import { REGISTRY } from './registry';
import { deriveHints } from './derive';
import { validateHints } from './validate';
import type { ChampionHints } from './schema';

export * from './schema';
export { deriveHints } from './derive';
export { validateHints } from './validate';

const cache = new Map<string, ChampionHints>();

/** The hints of a champion: the validated file entry, else the derived hints. */
export function hintsOf(champ: ChampionData): ChampionHints {
  let h = cache.get(champ.id);
  if (!h) {
    const entry = REGISTRY[champ.id];
    h = entry && validateHints(entry, champ).length === 0 ? (entry as unknown as ChampionHints) : deriveHints(champ);
    cache.set(champ.id, h);
  }
  return h;
}

/** Champion ids that have a hints file (tests). */
export const hintIds = (): string[] => Object.keys(REGISTRY).sort();

/** Raw registry entry (tests, tools). */
export const hintEntry = (id: string): unknown => REGISTRY[id];
