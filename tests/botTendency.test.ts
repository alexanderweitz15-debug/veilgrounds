// FEATURE-GAP 1.7: playstyle axis value -> plain-language tendency (scoreboard Bot-Info tooltips).
import { describe, expect, it } from 'vitest';
import { PLAYSTYLE_AXES } from '../src/ai/contract';
import de from '../src/i18n/de.json';
import en from '../src/i18n/en.json';
import { TENDENCY_KEYS, tendencyKey, tendencyText, tendencyTier } from '../src/ui/botTendency';

describe('bot tendency text', () => {
  it('maps -5..+5 to five symmetric tiers', () => {
    const tiers = Array.from({ length: 11 }, (_, i) => tendencyTier(i - 5));
    expect(tiers).toEqual([-2, -2, -1, -1, 0, 0, 0, 1, 1, 2, 2]);
  });

  it('clamps and rounds out-of-range values', () => {
    expect(tendencyTier(-9)).toBe(-2);
    expect(tendencyTier(9)).toBe(2);
    expect(tendencyTier(1.6)).toBe(1);
    expect(tendencyTier(Number.NaN)).toBe(0);
  });

  it('produces the documented German sentences', () => {
    expect(tendencyText('aggression', 5)).toBe('spielt sehr aggressiv');
    expect(tendencyText('aggression', -5)).toBe('spielt sehr passiv');
    expect(tendencyText('roam', -4)).toBe('roamt selten');
    expect(tendencyText('roam', 5, 'en')).toBe('roams constantly');
    expect(tendencyText('kiting', -5)).toBe('kitet wie ein Profi');
    expect(tendencyText('kiting', 5)).toBe('kitet nie');
  });

  it('has a distinct text for every axis and tier in both languages', () => {
    for (const lang of ['de', 'en'] as const) {
      for (const a of PLAYSTYLE_AXES) {
        const texts = [-5, -3, 0, 3, 5].map((v) => tendencyText(a, v, lang));
        expect(texts.every((x) => x.length > 0), `${a} ${lang}`).toBe(true);
        expect(new Set(texts).size, `${a} ${lang} distinct`).toBe(5);
      }
    }
  });

  it('every produced key exists in de.json and en.json', () => {
    expect(TENDENCY_KEYS).toHaveLength(PLAYSTYLE_AXES.length * 5);
    for (const k of TENDENCY_KEYS) {
      expect(k in de, `de ${k}`).toBe(true);
      expect(k in en, `en ${k}`).toBe(true);
    }
    expect(tendencyKey('tempo', 4)).toBe('tend.tempo.2');
  });
});
