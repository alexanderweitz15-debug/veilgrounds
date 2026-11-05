import { describe, expect, it } from 'vitest';
import { fmtNum, hasteCooldown, keywordSegs, rankedSegs, scalingSegs, type TipStats } from '../src/ui/tooltipMath';

const st: TipStats = { level: 9, ad: 100, bonusAd: 40, ap: 60, maxHp: 1000, bonusHp: 200, haste: 100 };
const names = { ad: 'AD', bonusAd: 'bonus AD', ap: 'AP', maxHp: 'max HP', bonusHp: 'bonus HP', targetMaxHp: 'tmax', targetMissingHp: 'tmiss' };
const text = (s: { text: string }[]): string => s.map((x) => x.text).join('');

describe('tooltipMath', () => {
  it('formats numbers per language', () => {
    expect(fmtNum(2.5, 'de')).toBe('2,5');
    expect(fmtNum(2.5, 'en')).toBe('2.5');
    expect(fmtNum(123.4, 'en')).toBe('123');
  });
  it('haste halves a cooldown at 100', () => expect(hasteCooldown(10, 100)).toBe(5));
  it('highlights the learned rank', () => {
    const s = rankedSegs([60, 95, 130], 2, 'en');
    expect(s.find((x) => x.cls === 'cur')?.text).toBe('95');
  });
  it('resolves ratios with live stats', () => {
    const s = scalingSegs({ base: [80, 100], ap: 0.7 }, 1, st, 'en', names, 'by level');
    expect(text(s)).toContain('80');
    expect(text(s)).toContain('+42');
  });
  it('highlights keywords', () => {
    expect(keywordSegs('Stuns the target', 'en').some((x) => x.cls === 'kw-cc')).toBe(true);
  });
});
