import { describe, expect, it } from 'vitest';
import { addHit, fightDps } from '../src/ui/dummyMeter';

describe('dummy meter', () => {
  it('sums a fight, splits auto / type, and starts a new fight after the idle gap', () => {
    let f = addHit(null, 10, 100, 'phys', true);
    f = addHit(f, 12, 200, 'magic', false);
    expect(f.total).toBe(300);
    expect(f.auto).toBe(100);
    expect(f.magic).toBe(200);
    expect(fightDps(f)).toBe(150);
    const g = addHit(f, 30, 50, 'true', false);
    expect(g.total).toBe(50);
    expect(g.first).toBe(30);
  });
  it('does not report absurd DPS for a single hit', () => expect(fightDps(addHit(null, 5, 400, 'phys', false))).toBe(400));
});
