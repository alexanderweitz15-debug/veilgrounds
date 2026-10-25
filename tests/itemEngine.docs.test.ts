// The JSON examples in docs/ITEMS-FORMAT.md (marked `<!-- check: kind -->` before the fence) must pass the item validation,
// so the documentation cannot drift from the format. kinds: item, rule, value, use, cond@<trigger>, effect@<trigger>.
// combat-helpers first: it imports sim.ts before any system module (systems <-> sim import cycle).
import './combat-helpers';
import { describe, expect, it } from 'vitest';
import doc from '../docs/ITEMS-FORMAT.md?raw';
import { ITEMS } from '../src/sim/items/inventory';
import { validateItems } from '../src/sim/items/validate';
import { EFFECT_TYPES, TRIGGERS } from '../src/sim/items/schema';

const text = (s = 'x') => ({ de: s, en: s });
const wrap = (rules: unknown[]): Record<string, unknown> => ({
  id: 'doc_probe',
  name: text(),
  tier: 'basic',
  cost: 300,
  from: [],
  stats: {},
  tags: [],
  passive: { name: text(), desc: text(), rules },
});

interface Example {
  kind: string;
  json: unknown;
  line: number;
}

function examples(): Example[] {
  const out: Example[] = [];
  const re = /<!-- check: ([\w@]+) -->\s*```json\n([\s\S]*?)```/g;
  for (let m = re.exec(doc); m; m = re.exec(doc)) out.push({ kind: m[1]!, json: JSON.parse(m[2]!), line: doc.slice(0, m.index).split('\n').length });
  return out;
}

describe('docs/ITEMS-FORMAT.md examples', () => {
  const list = examples();

  it('has examples of every kind', () => {
    expect(list.length).toBeGreaterThan(20);
    for (const k of ['item', 'rule', 'value', 'use']) expect(list.some((e) => e.kind === k)).toBe(true);
  });

  for (const ex of list) {
    it(`line ${ex.line}: ${ex.kind}`, () => {
      const [kind, trigger = 'onHit'] = ex.kind.split('@') as [string, string?];
      let item: unknown;
      if (kind === 'item') item = ex.json;
      else if (kind === 'rule') item = wrap([ex.json]);
      else if (kind === 'effect') item = wrap([{ on: trigger, do: [ex.json] }]);
      else if (kind === 'cond') item = wrap([{ on: trigger, if: ex.json, do: [{ type: 'restoreMana', value: 1 }] }]);
      else if (kind === 'value') item = wrap([{ on: 'onHit', do: [{ type: 'restoreMana', value: ex.json }] }]);
      else if (kind === 'use') item = { ...wrap([]), tier: 'consumable', passive: { name: text(), desc: text() }, use: ex.json };
      else throw new Error(`unknown example kind ${kind}`);
      expect(() => validateItems([item], ITEMS)).not.toThrow();
    });
  }

  it('documents every trigger and every effect type', () => {
    for (const t of TRIGGERS) expect(doc, `trigger ${t}`).toContain(`\`${t}\``);
    for (const e of EFFECT_TYPES) expect(doc, `effect ${e}`).toContain(`**\`${e}\`**`);
  });
});
