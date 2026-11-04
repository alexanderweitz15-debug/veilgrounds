// Missing-asset placeholder: the classic pink/black checkerboard. A sprite id that has no renderer, whose bake failed or
// whose atlas did not arrive in time is drawn with it instead of staying invisible (or a generic blob that looks like
// a deliberate sprite). The atlas builder reserves one cell for it (champions/atlas.ts), whole-atlas fallbacks use
// `placeholderAtlas` below.
import { ANIMS, DIRS, FPS, LOOP, type Anim, type ChampionAtlas, type Dir, type FrameRect } from '../champions/atlas';
import { paintChecker } from './checker';

export { paintChecker, CHECKER_PINK, CHECKER_BLACK, CHECKER_SQUARES } from './checker';

/** What a stand-in atlas needs to know about an id (plain numbers: kept free of the sprite renderer for tests). */
export interface PlaceholderSpec {
  /** frames per anim; at least one frame each is created */
  frames: Record<Anim, number>;
  world: number;
  foot: number;
}

export const DEFAULT_PLACEHOLDER_SPEC: PlaceholderSpec = { frames: { idle: 1, run: 1, attack: 1, cast: 1, death: 1 }, world: 260, foot: 0.935 };

/**
 * A complete atlas in which every given id is the checkerboard (one 64 px cell). Used when a whole atlas failed or did
 * not arrive within its time budget, so the match can start with clearly visible stand-ins; the real atlas replaces it
 * as soon as it is ready. Needs a DOM canvas.
 */
export function placeholderAtlas(ids: string[], spec: (id: string) => PlaceholderSpec = () => DEFAULT_PLACEHOLDER_SPEC): ChampionAtlas {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  paintChecker(ctx, 0, 0, size);
  return placeholderAtlasFrom(canvas, size, ids, spec);
}

/** Pure part of `placeholderAtlas` (testable without a canvas). */
export function placeholderAtlasFrom(canvas: HTMLCanvasElement, size: number, ids: string[], spec: (id: string) => PlaceholderSpec): ChampionAtlas {
  // whole cell, half-texel inset like the real atlas (UVs follow three.js CanvasTexture defaults: v = 1 at the top)
  const rect: FrameRect = { x: 0, y: 0, w: size, h: size, u0: 0.5 / size, u1: 1 - 0.5 / size, v0: 0.5 / size, v1: 1 - 0.5 / size, flip: false };
  const frames: ChampionAtlas['frames'] = {};
  const worldSize: Record<string, number> = {};
  const foot: Record<string, number> = {};
  const top: Record<string, number> = {};
  const rate: Record<string, Record<Anim, number>> = {};
  const hit: Record<string, number> = {};
  for (const id of ids) {
    const s = spec(id);
    const a = {} as Record<Anim, Record<Dir, FrameRect[]>>;
    for (const anim of ANIMS) {
      const d = {} as Record<Dir, FrameRect[]>;
      for (const dir of DIRS) d[dir] = Array.from({ length: Math.max(1, s.frames[anim]) }, () => rect);
      a[anim] = d;
    }
    frames[id] = a;
    worldSize[id] = s.world;
    foot[id] = s.foot;
    top[id] = 0.2;
    rate[id] = { ...FPS };
    hit[id] = 0;
  }
  return { canvas, frameSize: size, frames, worldSize, foot, top, fps: { ...FPS }, rate, hit, loop: { ...LOOP }, placeholders: [...ids], check: { x: 1, y: 1 } };
}
