// Bot prototype: a full classic 10-bot game runs headless, bots farm/fight/move, games are deterministic, and
// brains only ever see fog-filtered snapshots.
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createSim, step } from '../src/sim/sim';
import { sees } from '../src/sim/vision';
import { Kind } from '../src/sim/types';
import type { Snapshot } from '../src/sim/snapshot';
import { BotRunner, botGameConfig, classicConfig } from '../src/ai/runner';
import { runBotGame, type GameResult } from '../src/ai/harness';
import { think } from '../src/ai/bot/brain';
import type { BotStatic, Brain } from '../src/ai/bot/types';

const MIN = 30 * 60;

describe('bot prototype: full classic game (10 gold bots, 12 min)', () => {
  let game: GameResult;
  it('runs without exceptions', () => {
    game = runBotGame(botGameConfig(7, 'gold'), 12 * MIN);
    expect(game.ticks).toBeGreaterThan(10 * MIN); // either 12 min or a (very early) win
    for (const s of game.stats) console.log(`${s.team} ${s.role.padEnd(7)} ${s.champion.padEnd(9)} cs ${s.cs} k ${s.kills} d ${s.deaths} dmg ${Math.round(s.damageToChampions)} idle ${s.maxIdleS.toFixed(1)}s`);
  }, 300_000);

  it('every bot moves around the map', () => {
    for (const s of game.stats) expect(s.moved, `${s.champion} moved`).toBeGreaterThan(5000);
  });

  it('bots last-hit: both teams farm, laners average a rough CS rate', () => {
    for (const team of [0, 1]) expect(game.stats.filter((s) => s.team === team).reduce((a, s) => a + s.cs, 0)).toBeGreaterThan(0);
    const laners = game.stats.filter((s) => s.role === 'top' || s.role === 'mid' || s.role === 'adc');
    const csPerMin = laners.reduce((a, s) => a + s.cs, 0) / laners.length / game.minutes;
    console.log(`laner CS/min ${csPerMin.toFixed(2)}`);
    // ponytail: target ~3; measured 2.6-3.3 over seeds (first wave meets at 1:45, recall walks ~35 s, the scripted
    // perfect last-hitter caps at ~65 CS/10 min in this sim). Margin for engine changes; Table A calibration is Phase 4.
    expect(csPerMin).toBeGreaterThanOrEqual(2);
  });

  it('champions fight: damage between champions happens', () => {
    const dmg = game.stats.reduce((a, s) => a + s.damageToChampions, 0);
    const kills = game.stats.reduce((a, s) => a + s.kills, 0);
    console.log(`champion damage ${Math.round(dmg)}, kills ${kills}`);
    expect(dmg).toBeGreaterThan(5000);
    for (const team of [0, 1]) expect(game.stats.filter((s) => s.team === team).some((s) => s.damageToChampions > 0)).toBe(true);
  });

  it('no bot stands idle for more than 10 s (after the first waves meet)', () => {
    for (const s of game.stats) expect(s.maxIdleS, `${s.champion} idle`).toBeLessThanOrEqual(10);
  });
});

describe('bot determinism', () => {
  it('same seed -> same state hash (bots included)', () => {
    const a = runBotGame(botGameConfig(11, 'gold'), 4 * MIN);
    const b = runBotGame(botGameConfig(11, 'gold'), 4 * MIN);
    expect(b.hash).toBe(a.hash);
    const c = runBotGame(botGameConfig(12, 'gold'), 4 * MIN);
    expect(c.hash).not.toBe(a.hash);
  }, 300_000);
});

describe('bot fog of war', () => {
  it('the brain type takes a Snapshot + static data, never the Sim', () => {
    expectTypeOf<Parameters<Brain>[0]>().toEqualTypeOf<Snapshot>();
    expectTypeOf<Parameters<Brain>[1]>().toEqualTypeOf<BotStatic>();
    // static guard: brain modules must not import sim state (sim.ts, ecs, vision, bitecs); the BRAIN-REWORK
    // directories (reflex, plan, utility, humanize) are guarded before they exist (supervisor, review-checklist §1 #6)
    const sources = import.meta.glob<string>(
      ['../src/ai/bot/*.ts', '../src/ai/bt/*.ts', '../src/ai/reflex/*.ts', '../src/ai/plan.ts', '../src/ai/utility/*.ts', '../src/ai/humanize/*.ts', '../src/ai/errors.ts'],
      { query: '?raw', import: 'default', eager: true },
    );
    expect(Object.keys(sources).length).toBeGreaterThan(5);
    for (const [f, src] of Object.entries(sources)) {
      expect(src, f).not.toMatch(/from '(\.\.\/)+sim\/(sim|ecs|vision)'|from 'bitecs'/);
    }
  });

  it('snapshots handed to brains contain no hidden enemy champions, and bots only target what they see', () => {
    const config = botGameConfig(5, 'gold');
    const sim = createSim(config);
    let hiddenChecks = 0;
    let badTargets = 0;
    const seen = new Map<number, Set<number>>();
    const spy: Brain = (snap, ctx, mem, rng) => {
      const ids = new Set(snap.entities.map((e) => e.id));
      seen.set(ctx.slot, ids);
      const out = think(snap, ctx, mem, rng);
      for (const a of out) if ((a.cmd.t === 'attack' || a.cmd.t === 'cast') && a.cmd.target !== undefined && !ids.has(a.cmd.target)) badTargets++;
      return out;
    };
    const bots = new BotRunner(config, spy);
    bots.onPerceive = (slot, snap) => {
      const team = config.players.find((p) => p.slot === slot)!.team;
      for (const s of config.players) {
        if (s.team === team) continue;
        const eid = sim.slots[s.slot]!;
        const inSnap = snap.entities.some((e) => e.id === eid);
        if (!sim.c.Unit.alive[eid] || sees(sim, team, eid)) continue;
        hiddenChecks++;
        expect(inSnap).toBe(false);
      }
      for (const e of snap.entities) if (e.kind === Kind.Champion && e.team !== team && e.alive) expect(sees(sim, team, e.id)).toBe(true);
    };
    while (sim.tick < 3 * MIN) step(sim, bots.tick(sim));
    expect(hiddenChecks).toBeGreaterThan(100); // fog actually hid enemies during the test
    expect(badTargets).toBe(0);
  }, 300_000);
});

describe('classic config builder', () => {
  it('human + 9 role-conform bots with unique champions', () => {
    const c = classicConfig('mira', 'adc', 'platinum', { seed: 3 });
    expect(c.players).toHaveLength(10);
    expect(c.players.filter((p) => p.isHuman)).toHaveLength(1);
    expect(c.players[0]).toMatchObject({ slot: 0, team: 0, champion: 'mira', role: 'adc', isHuman: true });
    expect(new Set(c.players.map((p) => p.champion)).size).toBe(10);
    for (const team of [0, 1]) expect(c.players.filter((p) => p.team === team).map((p) => p.role).sort()).toEqual(['adc', 'jungle', 'mid', 'support', 'top']);
    for (const p of c.players.slice(1)) expect(p.bot).toMatchObject({ rank: 'platinum' });
    expect(new BotRunner(c).bots).toHaveLength(9);
  });
});
