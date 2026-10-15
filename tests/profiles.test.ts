import { describe, expect, it } from 'vitest';
import { PROFILES, profileAt, profileOf, rollBotProfile, sampleReactionMs } from '../src/ai/profiles';
import { RANKS } from '../src/ai/profiles/schema';
import { botNames, chatLine, CHAT } from '../src/ai/humanize/names';
import { Rng } from '../src/sim/rng';

const ENUMS: Record<string, string[]> = {
  cooldownTracking: ['none', 'own', 'enemyBasic', 'ults', 'flash50', 'flash', 'all'],
  jungleTracking: ['none', 'sideOnSight', 'side', 'sideTimer', 'ahead60', 'ahead90', 'ahead90Leash', 'full'],
  buildQuality: ['random', 'recommended', 'standard70', 'standard', 'adaptive'],
  abilityOrder: ['unlock', 'standard', 'situational'],
};

describe('bot names + chat', () => {
  it('300 unique names, max 16 chars', () => {
    const ns = botNames(new Rng(1), 300, 'realistic', ['Brom', 'Mira']);
    expect(new Set(ns).size).toBe(300);
    for (const n of ns) expect(n.length).toBeLessThanOrEqual(16);
  });
  it('~120 lines, toxicity filter works, placeholders filled', () => {
    expect(CHAT.length).toBeGreaterThanOrEqual(110);
    const rng = new Rng(2);
    for (let i = 0; i < 50; i++) expect(chatLine(rng, 'flame', 'silver', false)).toBeNull();
    expect(chatLine(rng, 'flame', 'silver', true)).not.toBeNull();
    const l = chatLine(rng, 'objective', 'challenger', false, { t: '0:40', lane: 'Mid', champ: 'Brom' })!;
    expect(l).not.toMatch(/\{/);
  });
});

describe('rank profiles', () => {
  it('one profile per rank, same keys, valid enums, skill ascending', () => {
    expect(PROFILES.map((p) => p.rank)).toEqual([...RANKS]);
    const keys = Object.keys(PROFILES[0]!.behavior).sort();
    for (let i = 0; i < PROFILES.length; i++) {
      const p = PROFILES[i]!;
      expect(Object.keys(p.behavior).sort()).toEqual(keys);
      for (const [k, allowed] of Object.entries(ENUMS)) expect(allowed).toContain((p.behavior as unknown as Record<string, string>)[k]);
      if (i > 0) expect(p.skill).toBeGreaterThan(PROFILES[i - 1]!.skill);
    }
    expect([profileOf('iron').skill, profileOf('gold').skill, profileOf('diamond').skill, profileOf('challenger').skill]).toEqual([5, 45, 80, 100]);
  });

  it('spec table spot checks', () => {
    expect(profileOf('gold').behavior.reactionMedianMs).toBe(320);
    expect(profileOf('challenger').behavior.errorInjectionPct).toBe(3);
    expect(profileOf('emerald').behavior.baronWithoutVisionPct).toBe(45);
    expect(profileOf('silver').targets.csAt10).toBe(68);
    expect(profileOf('iron').behavior.recallGoldThreshold).toBeNull();
  });

  it('interpolates between anchors (Gold II)', () => {
    const p = profileAt(51);
    expect(p.behavior.reactionMedianMs).toBeLessThan(320);
    expect(p.behavior.reactionMedianMs).toBeGreaterThan(290);
    expect(profileAt(45).behavior.reactionMedianMs).toBe(320);
  });

  it('variance: stable spreads less than volatile, mean near the rank', () => {
    const rng = new Rng(7);
    const spread = (mode: 'stable' | 'volatile'): number[] => {
      const xs = Array.from({ length: 400 }, () => rollBotProfile('platinum', mode, rng).skill);
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      return [m, Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length)];
    };
    const [mStable, sdStable] = spread('stable');
    const [, sdVolatile] = spread('volatile');
    expect(sdStable!).toBeLessThan(sdVolatile!);
    expect(Math.abs(mStable! - 57)).toBeLessThan(3);
  });

  it('reaction samples are log-normal around the median, never constant', () => {
    const rng = new Rng(3);
    const b = profileOf('gold').behavior;
    const xs = Array.from({ length: 2000 }, () => sampleReactionMs(b, rng)).sort((a, c) => a - c);
    const median = xs[1000]!;
    expect(Math.abs(median - 320)).toBeLessThan(15);
    expect(xs[0]!).toBeGreaterThan(0);
    expect(new Set(xs.map((x) => Math.round(x))).size).toBeGreaterThan(100);
  });
});
