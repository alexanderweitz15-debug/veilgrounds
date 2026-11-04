// Runtime check for the canvas size limit of strict browsers (iOS/iPadOS Safari: 16,777,216 px). Such a browser does not
// throw for a bigger canvas: getContext('2d') succeeds and everything drawn into it is lost, so the sprite atlas would
// be a transparent texture and every champion invisible. Chromium/Firefox cannot be made to fail like that, so the
// decision is made by a feature test instead of a user-agent guess.
import type { ChampionAtlas } from '../champions/atlas';
import { MAX_CANVAS_AREA } from './layout';

/** True if a w x h canvas keeps what is drawn into its last pixel (read back through getImageData). */
export function canvasKeepsPixels(w: number, h: number): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(w - 1, h - 1, 1, 1);
    const d = ctx.getImageData(w - 1, h - 1, 1, 1).data;
    c.width = c.height = 0; // free the backing store at once
    return d[3] === 255 && d[0] === 255 && d[2] === 255;
  } catch {
    return false;
  }
}

let big: boolean | undefined;
/**
 * Whether canvases above MAX_CANVAS_AREA work in this browser (probed once with the smallest oversize rectangle,
 * 8192 x 2049 px, whose sides are within every browser's edge limit). False also when the probe cannot run.
 */
export function bigCanvasWorks(): boolean {
  if (big === undefined) {
    const t0 = performance.now();
    big = canvasKeepsPixels(8192, Math.floor(MAX_CANVAS_AREA / 8192) + 1);
    console.info(`canvas probe: canvases above ${MAX_CANVAS_AREA} px ${big ? 'work' : 'do NOT work: atlases are planned within the limit'} (${Math.round(performance.now() - t0)} ms)`);
  }
  return big;
}

/** Area cap to plan sprite atlases with: none where big canvases work, else the safe limit. */
export function atlasAreaCap(): number | undefined {
  return bigCanvasWorks() ? undefined : MAX_CANVAS_AREA;
}

/** True if the atlas canvas holds its content (the reserved checkerboard cell reads back opaque pink). */
export function atlasCanvasValid(a: Pick<ChampionAtlas, 'canvas' | 'check'>): boolean {
  try {
    const ctx = a.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    const d = ctx.getImageData(a.check.x, a.check.y, 1, 1).data;
    return d[3] === 255 && d[0] === 255 && d[1] === 0 && d[2] === 255;
  } catch {
    return false;
  }
}
