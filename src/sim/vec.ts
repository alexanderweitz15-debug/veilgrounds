// Deterministic vector helpers. Only + - * / sqrt (IEEE-754 exact). No Math.sin/cos/atan2 in sim code.

export const dist2 = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
};

export const dist = (ax: number, ay: number, bx: number, by: number): number => Math.sqrt(dist2(ax, ay, bx, by));

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Distance from point P to segment AB, squared. */
export function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / len2 : 0;
  t = clamp(t, 0, 1);
  return dist2(px, py, ax + abx * t, ay + aby * t);
}

/** Unit direction from A to B; returns [0,0] when coincident. */
export function dir(ax: number, ay: number, bx: number, by: number): [number, number] {
  const dx = bx - ax;
  const dy = by - ay;
  const l = Math.sqrt(dx * dx + dy * dy);
  return l > 0 ? [dx / l, dy / l] : [0, 0];
}

/**
 * Cone test without trig: is P inside the cone at A pointing along unit (dx,dy) with half-angle whose
 * cosine is cosHalf, within range r?
 */
export function inCone(px: number, py: number, ax: number, ay: number, dx: number, dy: number, cosHalf: number, r: number): boolean {
  const vx = px - ax;
  const vy = py - ay;
  const l2 = vx * vx + vy * vy;
  if (l2 > r * r) return false;
  if (l2 === 0) return true;
  const d = vx * dx + vy * dy;
  return d > 0 && d * d >= cosHalf * cosHalf * l2;
}

/**
 * Does a circle (unit hitbox at p, radius pr) touch the cone sector (apex a, unit direction d, half-angle cosine
 * cosHalf, range r)? Centre inside the angle within r + pr, or the hitbox overlapping one of the two side edges.
 * Matches the drawn telegraph exactly on the sides ("Hitbox = sichtbare Fläche").
 */
export function circleInCone(px: number, py: number, pr: number, ax: number, ay: number, dx: number, dy: number, cosHalf: number, r: number): boolean {
  if (inCone(px, py, ax, ay, dx, dy, cosHalf, r + pr)) return true;
  const sinHalf = Math.sqrt(Math.max(0, 1 - cosHalf * cosHalf));
  const pr2 = pr * pr;
  for (const s of [sinHalf, -sinHalf]) {
    const ex = dx * cosHalf - dy * s;
    const ey = dx * s + dy * cosHalf;
    if (segDist2(px, py, ax, ay, ax + ex * r, ay + ey * r) <= pr2) return true;
  }
  return false;
}

/** cos/sin via Taylor series (only + and *), so results are bit-identical on every engine, unlike Math.cos. */
export function cosRad(x: number): number {
  const TWO_PI = 6.283185307179586;
  x = x - TWO_PI * Math.floor(x / TWO_PI + 0.5); // to [-pi, pi]
  const x2 = x * x;
  let term = 1;
  let sum = 1;
  for (let n = 1; n <= 12; n++) {
    term *= -x2 / ((2 * n - 1) * (2 * n));
    sum += term;
  }
  return sum;
}
export const sinRad = (x: number): number => cosRad(x - 1.5707963267948966);
export const cosDeg = (deg: number): number => cosRad((deg * Math.PI) / 180);

/** Rotate unit vector (dx,dy) by deg degrees. */
export function rotate(dx: number, dy: number, deg: number): [number, number] {
  const c = cosDeg(deg);
  const s = sinRad((deg * Math.PI) / 180);
  return [dx * c - dy * s, dx * s + dy * c];
}
