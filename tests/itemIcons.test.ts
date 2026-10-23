// G icon rework: every item and rune has a motif entry, no two items share glyph + backdrop hue, every glyph and badge
// name has a drawing function in src/ui/icons.ts (the source is scanned: node has no canvas, icons.ts stays unimported).
import { describe, expect, it } from 'vitest';
import itemsJson from '../src/data/items.json';
import runesJson from '../src/data/runes.json';
import { ITEM_ICON_TABLE, RUNE_ICON_TABLE } from '../src/ui/iconTable';

const items = (itemsJson as { items: { id: string }[] }).items;
const runes = (runesJson as { runes: { id: string }[] }).runes;
const src = Object.values(import.meta.glob<string>('../src/ui/icons.ts', { query: '?raw', import: 'default', eager: true }))[0] ?? '';
/** Keys defined as `  name: (g, c) =>` or `  name: (g, c) => ...` inside the glyph records of icons.ts. */
const drawable = new Set([...src.matchAll(/^  (\w+): \(g, c\) =>/gm)].map((m) => m[1]!));

describe('item + rune icon tables', () => {
  it('every item has a motif, every glyph and badge is drawable', () => {
    for (const it of items) {
      const spec = ITEM_ICON_TABLE[it.id];
      expect(spec, it.id).toBeDefined();
      expect(drawable.has(spec!.glyph), `${it.id}: glyph ${spec!.glyph}`).toBe(true);
      if (spec!.accent) expect(drawable.has(spec!.accent), `${it.id}: accent ${spec!.accent}`).toBe(true);
    }
  });
  it('no two items share glyph + backdrop hue (the old regex icons had 28 of 47 in shared groups)', () => {
    const seen = new Map<string, string>();
    for (const it of items) {
      const s = ITEM_ICON_TABLE[it.id]!;
      const key = `${s.glyph}@${s.hue}`;
      expect(seen.get(key), `${it.id} vs ${seen.get(key)}: ${key}`).toBeUndefined();
      seen.set(key, it.id);
    }
  });
  it('every rune has a motif on its path hue, keystones all different', () => {
    const keys = new Set<string>();
    for (const r of runes) {
      const s = RUNE_ICON_TABLE[r.id];
      expect(s, r.id).toBeDefined();
      expect(drawable.has(s!.glyph), `${r.id}: ${s!.glyph}`).toBe(true);
      const key = `${s!.glyph}@${s!.hue}`;
      expect(keys.has(key), `${r.id}: ${key}`).toBe(false);
      keys.add(key);
    }
  });
  it('table entries point at existing items / runes (no leftovers after renames)', () => {
    const ids = new Set(items.map((i) => i.id));
    for (const id of Object.keys(ITEM_ICON_TABLE)) expect(ids.has(id), id).toBe(true);
    const rids = new Set(runes.map((r) => r.id));
    for (const id of Object.keys(RUNE_ICON_TABLE)) expect(rids.has(id), id).toBe(true);
  });
});
