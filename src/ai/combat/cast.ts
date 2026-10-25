// Micro-layer cast aiming (A13): where to throw a line / ground-circle spell at a champion, or null to hold it.
// Used by src/ai/bot/combat.ts castSlot for the beta brain only (microOn). Pure with respect to the world: the
// target's observed velocity, the caster's position and the ability data are the whole input; the bot's rng is
// drawn from only here (aim noise), in a fixed order.

import type { Rng } from '../../sim/rng';
import type { AbilityData } from '../../sim/champions/schema';
import type { BotStatic, SnapEntity } from '../bot/types';
import type { View } from '../bot/perception';
import { dst } from '../bot/geo';
import { aimNoise, circleConfidence, intercept, lineConfidence, observedVelocity, rotateAim, segmentBlocked, type Vec } from './aim';
import { MICRO } from './params';

/** poke = free harassment (strict: only a clean shot), fight = trade / all-in / teamfight (a thrown spell also forces a reaction). */
export type AimMode = 'poke' | 'fight';

/** Line skillshot: aim point, or null (out of reach, blocked by a minion, or too unlikely to land for this mode). */
export function aimLine(v: View, ctx: BotStatic, rng: Rng, t: SnapEntity, ab: AbilityData, range: number, mode: AimMode): Vec | null {
  const from = v.self;
  const vel = observedVelocity(t);
  const speed = ab.speed ?? 0;
  const noise = aimNoise(ctx.profile.behavior.aimErrorDeg, rng);
  const exact = intercept(from, t, vel, speed, ab.castTime);
  const reach = Math.min(range, 1500) * MICRO.aim.rangeShare;
  if (dst(from, exact) > reach) return null;
  if (lineConfidence(from, exact, vel, exact.t, (ab.width ?? 60) / 2 + t.radius) < MICRO.aim.minConfidence[mode]) return null;
  if (ab.flags?.includes('blocked_by_minions') && segmentBlocked(from, exact, ab.width ?? 60, [...v.enemyMinions, ...v.monsters])) return null;
  // the exact solution decided whether to throw; the rank's lead noise decides where the throw goes
  const p = intercept(from, t, vel, speed, ab.castTime, noise.lead);
  return rotateAim(from, p, noise.deg, range);
}

/** Ground circle / zone: centre point, or null. Standing targets (wind-up, rooted, stunned) are the reliable hits. */
export function aimCircle(v: View, ctx: BotStatic, rng: Rng, t: SnapEntity, ab: AbilityData, range: number, mode: AimMode): Vec | null {
  const from = v.self;
  const vel = observedVelocity(t);
  const radius = ab.radius ?? 200;
  const noise = aimNoise(ctx.profile.behavior.aimErrorDeg, rng);
  const fixed = ab.castTime + (ab.delay ?? 0);
  const exact = intercept(from, t, vel, 0, fixed);
  const maxCast = Math.min(range, 1500);
  const d = dst(from, exact);
  if (d > maxCast + radius * 0.5) return null;
  if (circleConfidence(vel, fixed, radius, t.radius) < MICRO.aim.minConfidence[mode]) return null;
  const p = intercept(from, t, vel, 0, fixed, noise.lead);
  return rotateAim(from, p, noise.deg, maxCast);
}
