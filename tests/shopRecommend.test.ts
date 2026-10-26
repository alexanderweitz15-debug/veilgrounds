// G/B2: recommended-items plan (src/ui/shopRecommend.ts) on Mira's bot build.
import { describe, expect, it } from 'vitest';
import { BUILDS } from '../src/ai/bot/builds';
import { itemById } from '../src/sim/items/inventory';
import { nextPurchase, recommendedPlan } from '../src/ui/shopRecommend';

const build = BUILDS.mira!;
const empty = [null, null, null, null, null, null, null];

describe('recommended plan', () => {
  it('rows: starter, boots (+ situational alternatives), core in order with the first unowned marked next, situational extras', () => {
    const p = recommendedPlan(build, empty, 500, itemById);
    expect(p.starter).toEqual(build.starter);
    expect(p.boots[0]!.id).toBe(build.standard.boots);
    expect(p.boots.slice(1).every((b) => b.vs && b.id !== build.standard.boots)).toBe(true);
    expect(p.core.map((c) => c.id)).toEqual(build.standard.core);
    expect(p.core.map((c) => c.next)).toEqual([true, false, false, false]);
    expect(p.target).toBe(build.standard.core[0]);
    for (const s of p.situational) expect(build.standard.core).not.toContain(s.id);
  });

  it('next core item skips owned ones; a complete build has no target', () => {
    const inv = [build.standard.core[0]!, build.standard.core[1]!, null, null, null, null, null];
    const p = recommendedPlan(build, inv, 0, itemById);
    expect(p.core.map((c) => c.owned)).toEqual([true, true, false, false]);
    expect(p.target).toBe(build.standard.core[2]);
    const all = [...build.standard.core, null, null, null];
    expect(recommendedPlan(build, all, 9999, itemById).target).toBeNull();
    expect(recommendedPlan(build, all, 9999, itemById).nextBuy).toBeNull();
  });

  it('quick buy picks the deepest affordable step toward the target (Sturmbogen: Langschwert -> Spitzhacke -> item)', () => {
    const sturmbogen = itemById('sturmbogen')!;
    expect(nextPurchase(empty, 500, sturmbogen, itemById)).toBe('langschwert');
    expect(nextPurchase(empty, 1100, sturmbogen, itemById)).toBe('spitzhacke');
    expect(nextPurchase(['langschwert', null, null, null, null, null, null], 600, sturmbogen, itemById)).toBe('spitzhacke'); // 875 - 350
    expect(nextPurchase(['spitzhacke', null, null, null, null, null, null], 300, sturmbogen, itemById)).toBe('wetzdolch'); // toward Eiferschwert
    expect(nextPurchase(['spitzhacke', 'eiferschwert', null, null, null, null, null], 1175, sturmbogen, itemById)).toBe('sturmbogen'); // 3100 - 875 - 1050
    expect(nextPurchase(empty, 100, sturmbogen, itemById)).toBeNull();
  });

  it('duplicate components in a recipe need duplicates in the bag (Klingenbrecher = 2x Langschwert)', () => {
    const kb = itemById('klingenbrecher')!;
    expect(nextPurchase(['langschwert', null, null, null, null, null, null], 350, kb, itemById)).toBe('langschwert');
    expect(nextPurchase(['langschwert', 'langschwert', null, null, null, null, null], 400, kb, itemById)).toBe('klingenbrecher');
  });
});
