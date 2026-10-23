import { describe, expect, it } from 'vitest';
import type { ChampionData, Role } from '../src/sim/champions/schema';
import { ROLES, hookIds, validateChampion } from '../src/data/champions/validate';

// Every champion JSON on disk, keyed by file path.
const files = import.meta.glob<{ default: unknown }>('../src/data/champions/*.json', { eager: true });
const entries = Object.entries(files).map(([path, mod]) => ({ file: path.split('/').pop()!, data: mod.default }));

const ROSTER = [
  'ilvane', 'thessaly', 'kaelen', 'brom', 'oleth', 'mira', 'ferris', 'gorvam', 'vessa', 'nyx', 'harrow', 'seraphyne', 'renn',
  'isolde', 'dagny', 'grimald', 'lio', 'ottilie', 'aurel', 'corvin', 'lysa', 'tobin', 'wren', 'hagen', 'kiran', 'oda', 'sev', 'vargrim',
];
const hasMira = entries.some((e) => e.file === 'mira.json');

describe('champion data', () => {
  it('finds champion files', () => {
    expect(entries.length).toBeGreaterThanOrEqual(25);
  });

  describe.each(entries)('$file', ({ file, data }) => {
    it('conforms to the schema rules', () => {
      expect(validateChampion(data, file)).toEqual([]);
    });

    it('file name matches id', () => {
      expect((data as ChampionData).id + '.json').toBe(file);
    });

    it('has rank arrays of length 5 (Q/W/E) and 3 (R), cast times within 0..0.5', () => {
      const c = data as ChampionData;
      c.abilities.forEach((a, i) => {
        const len = i === 3 ? 3 : 5;
        for (const v of [a.range, a.cooldown, a.cost, a.duration]) if (Array.isArray(v)) expect(v).toHaveLength(len);
        expect(a.castTime).toBeGreaterThanOrEqual(0);
        expect(a.castTime).toBeLessThanOrEqual(0.5);
      });
    });

    it('has exactly three combos and at most one hard dash', () => {
      const c = data as ChampionData;
      expect(c.combos).toHaveLength(3);
      expect(c.abilities.filter((a) => a.type === 'dash').length).toBeLessThanOrEqual(1);
    });
  });

  it('ids are unique', () => {
    const ids = entries.map((e) => (e.data as ChampionData).id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('hook ids are unique across the roster', () => {
    const all = entries.flatMap((e) => hookIds(e.data as ChampionData));
    expect(all.length).toBe(new Set(all).size);
  });

  it('contains every roster champion except possibly mira', () => {
    const ids = new Set(entries.map((e) => (e.data as ChampionData).id));
    const expected = hasMira ? ROSTER : ROSTER.filter((id) => id !== 'mira');
    expect([...ids].sort()).toEqual([...expected].sort());
  });

  it.skipIf(!hasMira)('all roster ids are present (needs mira.json from Agent B)', () => {
    const ids = new Set(entries.map((e) => (e.data as ChampionData).id));
    for (const id of ROSTER) expect(ids.has(id), `missing ${id}.json`).toBe(true);
  });

  it('typed loader (src/data/champions/index.ts) accepts every file', async () => {
    const { champions } = await import('../src/data/champions/index');
    expect(Object.keys(champions).sort()).toEqual(entries.map((e) => (e.data as ChampionData).id).sort());
  });

  it('validator rejects broken data', () => {
    const c = structuredClone(entries.find((e) => e.file === 'ilvane.json')!.data) as ChampionData & Record<string, unknown>;
    c.abilities[0].cooldown = [1, 2, 3];
    c.abilities[1].type = 'dash';
    c.abilities[2].castTime = 0.8;
    (c.abilities[3] as unknown as Record<string, unknown>).widht = 50;
    c.combos = c.combos.slice(0, 2);
    c.roles = ['middle' as Role];
    const errs = validateChampion(c, 'broken').join('\n');
    for (const needle of ['rank array length 3', 'max 1 hard dash', 'castTime', 'unknown key "widht"', 'exactly 3 combos', 'invalid role'])
      expect(errs).toContain(needle);
  });

  it('at least five primary champions per role (ADC counted with mira only once mira.json exists)', () => {
    const counts = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<Role, number>;
    for (const e of entries) counts[(e.data as ChampionData).roles[0]]++;
    if (!hasMira) {
      console.warn('mira.json missing: ADC primary count checked as >= 4 until Agent B adds Mira');
      counts.adc++;
    }
    for (const r of ROLES) expect(counts[r], `primary ${r}`).toBeGreaterThanOrEqual(5);
  });
});
