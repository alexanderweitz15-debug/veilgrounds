// Aggregation: games -> metric values with a bootstrap standard error / 95 % interval (resampling whole games, so
// the 10 champions of one game - which are not independent - count as one cluster). The bootstrap uses its own seeded
// generator: same raw games -> same report, byte for byte.

import { METRICS, METRIC_BY_ID, ROLES, type MetricDef } from './metrics';
import type { GameRaw } from './play';

export interface Estimate {
  /** Pooled value (ratio of sums / median of the pooled samples); NaN if there is no data. */
  value: number;
  se: number;
  lo: number;
  hi: number;
  /** Games that contributed (denominator > 0 / samples present) and the pooled denominator / sample count. */
  games: number;
  den: number;
}
const NAN: Estimate = { value: NaN, se: NaN, lo: NaN, hi: NaN, games: 0, den: 0 };
export const BOOT = 1000;

/** mulberry32 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const median = (xs: number[]): number => quantile(xs, 0.5);
export function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo]! + (s[Math.min(s.length - 1, lo + 1)]! - s[lo]!) * (i - lo);
}

/** Per-game contribution of one rank X to one metric: [num, den] or the sample list. */
export type Cluster = { r: [number, number] } | { s: number[] };

function clusterValue(cs: Cluster[], kind: 'ratio' | 'samples'): number {
  if (kind === 'ratio') {
    let n = 0;
    let d = 0;
    for (const c of cs) {
      const r = (c as { r: [number, number] }).r;
      n += r[0];
      d += r[1];
    }
    return d > 0 ? n / d : NaN;
  }
  const all: number[] = [];
  for (const c of cs) all.push(...(c as { s: number[] }).s);
  return median(all);
}

export function estimate(cs: Cluster[], kind: 'ratio' | 'samples', key: string): Estimate {
  const has = cs.filter((c) => ('r' in c ? c.r[1] > 0 : c.s.length > 0));
  if (!has.length) return NAN;
  const value = clusterValue(has, kind);
  const den = has.reduce((a, c) => a + ('r' in c ? c.r[1] : c.s.length), 0);
  if (has.length < 2) return { value, se: NaN, lo: NaN, hi: NaN, games: has.length, den };
  const rand = rng(hashStr(key));
  const vals: number[] = [];
  for (let b = 0; b < BOOT; b++) {
    const pick: Cluster[] = [];
    for (let i = 0; i < has.length; i++) pick.push(has[Math.floor(rand() * has.length)]!);
    const v = clusterValue(pick, kind);
    if (Number.isFinite(v)) vals.push(v);
  }
  if (!vals.length) return { value, se: NaN, lo: NaN, hi: NaN, games: has.length, den };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const se = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, vals.length - 1));
  return { value, se, lo: quantile(vals, 0.025), hi: quantile(vals, 0.975), games: has.length, den };
}

/** Metric ids present in the games, with role splits, ordered like the registry. */
export function metricKeys(def: MetricDef): string[] {
  return def.roles ? [def.id, ...ROLES.map((r) => `${def.id}.${r}`)] : [def.id];
}

/** Clusters of one rank X for one metric key over a list of games (each game contributes its X teams pooled). */
export function clustersFor(games: GameRaw[], key: string, kind: 'ratio' | 'samples'): Cluster[] {
  return games.map((g) => {
    if (kind === 'samples') {
      const s: number[] = [];
      for (const t of g.xTeams) s.push(...(g.teams[t]!.samples[key] ?? []));
      return { s };
    }
    const r: [number, number] = [0, 0];
    for (const t of g.xTeams) {
      const c = g.teams[t]!.ratio[key];
      if (c) {
        r[0] += c[0];
        r[1] += c[1];
      }
    }
    return { r };
  });
}

export interface RowKey {
  brain: string;
  set: string;
  pair: string;
}
export const groupKey = (g: GameRaw): string => `${g.spec.brain}|${g.spec.set}|${g.spec.pair}`;

export interface AggRow {
  brain: string;
  set: string;
  pair: string;
  x: string;
  ref: string;
  games: number;
  minutes: number;
  /** key -> estimate */
  est: Record<string, Estimate>;
}

/** Aggregates all games into rows (brain x set x pair) with every metric key. */
export function aggregate(games: GameRaw[]): AggRow[] {
  const groups = new Map<string, GameRaw[]>();
  for (const g of games) {
    const k = groupKey(g);
    const list = groups.get(k);
    if (list) list.push(g);
    else groups.set(k, [g]);
  }
  const rows: AggRow[] = [];
  for (const [k, gs] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    const first = gs[0]!.spec;
    const est: Record<string, Estimate> = {};
    for (const def of METRICS) {
      for (const key of metricKeys(def)) {
        est[key] = estimate(clustersFor(gs, key, def.kind), def.kind, `${k}|${key}`);
      }
    }
    // extra sample metric: longest idle stretch per champion (mean of the per-champion maxima), informational
    est['idleMaxS'] = estimate(clustersFor(gs, 'idleMaxS', 'samples'), 'samples', `${k}|idleMaxS`);
    rows.push({ brain: first.brain, set: first.set, pair: first.pair, x: first.x, ref: first.ref, games: gs.length, minutes: gs.reduce((a, g) => a + g.minutes, 0) / gs.length, est });
  }
  return rows;
}

export { METRIC_BY_ID };
