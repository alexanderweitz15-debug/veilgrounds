// A4 VFX: procedural glyph atlas (white shapes with alpha on a 4 x 2 grid of 64 px cells; order = GLYPHS in
// schema.ts). Only the alpha channel is used, colour comes from the effect. null without a DOM (Node tests).
import * as THREE from 'three';
import { GLYPHS } from './schema';

export const ATLAS_COLS = 4;
export const ATLAS_ROWS = 2;
const CELL = 64;

let atlas: THREE.CanvasTexture | null = null;

function radial(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, stops: [number, number][]): void {
  const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const [t, a] of stops) gr.addColorStop(t, `rgba(255,255,255,${a})`);
  g.fillStyle = gr;
  g.fillRect(cx - r, cy - r, r * 2, r * 2);
}

const PAINT: Record<(typeof GLYPHS)[number], (g: CanvasRenderingContext2D) => void> = {
  // soft round dot (the legacy particle look)
  dot: (g) => radial(g, 32, 32, 31, [[0, 1], [0.35, 0.75], [1, 0]]),
  // four-point star with a hot core
  spark: (g) => {
    radial(g, 32, 32, 14, [[0, 1], [1, 0]]);
    for (const [w, h] of [[3, 30], [30, 3]] as const) {
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 30);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.save();
      g.translate(32, 32);
      g.scale(w / 30, h / 30);
      g.translate(-32, -32);
      g.fillStyle = gr;
      g.beginPath();
      g.arc(32, 32, 30, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  },
  ring: (g) => radial(g, 32, 32, 31, [[0, 0], [0.62, 0], [0.8, 1], [0.92, 0.5], [1, 0]]),
  // kite-shaped sliver
  shard: (g) => {
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.beginPath();
    g.moveTo(32, 2);
    g.lineTo(44, 32);
    g.lineTo(32, 62);
    g.lineTo(20, 32);
    g.closePath();
    g.fill();
    radial(g, 32, 32, 18, [[0, 0.8], [1, 0]]);
  },
  // overlapping low-alpha puffs
  smoke: (g) => {
    for (const [x, y, r] of [[32, 32, 24], [22, 26, 16], [42, 28, 15], [28, 42, 15], [40, 40, 14]] as const) radial(g, x, y, r, [[0, 0.5], [1, 0]]);
  },
  // horizontal streak, thin and long
  streak: (g) => {
    g.save();
    g.translate(32, 32);
    g.scale(1, 0.16);
    g.translate(-32, -32);
    radial(g, 32, 32, 31, [[0, 1], [0.5, 0.6], [1, 0]]);
    g.restore();
  },
  cross: (g) => {
    for (const [w, h] of [[5, 28], [28, 5]] as const) {
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.fillRect(32 - w, 32 - h, w * 2, h * 2);
    }
    radial(g, 32, 32, 16, [[0, 0.8], [1, 0]]);
  },
  // teardrop / flame tongue
  wisp: (g) => {
    const gr = g.createLinearGradient(32, 60, 32, 4);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.9)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(32, 4);
    g.bezierCurveTo(52, 26, 50, 50, 32, 60);
    g.bezierCurveTo(14, 50, 12, 26, 32, 4);
    g.fill();
  },
};

/** The shared glyph atlas texture (created on first use; null in Node tests without a document). */
export function glyphAtlas(): THREE.Texture | null {
  if (atlas || typeof document === 'undefined') return atlas;
  const c = document.createElement('canvas');
  c.width = ATLAS_COLS * CELL;
  c.height = ATLAS_ROWS * CELL;
  const g = c.getContext('2d');
  if (!g) return null;
  GLYPHS.forEach((id, i) => {
    g.save();
    g.translate((i % ATLAS_COLS) * CELL, Math.floor(i / ATLAS_COLS) * CELL);
    g.beginPath();
    g.rect(0, 0, CELL, CELL);
    g.clip();
    PAINT[id](g);
    g.restore();
  });
  atlas = new THREE.CanvasTexture(c);
  atlas.generateMipmaps = false;
  atlas.minFilter = THREE.LinearFilter;
  atlas.magFilter = THREE.LinearFilter;
  return atlas;
}
