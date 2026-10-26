// S1 / FEATURE-GAP 1.14: rule order of the death recap hint.
import { describe, expect, it } from 'vitest';
import { deathHint, type HintHit } from '../src/game/deathHint';
import de from '../src/i18n/de.json';
import en from '../src/i18n/en.json';

const hit = (o: Partial<HintHit>): HintHit => ({ ago: 5, kind: 'champ', key: 'c1', amount: 100, type: 'phys', ...o });

describe('death hint', () => {
  it('picks the first matching rule', () => {
    expect(deathHint([])).toBe('default');
    expect(deathHint([hit({ kind: 'tower', key: 'tower' }), hit({})])).toBe('tower');
    expect(deathHint([hit({ key: 'c1' }), hit({ key: 'c2' })])).toBe('group');
    expect(deathHint([hit({ kind: 'minion', key: 'minion', amount: 300 }), hit({})])).toBe('minions');
    expect(deathHint([hit({ kind: 'monster', key: 'monster', amount: 300 }), hit({})])).toBe('monster');
    expect(deathHint([hit({ ago: 1 })])).toBe('burst');
    expect(deathHint([hit({ type: 'magic' }), hit({ type: 'magic', ago: 7 })])).toBe('magic');
    expect(deathHint([hit({}), hit({ ago: 8 })])).toBe('phys');
    expect(deathHint([hit({ type: 'true' }), hit({ ago: 8, type: 'true' })])).toBe('default');
  });

  it('every hint has a de and en text', () => {
    for (const id of ['tower', 'group', 'minions', 'monster', 'burst', 'magic', 'phys', 'default']) {
      expect(de).toHaveProperty(`recap.hint.${id}`);
      expect(en).toHaveProperty(`recap.hint.${id}`);
    }
  });
});
