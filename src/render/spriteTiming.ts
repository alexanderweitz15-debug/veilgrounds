// Sprite playback timing shared by render/championSprites.ts (kept free of canvas code so tests can import it).

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
