// Champion portraits for the UI: a head-and-shoulders crop of the procedural champion sprite (idle, 3/4 view)
// on a dusk backdrop, as a PNG data URL. Rendered lazily on the main thread (one per task) and cached per id.
import { headAnchor, renderMaster } from './champions';

const OUT = 128;
const RES = 512;
/**
 * 3/4 view turned to the viewer's left (0 = facing the viewer) so the weapon hand stays behind the body; the crop
 * is then mirrored, so the champion faces right and the sprites' key light falls on the face.
 */
const YAW = -Math.PI / 5;

const cache = new Map<string, string | null>();

/** Portrait data URL (renders synchronously on a cache miss, ~20–40 ms); null for unknown ids. */
export function portraitUrl(id: string): string | null {
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  let url: string | null = null;
  try {
    url = render(id);
  } catch (e) {
    console.warn(`portrait '${id}' failed`, e);
  }
  cache.set(id, url);
  return url;
}

/** Highest row with visible pixels in the column band [x0, x1] above `maxY` (maxY when nothing is found). */
function opaqueTop(src: CanvasImageSource & { width: number; height: number }, x0: number, x1: number, maxY: number): number {
  const g = (src as HTMLCanvasElement).getContext?.('2d') as CanvasRenderingContext2D | null;
  if (!g) return maxY;
  const a = Math.max(0, Math.floor(x0));
  const w = Math.max(1, Math.min(src.width, Math.ceil(x1)) - a);
  const h = Math.max(1, Math.min(src.height, Math.ceil(maxY)));
  const px = g.getImageData(a, 0, w, h).data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3]! > 40) return y;
  return maxY;
}

function render(id: string): string | null {
  const head = headAnchor(id, YAW, RES);
  if (!head) return null;
  const src = renderMaster(id, 'idle', YAW, 0, RES);
  const c = document.createElement('canvas');
  c.width = c.height = OUT;
  const g = c.getContext('2d')!;
  // backdrop: dusk violet with a warm glow from the upper left (the mirrored key light)
  const bg = g.createRadialGradient(OUT * 0.3, OUT * 0.25, OUT * 0.05, OUT * 0.5, OUT * 0.5, OUT * 0.75);
  bg.addColorStop(0, '#7a5a62');
  bg.addColorStop(0.45, '#3a2d48');
  bg.addColorStop(1, '#16121e');
  g.fillStyle = bg;
  g.fillRect(0, 0, OUT, OUT);
  // crop: head slightly above centre, shoulders at the bottom; the window grows upward when hair, hats, horns or
  // headdresses reach above the head sphere (Ilvane, Seraphyne ...), so nothing is cut at the top edge
  let side = head.r * 5.4;
  const cx = head.x - head.r * 0.2;
  let cy = head.y + head.r * 0.7;
  const want = opaqueTop(src, cx - head.r * 2.2, cx + head.r * 2.2, head.y) - head.r * 0.3;
  if (cy - side / 2 > want) {
    const bottom = cy + side / 2;
    side = bottom - want;
    cy = bottom - side / 2;
  }
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.save();
  g.translate(OUT, 0);
  g.scale(-1, 1);
  g.drawImage(src, cx - side / 2, cy - side / 2, side, side, 0, 0, OUT, OUT);
  g.restore();
  // soft vignette
  const vg = g.createRadialGradient(OUT / 2, OUT / 2, OUT * 0.42, OUT / 2, OUT / 2, OUT * 0.72);
  vg.addColorStop(0, 'rgba(10,8,16,0)');
  vg.addColorStop(1, 'rgba(10,8,16,0.55)');
  g.fillStyle = vg;
  g.fillRect(0, 0, OUT, OUT);
  return c.toDataURL('image/png');
}

const queue: { el: HTMLElement; id: string }[] = [];
let pumping = false;
function pump(): void {
  const job = queue.shift();
  if (!job) {
    pumping = false;
    return;
  }
  if (job.el.isConnected && job.el.dataset.portrait === job.id) apply(job.el, portraitUrl(job.id));
  setTimeout(pump, 0);
}

function apply(el: HTMLElement, url: string | null): void {
  if (!url) return;
  el.textContent = '';
  el.style.backgroundImage = `url(${url})`;
  el.style.backgroundSize = 'cover';
  el.style.backgroundPosition = 'center';
}

/**
 * Shows the champion's portrait as the element's background (the element keeps its letter placeholder until the
 * portrait is rendered; cached portraits apply immediately, new ones one per task so menus stay responsive).
 */
export function setPortrait(el: HTMLElement, id: string): void {
  el.dataset.portrait = id;
  const hit = cache.get(id);
  if (hit !== undefined) {
    apply(el, hit);
    return;
  }
  queue.push({ el, id });
  if (!pumping) {
    pumping = true;
    setTimeout(pump, 0);
  }
}

// ------------------------------------------------------------------------------------------------ splash art
const SW = 360;
const SH = 450;
const SRES = 768;
const splashCache = new Map<string, string | null>();

/** Hash → stable 0..1 for per-champion backdrop variation. */
const hash01 = (s: string, k: number): number => {
  let h = k;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 1000) / 1000;
};

/**
 * Full-body "loading screen" splash (4:5): dusk sky, painted mountain silhouettes, a warm ground glow and the
 * champion large in the foreground. ~80–150 ms on a cache miss.
 */
export function splashUrl(id: string): string | null {
  const hit = splashCache.get(id);
  if (hit !== undefined) return hit;
  let url: string | null = null;
  try {
    url = renderSplash(id);
  } catch (e) {
    console.warn(`splash '${id}' failed`, e);
  }
  splashCache.set(id, url);
  return url;
}

function renderSplash(id: string): string | null {
  const src = renderMaster(id, 'idle', YAW, 0, SRES);
  const c = document.createElement('canvas');
  c.width = SW;
  c.height = SH;
  const g = c.getContext('2d')!;
  // sky: per-champion hue shift of the dusk palette
  const hue = Math.round(hash01(id, 7) * 60 - 30);
  const sky = g.createLinearGradient(0, 0, 0, SH);
  sky.addColorStop(0, `hsl(${260 + hue}, 30%, 14%)`);
  sky.addColorStop(0.45, `hsl(${330 + hue}, 28%, 30%)`);
  sky.addColorStop(0.62, `hsl(${25 + hue / 2}, 45%, 46%)`);
  sky.addColorStop(1, `hsl(${280 + hue}, 25%, 10%)`);
  g.fillStyle = sky;
  g.fillRect(0, 0, SW, SH);
  // sun glow behind the figure
  const sun = g.createRadialGradient(SW * 0.62, SH * 0.48, 4, SW * 0.62, SH * 0.48, SW * 0.6);
  sun.addColorStop(0, 'rgba(255,214,150,0.55)');
  sun.addColorStop(1, 'rgba(255,214,150,0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, SW, SH);
  // two mountain ridges (painted silhouettes)
  const ridge = (base: number, amp: number, color: string, seed: number): void => {
    g.beginPath();
    g.moveTo(0, SH);
    for (let x = 0; x <= SW; x += 12) {
      const n = Math.sin(x * 0.021 + seed) * 0.6 + Math.sin(x * 0.053 + seed * 2.3) * 0.3 + Math.sin(x * 0.11 + seed * 5.1) * 0.1;
      g.lineTo(x, base - n * amp);
    }
    g.lineTo(SW, SH);
    g.closePath();
    g.fillStyle = color;
    g.fill();
  };
  ridge(SH * 0.6, 34, `hsla(${270 + hue}, 22%, 26%, 0.85)`, hash01(id, 3) * 10);
  ridge(SH * 0.72, 26, `hsla(${265 + hue}, 25%, 15%, 0.95)`, hash01(id, 5) * 10);
  // ground
  const gr = g.createLinearGradient(0, SH * 0.78, 0, SH);
  gr.addColorStop(0, 'rgba(40,30,34,0.0)');
  gr.addColorStop(1, 'rgba(18,13,18,0.95)');
  g.fillStyle = gr;
  g.fillRect(0, SH * 0.7, SW, SH * 0.3);
  // figure: crop from head to feet, mirrored like the portraits
  const head = headAnchor(id, YAW, SRES);
  const feet = SRES * 0.95;
  const top = head ? head.y - (feet - head.y) * 0.32 : SRES * 0.18;
  const ch = feet - top;
  const cw = ch * (SW / SH);
  const cx = head ? head.x : SRES / 2;
  // ground shadow
  g.fillStyle = 'rgba(8,6,10,0.55)';
  g.beginPath();
  g.ellipse(SW * 0.5, SH * 0.945, SW * 0.28, SH * 0.025, 0, 0, Math.PI * 2);
  g.fill();
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.save();
  g.translate(SW, 0);
  g.scale(-1, 1);
  g.drawImage(src, cx - cw / 2, top, cw, ch, 0, SH * 0.02, SW, SH * 0.96);
  g.restore();
  // vignette + bottom fade for text
  const vg = g.createRadialGradient(SW / 2, SH * 0.45, SW * 0.35, SW / 2, SH * 0.5, SW * 0.85);
  vg.addColorStop(0, 'rgba(10,8,16,0)');
  vg.addColorStop(1, 'rgba(10,8,16,0.6)');
  g.fillStyle = vg;
  g.fillRect(0, 0, SW, SH);
  const bf = g.createLinearGradient(0, SH * 0.75, 0, SH);
  bf.addColorStop(0, 'rgba(12,9,14,0)');
  bf.addColorStop(1, 'rgba(12,9,14,0.85)');
  g.fillStyle = bf;
  g.fillRect(0, SH * 0.75, SW, SH * 0.25);
  return c.toDataURL('image/jpeg', 0.9);
}

/** Splash as element background, rendered on the next task (keeps clicks responsive). */
export function setSplash(el: HTMLElement, id: string): void {
  el.dataset.splash = id;
  const show = (url: string | null): void => {
    if (!url || el.dataset.splash !== id) return;
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
  };
  const hit = splashCache.get(id);
  if (hit !== undefined) return show(hit);
  setTimeout(() => show(splashUrl(id)), 0);
}
