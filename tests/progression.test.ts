// Progression: ladder LP math, rank mapping, mission checks from a MatchSummary, level, champion mastery, mission roll.
import { describe, expect, it } from 'vitest';
import type { MatchSummary, StatSample } from '../src/game/matchStats';
import { recordFromSummary } from '../src/stats/history';
import {
  L,
  MISSIONS,
  applyMatch,
  counts,
  dayKey,
  freshProgress,
  levelInfo,
  lpChange,
  masteryLevel,
  masteryScore,
  missionMetric,
  opponentTier,
  pickMissions,
  rankInfo,
  rollMissions,
  tierStart,
  weekKey,
  type Progress,
} from '../src/stats/progression';

const NOW = new Date(2026, 9, 28, 12, 0, 0).getTime(); // Wednesday

function sample(t: number, cs: number, wards = 0): StatSample {
  return { t, cs, gold: cs * 20, level: 10, wards };
}

function summary(o: Partial<MatchSummary> = {}): MatchSummary {
  // 25 min game, 7 CS/min, wards 0 -> 2 -> 1 -> 4 (5 placed)
  const samples: StatSample[] = [];
  const wards = [0, 2, 1, 4, 4];
  for (let t = 0; t <= 1500; t += 5) samples.push(sample(t, Math.floor((t / 60) * 7), wards[Math.min(4, Math.floor(t / 300))]));
  return {
    mode: 'classic',
    champion: 'mira',
    duration: 1500,
    samples,
    deaths: [1000],
    kills: [300, 600, 900],
    assists: 4,
    dealtChamp: [100, 200],
    dealtAll: [100, 200],
    taken: [50, 50],
    winner: 0,
    team: 0,
    trainer: null,
    ...o,
  };
}

describe('ladder rank mapping', () => {
  it('maps ladder points to tier, division and LP', () => {
    expect(rankInfo(0)).toMatchObject({ rank: 'iron', division: 4, lp: 0, lpMax: 100 });
    expect(rankInfo(99)).toMatchObject({ rank: 'iron', division: 4, lp: 99 });
    expect(rankInfo(100)).toMatchObject({ rank: 'iron', division: 3, lp: 0 });
    expect(rankInfo(400)).toMatchObject({ rank: 'bronze', division: 4, lp: 0 });
    expect(rankInfo(2799)).toMatchObject({ rank: 'diamond', division: 1, lp: 99 });
    expect(rankInfo(2800)).toMatchObject({ rank: 'master', division: 0, lp: 0, lpMax: 300 });
    expect(rankInfo(3100).rank).toBe('grandmaster');
    expect(rankInfo(3400)).toMatchObject({ rank: 'challenger', lpMax: null });
    expect(rankInfo(99999)).toMatchObject({ rank: 'challenger', tier: 9 });
  });

  it('tierStart is the inverse of rankInfo at tier borders', () => {
    for (let t = 0; t <= 9; t++) expect(rankInfo(tierStart(t))).toMatchObject({ tier: t, lp: 0 });
  });
});

describe('LP math', () => {
  const settled = L.placementGames; // no placement doubling
  it('a win with average play against equal bots gives the base value', () => {
    const tier = rankInfo(L.startLadder).tier;
    expect(lpChange(L.startLadder, settled, true, tier, tier).delta).toBe(L.winBase);
    expect(lpChange(L.startLadder, settled, false, tier, tier).delta).toBe(L.lossBase);
  });

  it('better performance gives more LP, worse gives less, capped', () => {
    const tier = 1;
    const base = lpChange(L.startLadder, settled, true, tier, tier).delta;
    expect(lpChange(L.startLadder, settled, true, tier + 2, tier).delta).toBeGreaterThan(base);
    expect(lpChange(L.startLadder, settled, true, tier - 1, tier).delta).toBeLessThan(base);
    expect(lpChange(L.startLadder, settled, true, 9, tier).perf).toBe(L.perfCap);
    expect(lpChange(L.startLadder, settled, false, 0, tier).perf).toBeLessThanOrEqual(0);
    // a loss with great play costs less than a loss with bad play
    expect(lpChange(L.startLadder, settled, false, 6, tier).delta).toBeGreaterThan(lpChange(L.startLadder, settled, false, 0, tier).delta);
  });

  it('harder bots give more, easier bots less', () => {
    const tier = 3;
    const l = tier * 400;
    expect(lpChange(l, settled, true, tier, 6).opp).toBe(L.oppCap);
    expect(lpChange(l, settled, true, tier, 0).opp).toBe(-L.oppCap);
    expect(lpChange(l, settled, true, tier, 5).delta).toBeGreaterThan(lpChange(l, settled, true, tier, 1).delta);
  });

  it('win always at least minWin and at most maxWin, loss within its bounds', () => {
    expect(lpChange(1600, settled, true, 0, 0).delta).toBeGreaterThanOrEqual(L.minWin);
    expect(lpChange(0, settled, true, 9, 9).delta).toBeLessThanOrEqual(L.maxWin);
    expect(lpChange(1600, settled, false, 9, 9).delta).toBeLessThanOrEqual(L.minLoss);
    expect(lpChange(1600, settled, false, 0, 0).delta).toBeGreaterThanOrEqual(L.maxLoss);
  });

  it('placement games count double', () => {
    expect(lpChange(L.startLadder, 0, true, null, null).delta).toBe(L.winBase * L.placementMult);
    expect(lpChange(L.startLadder, 0, true, null, null).placement).toBe(true);
  });

  it('ladder never drops below zero and can promote across tiers', () => {
    const p: Progress = { ...freshProgress(NOW), ladder: 5, games: 10 };
    const lost = applyMatch(p, summary({ winner: 1 }), recordFromSummary(summary({ winner: 1 }), NOW), null, NOW);
    expect(lost.next.ladder).toBe(0);
    const near: Progress = { ...freshProgress(NOW), ladder: 395, games: 10 };
    const won = applyMatch(near, summary(), recordFromSummary(summary(), NOW), null, NOW);
    expect(won.delta.lp.before.rank).toBe('iron');
    expect(won.delta.lp.after.rank).toBe('bronze');
  });

  it('opponentTier averages the enemy bots only', () => {
    const mk = (team: 0 | 1, rank: string, human = false) => ({ slot: 0, team, champion: 'mira', role: 'mid', summoners: ['a', 'b'], isHuman: human, ...(human ? {} : { bot: { rank } }) }) as never;
    expect(opponentTier([mk(0, '', true), mk(0, 'iron'), mk(1, 'gold'), mk(1, 'diamond')])).toBe(4.5);
    expect(opponentTier([mk(0, '', true)])).toBeNull();
  });
});

describe('missions from a match summary', () => {
  it('cs10 reads CS at 10:00 and ignores games shorter than 10 minutes', () => {
    expect(missionMetric({ metric: 'cs10' }, summary())).toBe(70);
    expect(missionMetric({ metric: 'cs10' }, summary({ duration: 500 }))).toBe(0);
  });

  it('counts ward placements (rises of the active ward count)', () => {
    expect(missionMetric({ metric: 'wardsPlaced' }, summary())).toBe(5);
  });

  it('noDeathBy: no death before the time and the game lasted that long', () => {
    expect(missionMetric({ metric: 'noDeathBy', at: 900 }, summary())).toBe(1); // death at 16:40
    expect(missionMetric({ metric: 'noDeathBy', at: 1200 }, summary())).toBe(0);
    expect(missionMetric({ metric: 'noDeathBy', at: 900 }, summary({ duration: 600, deaths: [] }))).toBe(0);
  });

  it('win, kills, cs, games', () => {
    expect(missionMetric({ metric: 'win' }, summary())).toBe(1);
    expect(missionMetric({ metric: 'win' }, summary({ winner: 1 }))).toBe(0);
    expect(missionMetric({ metric: 'kills' }, summary())).toBe(3);
    expect(missionMetric({ metric: 'cs' }, summary())).toBe(175);
    expect(missionMetric({ metric: 'games' }, summary())).toBe(1);
  });

  it('every mission in the data uses a known metric', () => {
    for (const m of MISSIONS) expect(missionMetric(m, summary()), m.id).toBeGreaterThanOrEqual(0);
    expect(MISSIONS.filter((m) => m.kind === 'daily').length).toBeGreaterThanOrEqual(3);
    expect(MISSIONS.filter((m) => m.kind === 'weekly').length).toBeGreaterThanOrEqual(3);
  });

  it('max missions complete in one game, sum missions accumulate over games', () => {
    const p: Progress = {
      ...freshProgress(NOW),
      games: 10,
      daily: [
        { id: 'cs10', progress: 0, done: false },
        { id: 'wards5', progress: 0, done: false },
        { id: 'kills5', progress: 0, done: false },
      ],
      weekly: [{ id: 'win3', progress: 0, done: false }],
    };
    const r1 = applyMatch(p, summary(), recordFromSummary(summary(), NOW), null, NOW);
    const done1 = r1.delta.missions.filter((m) => m.justDone).map((m) => m.id);
    expect(done1.sort()).toEqual(['cs10', 'wards5']);
    expect(r1.next.daily.find((m) => m.id === 'kills5')).toMatchObject({ progress: 3, done: false });
    expect(r1.delta.xp.parts.missions).toBe(60 + 50);
    const r2 = applyMatch(r1.next, summary(), recordFromSummary(summary(), NOW), null, NOW);
    expect(r2.delta.missions.filter((m) => m.justDone).map((m) => m.id)).toEqual(['kills5']); // 3 + 3 >= 5; done ones do not pay again
    expect(r2.delta.xp.parts.missions).toBe(40);
  });

  it('short and unfinished games do not count', () => {
    expect(counts(summary())).toBe(true);
    expect(counts(summary({ duration: 200 }))).toBe(false);
    expect(counts(summary({ winner: null }))).toBe(false);
    expect(counts(summary({ mode: 'laneOnly' }))).toBe(false);
  });

  it('daily / weekly pick is deterministic per period and rolls over', () => {
    const a = pickMissions('daily', dayKey(NOW));
    expect(pickMissions('daily', dayKey(NOW))).toEqual(a);
    expect(new Set(a.map((m) => m.id)).size).toBe(a.length);
    const p = { ...freshProgress(NOW), daily: a.map((m) => ({ ...m, progress: 1 })) };
    expect(rollMissions(p, NOW + 3600_000)).toBe(p); // same day (12:00 -> 13:00)
    const tomorrow = rollMissions(p, NOW + 86400_000);
    expect(tomorrow.day).not.toBe(p.day);
    expect(tomorrow.daily.every((m) => m.progress === 0)).toBe(true);
    expect(tomorrow.weekly).toEqual(p.weekly); // Wednesday -> Thursday: same week
    expect(weekKey(NOW)).toBe('2026-10-26'); // Monday
    expect(rollMissions(p, NOW + 5 * 86400_000).week).not.toBe(p.week);
  });
});

describe('account level and mastery', () => {
  it('levelInfo walks the XP curve', () => {
    expect(levelInfo(0)).toEqual({ level: 1, into: 0, need: 120 });
    expect(levelInfo(120)).toEqual({ level: 2, into: 0, need: 160 });
    expect(levelInfo(119).level).toBe(1);
    expect(levelInfo(120 + 160 + 200 + 5)).toMatchObject({ level: 4, into: 5 });
  });

  it('level-up shows in the delta', () => {
    const p: Progress = { ...freshProgress(NOW), games: 10, xp: 110 };
    const r = applyMatch(p, summary(), recordFromSummary(summary(), NOW), null, NOW);
    expect(r.delta.xp.before.level).toBe(1);
    expect(r.delta.xp.after.level).toBeGreaterThan(1);
    expect(r.next.xp).toBe(110 + r.delta.xp.gain);
  });

  it('mastery score rewards wins, kills, assists and CS, punishes deaths, floors at min', () => {
    expect(masteryScore(true, 5, 2, 3, 7)).toBeGreaterThan(masteryScore(false, 5, 2, 3, 7));
    expect(masteryScore(false, 0, 30, 0, 0)).toBe(5);
    expect(masteryScore(true, 0, 0, 0, 0)).toBe(40);
  });

  it('mastery level counts passed thresholds, 0..10', () => {
    expect(masteryLevel(0)).toBe(0);
    expect(masteryLevel(99)).toBe(0);
    expect(masteryLevel(100)).toBe(1);
    expect(masteryLevel(450)).toBe(3);
    expect(masteryLevel(99999)).toBe(10);
  });

  it('mastery accumulates per champion and survives the history cap (stored in progress)', () => {
    let p: Progress = { ...freshProgress(NOW), games: 10 };
    for (let i = 0; i < 3; i++) p = applyMatch(p, summary(), recordFromSummary(summary(), NOW + i), null, NOW).next;
    p = applyMatch(p, summary({ champion: 'brom', winner: 1 }), recordFromSummary(summary({ champion: 'brom', winner: 1 }), NOW), null, NOW).next;
    expect(p.mastery.mira).toMatchObject({ games: 3, wins: 3 });
    expect(p.mastery.brom).toMatchObject({ games: 1, wins: 0 });
    const delta = applyMatch(p, summary(), recordFromSummary(summary(), NOW), null, NOW).delta.mastery;
    expect(delta.after).toBe(delta.before + delta.gain);
    expect(delta.levelAfter).toBeGreaterThanOrEqual(delta.levelBefore);
  });
});
