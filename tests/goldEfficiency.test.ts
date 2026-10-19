// C7 / FEATURE-GAP 5.3: shop gold efficiency (LoL wiki method).
import { describe, expect, it } from 'vitest';
import { goldEfficiency, goldPerStat } from '../src/ui/goldEfficiency';
import { ITEMS, itemById } from '../src/sim/items/inventory';

describe('gold efficiency', () => {
  it('derives gold per stat from the single-stat basic items', () => {
    const g = goldPerStat();
    expect(g.ad).toBe(35); // Langschwert 350 / 10
    expect(g.ap).toBeCloseTo(21.75); // Verstärkerbuch 435 / 20
    expect(g.armor).toBe(20); // Lederweste 300 / 15
    expect(g.msFlat).toBeGreaterThan(0); // Stiefel
  });

  it('basic items are exactly 100 %, every priced item gets a sane value', () => {
    expect(goldEfficiency(itemById('langschwert')!)).toEqual({ value: 350, pct: 100 });
    expect(goldEfficiency(itemById('trank')!)).toBeNull();
    for (const it of ITEMS) {
      const ge = goldEfficiency(it);
      if (ge) expect(ge.pct, it.id).toBeGreaterThan(20);
      if (ge) expect(ge.pct, it.id).toBeLessThan(250);
    }
  });
});
