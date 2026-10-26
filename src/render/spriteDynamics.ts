// Runtime sprite dynamics (agent F): squash / stretch / lean springs applied to the sprite quad on top of the baked
// frames, so starts, stops, strikes, releases and hits are not hard frame cuts. Pure (no THREE, no DOM) so tests can
// run it; render/championSprites.ts composes the result into the instance matrix (scale about the feet + a roll of
// the quad around the view axis). Volume stays roughly constant: a vertical squash widens the figure.

/** Spring state of one sprite instance. */
export interface DynState {
  /** vertical scale offset (0 = rest) and its velocity */
  y: number;
  vy: number;
  /** roll around the view axis (rad, + = top leans toward screen-right) and its velocity */
  lean: number;
  vlean: number;
  /** last integration time (ms) */
  t: number;
}

export interface DynOut {
  sx: number;
  sy: number;
  lean: number;
}

/** stiffness / damping of the two springs (per second units) */
const K_Y = 260;
const C_Y = 2 * Math.sqrt(K_Y) * 0.55; // under-damped: one visible overshoot, then settles
const K_L = 170;
const C_L = 2 * Math.sqrt(K_L) * 0.7;
/** squash clamp so health bars / picking (atlas foot + top) never drift far */
const MAX_Y = 0.22;
const MAX_LEAN = 0.3;

export const newDyn = (now: number): DynState => ({ y: 0, vy: 0, lean: 0, vlean: 0, t: now });

/**
 * Impulses (velocity kicks, per second). `stretch` > 0 pulls the figure taller, < 0 squashes it; `lean` > 0 tips the
 * top toward screen-right. `amp` scales both (reduce-motion, big monsters).
 */
export function kick(d: DynState, stretch: number, lean: number, amp = 1): void {
  d.vy += stretch * amp * 7;
  d.vlean += lean * amp * 6;
}

/** Named impulses so the sprite renderer and the tests agree on the feel. */
export const KICKS = {
  /** idle -> run: stretch up and tip into the run direction (sign from the screen-x of the facing) */
  runStart: (d: DynState, dirX: number, amp = 1): void => kick(d, 0.5, 0.55 * dirX, amp),
  /** run -> idle: settle squash, tip back against the last direction */
  runStop: (d: DynState, dirX: number, amp = 1): void => kick(d, -0.55, -0.35 * dirX, amp),
  /** melee strike lands: squash into the blow, top tips toward the target */
  strikeMelee: (d: DynState, dirX: number, amp = 1): void => kick(d, -0.6, 0.5 * dirX, amp),
  /** ranged release: short recoil (stretch back, tip away from the target) */
  strikeRanged: (d: DynState, dirX: number, amp = 1): void => kick(d, 0.25, -0.3 * dirX, amp),
  /** cast release: pop */
  castRelease: (d: DynState, amp = 1): void => kick(d, 0.45, 0, amp),
  /** took a hit from the side `fromX` (screen-x sign of the source): squash and tip away from it */
  hit: (d: DynState, fromX: number, amp = 1): void => kick(d, -0.5, -0.45 * fromX, amp),
  /** turned around (facing flipped): small sway */
  turn: (d: DynState, dirX: number, amp = 1): void => kick(d, 0.12, 0.3 * dirX, amp),
} as const;

/** Integrates the springs to `now` and returns the quad scale factors + roll. Stable for any frame gap. */
export function stepDyn(d: DynState, now: number): DynOut {
  let dt = (now - d.t) / 1000;
  d.t = now;
  if (!(dt > 0)) dt = 0;
  if (dt > 0.25) dt = 0.25;
  // semi-implicit Euler in <= 8 ms steps so stiff springs stay stable at low frame rates
  while (dt > 0) {
    const h = Math.min(dt, 0.008);
    dt -= h;
    d.vy += (-K_Y * d.y - C_Y * d.vy) * h;
    d.y += d.vy * h;
    d.vlean += (-K_L * d.lean - C_L * d.vlean) * h;
    d.lean += d.vlean * h;
  }
  if (d.y > MAX_Y) d.y = MAX_Y;
  else if (d.y < -MAX_Y) d.y = -MAX_Y;
  if (d.lean > MAX_LEAN) d.lean = MAX_LEAN;
  else if (d.lean < -MAX_LEAN) d.lean = -MAX_LEAN;
  // sleeping springs cost nothing
  if (Math.abs(d.y) < 0.002 && Math.abs(d.vy) < 0.02) d.y = d.vy = 0;
  if (Math.abs(d.lean) < 0.002 && Math.abs(d.vlean) < 0.02) d.lean = d.vlean = 0;
  return { sx: 1 - d.y * 0.6, sy: 1 + d.y, lean: d.lean };
}

/** Is the instance at rest (identity transform)? */
export const dynIdle = (d: DynState): boolean => d.y === 0 && d.lean === 0;
