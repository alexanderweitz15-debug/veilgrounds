// LOCAL ADAPTER (agent D) for the rank calibration API that AGENTS-PLAN §3/§7 assigns to A3 (`stats/rankCalibration`).
// A3 has not defined it yet (main c15e402); D's training plan consumes only the types below. When A3 ships the real
// API, replace `calibrateMatch` (keep the `RankCalibration` shape or map onto it) - nothing else in src/stats changes.
//
// Calibration = where a match metric sits on the ten rank targets of Table A (src/data/bots/profiles/*.json `targets`):
// fractional rank index 0 (Iron) .. 9 (Challenger), linear between neighbouring ranks, clamped at both ends.
import { PROFILES } from '../ai/profiles';
import { RANKS, type Rank, type RankTargets } from '../ai/profiles/schema';
import data from './trainingData.json';

export type CategoryId = 'farming' | 'economy' | 'survival' | 'fighting';

interface CategoryDef {
  metric: keyof MatchMetrics;
  target: keyof RankTargets;
  higherIsBetter: boolean;
  per30: boolean;
}
export const CATEGORIES = (data as unknown as { categories: Record<CategoryId, CategoryDef> }).categories;
export const CATEGORY_IDS = Object.keys(CATEGORIES) as CategoryId[];

/** Per-match metrics the calibration reads (src/stats/history.ts builds them from the post-game MatchSummary). */
export interface MatchMetrics {
  cs10: number;
  csPerMin: number;
  goldPerMin: number;
  deathsPer30: number;
  killsPer30: number;
}

export interface CategoryCalibration {
  /** Fractional rank index 0..9 (Iron .. Challenger). */
  index: number;
  /** Nearest rank. */
  rank: Rank;
  /** The match value and the value the next rank expects (absent at Challenger). */
  value: number;
  next?: number;
}

export type RankCalibration = Partial<Record<CategoryId, CategoryCalibration>>;

/** Rank target of `cat` for every rank (index 0..9), per30 targets scaled to a 30-minute game. */
export function targetsOf(cat: CategoryId): number[] {
  const d = CATEGORIES[cat];
  return PROFILES.map((p) => {
    const t = p.targets[d.target];
    return d.per30 ? (t * 30) / p.targets.gameLengthMin : t;
  });
}

/** Fractional rank index of `value` on targets `t` (monotone in rank; decreasing when lower is better). */
export function rankIndexOf(value: number, t: readonly number[], higherIsBetter: boolean): number {
  const s = higherIsBetter ? 1 : -1;
  const v = value * s;
  const tt = t.map((x) => x * s);
  if (v <= tt[0]!) return 0;
  for (let i = 0; i < tt.length - 1; i++) {
    const a = tt[i]!;
    const b = tt[i + 1]!;
    if (v <= b) return b === a ? i + 1 : i + (v - a) / (b - a);
  }
  return tt.length - 1;
}

/** Calibrates one match (only categories whose metric is a finite number). */
export function calibrateMatch(m: Partial<MatchMetrics>): RankCalibration {
  const out: RankCalibration = {};
  for (const cat of CATEGORY_IDS) {
    const d = CATEGORIES[cat];
    const value = m[d.metric];
    if (value === undefined || !Number.isFinite(value)) continue;
    const t = targetsOf(cat);
    const index = rankIndexOf(value, t, d.higherIsBetter);
    const nextI = Math.floor(index) + 1;
    out[cat] = { index, rank: RANKS[Math.round(index)]!, value, ...(nextI < t.length ? { next: t[nextI] } : {}) };
  }
  return out;
}
