// Summoner-style bot names (spec §11) and rank-typed chat lines (spec §8).

import names from '../../data/bots/names.json';
import chat from '../../data/bots/chat.json';
import type { Rng } from '../../sim/rng';
import type { Rank } from '../profiles/schema';

const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[rng.int(xs.length)]!;
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Unique bot names for one lobby. style 'neutral' gives "Bot <Name>". */
export function botNames(rng: Rng, count: number, style: 'realistic' | 'neutral', champNames: string[] = []): string[] {
  const out = new Set<string>();
  while (out.size < count) {
    if (style === 'neutral') {
      out.add(`Bot ${cap(pick(rng, names.second))}`);
      continue;
    }
    const s = pick(rng, names.second);
    const name = pick(rng, names.patterns)
      .replace('{F}', pick(rng, names.first))
      .replace('{s}', s)
      .replace('{S}', cap(s))
      .replace('{C}', champNames.length ? pick(rng, champNames) : pick(rng, names.first))
      .replace('{n2}', String(rng.int(100)))
      .replace('{n4}', String(1900 + rng.int(130)));
    if (name.length <= 16) out.add(name);
  }
  return [...out];
}

export type ChatBand = 'low' | 'mid' | 'high';
export const bandOf = (rank: Rank): ChatBand =>
  rank === 'iron' || rank === 'bronze' || rank === 'silver' ? 'low' : rank === 'gold' || rank === 'platinum' || rank === 'emerald' ? 'mid' : 'high';

export interface ChatLine {
  cat: string;
  band: string;
  de: string;
  en: string;
  toxic?: boolean;
}
export const CHAT = chat.lines as ChatLine[];

/** A chat line for a category at the bot's band, or null if none fits (bot stays silent). */
export function chatLine(rng: Rng, cat: string, rank: Rank, toxicity: boolean, vars: Record<string, string> = {}, lang: 'de' | 'en' = 'de'): string | null {
  const band = bandOf(rank);
  const pool = CHAT.filter((l) => l.cat === cat && l.band === band && (toxicity || !l.toxic));
  if (!pool.length) return null;
  return pick(rng, pool)[lang].replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}
