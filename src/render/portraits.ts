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
  // crop: head slightly above centre, shoulders at the bottom
  const side = head.r * 5.4;
  const cx = head.x - head.r * 0.2;
  const cy = head.y + head.r * 0.7;
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
