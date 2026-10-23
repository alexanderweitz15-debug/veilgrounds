// Bot tendency text (FEATURE-GAP 1.7): a playstyle axis value (-5..+5, src/ai/contract.ts PLAYSTYLE_AXES) as a short
// plain-language sentence ("spielt sehr aggressiv", "roamt selten"). Pure and DOM-free: the texts live in the i18n
// tables (keys `tend.<axis>.<tier>`), five tiers per axis; tooltips and tests use the same mapping.
import { PLAYSTYLE_AXES, type PlaystyleAxis } from '../ai/contract';
import de from '../i18n/de.json';
import en from '../i18n/en.json';

/** -2 = strong tendency to the left end of the scale (-5/-4), 0 = neutral (-1..+1), +2 = strong tendency to the right end. */
export type TendencyTier = -2 | -1 | 0 | 1 | 2;

/** Value -5..+5 -> tier (-5,-4 -> -2; -3,-2 -> -1; -1..1 -> 0; 2,3 -> 1; 4,5 -> 2). Out-of-range values are clamped. */
export function tendencyTier(value: number): TendencyTier {
  const v = Math.round(value);
  if (v <= -4) return -2;
  if (v <= -2) return -1;
  if (v >= 4) return 2;
  if (v >= 2) return 1;
  return 0;
}

/** i18n key of an axis value, e.g. `tend.aggression.2`. */
export const tendencyKey = (axis: PlaystyleAxis, value: number): string => `tend.${axis}.${tendencyTier(value)}`;

const TABLES: Record<'de' | 'en', Record<string, string>> = { de, en };

/** Plain-language tendency of one axis value ("spielt sehr aggressiv"). */
export function tendencyText(axis: PlaystyleAxis, value: number, lang: 'de' | 'en' = 'de'): string {
  return TABLES[lang][tendencyKey(axis, value)] ?? '';
}

/** Every key the mapping can produce (tests check they exist in both languages). */
export const TENDENCY_KEYS: readonly string[] = PLAYSTYLE_AXES.flatMap((a) => ([-2, -1, 0, 1, 2] as const).map((tier) => `tend.${a}.${tier}`));
