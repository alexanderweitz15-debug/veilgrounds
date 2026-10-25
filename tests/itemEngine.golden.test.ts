// Characterization of every item (A7): the data-driven item engine must reproduce the numbers of the former code-hook
// implementation bit-exactly. Fixture: tests/fixtures/itemsGolden.json (generator: tests/itemGoldenTrace.ts).
// Regenerate only after an intended balance or base-stat change: UPDATE_GOLDEN=1 npx vitest run tests/itemEngine.golden
import { describe, expect, it } from 'vitest';
import golden from './fixtures/itemsGolden.json';
import { goldenTrace } from './itemGoldenTrace';

const update = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env?.UPDATE_GOLDEN;

describe('item golden trace', () => {
  // only the items of the fixture are pinned: items added later (A12 content) do not break it, removed ones do
  const now = JSON.parse(JSON.stringify(goldenTrace(update ? undefined : new Set(Object.keys(golden.stats))))) as typeof golden;

  it('regenerates the fixture on request', async () => {
    if (!update) return;
    const fs = await import(/* @vite-ignore */ 'node:fs' as string);
    fs.writeFileSync(new URL('./fixtures/itemsGolden.json', import.meta.url), JSON.stringify(now));
  });

  it('item stats are unchanged', () => {
    if (update) return;
    expect(now.stats).toEqual(golden.stats);
  });

  it('shop rules are unchanged', () => {
    if (update) return;
    expect(now.shop).toEqual(golden.shop);
  });

  const ids = Object.keys(golden.script);
  it('every pinned item still exists', () => {
    if (update) return;
    expect(Object.keys(now.stats)).toEqual(Object.keys(golden.stats));
    expect(Object.keys(now.script)).toEqual(ids);
  });

  for (const id of ids) {
    it(`script ${id}`, () => {
      if (update) return;
      expect((now.script as Record<string, unknown>)[id]).toEqual((golden.script as Record<string, unknown>)[id]);
    });
  }
});
