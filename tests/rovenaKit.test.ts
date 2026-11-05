// Rovena sprite kit, Bloodchalice passive, bot HP-cost rule.
// combat-helpers first: it imports sim.ts before any system module (systems <-> sim import cycle).
import { steps } from './combat-helpers';
import { describe, expect, it, vi } from 'vitest';

// the kit registry module builds a Path2D at load time (browser only)
vi.hoisted(() => {
  (globalThis as { Path2D?: unknown }).Path2D ??= class { rect(): void {} };
});
import { CHAMPION_IDS, championKit, framesOf } from '../src/render/champions';
import { levelAbility } from '../src/sim/systems/abilities';
import { itemById } from '../src/sim/items/inventory';
import { goldEfficiency } from '../src/ui/goldEfficiency';
import { champions } from '../src/data/champions';
import { ready } from '../src/ai/bot/combat';
import { abilityHit, duel } from './itemHelpers';

describe('Rovena kit', () => {
  it('has her own sprite kit: thorn crown, orbs, drips, all five animations', () => {
    const k = championKit('rovena')!;
    expect(CHAMPION_IDS).toContain('rovena');
    expect(k.props.length).toBe(3);
    expect(k.feature).toContain('thorn');
    for (const a of ['idle', 'run', 'attack', 'cast', 'death'] as const) expect(framesOf('rovena', a)).toBeGreaterThan(0);
    expect(championKit('fenna')!.look).not.toBe(k.look);
  });
});

describe('Bloodchalice (blutkelch)', () => {
  it('is priced by gold efficiency (80-120 % of its stats)', () => {
    const ge = goldEfficiency(itemById('blutkelch')!)!;
    expect(ge.pct).toBeGreaterThan(80);
    expect(ge.pct).toBeLessThan(120);
    expect(goldEfficiency(itemById('aderglas')!)!.pct).toBeGreaterThan(80);
  });

  it('Last Sip: an ability hit on an enemy champion heals 4 % missing HP (+15), once per 0.5 s; below 40 % HP +10 % AP', () => {
    const { sim, me, foe } = duel({ champ: 'rovena', items: ['blutkelch'] });
    sim.c.Champ.skillPoints[me] = 3;
    levelAbility(sim, me, 0);
    sim.c.Hp.cur[me] = sim.c.Hp.max[me]! * 0.5;
    const miss = sim.c.Hp.max[me]! - sim.c.Hp.cur[me]!;
    const hp0 = sim.c.Hp.cur[me]!;
    abilityHit(sim, me, foe);
    const gained = sim.c.Hp.cur[me]! - hp0;
    // item heal (0.04 x missing + 15) plus Bloodtithe's own heal-back of the Q damage
    expect(gained).toBeGreaterThan(0.04 * miss + 15 - 1);
    const ap0 = sim.c.Stats.ap[me]!;
    sim.c.Hp.cur[me] = sim.c.Hp.max[me]! * 0.3;
    steps(sim, 2);
    expect(sim.c.Stats.ap[me]! / ap0).toBeCloseTo(1.1, 1);
  });
});

describe('Bot HP-cost rule', () => {
  const ctx = { champ: champions.rovena! } as never;
  const view = (hp: number, maxHp: number): never =>
    ({ self: { hp, maxHp, shield: 0, mana: 0 }, me: { abilities: [{ rank: 1, cdLeft: 0, cost: 45 }, null, null, { rank: 1, cdLeft: 0, cost: 0 }] } }) as never;

  it('casts HP-cost spells with a margin, stops below 25 % HP, R stays free', () => {
    expect(ready(view(900, 1000), ctx, 0)).toBe(true);
    expect(ready(view(200, 1000), ctx, 0)).toBe(false);
    expect(ready(view(60, 1000), ctx, 3)).toBe(true);
  });
});
