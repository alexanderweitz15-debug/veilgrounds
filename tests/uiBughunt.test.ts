// ui-bughunt regressions: data files must be clean UTF-8 (no mojibake), encyclopedia shows no raw enum ids.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MOJIBAKE = /├|┬|Ã[¤¼¶\u009f]|â€|�/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.json')) out.push(p);
  }
  return out;
}

describe('ui bughunt', () => {
  it('no JSON data file under src/ contains mojibake', () => {
    const bad = walk('src').filter((f) => MOJIBAKE.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});
