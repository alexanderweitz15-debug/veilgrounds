// Skillshot aiming of the micro layer (A13). A player leads a moving target from what he SEES: where the target was a
// moment ago and where it is now. Here: the observed velocity (previous tick -> this tick, SnapEntity px/py), nothing
// else - no cooldown, no path, no intent of the target. Rank enters only through the aim noise (profile aimErrorDeg:
// the aim angle noise of old, plus a noise on the lead itself) and through the error rate of the caller.
//
//   intercept        iterated solution of "where will it be when the missile arrives" (the old code used the current
//                    distance for the flight time: a fleeing target outruns that lead)
//   hit confidence   how likely the throw lands given the path uncertainty (lateral speed for lines, any speed for
//                    delayed ground circles) - below the mode's threshold the bot holds the spell
//   noise            angle noise (aimErrorDeg) + lead noise sigma = aimErrorDeg / leadNoiseDivisor

import { rotate } from '../../sim/vec';
import type { Rng } from '../../sim/rng';
import type { SnapEntity } from '../bot/types';
import { MICRO } from './params';

export interface Vec {
  x: number;
  y: number;
}

/** Missiles at or above this speed (units / s) arrive instantly (hitscan-like). */
const INSTANT_SPEED = 20000;
const MAX_ITER = 4;

/** Observed velocity (units / s): the step of the last tick. Zero for a unit that did not move. */
export function observedVelocity(e: SnapEntity): Vec {
  return { x: (e.x - e.px) * 30, y: (e.y - e.py) * 30 };
}

export interface Intercept {
  x: number;
  y: number;
  /** Seconds from the key press until the effect reaches the point. */
  t: number;
}

/**
 * Point where a target with constant velocity `vel` is hit by a missile of `speed` (0 / instant = no flight) that
 * leaves the caster after `fixedS` seconds (cast time, plus the area delay for ground spells). `lead` scales the
 * velocity (1 = exact lead, 0 = aim at the current position).
 */
export function intercept(from: Vec, target: Vec, vel: Vec, speed: number, fixedS: number, lead = 1): Intercept {
  let t = fixedS;
  let x = target.x + vel.x * lead * t;
  let y = target.y + vel.y * lead * t;
  if (speed > 0 && speed < INSTANT_SPEED) {
    for (let i = 0; i < MAX_ITER; i++) {
      t = fixedS + Math.hypot(x - from.x, y - from.y) / speed;
      x = target.x + vel.x * lead * t;
      y = target.y + vel.y * lead * t;
    }
  }
  return { x, y, t };
}

/**
 * Hit confidence 0..1 of a line missile aimed at `p` (arrival after `t` s) at a target with velocity `vel`:
 * hitHalf = missile half width + target radius; the path uncertainty grows with the lateral speed (crossing the
 * line) and a little with any speed.
 */
export function lineConfidence(from: Vec, p: Vec, vel: Vec, t: number, hitHalf: number): number {
  const dx = p.x - from.x;
  const dy = p.y - from.y;
  const l = Math.hypot(dx, dy) || 1;
  const vperp = Math.abs((vel.x * dy - vel.y * dx) / l);
  const speed = Math.hypot(vel.x, vel.y);
  const u = t * (MICRO.aim.jukeLateral * vperp + MICRO.aim.jukeSpeed * speed);
  return hitHalf / (hitHalf + u);
}

/** Hit confidence of a ground circle of `radius` that resolves `t` s after the press, on a target of `speed`. */
export function circleConfidence(vel: Vec, t: number, radius: number, targetRadius: number): number {
  const half = radius + targetRadius * 0.5;
  const u = t * MICRO.aim.jukeCircle * Math.hypot(vel.x, vel.y);
  return half / (half + u);
}

/** Lead factor and aim-angle noise of this throw (rank: profile aimErrorDeg). */
export function aimNoise(aimErrorDeg: number, rng: Rng): { lead: number; deg: number } {
  const lead = 1 + (rng.normal() * aimErrorDeg) / MICRO.aim.leadNoiseDivisor;
  return { lead: Math.max(0, Math.min(2, lead)), deg: rng.normal() * aimErrorDeg };
}

/** Rotate the aim point around the caster by `deg`, keep it at most `maxR` away. */
export function rotateAim(from: Vec, p: Vec, deg: number, maxR: number): Vec {
  const dx = p.x - from.x;
  const dy = p.y - from.y;
  const d = Math.min(maxR, Math.hypot(dx, dy));
  const l = Math.hypot(dx, dy) || 1;
  const [ex, ey] = rotate(dx / l, dy / l, deg);
  return { x: from.x + ex * d, y: from.y + ey * d };
}

/** True if a unit of `blockers` sits on the segment from -> to (minion-blocked missiles). */
export function segmentBlocked(from: Vec, to: Vec, width: number, blockers: readonly (Vec & { radius: number })[]): boolean {
  const bx = to.x - from.x;
  const by = to.y - from.y;
  const len2 = bx * bx + by * by || 1;
  for (const m of blockers) {
    const t = ((m.x - from.x) * bx + (m.y - from.y) * by) / len2;
    if (t <= 0 || t >= 1) continue;
    const dx = m.x - (from.x + bx * t);
    const dy = m.y - (from.y + by * t);
    if (dx * dx + dy * dy < (m.radius + width / 2) * (m.radius + width / 2)) return true;
  }
  return false;
}
