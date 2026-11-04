// Missing-asset placeholder: pink/black checkerboard with a complete atlas shape, so every consumer works unchanged.
import './loaderEnv';
import { describe, expect, it } from 'vitest';
import { CHECKER_BLACK, CHECKER_PINK, CHECKER_SQUARES, paintChecker } from '../src/render/loader/checker';
import { DEFAULT_PLACEHOLDER_SPEC, placeholderAtlasFrom } from '../src/render/loader/placeholder';
import { ANIMS, DIRS } from '../src/render/champions/atlas';
import { atlasCanvasValid } from '../src/render/loader/canvasProbe';

describe('checkerboard', () => {
  it('alternates pink and black squares over the whole cell', () => {
    const fills: { c: string; x: number; y: number; w: number }[] = [];
    const ctx = {
      fillStyle: '',
      fillRect(x: number, y: number, w: number) {
        fills.push({ c: this.fillStyle, x, y, w });
      },
    };
    paintChecker(ctx as unknown as CanvasRenderingContext2D, 10, 20, 64);
    expect(fills).toHaveLength(CHECKER_SQUARES * CHECKER_SQUARES);
    expect(fills[0]).toMatchObject({ c: CHECKER_PINK, x: 10, y: 20, w: 8 });
    expect(fills[1]!.c).toBe(CHECKER_BLACK);
    expect(fills[CHECKER_SQUARES]!.c).toBe(CHECKER_BLACK); // next row starts with the other colour
    expect(new Set(fills.map((f) => f.c))).toEqual(new Set([CHECKER_PINK, CHECKER_BLACK]));
  });
});

describe('placeholder atlas', () => {
  const canvas = {} as HTMLCanvasElement;
  const a = placeholderAtlasFrom(canvas, 64, ['fenna', 'melee0'], (id) => (id === 'melee0' ? { frames: { idle: 4, run: 6, attack: 4, cast: 0, death: 3 }, world: 180, foot: 0.9 } : DEFAULT_PLACEHOLDER_SPEC));

  it('has frames for every anim and direction of every id, all showing the same cell', () => {
    for (const id of ['fenna', 'melee0']) for (const anim of ANIMS) for (const dir of DIRS) expect(a.frames[id]![anim][dir].length).toBeGreaterThan(0);
    expect(a.frames.melee0!.run.E).toHaveLength(6);
    expect(a.frames.melee0!.cast.E).toHaveLength(1); // at least one frame even for "no cast"
    const r = a.frames.fenna!.idle.S[0]!;
    expect(r.u0).toBeGreaterThan(0);
    expect(r.u1).toBeLessThan(1);
    expect(r.flip).toBe(false);
  });

  it('carries the metadata the sprite batches read (world size, foot, rates, hit frame)', () => {
    expect(a.worldSize).toEqual({ fenna: 260, melee0: 180 });
    expect(a.foot.melee0).toBe(0.9);
    expect(a.rate.fenna!.run).toBeGreaterThan(0);
    expect(a.hit.fenna).toBe(0);
    expect(a.placeholders).toEqual(['fenna', 'melee0']);
  });

  it('atlasCanvasValid reads the check pixel: pink = fine, transparent (blank canvas) = invalid', () => {
    const mk = (px: number[]) => ({ getContext: () => ({ getImageData: () => ({ data: px }) }) }) as unknown as HTMLCanvasElement;
    expect(atlasCanvasValid({ canvas: mk([255, 0, 255, 255]), check: { x: 1, y: 1 } })).toBe(true);
    expect(atlasCanvasValid({ canvas: mk([0, 0, 0, 0]), check: { x: 1, y: 1 } })).toBe(false);
    expect(atlasCanvasValid({ canvas: { getContext: () => null } as unknown as HTMLCanvasElement, check: { x: 1, y: 1 } })).toBe(false);
    expect(atlasCanvasValid({ canvas: { getContext: () => { throw new Error('x'); } } as unknown as HTMLCanvasElement, check: { x: 1, y: 1 } })).toBe(false);
  });
});
