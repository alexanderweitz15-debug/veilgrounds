// S1 / FEATURE-GAP 4.8: profile aggregation (src/game/profile.ts) on top of the match history records.
import { describe, expect, it } from 'vitest';
import { championStats, currentEstimate, kdaOf, overview, rankOfIndex, rankTrend, recent } from '../src/game/profile';
import { recordFromSummary, streaks, type MatchRecord } from '../src/stats/history';
import { calibrateMatch } from '../src/stats/rankCalibration';
import type { MatchSummary } from '../src/game/matchStats';

const DAY = 86400000;

function rec(o: Partial<MatchRecord> & { at: number }): MatchRecord {
  const m = { cs10: 60, csPerMin: 6, goldPerMin: 380, deathsPer30: 5, killsPer30: 5 };
  return {
    id: `r${o.at}`,
    mode: 'classic',
    champion: 'mira',
    durationS: 1800,
    win: true,
    kills: 5,
    deaths: 4,
    assists: 6,
    dmgChampPerMin: 500,
    ...m,
    calibration: calibrateMatch(m),
    ...o,
  };
}

describe('profile aggregation', () => {
  const h: MatchRecord[] = [
    rec({ at: 1 * DAY, champion: 'mira', win: true, kills: 10, deaths: 2, assists: 8, csPerMin: 8, durationS: 1200 }),
    rec({ at: 2 * DAY, champion: 'mira', win: false, kills: 2, deaths: 8, assists: 4, csPerMin: 4, durationS: 2400 }),
    rec({ at: 3 * DAY, champion: 'brom', win: true, kills: 1, deaths: 0, assists: 12 }),
    rec({ at: 4 * DAY, champion: 'brom', mode: 'laneOnly', win: null }),
    rec({ at: 5 * DAY, champion: 'wren', mode: 'duel' as never, win: true, trainer: { kind: 'laneDuel', score: 80, grade: 'B' }, calibration: {} }),
  ];

  it('KDA is (K + A) / max(1, D)', () => {
    expect(kdaOf(10, 2, 8)).toBe(9);
    expect(kdaOf(1, 0, 12)).toBe(13); // no division by zero
  });

  it('per-champion stats count classic games only, sorted by games', () => {
    const c = championStats(h);
    expect(c.map((x) => x.champion)).toEqual(['mira', 'brom']);
    const mira = c[0]!;
    expect(mira).toMatchObject({ games: 2, decided: 2, wins: 1, winRate: 0.5, kills: 12, deaths: 10, assists: 12 });
    expect(mira.kda).toBeCloseTo(2.4);
    // CS/min is weighted by game length: (8 * 20 + 4 * 40) / 60
    expect(mira.csPerMin).toBeCloseTo(320 / 60);
    expect(c[1]).toMatchObject({ champion: 'brom', games: 1, wins: 1 });
  });

  it('overview: games, wins, losses, win rate, totals', () => {
    expect(overview(h)).toMatchObject({ games: 3, decided: 3, wins: 2, losses: 1, kills: 13, deaths: 10, assists: 24 });
    expect(overview(h).winRate).toBeCloseTo(2 / 3);
    expect(overview([])).toMatchObject({ games: 0, winRate: 0, kda: 0 });
  });

  it('records without assists (older history) count as 0 and do not break the sums', () => {
    const old = rec({ at: 1, assists: undefined });
    expect(overview([old]).assists).toBe(0);
    expect(championStats([old])[0]!.kda).toBeCloseTo(5 / 4);
  });

  it('streaks come from the history module (win run, best run)', () => {
    const s = streaks(h, 5 * DAY);
    expect(s.win).toBe(2); // trainer duel wins count for the streak, the undecided practice game is skipped
    expect(s.bestWin).toBe(2);
  });

  it('recent lists newest first and caps', () => {
    expect(recent(h, 2).map((r) => r.at)).toEqual([5 * DAY, 4 * DAY]);
  });
});

describe('rank estimate trend', () => {
  // a game whose four categories all sit at fractional rank index `i` (synthetic calibration)
  const at = (i: number, t: number): MatchRecord => {
    const cal = Object.fromEntries(['farming', 'economy', 'survival', 'fighting'].map((c) => [c, { index: i, rank: rankOfIndex(i), value: 1 }]));
    return rec({ at: t, calibration: cal });
  };

  it('one point per calibrated game, games without calibration are skipped', () => {
    const trend = rankTrend([at(2, 1), rec({ at: 2, calibration: {} }), at(4, 3)]);
    expect(trend.map((p) => p.at)).toEqual([1, 3]);
    expect(trend[0]!.index).toBeCloseTo(2, 5);
    expect(trend[0]!.rank).toBe('silver');
    expect(trend[1]!.rank).toBe('platinum');
    expect(Object.keys(trend[0]!.cat).sort()).toEqual(['economy', 'farming', 'fighting', 'survival']);
  });

  it('current estimate averages the last window and reports the change against the window before', () => {
    const trend = rankTrend([at(2, 1), at(2, 2), at(2, 3), at(4, 4), at(4, 5), at(4, 6)]);
    const e = currentEstimate(trend, 3)!;
    expect(e.games).toBe(3);
    expect(e.index).toBeCloseTo(4, 5);
    expect(e.rank).toBe('platinum');
    expect(e.delta).toBeCloseTo(2, 5);
    expect(currentEstimate(trend.slice(0, 2), 3)!.delta).toBeNull();
    expect(currentEstimate([])).toBeNull();
  });

  it('rankOfIndex rounds and clamps', () => {
    expect(rankOfIndex(-3)).toBe('iron');
    expect(rankOfIndex(3.4)).toBe('gold');
    expect(rankOfIndex(99)).toBe('challenger');
  });

  it('assists travel from the post-game summary into the history record', () => {
    const s: MatchSummary = { mode: 'classic', champion: 'mira', duration: 700, samples: [{ t: 0, cs: 0, gold: 500, level: 1 }, { t: 700, cs: 70, gold: 5000, level: 9 }], deaths: [100], kills: [200, 300], assists: 7, dealtChamp: [1000], dealtAll: [], taken: [], winner: 0, team: 0, trainer: null };
    expect(recordFromSummary(s, 1).assists).toBe(7);
    const { assists: _a, ...noAssist } = s;
    expect(recordFromSummary(noAssist, 1).assists).toBeUndefined();
  });
});
