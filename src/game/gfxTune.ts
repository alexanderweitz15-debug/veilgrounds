// Frame cap and the first-start graphics benchmark: pure logic, wired up in game.ts.
import type { GraphicsPreset } from '../settings';

/**
 * rAF frame limiter: tick() per rAF callback says whether to render. Cap 0 = every frame. Tolerance is half the
 * measured rAF gap, so a 60 fps cap on a 60 Hz display (gaps jitter around the interval) never drops frames.
 */
export class FrameLimiter {
  private last = -Infinity;
  private prev = -1;
  private gap = 1000 / 60;

  tick(now: number, cap: number): boolean {
    const d = now - this.prev;
    this.prev = now;
    if (d > 0 && d < 200) this.gap += (d - this.gap) * 0.1;
    if (cap <= 0) {
      this.last = now;
      return true;
    }
    const interval = 1000 / cap;
    if (now - this.last < interval - Math.min(this.gap / 2, interval / 2)) return false;
    this.last += interval;
    if (now - this.last > interval) this.last = now; // stall or first frame: resync instead of bursting
    return true;
  }
}

export interface BenchResult {
  avgMs: number;
  p90Ms: number;
}

export const BENCH_WARMUP_MS = 1000;
export const BENCH_MS = 3000;

/** Collects rAF gaps for BENCH_MS after a BENCH_WARMUP_MS warm-up; add() returns the result when done. */
export class Benchmark {
  private t0 = -1;
  private prev = -1;
  private readonly gaps: number[] = [];

  add(now: number): BenchResult | null {
    if (this.t0 < 0) this.t0 = now;
    const d = now - this.prev;
    this.prev = now;
    const t = now - this.t0;
    if (t - d >= BENCH_WARMUP_MS && d > 0 && d < 250) this.gaps.push(d); // longer gaps = hidden tab / stall, not GPU load
    if (t < BENCH_WARMUP_MS + BENCH_MS) return null;
    if (this.gaps.length < 10) {
      this.t0 = -1; // tab was hidden the whole time: measure again
      this.gaps.length = 0;
      return null;
    }
    const s = [...this.gaps].sort((a, b) => a - b);
    return { avgMs: s.reduce((a, b) => a + b, 0) / s.length, p90Ms: s[Math.floor(s.length * 0.9)]! };
  }
}

// Frame cost relative to 'high' (the preset the benchmark runs at), rough from the preset table.
const COST: [GraphicsPreset, number][] = [['medium', 0.74], ['low', 0.48], ['veryLow', 0.3]];

/**
 * Best preset for the measured frame times at 'high'. rAF is vsync bound, so a 60 Hz display cannot show headroom
 * beyond 'high'; veryHigh needs a >= 108 Hz display (avg <= 9.2 ms) that still holds its rate.
 */
export function pickPreset({ avgMs, p90Ms }: BenchResult): GraphicsPreset {
  if (p90Ms <= 19.2) return avgMs <= 9.2 ? 'veryHigh' : 'high';
  return COST.find(([, c]) => avgMs * c <= 17.5)?.[0] ?? 'veryLow';
}
