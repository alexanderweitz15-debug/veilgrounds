// C5 / FEATURE-GAP 4.2: own rune page validation, minor toggling, preset fallback.
import { describe, expect, it } from 'vitest';
import { CUSTOM_ID, runesFor, toggleMinor, validPage } from '../src/game/runePages';
import { RUNES, runesFromPreset } from '../src/sim/items/runes';

const KEY = RUNES.find((r) => r.kind === 'keystone')!.id;
const MIN = RUNES.filter((r) => r.kind === 'minor').map((r) => r.id);

describe('own rune page', () => {
  it('accepts one keystone + three different minors only', () => {
    expect(validPage({ keystone: KEY, minor: [MIN[0]!, MIN[1]!, MIN[2]!] })).toBe(true);
    expect(validPage({ keystone: KEY, minor: [MIN[0]!, MIN[0]!, MIN[2]!] })).toBe(false);
    expect(validPage({ keystone: MIN[0]!, minor: [MIN[1]!, MIN[2]!, MIN[3]!] })).toBe(false);
    expect(validPage({ keystone: KEY, minor: [KEY, MIN[1]!, MIN[2]!] })).toBe(false);
    expect(validPage(undefined)).toBe(false);
  });

  it('toggling keeps at most three minors (oldest drops out)', () => {
    let m: string[] = [];
    for (const id of MIN.slice(0, 4)) m = toggleMinor(m, id);
    expect(m).toEqual(MIN.slice(1, 4));
    expect(toggleMinor(m, MIN[2]!)).toEqual([MIN[1], MIN[3]]);
  });

  it('without a saved page the custom id falls back to the default preset', () => {
    expect(runesFor('mira', CUSTOM_ID)).toEqual(runesFromPreset('mira', undefined));
  });
});
