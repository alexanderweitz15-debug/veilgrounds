// A13: per-champion combat hints (src/data/bots/hints). Every champion has a valid entry, the entries equal what the
// generator derives from the champion data (unless curated), the validator rejects broken entries, the loader falls
// back to derived hints, and the brain files carry no champion-specific branches.

import { describe, expect, it } from 'vitest';
import { CHAMPION_DATA, championData } from '../src/sim/champions';
import { hintEntry, hintIds, hintsOf, deriveHints, validateHints, SLOT_INDEX, type ChampionHints } from '../src/data/bots/hints';

const ids = Object.keys(CHAMPION_DATA).sort();

describe('bot hints data', () => {
  it('every champion has a hints file and no file is orphaned', () => {
    expect(hintIds()).toEqual(ids);
  });

  it('every entry validates against the schema and its champion data', () => {
    for (const id of ids) expect(validateHints(hintEntry(id), CHAMPION_DATA[id]!), id).toEqual([]);
  });

  it('generated entries equal the derivation from the champion data (stale = run tools/botHints/generate.ts)', () => {
    for (const id of ids) {
      const e = hintEntry(id) as ChampionHints;
      if (e.status === 'curated') continue;
      expect(e, id).toEqual(JSON.parse(JSON.stringify(deriveHints(CHAMPION_DATA[id]!))));
    }
  });

  it('the derivation reads the champion data: ranges, aim kinds, combos and CC come from the abilities', () => {
    for (const id of ids) {
      const c = CHAMPION_DATA[id]!;
      const h = deriveHints(c);
      expect(h.keyRanges.auto).toBe(c.base.range);
      expect(h.combos.filter((k) => k.source === 'data').map((k) => k.sequence)).toEqual(c.combos.map((k) => k.sequence));
      for (let i = 0; i < 4; i++) {
        const a = h.abilities[i]!;
        const d = c.abilities[i]!;
        expect(a.castTime).toBe(d.castTime);
        expect(a.delay).toBe(d.delay ?? 0);
        expect(a.damage).toBe(d.effects.some((e) => e.kind === 'damage' && (!('target' in e) || e.target === undefined || e.target === 'hit' || e.target === 'enemies')));
        if (d.type === 'skillshot_line') {
          expect(a.aim).toBe('line');
          expect(a.width).toBe(d.width ?? 0);
        }
      }
    }
  });

  it('spot checks: engage champions engage, supports peel, line skillshots are dodgeable, ultimates are held', () => {
    const grim = deriveHints(championData('grimald'));
    expect(grim.abilities[2]!.roles).toContain('engage');
    expect(grim.roleHints.engage).toBeGreaterThanOrEqual(4);
    const oda = deriveHints(championData('oda'));
    expect(oda.roleHints.fightRole).toBe('support');
    expect(oda.keyRanges.peel).toBeGreaterThan(0);
    const mira = deriveHints(championData('mira'));
    expect(mira.abilities[1]!.aim).toBe('line');
    expect(mira.abilities[1]!.dodgeable).toBe(true);
    for (const id of ids) expect(deriveHints(CHAMPION_DATA[id]!).abilities[SLOT_INDEX.R]!.holdFor, id).toBe('kill');
  });

  it('the validator rejects broken entries', () => {
    const c = championData('ilvane');
    const good = JSON.parse(JSON.stringify(deriveHints(c))) as ChampionHints;
    expect(validateHints(good, c)).toEqual([]);
    const mut = (f: (h: ChampionHints) => void): string[] => {
      const h = JSON.parse(JSON.stringify(good)) as ChampionHints;
      f(h);
      return validateHints(h, c);
    };
    expect(mut((h) => (h.id = 'brom')).length).toBeGreaterThan(0);
    expect(mut((h) => (h.combos[0]!.sequence = ['Q', 'X'])).length).toBeGreaterThan(0);
    expect(mut((h) => (h.combos = [])).length).toBeGreaterThan(0);
    expect(mut((h) => (h.abilities[0]!.aim = 'circle')).length).toBeGreaterThan(0);
    expect(mut((h) => (h.abilities[1]!.useRange = [500, 100])).length).toBeGreaterThan(0);
    expect(mut((h) => (h.keyRanges.threat = 10)).length).toBeGreaterThan(0);
    expect(mut((h) => (h.keyRanges.auto = 999)).length).toBeGreaterThan(0);
    expect(mut((h) => (h.roleHints.engage = 9)).length).toBeGreaterThan(0);
    expect(mut((h) => (h.abilities[2]!.roles = [])).length).toBeGreaterThan(0);
    expect(mut((h) => (h.abilities[3]!.holdFor = 'always' as never)).length).toBeGreaterThan(0);
    expect(validateHints(null, c).length).toBeGreaterThan(0);
  });

  it('the loader returns the file entry, and derived hints for an unknown champion', () => {
    const c = championData('kaelen');
    expect(hintsOf(c)).toBe(hintsOf(c));
    expect(hintsOf(c).id).toBe('kaelen');
    const ghost = { ...c, id: 'not_in_registry' };
    const h = hintsOf(ghost);
    expect(h.id).toBe('not_in_registry');
    expect(h.keyRanges.auto).toBe(c.base.range);
  });
});

describe('no champion-specific branches in the brain', () => {
  it('brain files contain no quoted champion ids', () => {
    const sources = import.meta.glob<string>(
      ['../src/ai/reflex/*.ts', '../src/ai/combat/*.ts', '../src/ai/bot/{combat,kite,trade,teamfight,spells,lasthit}.ts', '../src/ai/exchange.ts', '../src/ai/ganks/escape.ts'],
      { query: '?raw', import: 'default', eager: true },
    );
    expect(Object.keys(sources).length).toBeGreaterThan(8);
    const re = new RegExp(`['"\`](${ids.join('|')})['"\`]`);
    for (const [f, src] of Object.entries(sources)) expect(src, f).not.toMatch(re);
  });

  it('combat micro modules never import sim state or clocks (fog guard for src/ai/combat)', () => {
    const sources = import.meta.glob<string>('../src/ai/combat/*.ts', { query: '?raw', import: 'default', eager: true });
    expect(Object.keys(sources).length).toBeGreaterThan(0);
    for (const [f, src] of Object.entries(sources)) {
      expect(src, f).not.toMatch(/from '(\.\.\/)+sim\/(sim|ecs|vision)'|from 'bitecs'/);
      expect(src, f).not.toMatch(/Math\.random|Date\.now|performance\.now/);
    }
  });
});
