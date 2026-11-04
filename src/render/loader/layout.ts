// Atlas layout math (pure, no canvas): how many cells fit where, and the canvas area budget.

/**
 * Largest canvas (width x height, px) that every browser we target still draws: iOS/iPadOS Safari silently turns a
 * canvas above 4096x4096 = 16,777,216 px into a blank one (no exception; getContext works, drawImage/getImageData
 * return nothing). Chromium (268 Mpx) and Firefox accept far more, so there the cap is only applied when the runtime
 * probe (src/render/loader/canvasProbe.ts) says the big canvas does not work.
 */
export const MAX_CANVAS_AREA = 16_777_216;

const pot = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

export interface LayoutOptions {
  /** wanted cell edge (px) */
  frame: number;
  /** max texture edge (px) */
  maxSize: number;
  /** max canvas width x height (px), default unlimited */
  maxArea?: number;
  /** cells are never shrunk below this (default 48) unless the wanted size is already smaller */
  minFrame?: number;
}

export interface AtlasLayout {
  /** cell edge actually used (the wanted one, shrunk in steps of 8 px until the cells fit the limits) */
  frame: number;
  width: number;
  height: number;
  perRow: number;
  /** true when the area cap (not the texture edge) forced a smaller cell */
  capped: boolean;
}

function arrange(cells: number, frame: number, maxSize: number): { width: number; height: number; perRow: number } {
  const cols = Math.floor(maxSize / frame);
  const width = Math.min(maxSize, pot(Math.min(cols, cells) * frame));
  const perRow = Math.floor(width / frame);
  const height = pot(Math.ceil(cells / perRow) * frame);
  return { width, height, perRow };
}

/**
 * Power-of-two atlas for `cells` equally sized cells: the largest cell edge <= `frame` (steps of 8 px) whose grid fits
 * into maxSize x maxSize and, when given, into `maxArea` pixels.
 */
export function layoutAtlas(cells: number, o: LayoutOptions): AtlasLayout {
  const minFrame = o.minFrame ?? 48;
  const maxArea = o.maxArea ?? Infinity;
  const fitsEdge = (f: number): boolean => Math.floor(o.maxSize / f) ** 2 >= cells;
  let frame = o.frame;
  let capped = false;
  for (;;) {
    const a = arrange(cells, frame, o.maxSize);
    const fitsArea = a.width * a.height <= maxArea;
    if ((fitsEdge(frame) && fitsArea) || frame <= minFrame) {
      if (!fitsArea) console.warn(`atlas of ${cells} cells exceeds ${maxArea} px even at ${frame} px cells`);
      return { frame, ...a, capped };
    }
    if (fitsEdge(frame) && !fitsArea) capped = true;
    frame -= 8;
  }
}
