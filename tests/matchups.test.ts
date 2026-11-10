// Matchup hint data: every champion has a class and strong/weak lists, ids are valid, relations are consistent, texts in de + en.
import { describe, expect, it } from 'vitest';
import { champions } from '../src/data/champions';
import { matchupOf, strongAgainst } from '../src/data/matchups';
import data from '../src/data/matchups.json';

describe('matchups', () => {
  it('every champion has a class, 1-3 strong and 1-3 weak entries with valid ids', () => {
    for (const id of Object.keys(champions)) {
      const m = matchupOf(id);
      expect(m, id).not.toBeNull();
      expect(m!.strong.length, `${id} strong`).toBeGreaterThanOrEqual(1);
      expect(m!.weak.length, `${id} weak`).toBeGreaterThanOrEqual(1);
      expect(m!.strong.length).toBeLessThanOrEqual(3);
      expect(m!.weak.length).toBeLessThanOrEqual(3);
      for (const e of [...m!.strong, ...m!.weak]) {
        expect(champions[e.id], `${id} -> ${e.id}`).toBeDefined();
        expect(e.id).not.toBe(id);
      }
    }
  });

  it('strong entries follow the class relations; weak entries are the reverse relation', () => {
    for (const id of Object.keys(champions)) {
      const m = matchupOf(id)!;
      for (const e of m.strong) expect(strongAgainst(id, e.id), `${id} strong vs ${e.id}`).toBe(true);
      for (const e of m.weak) expect(strongAgainst(e.id, id), `${id} weak vs ${e.id}`).toBe(true);
    }
  });

  it('relations and class names have de and en texts, relations reference known classes', () => {
    const cls = new Set(Object.keys(data.classInfo));
    for (const [k, v] of Object.entries(data.relations)) {
      const [a, b] = k.split('>');
      expect(cls.has(a!) && cls.has(b!), k).toBe(true);
      expect(v.de.length).toBeGreaterThan(5);
      expect(v.en.length).toBeGreaterThan(5);
    }
    for (const v of Object.values(data.classInfo)) expect(v.de && v.en).toBeTruthy();
    expect(matchupOf('nobody')).toBeNull();
  });
});
