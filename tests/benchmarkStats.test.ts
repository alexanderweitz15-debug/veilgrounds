import { describe, expect, it } from 'vitest';
import { estimate, median, quantile, aggregate, type Cluster } from '../tools/benchmark/stats';
import { monotone, buildMarkdown, buildHtml } from '../tools/benchmark/report';
import { METRIC_BY_ID, METRICS } from '../tools/benchmark/metrics';
import type { GameRaw } from '../tools/benchmark/play';
import { closest } from '../tools/benchmark/geometry';

const ratio = (n: number, d: number): Cluster => ({ r: [n, d] });

describe('benchmark statistics', () => {
  it('pools ratios as sum / sum and ignores clusters without denominator', () => {
    const e = estimate([ratio(1, 2), ratio(3, 4), ratio(0, 0)], 'ratio', 'k');
    expect(e.value).toBeCloseTo(4 / 6, 12);
    expect(e.games).toBe(2);
    expect(e.den).toBe(6);
  });

  it('bootstrap is deterministic and brackets the estimate', () => {
    const cs = [ratio(4, 10), ratio(6, 10), ratio(5, 10), ratio(7, 10), ratio(3, 10), ratio(5, 10)];
    const a = estimate(cs, 'ratio', 'metric|x');
    const b = estimate(cs, 'ratio', 'metric|x');
    expect(b).toEqual(a);
    expect(a.value).toBeCloseTo(0.5, 12);
    expect(a.lo).toBeLessThan(a.value);
    expect(a.hi).toBeGreaterThan(a.value);
    expect(a.se).toBeGreaterThan(0);
    expect(a.se).toBeLessThan(0.2);
    // a different key draws a different resample sequence
    expect(estimate(cs, 'ratio', 'other').se).not.toBe(a.se);
  });

  it('median / quantile of pooled samples', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    const e = estimate([{ s: [100, 200] }, { s: [300] }, { s: [] }], 'samples', 'rt');
    expect(e.value).toBe(200);
    expect(e.games).toBe(2);
    expect(e.den).toBe(3);
  });

  it('a single game has no spread, no data gives NaN', () => {
    const one = estimate([ratio(1, 4)], 'ratio', 'k');
    expect(one.value).toBe(0.25);
    expect(Number.isNaN(one.se)).toBe(true);
    expect(Number.isNaN(estimate([], 'ratio', 'k').value)).toBe(true);
  });
});

describe('monotonicity verdict', () => {
  const row = (x: string, value: number, se: number) => ({ brain: 'new', set: 'L', pair: `${x}:gold`, x, ref: 'gold', games: 8, minutes: 15, est: { cs10: { value, se, lo: value - 2 * se, hi: value + 2 * se, games: 8, den: 24 } } });
  const def = METRIC_BY_ID.get('cs10')!;

  it('accepts a rising sequence', () => {
    expect(monotone(def, [row('iron', 18, 1), row('gold', 22, 1), row('diamond', 25, 1)])).toMatchObject({ ok: true });
  });
  it('flags a violation and tells noise from a significant one', () => {
    const noise = monotone(def, [row('iron', 20, 2), row('gold', 19, 2)]);
    expect(noise.ok).toBe(false);
    expect(noise.significant).toBe(false);
    const real = monotone(def, [row('iron', 25, 0.5), row('gold', 19, 0.5)]);
    expect(real.ok).toBe(false);
    expect(real.significant).toBe(true);
  });
  it('honours the direction of "down" metrics', () => {
    const idle = METRIC_BY_ID.get('idle')!;
    const r = (x: string, v: number) => ({ ...row(x, v, 0.01), est: { idle: { value: v, se: 0.01, lo: v, hi: v, games: 8, den: 1000 } } });
    expect(monotone(idle, [r('iron', 0.2), r('gold', 0.1), r('diamond', 0.05)]).ok).toBe(true);
    expect(monotone(idle, [r('iron', 0.1), r('gold', 0.2)]).ok).toBe(false);
  });
});

describe('metric registry and report', () => {
  it('every metric has a definition, a unique id and a direction for core metrics', () => {
    const ids = new Set<string>();
    for (const d of METRICS) {
      expect(ids.has(d.id), d.id).toBe(false);
      ids.add(d.id);
      expect(d.def.length, d.id).toBeGreaterThan(30);
      if (d.core) expect(d.better, d.id).not.toBeNull();
    }
  });

  it('renders markdown and self-contained HTML (no external resource) from raw games', () => {
    const mk = (seed: number, x: string, win: number): GameRaw => ({
      spec: { pair: `${x}:gold`, x: x as 'iron', ref: 'gold', seed, flip: false, brain: 'new', minutes: 15, set: 'L', variance: false },
      hash: 'abc',
      minutes: 15,
      winner: null,
      wallS: 1,
      xTeams: [0],
      teams: [
        { ratio: { cs10: [60 + seed + (x === 'iron' ? 0 : 10), 3], winLead: [win, 1], idle: [10, 100] }, samples: { rtAll: [300 + seed, 500] } },
        { ratio: { cs10: [70, 3] }, samples: {} },
      ],
    });
    const games = [mk(1, 'iron', 0), mk(2, 'iron', 0), mk(1, 'gold', 1), mk(2, 'gold', 1)];
    const md = buildMarkdown(games, { commands: ['cmd'], head: 'deadbee' });
    expect(md).toContain('CS@10');
    expect(md).toContain('Definitionen');
    const html = buildHtml(games, { commands: ['cmd'], head: 'deadbee' });
    expect(html).toContain('<svg');
    expect(html).not.toMatch(/(src|href)=["']https?:/);
    expect(aggregate(games)).toHaveLength(2);
  });
});

describe('dodge geometry', () => {
  // projectile from the origin flying along +x at 1000 u/s
  it('a standing target on the line is a threat, one off the line is not', () => {
    expect(closest(1000, 0, 0, 0, 0, 0, 1000, 0, 2)).toMatchObject({ t: 1, d: 0 });
    expect(closest(1000, 300, 0, 0, 0, 0, 1000, 0, 2).d).toBeCloseTo(300, 9);
  });
  it('extrapolates a walking target: it walks into the line (threat), or away from it', () => {
    // target 400 off the line at x=1000, walking towards the line at 400 u/s: crosses at t=1 exactly when the shot arrives
    expect(closest(1000, 400, 0, -400, 0, 0, 1000, 0, 2).d).toBeCloseTo(0, 6);
    expect(closest(1000, 400, 0, 400, 0, 0, 1000, 0, 2).d).toBeGreaterThan(300);
  });
  it('limits the time to the projectile range and clamps negative times', () => {
    expect(closest(5000, 0, 0, 0, 0, 0, 1000, 0, 2).d).toBeCloseTo(3000, 6); // out of range: closest at tmax
    expect(closest(-500, 0, 0, 0, 0, 0, 1000, 0, 2)).toMatchObject({ t: 0 }); // behind the muzzle
  });
});
