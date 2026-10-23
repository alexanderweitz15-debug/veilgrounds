// S1 / FEATURE-GAP 4.8: aggregation for the profile screen (src/ui/profileScreen.ts) from the match history
// (src/stats/history.ts). Pure functions: per-champion stats, KDA, rank-estimate trend per record, current estimate.
import { RANKS, type Rank } from '../ai/profiles/schema';
import type { MatchRecord } from '../stats/history';
import { CATEGORY_IDS, type CategoryId, type RankCalibration } from '../stats/rankCalibration';

/** Records that count as "games" (full matches against bots); trainer runs are listed but not aggregated. */
export const isGame = (r: MatchRecord): boolean => r.mode === 'classic';

export interface ChampionStats {
  champion: string;
  games: number;
  /** Games with a result. */
  decided: number;
  wins: number;
  /** 0..1, 0 when nothing was decided. */
  winRate: number;
  kills: number;
  deaths: number;
  assists: number;
  /** (K + A) / max(1, D). */
  kda: number;
  csPerMin: number;
  goldPerMin: number;
}

/** (K + A) / max(1, D), the usual LoL ratio. */
export const kdaOf = (k: number, d: number, a: number): number => (k + a) / Math.max(1, d);

/** Games per champion, most played first (ties: more wins, then name). Averages are per game; CS and gold per minute are time-weighted. */
export function championStats(history: readonly MatchRecord[]): ChampionStats[] {
  const by = new Map<string, { rs: MatchRecord[] }>();
  for (const r of history) {
    if (!isGame(r)) continue;
    const e = by.get(r.champion) ?? { rs: [] };
    e.rs.push(r);
    by.set(r.champion, e);
  }
  const out: ChampionStats[] = [];
  for (const [champion, { rs }] of by) {
    const decided = rs.filter((r) => r.win !== null);
    const wins = decided.filter((r) => r.win).length;
    const minutes = rs.reduce((a, r) => a + r.durationS / 60, 0);
    const k = rs.reduce((a, r) => a + r.kills, 0);
    const d = rs.reduce((a, r) => a + r.deaths, 0);
    const as = rs.reduce((a, r) => a + (r.assists ?? 0), 0);
    out.push({
      champion,
      games: rs.length,
      decided: decided.length,
      wins,
      winRate: decided.length ? wins / decided.length : 0,
      kills: k,
      deaths: d,
      assists: as,
      kda: kdaOf(k, d, as),
      csPerMin: minutes > 0 ? rs.reduce((a, r) => a + r.csPerMin * (r.durationS / 60), 0) / minutes : 0,
      goldPerMin: minutes > 0 ? rs.reduce((a, r) => a + r.goldPerMin * (r.durationS / 60), 0) / minutes : 0,
    });
  }
  return out.sort((a, b) => b.games - a.games || b.wins - a.wins || a.champion.localeCompare(b.champion));
}

export interface Overview {
  games: number;
  decided: number;
  wins: number;
  losses: number;
  /** 0..1 */
  winRate: number;
  kills: number;
  deaths: number;
  assists: number;
  kda: number;
}

export function overview(history: readonly MatchRecord[]): Overview {
  const rs = history.filter(isGame);
  const decided = rs.filter((r) => r.win !== null);
  const wins = decided.filter((r) => r.win).length;
  const kills = rs.reduce((a, r) => a + r.kills, 0);
  const deaths = rs.reduce((a, r) => a + r.deaths, 0);
  const assists = rs.reduce((a, r) => a + (r.assists ?? 0), 0);
  return { games: rs.length, decided: decided.length, wins, losses: decided.length - wins, winRate: decided.length ? wins / decided.length : 0, kills, deaths, assists, kda: kdaOf(kills, deaths, assists) };
}

/** Mean fractional rank index (0 Iron .. 9 Challenger) of a calibration, or null when it has no category. */
export function meanIndex(c: RankCalibration): number | null {
  const v = CATEGORY_IDS.map((id) => c[id]?.index).filter((x): x is number => x !== undefined);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export const rankOfIndex = (i: number): Rank => RANKS[Math.max(0, Math.min(RANKS.length - 1, Math.round(i)))]!;

export interface TrendPoint {
  at: number;
  /** Mean index over the categories of this match. */
  index: number;
  rank: Rank;
  /** Index per category (only those the match was calibrated for). */
  cat: Partial<Record<CategoryId, number>>;
}

/** One point per calibrated game (full classic games >= 10 min), oldest first. */
export function rankTrend(history: readonly MatchRecord[]): TrendPoint[] {
  const out: TrendPoint[] = [];
  for (const r of history) {
    const index = meanIndex(r.calibration);
    if (index === null) continue;
    const cat: TrendPoint['cat'] = {};
    for (const id of CATEGORY_IDS) {
      const c = r.calibration[id];
      if (c) cat[id] = c.index;
    }
    out.push({ at: r.at, index, rank: rankOfIndex(index), cat });
  }
  return out;
}

export interface Estimate {
  index: number;
  rank: Rank;
  /** Games the estimate is based on (the last `window`). */
  games: number;
  /** Mean index per category over the same games. */
  cat: Partial<Record<CategoryId, number>>;
  /** Change of the mean index against the window before (null when there is no earlier window). */
  delta: number | null;
}

/** Current estimate: mean over the last `window` calibrated games; delta against the `window` games before them. */
export function currentEstimate(trend: readonly TrendPoint[], window = 5): Estimate | null {
  if (!trend.length) return null;
  const last = trend.slice(-window);
  const mean = (ps: readonly TrendPoint[]): number => ps.reduce((a, p) => a + p.index, 0) / ps.length;
  const cat: Estimate['cat'] = {};
  for (const id of CATEGORY_IDS) {
    const v = last.map((p) => p.cat[id]).filter((x): x is number => x !== undefined);
    if (v.length) cat[id] = v.reduce((a, b) => a + b, 0) / v.length;
  }
  const before = trend.slice(-2 * window, -window);
  const index = mean(last);
  return { index, rank: rankOfIndex(index), games: last.length, cat, delta: before.length ? index - mean(before) : null };
}

/** Newest first, optionally capped. */
export const recent = (history: readonly MatchRecord[], n = 40): MatchRecord[] => [...history].sort((a, b) => b.at - a.at).slice(0, n);
