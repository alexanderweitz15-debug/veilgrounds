// Sprite playback timing shared by render/championSprites.ts (kept free of canvas code so tests can import it).
import { TICK_HZ } from '../sim/types';

/** frame time of the follow-through frames after an attack's hit point / a cast's release */
export const AFTER_MS = 95;

/**
 * Frames after the hit point with a hold on the strike (hitstop feel) and a quicker settle: relative durations of
 * strike / follow-through ... / recover, normalised so the whole backswing still lasts `n * AFTER_MS`. The strike
 * frame still starts exactly on the sim's hit tick (frame index 0 here = the hit frame).
 */
const AFTER_WEIGHTS: Record<number, number[]> = { 1: [1], 2: [1.35, 0.65], 3: [1.5, 0.95, 0.55], 4: [1.45, 1, 0.85, 0.7] };
export function afterFrame(ms: number, n: number): number {
  const w = AFTER_WEIGHTS[n];
  if (!w) return Math.min(n - 1, Math.floor(ms / AFTER_MS));
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += w[i]! * AFTER_MS;
    if (ms < acc) return i;
  }
  return n - 1;
}

/**
 * G/A1: a cast pose is held for its full playback only while the champion stands still. Once it walks, the pose
 * ends one AFTER_MS after the release (LoL blends into the run right after the release frame), so quick-cast
 * combos with move clicks no longer slide across the ground in a throwing pose.
 */
export function castPoseActive(elapsedMs: number, releaseMs: number, lengthMs: number, moving: boolean): boolean {
  if (elapsedMs >= lengthMs) return false;
  return !moving || elapsedMs < releaseMs + AFTER_MS;
}

/** Reference walking speed (units per tick) that plays the run cycle at its authored rate: 340 MS. */
export const RUN_REF_PER_TICK = 340 / TICK_HZ;
export const RUN_RATE_MIN = 0.75;
export const RUN_RATE_MAX = 1.5;

/**
 * G/A2: run-cycle playback rate (frames per second) for a unit that moved `unitsPerTick` in the last tick: the
 * authored rate at 340 MS, proportionally faster with boots/Geist, slower under slows (clamped so the cycle stays
 * readable). 0 (pushed, not walking) keeps the authored rate.
 */
export function runRate(baseFps: number, unitsPerTick: number, refPerTick = RUN_REF_PER_TICK): number {
  if (!(unitsPerTick > 0) || !(refPerTick > 0)) return baseFps;
  const k = Math.min(RUN_RATE_MAX, Math.max(RUN_RATE_MIN, unitsPerTick / refPerTick));
  return baseFps * k;
}

/**
 * G/A6: wind-up length in ms from the snapshot's attack timing (atkStart/atkEnd in ticks, present while atkPhase
 * is 1); null when the snapshot does not carry it (then the caller falls back to measuring / estimating).
 */
export function windupMsOf(atkStart: number | undefined, atkEnd: number | undefined): number | null {
  if (atkStart === undefined || atkEnd === undefined || atkEnd <= atkStart) return null;
  return ((atkEnd - atkStart) * 1000) / TICK_HZ;
}
