// Game variants (ARAM, URF; src/sim/rules.ts, src/data/gameModes.json): config shape, rule effects, short bot game.
import './structuresHelpers';
import { describe, expect, it } from 'vitest';
import { createSim, step } from '../src/sim/sim';
import { BotRunner } from '../src/ai/runner';
import { variantConfig } from '../src/game/modes';
import { variantRules, VARIANTS } from '../src/sim/rules';
import { jungleState } from '../src/sim/systems/jungle';
import { startRecall } from '../src/sim/systems/economy';
import { aramMap } from '../src/sim/aramMap';
import { findPath, walkable, loadMap } from '../src/sim/map';
import { towerState } from '../src/sim/systems/towers';
import { Kind } from '../src/sim/types';

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

describe('ARAM map and relics', () => {
  it('one lane: nexus to nexus is walkable, the side lanes are walled in, structures only mid', () => {
    const m = aramMap();
    const classic = loadMap();
    const a = m.sides[0].nexus;
    const b = m.sides[1].nexus;
    const path = findPath(m.nav, a.x, a.y, b.x, b.y);
    let len = 0;
    let px = a.x;
    let py = a.y;
    for (const p of path) (len += Math.hypot(p.x - px, p.y - py), (px = p.x), (py = p.y));
    expect(Math.hypot(px - b.x, py - b.y)).toBeLessThan(100);
    expect(len).toBeLessThan(1.25 * Math.hypot(b.x - a.x, b.y - a.y));
    for (const side of [0, 1]) for (const lane of ['top', 'bot'] as const) for (const p of classic.sides[side]!.towers[lane]) expect(walkable(m.nav, p.x, p.y)).toBe(false);
    const sim = createSim(variantConfig('aram', 'gold', 5));
    const towers = towerState(sim).list;
    expect(towers.filter((r) => r.kind === Kind.Inhibitor).length).toBe(2);
    expect(towers.every((r) => r.lane === 1 || r.lane === 255)).toBe(true);
  });

  it('a relic heals the champion on it, then respawns', () => {
    const sim = createSim(variantConfig('aram', 'gold', 5));
    const me = sim.slots[0]!;
    const rel = (sim.state.relics as { x: number; y: number; respawnAt: number }[])[0]!;
    sim.c.Hp.cur[me] = sim.c.Hp.max[me]! * 0.2;
    sim.c.Pos.x[me] = rel.x;
    sim.c.Pos.y[me] = rel.y;
    step(sim);
    expect(sim.c.Hp.cur[me]).toBeGreaterThan(sim.c.Hp.max[me]! * 0.45);
    expect(rel.respawnAt).toBeGreaterThan(sim.tick);
    while (sim.tick < rel.respawnAt + 2) step(sim);
    expect(rel.respawnAt).toBe(-1);
  });
});
