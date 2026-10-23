// D2 combat readability helpers: facing smoothing, hit-flash throttle, knock-up / dash lift.
import { describe, expect, it } from 'vitest';
import { FlashGate, READ, airborneLift, dashLift, flashAmp, turnToward } from '../src/render/readability';
import { BAR_MAX_STEPS, stackBars } from '../src/render/barLayout';
import { CC_GLYPH_KEYS, drawCcGlyph } from '../src/render/ccGlyphs';

describe('facing smoothing', () => {
  it('turns 180 deg in facingMs180, never overshoots, takes the short way round', () => {
    let a = 0;
    a = turnToward(a, Math.PI, READ.facingMs180 / 2);
    expect(Math.abs(a)).toBeCloseTo(Math.PI / 2, 5);
    a = turnToward(a, Math.PI, READ.facingMs180);
    expect(a).toBe(Math.PI);
    // 350 deg -> 10 deg is a 20 deg turn, not 340
    const b = turnToward((350 / 180) * Math.PI, (10 / 180) * Math.PI, 1);
    expect(b).toBeGreaterThan((350 / 180) * Math.PI);
  });
});

describe('hit flash', () => {
  it('at most one flash per unit per gap (4/s), units independent', () => {
    const g = new FlashGate();
    let n = 0;
    for (let t = 0; t < 1000; t += 33) if (g.accept(7, t)) n++;
    // hits arrive on a 33 ms grid: the effective gap is minGapMs rounded up to that grid (120 -> 132, 250 -> 264)
    expect(n).toBe(Math.ceil(1000 / (Math.ceil(READ.hitFlash.minGapMs / 33) * 33)));
    expect(g.accept(8, 500)).toBe(true);
    expect(flashAmp('minion', false)).toBeLessThan(flashAmp('champion', false));
    expect(flashAmp('champion', true)).toBe(READ.hitFlash.ampReduceMotion);
  });
});

describe('HP bar stacking', () => {
  it('fixed bars stay; overlapping minion bars move up, separate ones stay', () => {
    const off = stackBars([
      { id: 1, x: 100, y: 100, w: 54, h: 5, fixed: false },
      { id: 2, x: 110, y: 101, w: 54, h: 5, fixed: false },
      { id: 3, x: 400, y: 100, w: 54, h: 5, fixed: false },
      { id: 4, x: 90, y: 98, w: 104, h: 11, fixed: true },
    ]);
    expect(off.get(4)).toBe(0);
    expect(off.get(3)).toBe(0);
    expect(off.get(1)!).toBeLessThan(0);
    expect(off.get(2)!).toBeLessThan(off.get(1)!);
    expect(off.get(2)!).toBeGreaterThanOrEqual(-BAR_MAX_STEPS * (5 + 2));
  });
});

describe('CC glyphs', () => {
  it('every CC type draws its own shape (headless mock context)', () => {
    const calls: string[] = [];
    const g = new Proxy({} as Record<string, unknown>, {
      get: (_t, k) => (typeof k === 'string' && ['strokeStyle', 'fillStyle', 'lineWidth', 'lineCap', 'lineJoin'].includes(k) ? '' : (...a: unknown[]) => calls.push(`${String(k)}:${a.length}`)),
      set: () => true,
    }) as unknown as CanvasRenderingContext2D;
    const sigs = new Set<string>();
    for (const k of CC_GLYPH_KEYS) {
      calls.length = 0;
      drawCcGlyph(g, k, 10, 10, 14, '#fff', 0);
      expect(calls.length).toBeGreaterThan(3);
      sigs.add(calls.join(','));
    }
    expect(sigs.size).toBe(CC_GLYPH_KEYS.length);
  });
});

describe('B7 atlas strip cache layout', () => {
  it('strip keys separate resolution / mirror, cells run STRIP_COLS per row', async () => {
    const { STRIP_COLS, stripKey, stripPos } = await import('../src/render/atlasStrip');
    expect(stripKey('mira', 192, 128, true)).not.toBe(stripKey('mira', 192, 112, true));
    expect(stripKey('mira', 192, 128, true)).not.toBe(stripKey('mira', 192, 128, false));
    expect(stripPos(0, 128)).toEqual({ x: 0, y: 0 });
    expect(stripPos(STRIP_COLS + 2, 100)).toEqual({ x: 200, y: 100 });
  });
});

describe('lift', () => {
  it('knock-up and dash arcs are 0 at both ends and peak in the middle', () => {
    expect(airborneLift(0)).toBe(0);
    expect(airborneLift(1)).toBe(0);
    expect(airborneLift(0.5)).toBe(READ.airborne.height);
    expect(dashLift(0.5, 10000)).toBe(READ.dash.maxHeight);
    expect(dashLift(0.5, 100)).toBeCloseTo(READ.dash.heightPer100, 5);
  });
});
