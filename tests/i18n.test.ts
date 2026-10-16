// AGENTS-PLAN §9: every UI string exists in German and English (same keys, same placeholders).
import { describe, expect, it } from 'vitest';
import de from '../src/i18n/de.json';
import en from '../src/i18n/en.json';

const vars = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe('i18n', () => {
  it('de.json and en.json have identical keys', () => {
    const d = Object.keys(de).sort();
    const e = Object.keys(en).sort();
    expect(d.filter((k) => !(k in en)), 'missing in en.json').toEqual([]);
    expect(e.filter((k) => !(k in de)), 'missing in de.json').toEqual([]);
  });

  it('placeholders match and no string is empty', () => {
    const D = de as Record<string, string>;
    const E = en as Record<string, string>;
    const bad = Object.keys(D).filter((k) => k in E && vars(D[k]!).join() !== vars(E[k]!).join());
    expect(bad, 'placeholder mismatch').toEqual([]);
    expect(Object.keys(D).filter((k) => !D[k] || !E[k]), 'empty strings').toEqual([]);
  });
});
