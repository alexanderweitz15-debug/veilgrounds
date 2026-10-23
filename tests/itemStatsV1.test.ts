// G/V1: penetration and tenacity as item stats (schema + stats fold + damage order), see docs/IDEAS-FEEL-SHOP.md.
import { makeSim, mira, steps } from './combat-helpers';
import { describe, expect, it } from 'vitest';
import { effectiveResist, mitigation } from '../src/sim/damage';
import { spawnDummy } from '../src/sim/systems/champions';

describe('V1 penetration stats', () => {
  it('magic: percent penetration first, then flat (LoL order); armor: percent then lethality', () => {
    const sim = makeSim();
    const me = mira(sim);
    steps(sim, 1);
    const d = spawnDummy(sim, 6400, 8750, 1, 60, 80);
    expect(effectiveResist(sim, me, d, 'magic')).toBe(80);
    sim.c.Stats.magicPenPct[me] = 0.4;
    sim.c.Stats.magicPen[me] = 10;
    expect(effectiveResist(sim, me, d, 'magic')).toBeCloseTo(80 * 0.6 - 10);
    sim.c.Stats.armorPenPct[me] = 0.25;
    sim.c.Stats.lethality[me] = 5;
    expect(effectiveResist(sim, me, d, 'phys')).toBeCloseTo(60 * 0.75 - 5);
    expect(mitigation(38)).toBeCloseTo(100 / 138);
  });

  it('the stats system resets item penetration/tenacity every tick (no champion item: all zero)', () => {
    const sim = makeSim();
    const me = mira(sim);
    sim.c.Stats.magicPenPct[me] = 0.5;
    sim.c.Stats.armorPenPct[me] = 0.5;
    sim.c.Stats.magicPen[me] = 20;
    steps(sim, 1);
    expect(sim.c.Stats.magicPenPct[me]).toBe(0);
    expect(sim.c.Stats.armorPenPct[me]).toBe(0);
    expect(sim.c.Stats.magicPen[me]).toBe(0);
    expect(sim.c.Stats.tenacity[me]).toBe(0);
  });
});
