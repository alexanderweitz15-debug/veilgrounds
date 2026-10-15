// Style lab helpers. Deliberately self-contained (copied/adapted from src/render) so the lab never depends on
// game modules that other work is changing.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Same camera as the game (src/render/camera.ts). */
export const PITCH = THREE.MathUtils.degToRad(56);
export const FOV = 38;

/** Deterministic PRNG (same scatter every load). */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sim-style coordinates (x right, y "north") -> Three position on the ground. */
export function at(x: number, y: number, h = 0): THREE.Vector3 {
  return new THREE.Vector3(x, h, -y);
}

// ------------------------------------------------------------------ colour helpers (hex in, css string out)
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
export function mix(a: string, b: string, t: number): string {
  const A = rgb(a);
  const B = rgb(b);
  return hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}
export function scale(a: string, f: number): string {
  const A = rgb(a);
  return hex(A[0] * f, A[1] * f, A[2] * f);
}
export function luma(a: string): number {
  const A = rgb(a);
  return (0.299 * A[0] + 0.587 * A[1] + 0.114 * A[2]) / 255;
}

// ------------------------------------------------------------------ geometry helpers
/** Constant vertex colour so parts can be merged into one draw call (non-indexed = flat low-poly faces). */
export function paint(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

const outlineMats = new Map<string, THREE.MeshBasicMaterial>();
/** Inverted-hull outline (back faces pushed out along smoothed normals). */
export function outlineMesh(geo: THREE.BufferGeometry, thickness: number, color: string): THREE.Mesh {
  const key = color + thickness;
  let m = outlineMats.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `vec3 transformed = position + normal * ${thickness.toFixed(1)};`);
    };
    m.customProgramCacheKey = () => 'lab-outline' + thickness;
    outlineMats.set(key, m);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.getAttribute('position').clone());
  const merged = mergeVertices(g, 0.5);
  merged.computeVertexNormals();
  return new THREE.Mesh(merged, m);
}

/** Forget cached outline materials (called when the lab rebuilds a variant). */
export function disposeOutlineMats(): void {
  for (const m of outlineMats.values()) m.dispose();
  outlineMats.clear();
}

export function radialCanvas(inner: string, outer: string, size = 128): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}
