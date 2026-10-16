// Attack backswing playback (render/spriteTiming.ts, used by render/championSprites.ts): the strike frame is held longer, the recover shorter,
// but the strike still starts on the hit tick and the whole backswing keeps its length.
import { describe, expect, it } from 'vitest';
import { AFTER_MS, afterFrame } from '../src/render/spriteTiming';

describe('attack after-hit frames', () => {
  for (const n of [1, 2, 3, 4, 5]) {
    it(`n = ${n}: starts on the strike, monotonic, same total length`, () => {
      expect(afterFrame(0, n)).toBe(0);
      let prev = 0;
      for (let ms = 0; ms < n * AFTER_MS; ms += 5) {
        const f = afterFrame(ms, n);
        expect(f).toBeGreaterThanOrEqual(prev);
        expect(f).toBeLessThan(n);
        prev = f;
      }
      expect(afterFrame(n * AFTER_MS - 1, n)).toBe(n - 1);
      expect(afterFrame(n * AFTER_MS + 500, n)).toBe(n - 1);
    });
  }
  it('holds the strike frame longer than one even step', () => {
    expect(afterFrame(AFTER_MS * 1.2, 3)).toBe(0);
    expect(afterFrame(AFTER_MS * 1.2, 2)).toBe(0);
  });
});
