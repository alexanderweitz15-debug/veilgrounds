// Organic outlines for the wall polygons (map.json stays the collision truth): corners rounded, edges wobbled.
// The visual outline stays within about -35..+60 units of the collision polygon; unit centres keep 75 units of
// clearance (sim/map.ts UNIT_CLEARANCE), so nothing visibly clips. Shared by the 3D cliffs and the minimap.
import type { Pt } from '../sim/map';

const area = (p: Pt[]): number => {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j]!.x - p[i]!.x) * (p[j]!.y + p[i]!.y);
  return a / 2;
};

/** Chaikin corner cutting (one pass). */
function chaikin(p: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
  }
  return out;
}

function densify(p: Pt[], step: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

/** Smooth 1D noise along the outline (deterministic per seed). */
function wobble(t: number, seed: number): number {
  return Math.sin(t * 0.013 + seed) * 0.5 + Math.sin(t * 0.031 + seed * 2.3) * 0.3 + Math.sin(t * 0.071 + seed * 0.7) * 0.2;
}

/** Outline offset along the outward normals by `base` + `amp` * noise (negative base = inset). */
export function offsetOutline(p: Pt[], base: number, amp: number, seed: number): Pt[] {
  const ccw = area(p) > 0; // positive for counter-clockwise (y up): the right-hand normal points outward
  const out: Pt[] = [];
  let t = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[(i - 1 + p.length) % p.length]!;
    const c = p[i]!;
    const b = p[(i + 1) % p.length]!;
    let nx = b.y - a.y;
    let ny = -(b.x - a.x);
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    if (!ccw) {
      nx = -nx;
      ny = -ny;
    }
    if (i > 0) t += Math.hypot(c.x - p[i - 1]!.x, c.y - p[i - 1]!.y);
    const d = base + amp * wobble(t, seed);
    out.push({ x: c.x + nx * d, y: c.y + ny * d });
  }
  return out;
}

/** Rounded, wobbly outline of a wall polygon (render only). */
export function organicOutline(poly: Pt[], seed: number, base = 32, amp = 26): Pt[] {
  const smooth = chaikin(chaikin(densify(poly, 220)));
  return offsetOutline(densify(smooth, 70), base, amp, seed);
}

export function pointInPoly(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from (x, y) to the polygon boundary. */
export function edgeDist(x: number, y: number, poly: Pt[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]!;
    const b = poly[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
    const d = Math.hypot(x - a.x - dx * t, y - a.y - dy * t);
    if (d < best) best = d;
  }
  return best;
}
