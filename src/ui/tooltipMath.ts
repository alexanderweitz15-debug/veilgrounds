// Pure maths + text segmentation of the hover tooltips (no DOM, no settings: lang is a parameter, so it is testable).
// Ability numbers come from the champion JSON (Scaling/Ranked); items from items.json.
import type { Ranked, Scaling } from '../sim/champions/schema';
import type { ItemData, ItemStat } from '../sim/items/schema';
import keywords from './tooltipKeywords.json';

export type Lang = 'de' | 'en';
/** A run of tooltip text; `cls` colours it (cur = current rank, dim, ad/ap/hp ratio colours, kw-* keywords ...). */
export interface Seg {
  text: string;
  cls?: string;
}

/** Live numbers of the player's champion (HUD snapshot); null outside a match (lobby, encyclopedia). */
export interface TipStats {
  level: number;
  ad: number;
  bonusAd: number;
  ap: number;
  maxHp: number;
  bonusHp: number;
  /** Ability haste. */
  haste: number;
}

export const S = (text: string, cls?: string): Seg => (cls ? { text, cls } : { text });

/**
 * Number for display: integers plain, |n| >= 10 rounded, below one decimal (trailing zero dropped); dp forces the
 * decimals (cooldowns). German decimal comma.
 */
export function fmtNum(n: number, lang: Lang, dp?: number): string {
  const d = dp ?? (Math.abs(n) >= 10 ? 0 : 1);
  const s = String(Number(n.toFixed(d)));
  return lang === 'de' ? s.replace('.', ',') : s;
}

/** Cooldown after ability haste: LoL formula cd * 100 / (100 + haste). Same as abilities.ts (cdTotal). */
export const hasteCooldown = (cd: number, haste: number): number => (cd * 100) / (100 + Math.max(0, haste));
/** Cooldown reduction in percent that `haste` gives. */
export const hasteReductionPct = (haste: number): number => (100 * Math.max(0, haste)) / (100 + Math.max(0, haste));

export const rankList = (v: Ranked): number[] => (Array.isArray(v) ? v : [v]);

/**
 * "60/95/[130]/165/200": one run per rank, the learned rank in `cur`, the others dim. rank <= 0 (not learned / no match):
 * no highlight. All-equal arrays collapse to one value. `map` converts each value first (haste).
 */
export function rankedSegs(v: Ranked, rank: number, lang: Lang, map: (n: number) => number = (n) => n, dp?: number): Seg[] {
  const vals = rankList(v).map(map);
  if (vals.every((x) => x === vals[0])) return [S(fmtNum(vals[0]!, lang, dp))];
  const out: Seg[] = [];
  vals.forEach((x, i) => {
    if (i) out.push(S('/', 'dim'));
    out.push(S(fmtNum(x, lang, dp), rank > 0 ? (i === rank - 1 ? 'cur' : 'dim') : undefined));
  });
  return out;
}

/** Value of a byLevel scaling at a champion level (linear 1..18, like abilities.scaleAmount). */
export const byLevelValue = (b: [number, number], level: number): number => b[0] + ((b[1] - b[0]) * (Math.max(1, Math.min(18, level)) - 1)) / 17;

export type RatioKind = 'ad' | 'ap' | 'hp';
export interface Ratio {
  /** Display key (names[...]) */
  key: 'ad' | 'bonusAd' | 'ap' | 'maxHp' | 'bonusHp' | 'targetMaxHp' | 'targetMissingHp';
  ratio: number;
  kind: RatioKind;
  /** Resolved with the caster's stats; undefined: depends on the target (or no stats known). */
  value?: number;
}

/** All ratios of a Scaling, resolved with `st` where the caster's stats decide them. */
export function ratiosOf(s: Scaling, st: TipStats | null): Ratio[] {
  const defs: [Ratio['key'], number | undefined, RatioKind, number | undefined][] = [
    ['ad', s.ad, 'ad', st?.ad],
    ['bonusAd', s.bonusAd, 'ad', st?.bonusAd],
    ['ap', s.ap, 'ap', st?.ap],
    ['maxHp', s.maxHp, 'hp', st?.maxHp],
    ['bonusHp', s.bonusHp, 'hp', st?.bonusHp],
    ['targetMaxHp', s.targetMaxHp, 'hp', undefined],
    ['targetMissingHp', s.targetMissingHp, 'hp', undefined],
  ];
  return defs.filter(([, r]) => r).map(([key, ratio, kind, stat]) => ({ key, ratio: ratio!, kind, ...(stat !== undefined ? { value: ratio! * stat } : {}) }));
}

/**
 * "80 (+42)" for one Scaling: base per rank (learned rank highlighted), then the resolved bonus of every ratio in its
 * stat colour; the plain ratios ("70 % AP") follow dimmed. Without stats: "80 (+70 % AP)".
 * names: display names per ratio key. levelWord: label for byLevel ranges outside a match.
 */
export function scalingSegs(s: Scaling, rank: number, st: TipStats | null, lang: Lang, names: Record<Ratio['key'], string>, levelWord: string): Seg[] {
  const out: Seg[] = [];
  if (s.byLevel) {
    if (st) out.push(S(fmtNum(byLevelValue(s.byLevel, st.level), lang)));
    else out.push(S(`${fmtNum(s.byLevel[0], lang)}–${fmtNum(s.byLevel[1], lang)}`), S(` (${levelWord})`, 'dim'));
  } else out.push(...rankedSegs(s.base, rank, lang));
  const ratios = ratiosOf(s, st);
  const pct = (r: number): string => fmtNum(Math.round(r * 1000) / 10, lang);
  const resolved = ratios.filter((r) => r.value !== undefined);
  if (st && resolved.length) {
    out.push(S(' ('), ...resolved.flatMap((r, i) => [...(i ? [S(' ')] : []), S(`+${fmtNum(r.value!, lang)}`, r.kind)]), S(')'));
    out.push(S(` ${resolved.map((r) => `${pct(r.ratio)} % ${names[r.key]}`).join(' + ')}`, 'dim'));
  }
  // target-dependent ratios (and everything without stats) stay as plain ratios
  const plain = st ? ratios.filter((r) => r.value === undefined) : ratios;
  if (plain.length) out.push(S(` (+${plain.map((r) => `${pct(r.ratio)} % ${names[r.key]}`).join(', ')})`, st ? 'dim' : plain[0]!.kind));
  return out;
}

// ------------------------------------------------------------------------------------------------ keywords
interface KwDef {
  cls: string;
  de: string;
  en: string;
}
const kwCache: Partial<Record<Lang, RegExp>> = {};

/** Splits description text into runs, highlighting crowd control, damage-type and heal/shield words (tooltipKeywords.json). */
export function keywordSegs(text: string, lang: Lang): Seg[] {
  const defs = keywords as KwDef[];
  const all = (kwCache[lang] ??= new RegExp(defs.map((k, i) => `(?<k${i}>(?<![\\p{L}])(?:${k[lang]}))`).join('|'), 'giu'));
  const out: Seg[] = [];
  let last = 0;
  for (const m of text.matchAll(all)) {
    if (m.index! > last) out.push(S(text.slice(last, m.index)));
    const i = defs.findIndex((_, j) => m.groups?.[`k${j}`] !== undefined);
    out.push(S(m[0], defs[i]!.cls));
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(S(text.slice(last)));
  return out;
}

// ------------------------------------------------------------------------------------------------ items
const PCT_STATS = new Set<ItemStat>(['asPct', 'critPct', 'lifestealPct', 'msPct', 'hpRegenPct', 'manaRegenPct', 'healShieldPowerPct', 'magicPenPct', 'armorPenPct', 'tenacity']);
export const isPctStat = (k: string): boolean => PCT_STATS.has(k as ItemStat);

/** Stat differences item - other (non-zero only), in the item's stat order first. */
export function compareStats(item: ItemData, other: ItemData): { stat: ItemStat; delta: number }[] {
  const keys = new Set([...Object.keys(item.stats), ...Object.keys(other.stats)] as ItemStat[]);
  const out: { stat: ItemStat; delta: number }[] = [];
  for (const k of keys) {
    const d = (item.stats[k] ?? 0) - (other.stats[k] ?? 0);
    if (d) out.push({ stat: k, delta: d });
  }
  return out;
}

/**
 * Which owned item the shop compares `item` against: same slot type (boots vs boots; else same tier), preferring the
 * one with most shared tags, then the pricier one. Never the item itself.
 */
export function compareTarget(item: ItemData, owned: readonly (string | null)[], byId: (id: string) => ItemData | undefined): ItemData | null {
  let best: ItemData | null = null;
  let bestScore = -1;
  for (const id of owned) {
    const o = id ? byId(id) : undefined;
    if (!o || o.id === item.id || o.tier !== item.tier || o.tier === 'consumable') continue;
    const score = o.tags.filter((t) => item.tags.includes(t)).length * 100000 + o.cost;
    if (score > bestScore) (best = o), (bestScore = score);
  }
  return best;
}

export interface TreeNode {
  id: string;
  depth: number;
  /** Covered by an owned item (consumed once per copy). */
  owned: boolean;
}

/** Flattened build tree below `item`; owned components tick off (each copy once) and hide their own sub-tree. */
export function buildTree(item: ItemData, owned: readonly (string | null)[], byId: (id: string) => ItemData | undefined): TreeNode[] {
  const pool = [...owned];
  const out: TreeNode[] = [];
  const walk = (it: ItemData, depth: number): void => {
    for (const c of it.from) {
      const sub = byId(c);
      if (!sub) continue;
      const k = pool.indexOf(c);
      if (k >= 0) pool[k] = null;
      out.push({ id: c, depth, owned: k >= 0 });
      if (k < 0 && sub.from.length) walk(sub, depth + 1);
    }
  };
  walk(item, 0);
  return out;
}
