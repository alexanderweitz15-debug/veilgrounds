// D2 combat readability helpers (pure, no three/canvas): facing smoothing, hit-flash throttle, knock-up / dash lift.
// Values in src/render/readability.json.
import data from './readability.json';

export const READ = data as unknown as {
  facingMs180: number;
  hitFlash: { minGapMs: number; ampChampion: number; ampMinion: number; ampOther: number; ampReduceMotion: number };
  airborne: { height: number; minMs: number };
  dash: { heightPer100: number; maxHeight: number };
  /** A4: enemy telegraph rim (min alpha while shown) and the warning-spark rate along enemy rims (particles/s per shape). */
  telegraph: { enemyRimMin: number; warnRate: number };
};

const TAU = Math.PI * 2;

/** Turn the displayed angle `cur` toward `target` (radians) by at most 180 deg per facingMs180, over dtMs. */
export function turnToward(cur: number, target: number, dtMs: number): number {
  let d = (((target - cur) % TAU) + TAU * 1.5) % TAU - Math.PI; // shortest signed difference in [-PI, PI)
  const max = (Math.PI * Math.max(0, dtMs)) / READ.facingMs180;
  if (Math.abs(d) <= max) return target;
  d = Math.sign(d) * max;
  return cur + d;
}

/** Hit-flash gate per unit: true when the last accepted flash is at least minGapMs old (then records `now`). */
export class FlashGate {
  private readonly last = new Map<number, number>();
  accept(serial: number, now: number): boolean {
    const t = this.last.get(serial);
    if (t !== undefined && now - t < READ.hitFlash.minGapMs) return false;
    this.last.set(serial, now);
    if (this.last.size > 512) for (const [k, v] of this.last) if (now - v > 5000) this.last.delete(k);
    return true;
  }
}

/** Flash amplitude for a target kind group. */
export function flashAmp(target: 'champion' | 'minion' | 'other', reduceMotion: boolean): number {
  if (reduceMotion) return READ.hitFlash.ampReduceMotion;
  return target === 'champion' ? READ.hitFlash.ampChampion : target === 'minion' ? READ.hitFlash.ampMinion : READ.hitFlash.ampOther;
}

/** Knock-up hop: height at progress k (0..1) of the airborne time (parabola, 0 at both ends). */
export const airborneLift = (k: number): number => (k <= 0 || k >= 1 ? 0 : 4 * k * (1 - k) * READ.airborne.height);

/** Dash arc: height at progress k (0..1) of a dash of `len` world units. */
export const dashLift = (k: number, len: number): number =>
  k <= 0 || k >= 1 ? 0 : 4 * k * (1 - k) * Math.min(READ.dash.maxHeight, (READ.dash.heightPer100 * len) / 100);
