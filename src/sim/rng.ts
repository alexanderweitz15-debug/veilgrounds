// xoshiro128** seeded RNG. Integer ops only, so identical on every JS engine.

export class Rng {
  private s = new Uint32Array(4);

  constructor(seed: number) {
    // splitmix32 to expand the seed into 128 bits of state
    let x = seed >>> 0;
    for (let i = 0; i < 4; i++) {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      this.s[i] = (z ^ (z >>> 16)) >>> 0;
    }
  }

  /** Copy of the internal state (hashing only; does not advance). */
  state(): number[] {
    return [...this.s];
  }

  /** Uniform uint32. */
  u32(): number {
    const s = this.s;
    const r = Math.imul(rotl(Math.imul(s[1]!, 5), 7), 9) >>> 0;
    const t = s[1]! << 9;
    s[2]! ^= s[0]!;
    s[3]! ^= s[1]!;
    s[1]! ^= s[2]!;
    s[0]! ^= s[3]!;
    s[2]! ^= t;
    s[3] = rotl(s[3]!, 11);
    return r;
  }

  /** Uniform [0, 1). */
  next(): number {
    return this.u32() / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Standard normal via Box-Muller without trig: polar (Marsaglia) method, deterministic (sqrt + log only). */
  normal(): number {
    for (;;) {
      const u = this.next() * 2 - 1;
      const v = this.next() * 2 - 1;
      const s = u * u + v * v;
      // ponytail: Math.log is not IEEE-mandated exact; fine for bots (Phase 3+), never used for physics.
      if (s > 0 && s < 1) return u * Math.sqrt((-2 * Math.log(s)) / s);
    }
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}
