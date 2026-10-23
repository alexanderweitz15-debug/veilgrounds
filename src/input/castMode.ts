// Cast mode per key (C7, FEATURE-GAP 3.2 + 3.1; LoL "Quick Cast / Quick Cast with Indicator / Normal Cast"):
// quick = cast at the cursor on key press; indicator = hold to aim, release casts; normal = press shows the
// indicator, left click casts, right click / Esc cancels. Ability keys without an own mode follow the global
// castIndicator; summoner spells, items and the ward trinket default to quick.
export type CastMode = 'quick' | 'indicator' | 'normal';
export type AbilityKey = 'q' | 'w' | 'e' | 'r';
export type CastKey = AbilityKey | 'd' | 'f' | 'tp' | 'item1' | 'item2' | 'item3' | 'item4' | 'item5' | 'item6' | 'trinket';
export const ABILITY_KEYS: readonly AbilityKey[] = ['q', 'w', 'e', 'r'];
export const CAST_KEYS: readonly CastKey[] = ['q', 'w', 'e', 'r', 'd', 'f', 'tp', 'item1', 'item2', 'item3', 'item4', 'item5', 'item6', 'trinket'];
export const CAST_MODES: readonly CastMode[] = ['quick', 'indicator', 'normal'];

export const isCastKey = (k: string): k is CastKey => (CAST_KEYS as readonly string[]).includes(k);
export const isAbilityKey = (k: string): k is AbilityKey => (ABILITY_KEYS as readonly string[]).includes(k);

/** Sim target of a cast key: ability slot, summoner slot, item slot or the ward trinket. */
export type CastTarget = { t: 'cast' | 'spell' | 'item'; slot: number } | { t: 'ward' };

export function castTargetFor(k: CastKey): CastTarget {
  if (isAbilityKey(k)) return { t: 'cast', slot: ABILITY_KEYS.indexOf(k) };
  if (k === 'd') return { t: 'spell', slot: 0 };
  if (k === 'f') return { t: 'spell', slot: 1 };
  if (k === 'tp') return { t: 'spell', slot: 2 };
  if (k === 'trinket') return { t: 'ward' };
  return { t: 'item', slot: Number(k.slice(4)) - 1 };
}

/** `key` is a cast key; a number 0..3 is the ability slot (q w e r). */
export function castModeFor(s: { castIndicator: boolean; castModes?: Partial<Record<CastKey, CastMode>> }, key: CastKey | 0 | 1 | 2 | 3): CastMode {
  const k: CastKey = typeof key === 'number' ? ABILITY_KEYS[key]! : key;
  return s.castModes?.[k] ?? (isAbilityKey(k) && s.castIndicator ? 'indicator' : 'quick');
}
