// Agent M behaviour tests (docs/spec-bots.md §10): 5 trade length, 6 orbwalk quote, 9 objective conversion,
// 10 style combinations headless (sampled), plus fog-safe log positions of M's leaves.
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/rng';
import { loadMap } from '../src/sim/map';
import type { PlayerSetup } from '../src/sim/types';
import { profileOf } from '../src/ai/profiles';
import { RANKS, type Rank } from '../src/ai/profiles/schema';
import { ARCHETYPES, type DecisionLogEntry, type Playstyle } from '../src/ai/contract';
import { computeKnobs, neutralPlaystyle } from '../src/ai/params';
import { shouldAbort } from '../src/ai/bot/trade';
import { planOrbwalk } from '../src/ai/bot/kite';
import { TeamAI } from '../src/ai/bot/teamai';
import type { NodeCtx } from '../src/ai/bt/types';
import { botGameConfig } from '../src/ai/runner';
import { runBotGame } from '../src/ai/harness';

const style = (s: Partial<Playstyle>): Playstyle => ({ ...neutralPlaystyle(), ...s });

describe('spec test 5: trade length axis', () => {
  /**
   * Duel model of 100 trades: the bot starts at 70-100 % HP, at most 10 points ahead of the enemy (trade window), both lose HP at similar rates (+-25 %), the combo
   * ends after 1-1.6 s; the trade runs until the bot's abort rule (shouldAbort, the same function the trade leaf
   * uses) fires or someone dies. Returns the mean trade duration in seconds.
   */
  function meanTrade(tradeLength: number, seed: number): number {
    const knobs = computeKnobs(style({ tradeLength }));
    const rng = new Rng(seed);
    let sum = 0;
    for (let i = 0; i < 100; i++) {
      // trades only start inside the trade window (winProb > threshold): the bot is not behind on HP
      let me = rng.range(0.7, 1);
      let them = me - rng.range(0, 0.1);
      const myLoss = 0.05 * rng.range(0.75, 1.25);
      const theirLoss = 0.05 * rng.range(0.75, 1.25);
      const combo = rng.range(1, 1.6);
      let t = 0;
      for (; t < 12; t += 0.1) {
        me -= myLoss * 0.1;
        them -= theirLoss * 0.1;
        if (me <= 0 || them <= 0) break;
        const winProb = 1 / (1 + Math.exp(-5 * (me - them)));
        if (shouldAbort(knobs, { elapsedS: t, comboDone: t >= combo, myHp: me, theirHp: them, winProb })) break;
      }
      sum += t;
    }
    return sum / 100;
  }

  it('-5 trades last < 2.5 s, +5 trades > 6 s on average over 100 trades', () => {
    const short = meanTrade(-5, 11);
    const long = meanTrade(5, 11);
    console.log(`trade length: -5 ${short.toFixed(2)} s, +5 ${long.toFixed(2)} s`);
    expect(short).toBeLessThan(2.5);
    expect(long).toBeGreaterThan(6);
  });
});

describe('spec test 6: orbwalk quote by kiting axis and rank', () => {
  const quote = (rank: Rank, kiting: number): number => {
    const chance = computeKnobs(style({ kiting })).orbwalkChance;
    const rng = new Rng(17);
    let ok = 0;
    for (let i = 0; i < 2000; i++) if (planOrbwalk(rng, chance, profileOf(rank).behavior.lastHitJitterMs).outcome === 'ok') ok++;
    return ok / 2000;
  };
  it('Challenger -5 > 95 %, Challenger +5 < 5 %, Silver -5 60-80 %', () => {
    const c5 = quote('challenger', -5);
    const cp5 = quote('challenger', 5);
    const s5 = quote('silver', -5);
    console.log(`orbwalk quote: challenger -5 ${c5}, challenger +5 ${cp5}, silver -5 ${s5}`);
    expect(c5).toBeGreaterThan(0.95);
    expect(cp5).toBeLessThan(0.05);
    expect(s5).toBeGreaterThanOrEqual(0.6);
    expect(s5).toBeLessThanOrEqual(0.8);
  });
});

describe('spec test 9: objective conversion after a won 5v3 at 14:00 with a free dragon', () => {
  const map = loadMap();
  const players: PlayerSetup[] = (['top', 'jungle', 'mid', 'adc', 'support'] as const).flatMap((role, i) => [
    { slot: i, team: 0 as const, champion: 'brom', role, summoners: ['sprung', 'bannen'] as [string, string], isHuman: false },
    { slot: 5 + i, team: 1 as const, champion: 'brom', role, summoners: ['sprung', 'bannen'] as [string, string], isHuman: false },
  ]);
  const towers = (team: 0 | 1): { x: number; y: number }[] => (['top', 'mid', 'bot'] as const).flatMap((l) => map.sides[team].towers[l]);

  /** Fog-filtered team state as the team AI sees it (scoreboard + own vision). */
  function ctx(tick: number, deadEnemies: number): NodeCtx {
    const rows = players.map((p) => ({ slot: p.slot, team: p.team, champ: p.champion, level: 11, kills: 0, deaths: p.team === 1 && p.slot - 5 < deadEnemies ? 1 : 0, assists: 0, cs: 100, dead: p.team === 1 && p.slot - 5 < deadEnemies, itemValue: 4000 }));
    const self = { x: map.objectives.leviathan.x + 1500, y: map.objectives.leviathan.y };
    return {
      snap: { tick, time: tick / 30, team: 0, entities: [], events: [], eventTicks: [], players: rows, projectiles: [], objects: [], me: null },
      v: { tick, self, allies: [], enemies: [], ownMinions: [], enemyMinions: [], ownTowers: towers(0), enemyTowers: towers(1) },
    } as unknown as NodeCtx;
  }

  function rate(rank: Rank, trials: number): number {
    let took = 0;
    for (let s = 0; s < trials; s++) {
      const log: DecisionLogEntry[] = [];
      const ai = new TeamAI(0, map, players, 1000 + s, { push: (e) => void log.push(e), entries: () => log });
      const profile = profileOf(rank);
      for (const p of players.filter((q) => q.team === 0)) {
        const playstyle = neutralPlaystyle();
        ai.register({ slot: p.slot, role: p.role, champion: p.champion, profile, params: { slot: p.slot, rank, skill: profile.skill, behavior: profile.behavior, playstyle, archetype: null, rolled: false, knobs: computeKnobs(playstyle), hysteresis: profile.behavior.hysteresis, personalitySeed: 1 } });
      }
      const t0 = 14 * 60 * 30;
      ai.update(ctx(t0 - 60, 0)); // before the skirmish
      ai.update(ctx(t0, 2)); // two enemies down, none of ours: won skirmish -> conversion decision
      const d = ai.desireFor(1, t0 + 30);
      if (d?.kind === 'take_objective' && d.obj === 'leviathan') took++;
    }
    return took / trials;
  }

  it('Challenger takes the dragon > 90 %, Silver < 35 % (rank-typical non-conversion otherwise)', () => {
    const ch = rate('challenger', 300);
    const si = rate('silver', 300);
    console.log(`dragon conversion: challenger ${ch.toFixed(3)}, silver ${si.toFixed(3)}`);
    expect(ch).toBeGreaterThan(0.9);
    expect(si).toBeLessThan(0.35);
  });
});

describe('spec test 10: archetype x rank x role combinations run headless without deadlock (sampled)', () => {
  it('80 archetype/rank pairs over 8 games (each bot slot = one pair, all 5 roles per team): no exception, no idle > 10 s', () => {
    // ponytail: sampled - every (archetype, rank) pair once with one role (8 x 10 = 80 bots in 8 games), not all
    // 400 triples; each game runs 2 min after the first waves meet (1:45 -> 3:45), idle measured from 1:45.
    const pairs = ARCHETYPES.flatMap((a) => RANKS.map((r) => [a, r] as const));
    const rng = new Rng(99);
    for (let i = pairs.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [pairs[i], pairs[j]] = [pairs[j]!, pairs[i]!];
    }
    for (let g = 0; g < 8; g++) {
      const config = botGameConfig(300 + g, 'gold');
      config.players.forEach((p, i) => {
        const [archetype, rank] = pairs[g * 10 + i]!;
        p.bot = { ...p.bot!, rank, archetype };
      });
      const res = runBotGame(config, Math.round(225 * 30));
      for (const s of res.stats) expect(s.maxIdleS, `game ${g} ${s.role} ${s.champion} ${pairs[g * 10 + s.slot]!.join('/')}`).toBeLessThanOrEqual(10);
      expect(res.stats.every((s) => s.moved > 1500)).toBe(true);
    }
  }, 600_000);
});
