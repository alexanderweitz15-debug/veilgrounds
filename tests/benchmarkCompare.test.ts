import { describe, expect, it } from 'vitest';
import { compareMarkdown, pairedDelta } from '../tools/benchmark/compare';
import type { GameRaw } from '../tools/benchmark/play';

const game = (seed: number, cs: number, idle: number): GameRaw => ({
  spec: { pair: 'gold:gold', x: 'gold', ref: 'gold', seed, flip: false, brain: 'new', minutes: 15, set: 'L', variance: false },
  hash: 'h',
  minutes: 15,
  winner: null,
  wallS: 1,
  xTeams: [0],
  teams: [
    { ratio: { cs10: [cs * 3, 3], idle: [idle, 1000] }, samples: {} },
    { ratio: {}, samples: {} },
  ],
});

describe('benchmark compare', () => {
  const base = [1, 2, 3, 4, 5, 6].map((s) => game(s, 20 + (s % 3), 100));
  it('pairs games by pair / seed / side and bootstraps the difference', () => {
    const better = base.map((g) => game(g.spec.seed, 24 + (g.spec.seed % 3), 100));
    const d = pairedDelta(base, better, 'cs10', 'ratio', 'k')!;
    expect(d.n).toBe(6);
    expect(d.delta).toBeCloseTo(4, 9);
    expect(d.lo).toBeCloseTo(4, 9); // every pair improved by exactly 4: no spread
    expect(pairedDelta(base, better, 'cs10', 'ratio', 'k')).toEqual(d);
  });
  it('reports a >5 % deterioration of a core metric as a merge-rule violation', () => {
    const worse = base.map((g) => game(g.spec.seed, 22, 160)); // idle share 10 % -> 16 % (core, lower is better)
    const md = compareMarkdown(base, worse);
    expect(md).toContain('Merge-Regel');
    expect(md).toMatch(/Idle-Anteil Laner.*signifikant/);
  });
  it('says "Keine" when nothing got worse', () => {
    const same = base.map((g) => game(g.spec.seed, 24, 90));
    expect(compareMarkdown(base, same)).toMatch(/Keine\./);
  });
});
