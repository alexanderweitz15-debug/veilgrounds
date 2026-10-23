// Attack backswing playback (render/spriteTiming.ts, used by render/championSprites.ts): the strike frame is held longer, the recover shorter,
// but the strike still starts on the hit tick and the whole backswing keeps its length.
import { describe, expect, it } from 'vitest';
import { AFTER_MS, RUN_RATE_MAX, RUN_RATE_MIN, RUN_REF_PER_TICK, afterFrame, castPoseActive, runRate, windupMsOf } from '../src/render/spriteTiming';

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

describe('G feel: cast pose, run rate, wind-up from the snapshot', () => {
  it('cast pose plays fully while standing, ends one AFTER_MS after the release when walking', () => {
    const dur = 250; // wind-up until the release
    const len = dur + AFTER_MS * 3.6;
    expect(castPoseActive(dur + AFTER_MS * 2, dur, len, false)).toBe(true);
    expect(castPoseActive(len + 1, dur, len, false)).toBe(false);
    expect(castPoseActive(dur + AFTER_MS - 1, dur, len, true)).toBe(true); // release frame still shows while walking
    expect(castPoseActive(dur + AFTER_MS + 1, dur, len, true)).toBe(false); // then the run cycle takes over
    expect(castPoseActive(dur / 2, dur, len, true)).toBe(true); // the gather before the release is never cut
  });
  it('run cycle rate follows the walked distance, clamped, authored rate when pushed', () => {
    expect(runRate(14, RUN_REF_PER_TICK)).toBeCloseTo(14);
    expect(runRate(14, RUN_REF_PER_TICK * 1.2)).toBeCloseTo(16.8);
    expect(runRate(14, RUN_REF_PER_TICK * 3)).toBeCloseTo(14 * RUN_RATE_MAX);
    expect(runRate(14, RUN_REF_PER_TICK * 0.3)).toBeCloseTo(14 * RUN_RATE_MIN);
    expect(runRate(14, 0)).toBe(14);
  });
  it('wind-up length comes from atkStart/atkEnd (ticks) when the snapshot carries them', () => {
    expect(windupMsOf(100, 108)).toBeCloseTo((8 * 1000) / 30);
    expect(windupMsOf(undefined, 108)).toBeNull();
    expect(windupMsOf(108, 108)).toBeNull();
  });
});
