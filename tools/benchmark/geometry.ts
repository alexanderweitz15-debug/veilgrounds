// Pure geometry for the dodge metric.

/**
 * Closest approach of a unit moving with velocity v from p and a projectile moving with velocity u from q, for t in
 * [0, tmax] (seconds): the unit is assumed to keep its velocity (the "would it have hit if it had not dodged" test).
 * Returns the time of the closest approach and the centre distance then.
 */
export function closest(px: number, py: number, vx: number, vy: number, qx: number, qy: number, ux: number, uy: number, tmax: number): { t: number; d: number } {
  const rx = px - qx;
  const ry = py - qy;
  const wx = vx - ux;
  const wy = vy - uy;
  const ww = wx * wx + wy * wy;
  let t = ww < 1e-9 ? 0 : -(rx * wx + ry * wy) / ww;
  t = Math.max(0, Math.min(tmax, t));
  return { t, d: Math.hypot(rx + wx * t, ry + wy * t) };
}
