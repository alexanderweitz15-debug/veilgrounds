// Player progression on top of the match history: ranked ladder vs bots (LP), daily / weekly missions checked from the
// post-game summary, account level (XP) and champion mastery. Pure functions + a thin load/save pair on the kv store
// (src/store/kv.ts, IndexedDB, try/catch inside). Numbers live in progressionData.json, texts in i18n (rank.*, prog.*,
// mission.*). Only full classic games count (>= ladder.minDurationS).
import { RANKS, type Rank } from '../ai/profiles/schema';
import { meanIndex } from '../game/profile';
import type { MatchSummary } from '../game/matchStats';
import { Rng } from '../sim/rng';
import type { PlayerSetup } from '../sim/types';
import { kvGet, kvSet } from '../store/kv';
import { recordFromSummary, type MatchRecord } from './history';
import data from './progressionData.json';

const PROGRESS_KEY = 'progress:v1';
export const L = data.ladder;
const X = data.xp;
const M = data.mastery;

export type MissionKind = 'daily' | 'weekly';
export type MissionFocus = 'farming' | 'vision' | 'survival' | 'macro' | 'fighting';
interface MissionDef {
  id: string;
  kind: MissionKind;
  metric: string;
  agg: 'max' | 'sum';
  target: number;
  xp: number;
  focus: MissionFocus;
  at?: number;
}
export const MISSIONS = data.missions as MissionDef[];
const defOf = (id: string): MissionDef | undefined => MISSIONS.find((m) => m.id === id);

export interface MissionState {
  id: string;
  progress: number;
  done: boolean;
}
export interface MasteryEntry {
  games: number;
  wins: number;
  score: number;
}
export const HONOR = data.honor;
/** Honor level from the number of honors given (1 + one per perLevel). */
export const honorLevel = (given: number): number => 1 + Math.floor(Math.max(0, given) / HONOR.perLevel);

export interface Progress {
  /** Honors given to teammates after games (older saves: absent). */
  honor?: number;
  /** Ladder points: 0 = Iron IV 0 LP; see rankInfo. */
  ladder: number;
  /** Ladder games played (placement bonus). */
  games: number;
  xp: number;
  mastery: Record<string, MasteryEntry>;
  /** Local date keys the missions belong to. */
  day: string;
  week: string;
  daily: MissionState[];
  weekly: MissionState[];
}

// ---------- ladder ----------

const divSpan = L.lpPerDivision * L.divisions;
const apexStart = L.divisionTiers * divSpan;
export const MAX_TIER = RANKS.length - 1;

export interface RankInfo {
  /** 0 Iron .. 9 Challenger = bot rank index. */
  tier: number;
  rank: Rank;
  /** 4 (lowest) .. 1 for Iron..Diamond, 0 above (Master+ have no divisions). */
  division: number;
  lp: number;
  /** LP needed for the next division / tier, null at Challenger (open end). */
  lpMax: number | null;
}

export function rankInfo(ladder: number): RankInfo {
  const l = Math.max(0, Math.floor(ladder));
  if (l < apexStart) {
    const tier = Math.floor(l / divSpan);
    const inTier = l - tier * divSpan;
    const step = Math.floor(inTier / L.lpPerDivision);
    return { tier, rank: RANKS[tier]!, division: L.divisions - step, lp: inTier - step * L.lpPerDivision, lpMax: L.lpPerDivision };
  }
  const apex = Math.min(MAX_TIER - L.divisionTiers, Math.floor((l - apexStart) / L.apexWidth));
  const tier = L.divisionTiers + apex;
  const lp = l - apexStart - apex * L.apexWidth;
  return { tier, rank: RANKS[tier]!, division: 0, lp, lpMax: tier === MAX_TIER ? null : L.apexWidth };
}

/** Ladder value where a tier starts. */
export const tierStart = (tier: number): number => (tier < L.divisionTiers ? tier * divSpan : apexStart + (tier - L.divisionTiers) * L.apexWidth);

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export interface LpChange {
  delta: number;
  result: number;
  perf: number;
  opp: number;
  placement: boolean;
}

/**
 * LP change of one finished ladder game. `perfIndex` = mean rank calibration of the match (0..9, null = not measured),
 * `oppTier` = mean bot rank of the enemy team. Play above the own tier and harder bots give more. A win is worth
 * minWin..maxWin, a loss costs |minLoss|..|maxLoss|. Placement games count double.
 */
export function lpChange(ladder: number, games: number, win: boolean, perfIndex: number | null, oppTier: number | null): LpChange {
  const tier = rankInfo(ladder).tier;
  const result = win ? L.winBase : L.lossBase;
  const perf = perfIndex === null ? 0 : clamp(Math.round((perfIndex - tier) * L.perfPerIndex), -L.perfCap, L.perfCap);
  const opp = oppTier === null ? 0 : clamp(Math.round((oppTier - tier) * L.oppPerTier), -L.oppCap, L.oppCap);
  const sum = result + perf + opp;
  let delta = win ? clamp(sum, L.minWin, L.maxWin) : clamp(sum, L.maxLoss, L.minLoss);
  const placement = games < L.placementGames;
  if (placement) delta *= L.placementMult;
  return { delta, result, perf, opp, placement };
}

/** Mean bot rank index of the enemy team (null without bots). */
export function opponentTier(players: readonly PlayerSetup[]): number | null {
  const me = players.find((p) => p.isHuman)?.team ?? 0;
  const v = players.filter((p) => !p.isHuman && p.bot && p.team !== me).map((p) => RANKS.indexOf(p.bot!.rank));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

// ---------- account level ----------

export interface LevelInfo {
  level: number;
  /** XP into the current level / needed for the next. */
  into: number;
  need: number;
}
export function levelInfo(xp: number): LevelInfo {
  let level = 1;
  let left = Math.max(0, Math.floor(xp));
  for (;;) {
    const need = X.levelBase + X.levelStep * (level - 1);
    if (left < need) return { level, into: left, need };
    left -= need;
    level++;
  }
}

// ---------- champion mastery ----------

/** Mastery points of one finished game. */
export function masteryScore(win: boolean, kills: number, deaths: number, assists: number, csPerMin: number): number {
  const v = M.base + (win ? M.win : 0) + kills * M.kill + assists * M.assist + deaths * M.death + Math.round(csPerMin * M.csPerMin);
  return Math.max(M.min, v);
}
/** Mastery level 0..10 from the accumulated score. */
export const masteryLevel = (score: number): number => M.thresholds.filter((x) => score >= x).length;
export const MASTERY_MAX = M.thresholds.length;
export const masteryNext = (score: number): number | null => M.thresholds[masteryLevel(score)] ?? null;

// ---------- missions ----------

const pad = (n: number): string => String(n).padStart(2, '0');
const dateKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const dayKey = (now: number): string => dateKey(new Date(now));
/** Monday of the local week. */
export function weekKey(now: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dateKey(d);
}

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** Deterministic mission pick for a day / week key (same mission set for the whole period). */
export function pickMissions(kind: MissionKind, key: string): MissionState[] {
  const pool = MISSIONS.filter((m) => m.kind === kind);
  const rng = new Rng(hash(`${kind}:${key}`));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, data.missionCount[kind]).map((m) => ({ id: m.id, progress: 0, done: false }));
}

/** Value of a mission metric in one game (from the post-game summary only). */
export function missionMetric(def: Pick<MissionDef, 'metric' | 'at'>, s: MatchSummary): number {
  const cs = s.samples;
  const last = cs[cs.length - 1];
  switch (def.metric) {
    case 'cs10': {
      if (s.duration < 600) return 0;
      let v = 0;
      for (const p of cs) if (p.t <= 600) v = p.cs;
      return v;
    }
    case 'cs':
      return last?.cs ?? 0;
    case 'kills':
      return s.kills.length;
    case 'win':
      return s.winner !== null && s.winner === s.team ? 1 : 0;
    case 'games':
      return 1;
    case 'wardsPlaced': {
      // active-ward count rises when one is placed: sum of the rises (5 s sampling)
      let n = 0;
      for (let i = 1; i < cs.length; i++) n += Math.max(0, (cs[i]!.wards ?? 0) - (cs[i - 1]!.wards ?? 0));
      return n + (cs[0]?.wards ?? 0);
    }
    case 'noDeathBy': {
      const at = def.at ?? 900;
      return s.duration >= at && s.deaths.every((d) => d >= at) ? 1 : 0;
    }
    default:
      return 0;
  }
}

export interface MissionDelta {
  id: string;
  kind: MissionKind;
  before: number;
  after: number;
  target: number;
  xp: number;
  /** Completed by this game. */
  justDone: boolean;
}

function advance(list: readonly MissionState[], s: MatchSummary): { next: MissionState[]; deltas: MissionDelta[] } {
  const next: MissionState[] = [];
  const deltas: MissionDelta[] = [];
  for (const m of list) {
    const def = defOf(m.id);
    if (!def || m.done) {
      next.push(m);
      continue;
    }
    const v = missionMetric(def, s);
    const progress = Math.min(def.target, def.agg === 'sum' ? m.progress + v : Math.max(m.progress, v));
    const done = progress >= def.target;
    next.push({ id: m.id, progress, done });
    if (v > 0) deltas.push({ id: m.id, kind: def.kind, before: m.progress, after: progress, target: def.target, xp: def.xp, justDone: done });
  }
  return { next, deltas };
}

// ---------- state ----------

export function freshProgress(now: number): Progress {
  const day = dayKey(now);
  const week = weekKey(now);
  return { ladder: L.startLadder, games: 0, xp: 0, mastery: {}, day, week, daily: pickMissions('daily', day), weekly: pickMissions('weekly', week) };
}

/** Missions of an expired day / week are replaced; unknown mission ids (removed from the data) force a new pick. */
export function rollMissions(p: Progress, now: number): Progress {
  const day = dayKey(now);
  const week = weekKey(now);
  const ok = (l: readonly MissionState[], kind: MissionKind): boolean => l.length === data.missionCount[kind] && l.every((m) => defOf(m.id)?.kind === kind);
  const dailyNew = p.day !== day || !ok(p.daily, 'daily');
  const weeklyNew = p.week !== week || !ok(p.weekly, 'weekly');
  if (!dailyNew && !weeklyNew) return p;
  return { ...p, day, week, daily: dailyNew ? pickMissions('daily', day) : p.daily, weekly: weeklyNew ? pickMissions('weekly', week) : p.weekly };
}

export interface ProgressDelta {
  lp: LpChange & { before: RankInfo; after: RankInfo };
  xp: { gain: number; parts: { game: number; win: number; missions: number }; before: LevelInfo; after: LevelInfo };
  missions: MissionDelta[];
  mastery: { champion: string; gain: number; before: number; after: number; levelBefore: number; levelAfter: number };
}

/** Does this finished game count for the progression? Classic games of at least minDurationS. */
export const counts = (s: MatchSummary): boolean => s.mode === 'classic' && s.duration >= L.minDurationS && s.winner !== null;

/** Applies one finished classic game. `rec` = recordFromSummary(s) (calibration), `opp` = opponentTier(config.players). */
export function applyMatch(prev: Progress, s: MatchSummary, rec: MatchRecord, opp: number | null, now: number): { next: Progress; delta: ProgressDelta } {
  const p = rollMissions(prev, now);
  const win = s.winner === s.team;
  const lp = lpChange(p.ladder, p.games, win, meanIndex(rec.calibration), opp);
  const ladder = Math.max(0, p.ladder + lp.delta);
  const d = advance(p.daily, s);
  const w = advance(p.weekly, s);
  const missions = [...d.deltas, ...w.deltas];
  const missionXp = missions.filter((m) => m.justDone).reduce((a, m) => a + m.xp, 0);
  const parts = { game: X.perGame, win: win ? X.win : 0, missions: missionXp };
  const gain = parts.game + parts.win + parts.missions;
  const csPerMin = rec.csPerMin;
  const mGain = masteryScore(win, rec.kills, rec.deaths, rec.assists ?? 0, csPerMin);
  const old = p.mastery[s.champion] ?? { games: 0, wins: 0, score: 0 };
  const mNew = { games: old.games + 1, wins: old.wins + (win ? 1 : 0), score: old.score + mGain };
  const next: Progress = { ...p, ladder, games: p.games + 1, xp: p.xp + gain, mastery: { ...p.mastery, [s.champion]: mNew }, daily: d.next, weekly: w.next };
  return {
    next,
    delta: {
      lp: { ...lp, before: rankInfo(p.ladder), after: rankInfo(ladder) },
      xp: { gain, parts, before: levelInfo(p.xp), after: levelInfo(next.xp) },
      missions,
      mastery: { champion: s.champion, gain: mGain, before: old.score, after: mNew.score, levelBefore: masteryLevel(old.score), levelAfter: masteryLevel(mNew.score) },
    },
  };
}

// ---------- storage ----------

/** Loaded progress with expired missions replaced (a fresh start when nothing is stored or storage is unavailable). */
export async function loadProgress(now = Date.now()): Promise<Progress> {
  const raw = await kvGet<Partial<Progress>>(PROGRESS_KEY);
  const base = freshProgress(now);
  if (!raw || typeof raw.ladder !== 'number') return base;
  const p = rollMissions({ ...base, ...raw, mastery: raw.mastery ?? {}, daily: raw.daily ?? [], weekly: raw.weekly ?? [] }, now);
  masteryCache = p.mastery;
  ladderCache = p.ladder;
  return p;
}

/** Mastery of the last loaded progress (lobby badges read it synchronously; empty until a load). */
let masteryCache: Record<string, MasteryEntry> = {};
let ladderCache = L.startLadder;
/** Bot rank index (0..9) of the player's current ladder rank (lobby shortcut play at my rank). */
export const cachedTier = (): number => rankInfo(ladderCache).tier;
export const cachedMasteryLevel = (champion: string): number => masteryLevel(masteryCache[champion]?.score ?? 0);

/** Counts one finished game: load, apply, save. Null when the game does not count. */
export async function recordMatch(s: MatchSummary, opp: number | null, now = Date.now()): Promise<ProgressDelta | null> {
  if (!counts(s)) return null;
  const { next, delta } = applyMatch(await loadProgress(now), s, recordFromSummary(s, now), opp, now);
  masteryCache = next.mastery;
  ladderCache = next.ladder;
  await kvSet(PROGRESS_KEY, next);
  return delta;
}

/** One honor vote after a game: small XP reward, counts towards the honor level. Returns the new honor count. */
export async function giveHonor(now = Date.now()): Promise<number> {
  const p = await loadProgress(now);
  const honor = (p.honor ?? 0) + 1;
  await kvSet(PROGRESS_KEY, { ...p, honor, xp: p.xp + HONOR.xp });
  return honor;
}
