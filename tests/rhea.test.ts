// Rhea Doppelbolzen kit: Double Bolt (extra bolt on the auto after an ability), Scatter Shot, Tracking Shot, Fall Back, Bolt Storm; item.
import { CX, CY, cmd, makeSim, place, steps } from './combat-helpers';
import { duel } from './itemHelpers';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { Path2D?: unknown }).Path2D ??= class { rect(): void {} };
});
import { step, type Sim } from '../src/sim/sim';
import { missingHooks } from '../src/sim/champions';
import { rheaArmed } from '../src/sim/champions/rhea';
import { spawnDummy } from '../src/sim/systems/champions';
import { levelAbility, applyEffects, abilityOf } from '../src/sim/systems/abilities';
import { buffs, strongestSlow } from '../src/sim/buffs';
import { champions } from '../src/data/champions';

function setup(ranks: [number, number, number, number] = [1, 1, 1, 0]): { sim: Sim; m: number } {
  const sim = makeSim({ players: [{ slot: 0, team: 0, champion: 'rhea', role: 'adc', summoners: ['sprung', 'heilen'], isHuman: true }] });
  const m = sim.slots[0]!;
  place(sim, m, CX, CY);
  sim.c.Champ.level[m] = ranks[3] > 0 ? 6 : 5;
  sim.c.Champ.skillPoints[m] = 30;
  ranks.forEach((r, slot) => {
    for (let i = 0; i < r; i++) levelAbility(sim, m, slot);
  });
  sim.c.Mana.cur[m] = sim.c.Mana.max[m]!;
  step(sim);
  return { sim, m };
}

describe('Rhea data and kit', () => {
  it('hooks exist, marksman numbers, own painted kit with two props and five animations', async () => {
    expect(missingHooks('rhea')).toEqual([]);
    const r = champions.rhea!;
    expect(r.roles).toEqual(['adc']);
    for (const o of ['mira', 'tobin', 'svea']) expect(Math.abs(r.base.hp - champions[o]!.base.hp)).toBeLessThanOrEqual(40);
    const { championKit, framesOf } = await import('../src/render/champions');
    const k = championKit('rhea')!;
    expect(k.props.length).toBe(2);
    expect(k.feature).toContain('scarf');
    for (const an of ['idle', 'run', 'attack', 'cast', 'death'] as const) expect(framesOf('rhea', an)).toBeGreaterThan(0);
  }, 30000);
});

describe('Rhea Double Bolt', () => {
  it('an ability arms the passive; the next auto fires two bolts (the second weaker), then it is spent', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 400, CY, 1);
    step(sim);
    expect(rheaArmed(sim, m)).toBe(false);
    cmd(sim, { t: 'cast', slot: 2, x: CX + 800, y: CY }); // E hop back (no damage)
    steps(sim, 25);
    expect(rheaArmed(sim, m)).toBe(true);
    const autos: number[] = [];
    for (let i = 0; i < 60; i++) {
      step(sim, i === 0 ? [{ slot: 0, cmd: { t: 'attack', target: d } }] : []);
      for (const e of sim.events) if (e.e === 'damage' && e.src === m && e.dst === d && (e as { auto?: boolean }).auto) autos.push(e.amount);
    }
    expect(rheaArmed(sim, m)).toBe(false);
    expect(autos.length).toBeGreaterThanOrEqual(2); // the first auto fires two bolts
    expect(Math.min(autos[0]!, autos[1]!)).toBeLessThan(Math.max(autos[0]!, autos[1]!));
  });
});

describe('Rhea Q / W / E / R', () => {
  it('Q scatter cone damages and slows', () => {
    const { sim } = setup();
    const d = spawnDummy(sim, CX + 300, CY, 1);
    step(sim);
    cmd(sim, { t: 'cast', slot: 0, x: CX + 300, y: CY });
    steps(sim, 25);
    expect(sim.c.Hp.cur[d]!).toBeLessThan(sim.c.Hp.max[d]!);
    expect(strongestSlow(sim, d)).toBe(20);
  });
  it('W damages and slows', () => {
    const { sim } = setup();
    const d = spawnDummy(sim, CX + 600, CY, 1);
    step(sim);
    cmd(sim, { t: 'cast', slot: 1, x: CX + 600, y: CY });
    steps(sim, 25);
    expect(sim.c.Hp.cur[d]!).toBeLessThan(sim.c.Hp.max[d]!);
    expect(strongestSlow(sim, d)).toBe(25);
  });
  it('E hops away from the cursor with +20 % move speed', () => {
    const { sim, m } = setup();
    cmd(sim, { t: 'cast', slot: 2, x: CX + 800, y: CY });
    steps(sim, 15);
    expect(sim.c.Pos.x[m]!).toBeLessThan(CX - 150);
    expect(buffs(sim, m).some((b) => b.stat === 'ms')).toBe(true);
  });
  it('R is a long cone with heavy physical damage', () => {
    const { sim } = setup([1, 0, 0, 1]);
    const d = spawnDummy(sim, CX + 600, CY, 1);
    step(sim);
    cmd(sim, { t: 'cast', slot: 3, x: CX + 600, y: CY });
    steps(sim, 25);
    expect(sim.c.Hp.max[d]! - sim.c.Hp.cur[d]!).toBeGreaterThan(150);
  });
});

describe('Repeater Cord (item)', () => {
  it('priced 80-115 %; an ability hit gives attack speed', async () => {
    const { itemById } = await import('../src/sim/items/inventory');
    const { goldEfficiency } = await import('../src/ui/goldEfficiency');
    const ge = goldEfficiency(itemById('wundersehne')!)!;
    expect(ge.pct).toBeGreaterThan(80);
    expect(ge.pct).toBeLessThan(115);
    const d = duel({ champ: 'ilvane', items: ['wundersehne'] });
    const ab = abilityOf(d.sim, d.me, 0);
    applyEffects(d.sim, { caster: d.me, slot: 0, rank: 1, ability: ab, hits: [d.foe], x: 0, y: 0, target: d.foe, phase: 'cast', dx: 1, dy: 0, cursorX: 0, cursorY: 0 });
    steps(d.sim, 1);
    expect(buffs(d.sim, d.me).some((b) => b.id === 'recock')).toBe(true);
  });
});
