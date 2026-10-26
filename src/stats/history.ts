// D5: match history over several games (IndexedDB key-value store, src/store/kv.ts): one record per finished match or
// trainer run, metrics per record, series per metric for charts, streaks. Pure functions + a thin load/save pair.
import type { MatchSummary } from '../game/matchStats';
import { kvGet, kvSet } from '../store/kv';
import { calibrateMatch, type MatchMetrics, type RankCalibration } from './rankCalibration';
import data from './trainingData.json';

const HISTORY_KEY = 'history:v1';
export const HISTORY_CAP = (data as { historyCap: number }).historyCap;

export interface MatchRecord extends MatchMetrics {
  /** Unique per record (time + champion). */
  id: string;
  /** Wall-clock ms when the record was made. */
  at: number;
  mode: MatchSummary['mode'];
  champion: string;
  durationS: number;
  /** Classic games: true / false, trainer runs: duel/arena result, else null. */
  win: boolean | null;
  kills: number;
  deaths: number;
  dmgChampPerMin: number;
  /** metrics: per-trainer measurements (dodge: reactionMs, panic, unnecessary, hitRate; only those that were measured). */
  trainer?: { kind: string; score: number; grade: string; scenario?: string; metrics?: Record<string, number> };
  calibration: RankCalibration;
}

export type Metric = 'cs10' | 'csPerMin' | 'goldPerMin' | 'deathsPer30' | 'killsPer30' | 'dmgChampPerMin' | 'trainerScore';

/** Value of a sampled curve at time t (linear between samples, last value after the end). */
function sampleAt(samples: { t: number; v: number }[], t: number): number {
  if (!samples.length) return 0;
  if (t <= samples[0]!.t) return samples[0]!.v;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    if (t <= b.t) return a.v + ((b.v - a.v) * (t - a.t)) / Math.max(1e-9, b.t - a.t);
  }
  return samples[samples.length - 1]!.v;
}

/** Trainer-specific measurements of a finished run for the history (only values that were measured). */
export function trainerMetrics(tr: NonNullable<MatchSummary['trainer']>): Record<string, number> | undefined {
  const d = tr.dodge;
  if (!d) return undefined;
  const m: Record<string, number> = { panic: d.panic, unnecessary: d.unnecessary };
  if (d.reactionMs >= 0) m.reactionMs = d.reactionMs;
  if (d.hitRate >= 0) m.hitRate = d.hitRate;
  return m;
}

/** Metrics of one finished match / trainer run from the post-game summary (client snapshots only). */
export function recordFromSummary(s: MatchSummary, at: number): MatchRecord {
  const min = Math.max(1 / 60, s.duration / 60);
  const cs = s.samples.map((p) => ({ t: p.t, v: p.cs }));
  const gold = s.samples.map((p) => ({ t: p.t, v: p.gold }));
  const last = s.samples[s.samples.length - 1];
  // CS at 10:00 only exists for games that lasted 10 minutes; shorter runs extrapolate the rate
  const cs10 = s.duration >= 600 ? sampleAt(cs, 600) : ((last?.cs ?? 0) / min) * 10;
  const metrics: MatchMetrics = {
    cs10,
    csPerMin: (last?.cs ?? 0) / min,
    goldPerMin: (sampleAt(gold, s.duration) - (gold[0]?.v ?? 0)) / min,
    deathsPer30: (s.deaths.length * 30) / min,
    killsPer30: (s.kills.length * 30) / min,
  };
  const classic = s.mode === 'classic';
  const tr = s.trainer;
  const trMetrics = tr ? trainerMetrics(tr) : undefined;
  return {
    id: `${at.toString(36)}-${s.champion}`,
    at,
    mode: s.mode,
    champion: s.champion,
    durationS: s.duration,
    win: s.winner !== null ? s.winner === s.team : tr?.won ?? null,
    kills: s.kills.length,
    deaths: s.deaths.length,
    dmgChampPerMin: s.dealtChamp.reduce((a, b) => a + b, 0) / min,
    ...(tr ? { trainer: { kind: tr.kind, score: tr.score, grade: tr.grade, ...(tr.scenario ? { scenario: tr.scenario } : {}), ...(trMetrics ? { metrics: trMetrics } : {}) } } : {}),
    ...metrics,
    // only full games calibrate against the rank tables (trainer runs are not comparable)
    calibration: classic && s.duration >= 600 ? calibrateMatch(metrics) : {},
  };
}

/** New history with `rec` appended (oldest dropped beyond the cap). */
export function addRecord(history: readonly MatchRecord[], rec: MatchRecord, cap = HISTORY_CAP): MatchRecord[] {
  const out = [...history.filter((r) => r.id !== rec.id), rec].sort((a, b) => a.at - b.at);
  return out.slice(Math.max(0, out.length - cap));
}

/** Chart series of one metric (records without a value are skipped). */
export function series(history: readonly MatchRecord[], metric: Metric, mode?: MatchRecord['mode']): { at: number; v: number }[] {
  return history
    .filter((r) => !mode || r.mode === mode)
    .map((r) => ({ at: r.at, v: metric === 'trainerScore' ? r.trainer?.score ?? NaN : r[metric] }))
    .filter((p) => Number.isFinite(p.v));
}

/** Values of one trainer measurement over the runs of a trainer, oldest first ('score' = the run score). */
export function trainerSeries(history: readonly MatchRecord[], kind: string, key: string): number[] {
  const out: number[] = [];
  for (const r of history) {
    if (r.trainer?.kind !== kind) continue;
    const v = key === 'score' ? r.trainer.score : r.trainer.metrics?.[key];
    if (v !== undefined && Number.isFinite(v)) out.push(v);
  }
  return out;
}

/** History without the record this run was just saved as (same kind, score and length, within windowMs of `run.at`). */
export function withoutRun(history: readonly MatchRecord[], run: { kind: string; score: number; durationS: number; at: number }, windowMs = 120000): MatchRecord[] {
  return history.filter((r) => !(r.trainer?.kind === run.kind && r.trainer.score === run.score && r.durationS === run.durationS && Math.abs(r.at - run.at) < windowMs));
}

export interface Trend {
  /** Previous runs (oldest first, at most `n`) and this run's value (undefined = not measured). */
  past: number[];
  now: number | undefined;
  /** now minus the mean of the past runs, undefined without both. */
  delta: number | undefined;
}

/** Trend of one measurement: the last `n` earlier runs of the trainer against the current run. */
export function trainerTrend(history: readonly MatchRecord[], kind: string, key: string, now: number | undefined, n = 8): Trend {
  const past = trainerSeries(history, kind, key).slice(-n);
  const delta = now !== undefined && past.length ? now - past.reduce((a, b) => a + b, 0) / past.length : undefined;
  return { past, now, delta };
}

export interface Streaks {
  /** Current consecutive wins (classic games and duels), best ever. */
  win: number;
  bestWin: number;
  /** Consecutive classic games whose CS at 10 did not drop below the previous one. */
  csUp: number;
  /** Consecutive days (local calendar) with at least one record, ending today or yesterday. */
  days: number;
}

export function streaks(history: readonly MatchRecord[], now: number): Streaks {
  let win = 0;
  let bestWin = 0;
  let run = 0;
  for (const r of history) {
    if (r.win === null) continue;
    run = r.win ? run + 1 : 0;
    bestWin = Math.max(bestWin, run);
  }
  win = run;
  const classic = history.filter((r) => r.mode === 'classic');
  let csUp = 0;
  for (let i = classic.length - 1; i > 0 && classic[i]!.cs10 >= classic[i - 1]!.cs10; i--) csUp++;
  const day = (t: number): number => {
    const d = new Date(t);
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  };
  const days = new Set(history.map((r) => day(r.at)));
  let d = day(now);
  if (!days.has(d)) d--;
  let n = 0;
  while (days.has(d)) {
    n++;
    d--;
  }
  return { win, bestWin, csUp, days: n };
}

export async function loadHistory(): Promise<MatchRecord[]> {
  return (await kvGet<MatchRecord[]>(HISTORY_KEY)) ?? [];
}

/** Appends one record and saves (no-op when IndexedDB is unavailable). Returns the new history. */
export async function saveRecord(rec: MatchRecord): Promise<MatchRecord[]> {
  const next = addRecord(await loadHistory(), rec);
  await kvSet(HISTORY_KEY, next);
  return next;
}
