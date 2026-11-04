// ui-bughunt regressions: data files must be clean UTF-8 (no mojibake).
import { describe, expect, it } from 'vitest';

const MOJIBAKE = /├|┬|Ã[¤¼¶\u009f]|â€|�/;
const files = import.meta.glob<string>('../src/**/*.json', { query: '?raw', import: 'default', eager: true });

describe('ui bughunt', () => {
  it('no JSON data file under src/ contains mojibake', () => {
    expect(Object.keys(files).length).toBeGreaterThan(10);
    expect(Object.keys(files).filter((f) => MOJIBAKE.test(files[f]!))).toEqual([]);
  });
});
