import { describe, expect, it } from 'vitest';
import {
  LT, autoDamage, dropRate, hitDelay, isMissedCs, killWindow, lastHitMark, nextRank, perMin, projectCs10, pushSample, rankGoal, widgetVisible,
  type HpSample,
} from '../src/ui/liveTrainingCalc';
import { Kind, type SimEvent } from '../src/sim/types';

const death = (over: Partial<Extract<SimEvent, { e: 'death' }>> = {}): SimEvent => ({ e: 'death', eid: 9, kind: Kind.MinionMelee, team: 1, killer: 5, x: 100, y: 0, ...over });

describe('CS@10 projection', () => {
  it('is hidden before enough farming time', () => {
    expect(projectCs10(3, 60)).toBeNull();
    expect(projectCs10(3, LT.farmStartSec + LT.minSpanSec - 1)).toBeNull();
  });
  it('carries the rate since the first wave to 10:00', () => {
    const t = LT.farmStartSec + 100;
    expect(projectCs10(20, t)).toBeCloseTo(20 + (20 / 100) * (600 - t), 6);
  });
  it('uses the real value after 10:00', () => {
    expect(projectCs10(70, 610, 62)).toBe(62);
    expect(projectCs10(70, 700)).toBe(70);
  });
  it('per-minute rates wait for the first minute', () => {
    expect(perMin(5, 30)).toBeNull();
    expect(perMin(30, 300)).toBe(6);
  });
});

describe('missed CS', () => {
  it('counts enemy minions that died near me without my kill', () => {
    expect(isMissedCs(death(), 1, 0, 0, 0)).toBe(true);
  });
  it('ignores my own last hits, own-team minions, far deaths and non-minions', () => {
    expect(isMissedCs(death({ killer: 1 }), 1, 0, 0, 0)).toBe(false);
    expect(isMissedCs(death({ team: 0 }), 1, 0, 0, 0)).toBe(false);
    expect(isMissedCs(death({ x: LT.missRangeU + 1 }), 1, 0, 0, 0)).toBe(false);
    expect(isMissedCs(death({ kind: Kind.Champion }), 1, 0, 0, 0)).toBe(false);
    expect(isMissedCs({ e: 'gold', eid: 1, amount: 20, x: 0, y: 0 }, 1, 0, 0, 0)).toBe(false);
  });
  it('a masked killer (-1) still counts as missed', () => {
    expect(isMissedCs(death({ killer: -1 }), 1, 0, 0, 0)).toBe(true);
  });
});

describe('HP history', () => {
  it('measures the HP drop per second and forgets old samples', () => {
    const b: HpSample[] = [];
    pushSample(b, 0, 300);
    expect(dropRate(b)).toBe(0);
    pushSample(b, 0.5, 250);
    expect(dropRate(b)).toBeCloseTo(100, 6);
    pushSample(b, LT.hpWindowSec + 0.3, 100);
    expect(b.length).toBe(2); // the first sample fell out of the window
    pushSample(b, 5, 400); // healed: no negative rate
    expect(dropRate(b)).toBe(0);
  });
});

describe('last-hit timing', () => {
  it('armor reduces the auto damage', () => {
    expect(autoDamage(100, 0)).toBe(100);
    expect(autoDamage(100, 100)).toBe(50);
  });
  it('ranged hits need flight time', () => {
    expect(hitDelay(150, 900)).toBe(LT.windupSec);
    expect(hitDelay(550, 900)).toBeCloseTo(LT.windupSec + 900 / LT.projectileSpeed, 6);
  });
  it('kill window: opens when HP reaches the damage, closes at death', () => {
    expect(killWindow(200, 80, 100)).toEqual({ from: 1.2, to: 2 });
    expect(killWindow(60, 80, 0)).toEqual({ from: 0, to: Infinity });
    expect(killWindow(200, 80, 0).from).toBe(Infinity);
  });
  it('kill when the hit lands inside the window', () => {
    expect(lastHitMark(70, 80, 0, 0.2)).toEqual({ state: 'kill', frac: 1 });
    expect(lastHitMark(200, 80, 100, 1.5).state).toBe('kill'); // window 1.2..2.0
  });
  it('soon / wait before the window, late after it', () => {
    expect(lastHitMark(200, 80, 100, 0.8).state).toBe('soon'); // opens in 0.4 s
    expect(lastHitMark(400, 80, 100, 0.2).state).toBe('wait');
    expect(lastHitMark(150, 80, 100, 1.7).state).toBe('late'); // dead at 1.5 s
  });
  it('bar fill is damage over the HP left at the hit', () => {
    expect(lastHitMark(400, 100, 0, 0.2).frac).toBeCloseTo(0.25, 6);
  });
});

describe('rank targets and visibility', () => {
  it('rank goals rise with the rank', () => {
    expect(rankGoal('challenger').csPerMin).toBeGreaterThan(rankGoal('iron').csPerMin);
    expect(rankGoal('gold').csAt10).toBeGreaterThan(0);
  });
  it('cycles ranks and wraps', () => {
    expect(nextRank('iron')).toBe('bronze');
    expect(nextRank('challenger')).toBe('iron');
  });
  it('auto follows the mode, on/off override', () => {
    expect(widgetVisible('auto', 'classic')).toBe(false);
    expect(widgetVisible('auto', 'lastHit')).toBe(true);
    expect(widgetVisible('auto', 'dodge')).toBe(false);
    expect(widgetVisible('auto', undefined)).toBe(true);
    expect(widgetVisible('on', 'classic')).toBe(true);
    expect(widgetVisible('off', 'lastHit')).toBe(false);
  });
});
