// Spec-bots §6 ExchangeEstimate: sanity of win/kill/death probabilities, rank noise bounds, rank estimates,
// environment (tower) and the snapshot builder.
import { describe, expect, it } from 'vitest';
import { estimateRanks, exchangeEstimate, exchangeFromSnapshot, exchangeNoise, type FighterSpec } from '../src/ai/exchange';
import { championData } from '../src/sim/champions';
import { growthFactor } from '../src/sim/systems/stats';
import { createSim, step } from '../src/sim/sim';
import { buildSnapshot } from '../src/sim/snapshot';
import { botGameConfig } from '../src/ai/runner';
import { Kind } from '../src/sim/types';
import { Rng } from '../src/sim/rng';

const fighter = (id: string, level: number, hpFrac: number): FighterSpec => {
  const c = championData(id);
  const maxHp = c.base.hp + c.base.hpGrowth * growthFactor(level);
  return { champ: c, level, hp: maxHp * hpFrac, maxHp };
};

describe('ExchangeEstimate', () => {
  it('full-HP level 6 vs level 3 at low HP: clear win, likely kill, no death', () => {
    const r = exchangeEstimate({ allies: [fighter('mira', 6, 1)], enemies: [fighter('corvin', 3, 0.25)], horizonS: 3, gameTimeS: 300 });
    expect(r.winProb).toBeGreaterThan(0.85);
    expect(r.killProb).toBeGreaterThan(0.7);
    expect(r.deathProb).toBeLessThan(0.1);
    const flip = exchangeEstimate({ allies: [fighter('corvin', 3, 0.25)], enemies: [fighter('mira', 6, 1)], horizonS: 3, gameTimeS: 300 });
    expect(flip.winProb).toBeLessThan(0.15);
    expect(flip.deathProb).toBeGreaterThan(0.7);
  });

  it('mirror match is even; longer horizons deal more damage', () => {
    const a = exchangeEstimate({ allies: [fighter('brom', 5, 1)], enemies: [fighter('brom', 5, 1)], horizonS: 3, gameTimeS: 300 });
    expect(a.winProb).toBeCloseTo(0.5, 6);
    expect(a.dealt).toBeCloseTo(a.taken, 6);
    const b = exchangeEstimate({ allies: [fighter('brom', 5, 1)], enemies: [fighter('brom', 5, 1)], horizonS: 8, gameTimeS: 300 });
    expect(b.dealt).toBeGreaterThan(a.dealt);
  });

  it('enemy tower and minions count against the side standing in them; 2v1 beats 1v1', () => {
    const base = { allies: [fighter('isolde', 6, 1)], enemies: [fighter('isolde', 6, 1)], horizonS: 4, gameTimeS: 400 };
    const plain = exchangeEstimate(base);
    expect(exchangeEstimate({ ...base, enemyTower: { tier: 0 } }).winProb).toBeLessThan(plain.winProb - 0.1);
    expect(exchangeEstimate({ ...base, enemyMinions: 6 }).winProb).toBeLessThan(plain.winProb);
    expect(exchangeEstimate({ ...base, allies: [...base.allies, fighter('vessa', 6, 1)] }).winProb).toBeGreaterThan(plain.winProb + 0.2);
  });

  it('known cooldowns: abilities on cooldown beyond T deal no damage', () => {
    const me = fighter('thessaly', 9, 1);
    const ready = exchangeEstimate({ allies: [{ ...me, cdLeft: [0, 0, 0, 0] }], enemies: [fighter('mira', 9, 1)], horizonS: 3, gameTimeS: 600 });
    const down = exchangeEstimate({ allies: [{ ...me, cdLeft: [9, 9, 9, 60] }], enemies: [fighter('mira', 9, 1)], horizonS: 3, gameTimeS: 600 });
    expect(down.dealt).toBeLessThan(ready.dealt * 0.7);
  });

  it('noise bounds by rank: Iron +-40 %, Gold +-20 %, Challenger +-7 %', () => {
    expect(exchangeNoise(5)).toBeCloseTo(0.4, 6);
    expect(exchangeNoise(45)).toBeCloseTo(0.2, 6);
    expect(exchangeNoise(100)).toBeCloseTo(0.07, 6);
    const input = { allies: [fighter('mira', 6, 1)], enemies: [fighter('mira', 6, 1)], horizonS: 3, gameTimeS: 300 };
    for (const [skill, n] of [[5, 0.4], [45, 0.2], [100, 0.07]] as const) {
      const rng = new Rng(skill);
      const ms: number[] = [];
      for (let i = 0; i < 400; i++) {
        const r = exchangeEstimate(input, { skill, rng });
        ms.push(r.noiseDealt, r.noiseTaken);
      }
      expect(Math.min(...ms)).toBeGreaterThanOrEqual(1 - n - 1e-9);
      expect(Math.max(...ms)).toBeLessThanOrEqual(1 + n + 1e-9);
      expect(Math.min(...ms)).toBeLessThan(1 - n * 0.9); // the full range is used
      expect(Math.max(...ms)).toBeGreaterThan(1 + n * 0.9);
    }
  });

  it('estimates enemy ability ranks from level and max order', () => {
    const c = championData('mira');
    for (let lv = 1; lv <= 18; lv++) expect(estimateRanks(c, lv).reduce((a, b) => a + b, 0)).toBe(lv);
    expect(estimateRanks(c, 6)[3]).toBe(1);
    expect(estimateRanks(c, 18)).toEqual([5, 5, 5, 3]);
    const first = { Q: 0, W: 1, E: 2 }[c.maxOrder[0]];
    expect(estimateRanks(c, 9)[first]).toBe(5);
  });

  it('snapshot builder: fog-filtered view, own HUD stats, finite probabilities', () => {
    const sim = createSim(botGameConfig(3, 'gold'));
    for (let i = 0; i < 30; i++) step(sim, []);
    const snap = buildSnapshot(sim, 0, 0);
    const me = snap.me!.eid;
    const ally = snap.entities.find((e) => e.kind === Kind.Champion && e.team === 0 && e.id !== me)!;
    const enemies = snap.entities.filter((e) => e.kind === Kind.Champion && e.team === 1).map((e) => e.id);
    expect(enemies).toEqual([]); // red is in its fountain, unseen: the estimate cannot use it
    const r = exchangeFromSnapshot(snap, { allies: [me], enemies: [ally.id], horizonS: 3, skill: 45, rng: new Rng(1) });
    for (const v of [r.winProb, r.killProb, r.deathProb]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(r.dealt).toBeGreaterThan(0);
  });
});
