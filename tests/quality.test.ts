import { describe, expect, it } from 'vitest';
import { PRESET_IDS, QUALITY, currentFields, effectivePixelRatio, matchPreset, presetFields, resolveQuality } from '../src/render/gfxPreset';
import { Benchmark, FrameLimiter, pickPreset } from '../src/game/gfxTune';
import { DEFAULT_SETTINGS } from '../src/settings';

describe('graphics presets', () => {
  it('every preset round-trips through its fields', () => {
    for (const p of PRESET_IDS) {
      expect(matchPreset(presetFields(p))).toBe(p);
      expect(resolveQuality({ graphics: 'custom', ...presetFields(p) })).toEqual(QUALITY[p]);
    }
  });
  it('a changed field is custom, changing it back re-selects the preset', () => {
    const f = presetFields('high');
    expect(matchPreset({ ...f, gfxShadows: false })).toBe('custom');
    expect(matchPreset({ ...f, gfxShadows: true })).toBe('high');
  });
  it('custom clamps bad values; presets ignore the fields', () => {
    const q = resolveQuality({ graphics: 'custom', gfxShadowMap: 99999, gfxPixelRatio: -3, gfxParticles: NaN });
    expect(q.shadowMap).toBe(4096);
    expect(q.pixelRatio).toBe(0.5);
    expect(q.particles).toBe(1);
    expect(resolveQuality({ graphics: 'low', gfxShadows: true })).toEqual(QUALITY.low);
  });
  it('panel fields follow the preset unless custom', () => {
    expect(currentFields({ ...DEFAULT_SETTINGS, graphics: 'veryLow' })).toEqual(presetFields('veryLow'));
    expect(currentFields({ ...DEFAULT_SETTINGS, graphics: 'custom', gfxShadows: false }).gfxShadows).toBe(false);
  });
  it('effective pixel ratio = dpr capped by preset times render scale', () => {
    expect(effectivePixelRatio(2, QUALITY.high, 100)).toBe(1.5);
    expect(effectivePixelRatio(2, QUALITY.high, 50)).toBe(0.75);
    expect(effectivePixelRatio(1, QUALITY.veryHigh, 100)).toBe(1);
  });
});

/** Frames rendered out of a rAF stream with the given gaps (ms). */
function rendered(gaps: number[], cap: number): number {
  const l = new FrameLimiter();
  let t = 1000;
  let n = 0;
  for (const g of gaps) {
    t += g;
    if (l.tick(t, cap)) n++;
  }
  return n;
}

describe('frame limiter', () => {
  const at60 = Array<number>(120).fill(1000 / 60);
  it('cap 60 on 60 Hz and uncapped render every frame', () => {
    expect(rendered(at60, 60)).toBe(120);
    expect(rendered(at60, 0)).toBe(120);
    expect(rendered(at60, 120)).toBe(120);
  });
  it('cap 30 on 60 Hz renders every 2nd frame', () => {
    expect(rendered(at60, 30)).toBe(60);
  });
  it('cap 30 on 144 Hz renders about 30 fps', () => {
    const n = rendered(Array<number>(1440).fill(1000 / 144), 30);
    expect(n).toBeGreaterThanOrEqual(295);
    expect(n).toBeLessThanOrEqual(305);
  });
  it('jittery 60 Hz gaps keep cap 60', () => {
    const gaps = at60.map((g, i) => g + (i % 2 ? 1.5 : -1.5));
    expect(rendered(gaps, 60)).toBe(120);
  });
  it('a 500 ms stall renders one frame without a catch-up burst', () => {
    const l = new FrameLimiter();
    let t = 0;
    for (let i = 0; i < 10; i++) l.tick((t += 16.67), 60);
    expect(l.tick((t += 500), 60)).toBe(true);
    expect(l.tick((t += 16.67), 60)).toBe(true);
  });
});

describe('graphics benchmark', () => {
  it('picks a preset from the frame times', () => {
    expect(pickPreset({ avgMs: 16.7, p90Ms: 17 })).toBe('high');
    expect(pickPreset({ avgMs: 8.3, p90Ms: 8.8 })).toBe('veryHigh');
    expect(pickPreset({ avgMs: 20, p90Ms: 30 })).toBe('medium');
    expect(pickPreset({ avgMs: 30, p90Ms: 40 })).toBe('low');
    expect(pickPreset({ avgMs: 50, p90Ms: 70 })).toBe('veryLow');
    expect(pickPreset({ avgMs: 120, p90Ms: 150 })).toBe('veryLow');
  });
  it('skips the warm-up and ignores stalls', () => {
    const b = new Benchmark();
    let t = 0;
    let r = null;
    // 1 s of slow warm-up frames must not count, then 3 s at 20 ms with one 1 s stall
    for (; t < 1000; t += 100) r = b.add(t);
    for (let i = 0; i < 400 && !r; i++) r = b.add((t += i === 50 ? 1000 : 20));
    expect(r).not.toBeNull();
    expect(r!.avgMs).toBeCloseTo(20, 0);
  });
  it('restarts when the tab was hidden the whole time', () => {
    const b = new Benchmark();
    expect(b.add(0)).toBeNull();
    expect(b.add(5000)).toBeNull();
    expect(b.add(10000)).toBeNull();
  });
});
