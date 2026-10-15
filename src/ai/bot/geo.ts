// Pure geometry helpers for bots (lane progress along a polyline, distances). No sim state.

import type { Pt } from '../../sim/map';

export const d2 = (a: Pt, b: Pt): number => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
export const dst = (a: Pt, b: Pt): number => Math.sqrt(d2(a, b));

/** Arc-length position of p projected onto the polyline, and its distance from the line. */
export function laneProgress(pts: readonly Pt[], p: Pt): { s: number; off: number } {
  let acc = 0;
  let best = { s: 0, off: Infinity };
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    const len = Math.sqrt(len2);
    let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const off = dst(p, { x: a.x + abx * t, y: a.y + aby * t });
    if (off < best.off) best = { s: acc + len * t, off };
    acc += len;
  }
  return best;
}

/** Point at arc length s along the polyline (clamped). */
export function lanePoint(pts: readonly Pt[], s: number): Pt {
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const len = dst(a, b);
    if (s <= acc + len || i + 2 === pts.length) {
      const t = len > 0 ? Math.max(0, Math.min(1, (s - acc) / len)) : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    acc += len;
  }
  return { ...pts[0]! };
}

/** Unit vector a->b ([0,0] if coincident). */
export function unit(a: Pt, b: Pt): [number, number] {
  const l = dst(a, b);
  return l > 0 ? [(b.x - a.x) / l, (b.y - a.y) / l] : [0, 0];
}
