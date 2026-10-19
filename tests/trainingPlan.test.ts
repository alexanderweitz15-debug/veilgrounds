// D5: rank calibration adapter, match history, training plan.
import { describe, expect, it } from 'vitest';
import { calibrateMatch, rankIndexOf, targetsOf } from '../src/stats/rankCalibration';
import { addRecord, recordFromSummary, series, streaks, type MatchRecord } from '../src/stats/history';
import { trainingPlan } from '../src/stats/trainingPlan';
import { TRAINER_MODES } from '../src/game/modes';
import { SCENARIO_IDS } from '../src/sim/trainer/scenarios';
import data from '../src/stats/trainingData.json';
import type { MatchSummary } from '../src/game/matchStats';

const DAY = 86400000;

function summary(o: Partial<MatchSummary> & { csAt: (t: number) => number }): MatchSummary {
  const duration = o.duration ?? 1800;
  const samples = [];
  for (let t = 0; t <= duration; t += 5) samples.push({ t, cs: Math.round(o.csAt(t)), gold: 500 + t * 7, level: 1 + Math.min(17, Math.floor(t / 100)) });
  return { mode: 'classic', champion: 'mira', duration, samples, deaths: [], kills: [], dealtChamp: [1000], dealtAll: [], taken: [], winner: 0, team: 0, trainer: null, ...o };
}

describe('rank calibration (local adapter)', () => {
  it('interpolates between rank targets and clamps at both ends', () => {
    expect(rankIndexOf(10, [20, 40, 60], true)).toBe(0);
    expect(rankIndexOf(50, [20, 40, 60], true)).toBe(1.5);
    expect(rankIndexOf(99, [20, 40, 60], true)).toBe(2);
    expect(rankIndexOf(5, [9, 7, 5], false)).toBe(2); // fewer deaths = better
    const t = targetsOf('farming');
    expect(t.length).toBe(10);
    expect(calibrateMatch({ cs10: t[3]! }).farming).toMatchObject({ rank: 'gold', index: 3 });
    expect(calibrateMatch({ cs10: 1 }).farming!.rank).toBe('iron');
    const top = calibrateMatch({ cs10: 999 }).farming!;
    expect(top.rank).toBe('challenger');
    expect('next' in top).toBe(false);
  });
});

describe('history', () => {
  it('builds metrics from the post-game summary, calibrates only full classic games', () => {
    const r = recordFromSummary(summary({ csAt: (t) => (t / 60) * 7, deaths: [100, 900, 1500], kills: [400] }), 1000);
    expect(r.cs10).toBeCloseTo(70, 0);
    expect(r.csPerMin).toBeCloseTo(7, 1);
    expect(r.deathsPer30).toBeCloseTo(3, 5);
    expect(r.win).toBe(true);
    expect(Object.keys(r.calibration).sort()).toEqual(['economy', 'farming', 'fighting', 'survival']);
    const tr = recordFromSummary(summary({ mode: 'lastHit', duration: 300, csAt: (t) => t / 10, winner: null, trainer: { kind: 'lastHit', time: 300, duration: 300, done: true, score: 72, grade: 'B', stats: [] } }), 2000);
    expect(tr.calibration).toEqual({});
    expect(tr.trainer).toMatchObject({ kind: 'lastHit', score: 72 });
    expect(tr.win).toBeNull();
  });

  it('caps the history, builds series and streaks', () => {
    let h: MatchRecord[] = [];
    for (let i = 0; i < 5; i++) h = addRecord(h, recordFromSummary(summary({ csAt: (t) => (t / 60) * (5 + i), winner: i < 2 ? 1 : 0 }), i * DAY), 4);
    expect(h.length).toBe(4);
    expect(series(h, 'cs10').map((p) => Math.round(p.v))).toEqual([60, 70, 80, 90]);
    const s = streaks(h, 4 * DAY + 3600000);
    expect(s).toMatchObject({ win: 3, bestWin: 3, csUp: 3, days: 4 });
  });
});

describe('training plan', () => {
  it('drills are valid trainer modes / scenarios', () => {
    for (const list of Object.values((data as unknown as { drills: Record<string, { mode: string; opts: { scenario?: string } }[]> }).drills)) {
      expect(list.length).toBeGreaterThanOrEqual(3);
      for (const d of list) {
        expect(TRAINER_MODES).toContain(d.mode);
        if (d.opts.scenario) expect(SCENARIO_IDS as readonly string[]).toContain(d.opts.scenario);
      }
    }
  });

  it('three suggestions from the weakest categories of the last 10 games; provisional below 3 games', () => {
    expect(trainingPlan([]).items.length).toBe(3);
    expect(trainingPlan([]).provisional).toBe(true);
    // strong farmer who dies a lot: survival must come first
    let h: MatchRecord[] = [];
    for (let i = 0; i < 12; i++) h = addRecord(h, recordFromSummary(summary({ csAt: (t) => (t / 60) * 9, deaths: Array.from({ length: 14 }, (_, k) => 60 + k * 120) }), i * 1000));
    const p = trainingPlan(h);
    expect(p.matches).toBe(10);
    expect(p.provisional).toBe(false);
    expect(p.standings[0]!.category).toBe('survival');
    expect(p.items.map((x) => x.category)).toEqual(['survival', 'survival', p.standings[1]!.category]);
    expect(p.items[0]).toMatchObject({ mode: 'dodge', reasonKey: 'plan.reason.survival' });
    expect(p.items[0]!.params.rank).toBe('iron');
  });
});
