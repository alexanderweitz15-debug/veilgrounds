// G/B5: shop search by name, stat label, passive name and tag; clock formatting for "gold short" ETA.
import { describe, expect, it } from 'vitest';
import { itemById } from '../src/sim/items/inventory';
import { formatClock, itemMatches } from '../src/ui/shopSearch';

describe('shop search', () => {
  it('matches names in both languages, stat labels, passive names and tags', () => {
    const sturm = itemById('sturmbogen')!;
    expect(itemMatches(sturm, 'sturm', 'de')).toBe(true);
    expect(itemMatches(sturm, 'stormbow', 'de')).toBe(true);
    expect(itemMatches(sturm, 'krit', 'de')).toBe(true); // "Krit. Chance"
    expect(itemMatches(sturm, 'böe', 'de')).toBe(true); // passive name
    expect(itemMatches(sturm, 'crit', 'de')).toBe(true); // tag
    expect(itemMatches(sturm, 'rüstung', 'de')).toBe(false);
    expect(itemMatches(itemById('kettenhemd')!, 'rüstung', 'de')).toBe(true);
    expect(itemMatches(sturm, 'sturm krit', 'de')).toBe(true); // every word must match
    expect(itemMatches(sturm, 'sturm rüstung', 'de')).toBe(false);
    expect(itemMatches(sturm, '', 'de')).toBe(true);
  });
  it('formats seconds as m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(80.4)).toBe('1:20');
    expect(formatClock(605)).toBe('10:05');
  });
});
