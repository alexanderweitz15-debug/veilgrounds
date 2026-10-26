// combat-helpers first: it imports sim.ts before any system module (systems <-> sim import cycle).
import { makeSim, mira, place, steps, cmd } from './combat-helpers';
import { describe, expect, it } from 'vitest';
import { buyItem, inventory, itemStats, quote, sellItem, undoDepth, undoLast } from '../src/sim/items/inventory';

function setup() {
  const sim = makeSim();
  const me = mira(sim);
  steps(sim, 1);
  sim.c.Champ.gold[me] = 10000;
  return { sim, me };
}

describe('inventory + shop', () => {
  it('buys only inside the own fountain', () => {
    const { sim, me } = setup();
    expect(buyItem(sim, me, 'langschwert')).toBe(true);
    place(sim, me, 3000, 3000);
    expect(quote(sim, me, 'langschwert').reason).toBe('notInShop');
    expect(buyItem(sim, me, 'langschwert')).toBe(false);
    expect(sellItem(sim, me, 0)).toBe(false);
    expect(inventory(sim, me).filter(Boolean)).toEqual(['langschwert']);
  });

  it('buy command goes through the input system', () => {
    const { sim, me } = setup();
    cmd(sim, { t: 'buy', item: 'langschwert' });
    expect(inventory(sim, me)[0]).toBe('langschwert');
    expect(sim.c.Champ.gold[me]).toBe(10000 - 350);
    cmd(sim, { t: 'sell', slot: 0 });
    expect(inventory(sim, me)[0]).toBeNull();
  });

  it('recipe price subtracts owned components and consumes them', () => {
    const { sim, me } = setup();
    buyItem(sim, me, 'langschwert'); // 350
    const g = sim.c.Champ.gold[me]!;
    expect(quote(sim, me, 'spitzhacke').price).toBe(875 - 350);
    expect(buyItem(sim, me, 'spitzhacke')).toBe(true);
    expect(sim.c.Champ.gold[me]).toBe(g - 525);
    expect(inventory(sim, me).filter(Boolean)).toEqual(['spitzhacke']);
    // without components the full price is charged
    expect(quote(sim, me, 'klingenbrecher').price).toBe(1100);
  });

  it('sells for 70 % of the item cost', () => {
    const { sim, me } = setup();
    buyItem(sim, me, 'spitzhacke');
    const g = sim.c.Champ.gold[me]!;
    expect(sellItem(sim, me, 0)).toBe(true);
    expect(sim.c.Champ.gold[me]).toBe(g + Math.floor(875 * 0.7));
  });

  it('boots and starters are unique, inventory holds 6 items', () => {
    const { sim, me } = setup();
    expect(buyItem(sim, me, 'stiefel_schnelligkeit')).toBe(true);
    expect(quote(sim, me, 'stiefel_ruestung').reason).toBe('unique');
    expect(buyItem(sim, me, 'kurzschwert')).toBe(true);
    expect(buyItem(sim, me, 'zauberring')).toBe(false);
    for (let i = 0; i < 4; i++) expect(buyItem(sim, me, 'langschwert')).toBe(true);
    expect(quote(sim, me, 'lederweste').reason).toBe('full');
    // a recipe that consumes an owned component still fits
    expect(buyItem(sim, me, 'spitzhacke')).toBe(true);
  });

  it('rejects purchases without enough gold', () => {
    const { sim, me } = setup();
    sim.c.Champ.gold[me] = 100;
    expect(quote(sim, me, 'langschwert').reason).toBe('gold');
  });

  it('item stats apply to the champion', () => {
    const { sim, me } = setup();
    const { Stats, Hp } = sim.c;
    const ad = Stats.ad[me]!;
    const hp = Hp.max[me]!;
    const ms = Stats.ms[me]!;
    buyItem(sim, me, 'klingenbrecher'); // first: bought later it would consume the Langschwert
    buyItem(sim, me, 'langschwert');
    buyItem(sim, me, 'rubinsplitter');
    buyItem(sim, me, 'eiferschwert');
    buyItem(sim, me, 'stiefel_schnelligkeit');
    steps(sim, 1);
    expect(itemStats(sim, me).ad).toBe(30);
    expect(Stats.ad[me]).toBeCloseTo(ad + 30);
    expect(Hp.max[me]).toBeCloseTo(hp + 150);
    expect(Stats.crit[me]).toBeCloseTo(0.15);
    expect(Stats.lethality[me]).toBe(10);
    expect(Stats.ms[me]!).toBeGreaterThan(ms + 60);
  });
});

describe('recursive recipes', () => {
  it('owned sub-components (Langschwert) discount a legendary whose direct component is missing', async () => {
    const { recipePrice, itemById } = await import('../src/sim/items/inventory');
    const storm = itemById('sturmbogen')!;
    const lang = itemById('langschwert')!;
    const inv: (string | null)[] = ['langschwert', 'wetzdolch', null, null, null, null, null];
    const r = recipePrice(inv, storm);
    expect(r.price).toBe(storm.cost - lang.cost - itemById('wetzdolch')!.cost);
    expect(r.consumes.sort()).toEqual([0, 1]);
    // a direct component wins over its sub-components
    const r2 = recipePrice(['spitzhacke', 'langschwert', null, null, null, null, null], storm);
    expect(r2.consumes).toEqual([0]);
  });
});

describe('shop undo (G/B1)', () => {
  it('undoes the last buy: inventory and gold as before, consumed components return', () => {
    const { sim, me } = setup();
    buyItem(sim, me, 'langschwert');
    const g = sim.c.Champ.gold[me]!;
    buyItem(sim, me, 'spitzhacke'); // consumes the Langschwert
    expect(inventory(sim, me).filter(Boolean)).toEqual(['spitzhacke']);
    expect(undoDepth(sim, me)).toBe(2);
    expect(undoLast(sim, me)).toBe(true);
    expect(inventory(sim, me).filter(Boolean)).toEqual(['langschwert']);
    expect(sim.c.Champ.gold[me]).toBe(g);
    expect(undoLast(sim, me)).toBe(true);
    expect(inventory(sim, me).filter(Boolean)).toEqual([]);
    expect(sim.c.Champ.gold[me]).toBe(10000);
    expect(undoLast(sim, me)).toBe(false); // nothing left
  });

  it('undoes a sell (needs the sale gold) and goes through the input system', () => {
    const { sim, me } = setup();
    cmd(sim, { t: 'buy', item: 'langschwert' });
    cmd(sim, { t: 'sell', slot: 0 });
    expect(sim.c.Champ.gold[me]).toBe(10000 - 350 + 245);
    cmd(sim, { t: 'undo' });
    expect(inventory(sim, me)[0]).toBe('langschwert');
    expect(sim.c.Champ.gold[me]).toBe(10000 - 350);
    cmd(sim, { t: 'sell', slot: 0 });
    sim.c.Champ.gold[me] = 100; // spent the sale gold: the sell cannot be taken back
    expect(undoLast(sim, me)).toBe(false);
  });

  it('leaving the fountain or using an item ends the undo window', () => {
    const { sim, me } = setup();
    buyItem(sim, me, 'trank');
    buyItem(sim, me, 'langschwert');
    expect(undoDepth(sim, me)).toBe(2);
    place(sim, me, 3000, 3000);
    steps(sim, 1);
    expect(undoDepth(sim, me)).toBe(0);
    expect(undoLast(sim, me)).toBe(false);
    const { sim: s2, me: m2 } = setup();
    buyItem(s2, m2, 'trank');
    cmd(s2, { t: 'item', slot: 0 });
    expect(undoDepth(s2, m2)).toBe(0);
  });
});
