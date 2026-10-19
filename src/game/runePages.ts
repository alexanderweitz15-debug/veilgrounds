// Own rune page per champion (C5, FEATURE-GAP 4.2): one keystone + three different minor runes, saved in IndexedDB
// (kv 'runePages'), selected in the lobby like a preset (preset id CUSTOM_ID). Editor UI: src/ui/runePages.ts.
import { kvGet, kvSet } from '../store/kv';
import { RUNES, runesFromPreset, type RuneChoice } from '../sim/items/runes';

/** Preset id stored in settings.runePresets when the champion uses its own page. */
export const CUSTOM_ID = 'custom';
export const MINORS = 3;

const pages = new Map<string, RuneChoice>();
let loaded: Promise<void> | null = null;

/** Load the saved pages once (lobbies await it before drawing). */
export function loadRunePages(): Promise<void> {
  loaded ??= kvGet<Record<string, RuneChoice>>('runePages')
    .then((saved) => {
      for (const [champ, p] of Object.entries(saved ?? {})) if (validPage(p)) pages.set(champ, p);
    })
    .catch(() => undefined);
  return loaded;
}

/** A page the sim accepts: a known keystone and three different known minor runes. */
export function validPage(p: RuneChoice | undefined): p is RuneChoice {
  if (!p || !Array.isArray(p.minor) || p.minor.length !== MINORS || new Set(p.minor).size !== MINORS) return false;
  const kind = (id: string): string | undefined => RUNES.find((r) => r.id === id)?.kind;
  return kind(p.keystone) === 'keystone' && p.minor.every((m) => kind(m) === 'minor');
}

export function customPage(champ: string): RuneChoice | undefined {
  return pages.get(champ);
}

export function saveCustomPage(champ: string, p: RuneChoice): void {
  if (!validPage(p)) return;
  pages.set(champ, { keystone: p.keystone, minor: [...p.minor] as RuneChoice['minor'] });
  void kvSet('runePages', Object.fromEntries(pages));
}

/** Runes for the match: the own page when selected and valid, else the preset (default preset as fallback). */
export function runesFor(champ: string, presetId: string | undefined): RuneChoice {
  const own = presetId === CUSTOM_ID ? pages.get(champ) : undefined;
  return own ? { keystone: own.keystone, minor: [...own.minor] as RuneChoice['minor'] } : runesFromPreset(champ, presetId);
}

/**
 * Toggle a minor rune in a draft page: deselect if chosen, else add it (the oldest choice drops out when three are
 * already chosen). Pure (tests).
 */
export function toggleMinor(minor: readonly string[], id: string): string[] {
  if (minor.includes(id)) return minor.filter((m) => m !== id);
  const next = [...minor, id];
  return next.length > MINORS ? next.slice(next.length - MINORS) : next;
}
