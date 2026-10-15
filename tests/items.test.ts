import { describe, expect, it } from 'vitest';
import itemsJson from '../src/data/items.json';
import runesJson from '../src/data/runes.json';
import type { ItemData, RuneData } from '../src/sim/items/schema';
import { botRunes, defaultRunes, runePresets, runesFromPreset } from '../src/sim/items/runes';
import { Rng } from '../src/sim/rng';

const items = itemsJson.items as unknown as ItemData[];
const runes = runesJson.runes as unknown as RuneData[];
const byId = new Map(items.map((i) => [i.id, i]));
const count = (...tiers: string[]): number => items.filter((i) => tiers.includes(i.tier)).length;

describe('items (spec §5)', () => {
  it('40 items: 12 basic (incl. 5 starters), 14 components, 14 legendary; base boots 300 + 4 upgrades at 1100', () => {
    expect(count('starter', 'basic')).toBe(12);
    expect(count('starter')).toBe(5);
    expect(count('component')).toBe(14);
    expect(count('legendary')).toBe(14);
    expect(count('starter', 'basic', 'component', 'legendary')).toBe(40);
    const boots = items.filter((i) => i.tier === 'boots' && i.id !== 'stiefel');
    expect(byId.get('stiefel')?.cost).toBe(300);
    expect(boots.length).toBe(4);
    for (const b of boots) expect(b.cost).toBe(1100);
    for (const b of boots) expect(b.from).toEqual(['stiefel']);
  });

  it('ids unique, recipes reference existing cheaper items, recipe cost non-negative', () => {
    expect(byId.size).toBe(items.length);
    for (const i of items) {
      const parts = i.from.map((id) => byId.get(id));
      for (const p of parts) expect(p, `${i.id} from`).toBeDefined();
      const sum = parts.reduce((a, p) => a + p!.cost, 0);
      expect(i.cost - sum, `${i.id} recipe cost`).toBeGreaterThanOrEqual(0);
    }
  });

  it('cost bands and legendary recipes from 2-3 components', () => {
    for (const i of items) {
      if (i.tier === 'basic' || i.tier === 'starter') expect(i.cost).toBeGreaterThanOrEqual(300), expect(i.cost).toBeLessThanOrEqual(1100);
      if (i.tier === 'component') expect(i.cost).toBeGreaterThanOrEqual(700), expect(i.cost).toBeLessThanOrEqual(1300);
      if (i.tier === 'legendary') {
        // Hüterstab costs 2500 in the spec table itself, below the stated 2600 band.
        expect(i.cost).toBeGreaterThanOrEqual(i.id === 'hueterstab' ? 2500 : 2600);
        expect(i.cost).toBeLessThanOrEqual(3400);
        expect(i.from.length).toBeGreaterThanOrEqual(2);
        expect(i.from.length).toBeLessThanOrEqual(3);
        for (const id of i.from) expect(byId.get(id)!.tier).toBe('component');
      }
    }
  });

  it('exactly two legendary actives (Zeitglas, Kettenrelais)', () => {
    expect(items.filter((i) => i.active).map((i) => i.id).sort()).toEqual(['kettenrelais', 'zeitglas']);
  });
});

const builds = import.meta.glob('../src/data/builds/*.json', { eager: true, import: 'default' }) as Record<string, {
  champion: string;
  starter: string[];
  standard: { boots: string; core: string[] };
  vsAD: { boots: string; core: string[] };
  vsAP: { boots: string; core: string[] };
  runes: { keystone: string; minor: string[] };
}>;

describe('builds (data/builds)', () => {
  it('26 champions, every id resolves, core legendaries unique, boots are boots, 1 keystone + 3 minors', () => {
    const list = Object.values(builds);
    expect(list.length).toBe(26);
    const runeIds = new Map(runes.map((r) => [r.id, r]));
    for (const b of list) {
      for (const id of b.starter) expect(byId.has(id), `${b.champion} starter ${id}`).toBe(true);
      for (const v of [b.standard, b.vsAD, b.vsAP]) {
        expect(byId.get(v.boots)?.tier).toBe('boots');
        expect(new Set(v.core).size).toBe(v.core.length);
        for (const id of v.core) expect(byId.get(id)?.tier, `${b.champion} ${id}`).toBe('legendary');
      }
      expect(runeIds.get(b.runes.keystone)?.kind).toBe('keystone');
      expect(b.runes.minor.length).toBe(3);
      for (const m of b.runes.minor) expect(runeIds.get(m)?.kind).toBe('minor');
    }
  });
});

describe('rune presets', () => {
  it('every champion has 4 valid presets with distinct minors; default = build runes', () => {
    const kinds = new Map(runes.map((r) => [r.id, r.kind]));
    for (const b of Object.values(builds)) {
      const ps = runePresets(b.champion);
      expect(ps.map((p) => p.id)).toEqual(['standard', 'aggressiv', 'sicher', 'gegen_magie']);
      for (const p of ps) {
        expect(kinds.get(p.keystone), `${b.champion}/${p.id}`).toBe('keystone');
        expect(new Set(p.minor).size).toBe(3);
        for (const m of p.minor) expect(kinds.get(m), `${b.champion}/${p.id}/${m}`).toBe('minor');
      }
      expect(defaultRunes(b.champion)).toEqual({ keystone: b.runes.keystone, minor: b.runes.minor });
      expect(runesFromPreset(b.champion, 'unbekannt')).toEqual(defaultRunes(b.champion));
    }
  });
  it('bots: optimal share follows the profile', () => {
    const rng = new Rng(5);
    const std = defaultRunes('ilvane');
    const hits = Array.from({ length: 1000 }, () => botRunes('ilvane', 75, rng)).filter((r) => r.keystone === std.keystone && r.minor.join() === std.minor.join()).length;
    expect(hits).toBeGreaterThan(700);
    expect(hits).toBeLessThan(800);
  });
});

describe('Prägungen', () => {
  it('4 keystones + 12 minor', () => {
    expect(runes.filter((r) => r.kind === 'keystone').length).toBe(4);
    expect(runes.filter((r) => r.kind === 'minor').length).toBe(12);
  });
});
