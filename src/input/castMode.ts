// Cast mode per ability key (C7, FEATURE-GAP 3.2; LoL "Quick Cast / Quick Cast with Indicator / Normal Cast"):
// quick = cast at the cursor on key press; indicator = hold to aim, release casts; normal = press shows the
// indicator, left click casts, right click / Esc cancels. Keys without an own mode follow the global castIndicator.
export type CastMode = 'quick' | 'indicator' | 'normal';
export type CastKey = 'q' | 'w' | 'e' | 'r';
export const CAST_KEYS: readonly CastKey[] = ['q', 'w', 'e', 'r'];
export const CAST_MODES: readonly CastMode[] = ['quick', 'indicator', 'normal'];

export function castModeFor(s: { castIndicator: boolean; castModes?: Partial<Record<CastKey, CastMode>> }, slot: 0 | 1 | 2 | 3): CastMode {
  return s.castModes?.[CAST_KEYS[slot]!] ?? (s.castIndicator ? 'indicator' : 'quick');
}
