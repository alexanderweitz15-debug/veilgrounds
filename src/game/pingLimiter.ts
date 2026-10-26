// Client side of the ping spam limit (LoL: a burst is fine, then pings are refused and the wheel greys out). The sim
// enforces PING_MAX per PING_WINDOW (src/sim/pingRules.ts); this limiter stays one below it and adds a short lock-out
// after the cap was hit, so a held key or a click storm gives feedback instead of silently dropping pings.
import { PING_MAX, PING_WINDOW } from '../sim/pingRules';
import { TICK_HZ } from '../sim/types';

const WINDOW_MS = (PING_WINDOW / TICK_HZ) * 1000;
/** Allowed per window on the client (the sim lets PING_MAX through; the margin absorbs clock drift). */
export const CLIENT_PING_MAX = PING_MAX - 1;
/** After the cap was hit, nothing goes out for this long. */
export const LOCKOUT_MS = 1500;
/** Two pings closer together than this are one accidental double click. */
export const MIN_GAP_MS = 120;

export class PingLimiter {
  private readonly at: number[] = [];
  private lockedUntil = -Infinity;

  /** Try to ping at `now` (ms). Records the ping when allowed. */
  try(now: number): 'ok' | 'limited' | 'tooFast' {
    while (this.at.length && now - this.at[0]! >= WINDOW_MS) this.at.shift();
    if (now < this.lockedUntil) return 'limited';
    const last = this.at[this.at.length - 1];
    if (last !== undefined && now - last < MIN_GAP_MS) return 'tooFast';
    if (this.at.length >= CLIENT_PING_MAX) {
      this.lockedUntil = now + LOCKOUT_MS;
      return 'limited';
    }
    this.at.push(now);
    return 'ok';
  }

  /** Seconds until pinging works again (0 = now). */
  waitS(now: number): number {
    while (this.at.length && now - this.at[0]! >= WINDOW_MS) this.at.shift();
    const lock = Math.max(0, this.lockedUntil - now);
    const full = this.at.length >= CLIENT_PING_MAX ? this.at[0]! + WINDOW_MS - now : 0;
    return Math.max(lock, full) / 1000;
  }
}
