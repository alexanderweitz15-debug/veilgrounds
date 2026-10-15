// Bot play styles: 10 axes 0..1, independent of rank (rank = how well, style = how). Lobby overrides come later.
import styles from '../../data/bots/styles.json';
import type { Rng } from '../../sim/rng';

export type StyleAxis =
  | 'tradeLength'
  | 'aggression'
  | 'kiting'
  | 'mechanics'
  | 'farmVsFight'
  | 'roaming'
  | 'risk'
  | 'vision'
  | 'objectives'
  | 'teamplay';
export type BotStyle = Record<StyleAxis, number>;

export const STYLE_AXES = styles.axes as { id: StyleAxis; left: { de: string; en: string }; right: { de: string; en: string } }[];
const BIAS = styles.archetypeBias as Record<string, Partial<BotStyle>>;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Neutral style (all 0.5). */
export const neutralStyle = (): BotStyle => Object.fromEntries(STYLE_AXES.map((a) => [a.id, 0.5])) as BotStyle;

/** Per-bot style: archetype bias (else 0.5) + personality noise, optional manual overrides on top. */
export function rollStyle(rng: Rng, archetype: string, overrides: Partial<BotStyle> = {}): BotStyle {
  const bias = BIAS[archetype] ?? {};
  const s = neutralStyle();
  for (const a of STYLE_AXES) s[a.id] = clamp01((bias[a.id] ?? 0.5) + rng.normal() * styles.noiseSigma);
  for (const [k, v] of Object.entries(overrides)) s[k as StyleAxis] = clamp01(v);
  return s;
}

/** "kurze -x--- lange" style text for lobby/encyclopedia/debug overlay (5 positions). */
export function formatAxis(axis: StyleAxis, value: number, lang: 'de' | 'en' = 'de', width = 5): string {
  const a = STYLE_AXES.find((x) => x.id === axis)!;
  const pos = Math.round(clamp01(value) * (width - 1));
  const bar = Array.from({ length: width }, (_, i) => (i === pos ? 'x' : '-')).join('');
  return `${a.left[lang]} ${bar} ${a.right[lang]}`;
}

/** Mechanics axis -> rank-step offset applied to the rolled profile (±1 step at the extremes; 0 = pro side). */
export const mechanicsRankOffset = (s: BotStyle): number => (0.5 - s.mechanics) * 2;
