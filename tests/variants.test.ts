// Game variants (ARAM, URF; src/sim/rules.ts, src/data/gameModes.json): config shape, rule effects, short bot game.
import './structuresHelpers';
import { describe, expect, it } from 'vitest';
import { createSim, step } from '../src/sim/sim';
import { BotRunner } from '../src/ai/runner';
import { variantConfig } from '../src/game/modes';
import { variantRules, VARIANTS } from '../src/sim/rules';
import { jungleState } from '../src/sim/systems/jungle';
import { startRecall } from '../src/sim/systems/economy';

describe('variants', () => {
  it('ARAM: 10 distinct random champions, all mid, no Bannen; same seed same roster', () => {
    const a = variantConfig('aram', 'gold', 42);
    expect(new Set(a.players.map((p) => p.champion)).size).toBe(10);
    expect(a.players.every((p) => p.role === 'mid' && !p.summoners.includes('bannen'))).toBe(true);
    expect(variantConfig('aram', 'gold', 42).players.map((p) => p.champion)).toEqual(a.players.map((p) => p.champion));
    const kept = variantConfig('aram', 'gold', 42, 'mira');
    expect(kept.players[0]!.champion).toBe('mira');
    expect(new Set(kept.players.map((p) => p.champion)).size).toBe(10);
  });

  it('ARAM rules: start gold/level, no recall, no camps; URF: haste', () => {
    const sim = createSim(variantConfig('aram', 'gold', 3));
    const me = sim.slots[0]!;
    expect(sim.c.Champ.level[me]).toBe(variantRules('aram').startLevel);
    expect(sim.c.Champ.gold[me]).toBe(variantRules('aram').startGold);
    expect(jungleState(sim).camps.length).toBe(0);
    step(sim);
    expect(sim.c.Hp.cur[me]).toBeGreaterThan(0.99 * sim.c.Hp.max[me]!);
    startRecall(sim, me);
    expect(sim.c.Champ.recallAt[me]).toBe(0);
    const urf = createSim(variantConfig('urf', 'gold', 3));
    step(urf);
    expect(urf.c.Stats.haste[urf.slots[0]!]).toBeGreaterThanOrEqual(100);
    expect(VARIANTS).toEqual(['aram', 'urf']);
  });

  it.each(VARIANTS)('%s: a bot game progresses (minions spawn, champions fight)', (id) => {
    const cfg = { ...variantConfig(id, 'gold', 11) };
    cfg.players = cfg.players.map((p, i) => (i === 0 ? { ...p, isHuman: false, bot: { rank: 'gold' as const, variance: 'normal' as const } } : p));
    const sim = createSim(cfg);
    const bots = new BotRunner(cfg, undefined, { noVariance: true });
    while (sim.tick < 4 * 60 * 30) step(sim, bots.tick(sim));
    const { Champ } = sim.c;
    const dealt = sim.slots.some((e) => Champ.xp[e]! > 0 && Champ.level[e]! > (variantRules(id).startLevel ?? 1));
    expect(dealt).toBe(true);
  }, 120_000);
});
