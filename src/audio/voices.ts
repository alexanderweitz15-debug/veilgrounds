// Voice allocator: decides which sounds may start, so a teamfight does not turn into mush. Pure and deterministic
// (time is passed in, no AudioContext, no Math.random), allocation-free in the hot path (fixed slot table, numeric keys).
//
// Rules (see docs/AUDIO.md):
//  1. Dedupe: the same key (cue [+ source]) may not restart within its cooldown.
//  2. Per-category cap: when the category is full the lowest-priority voice of that category is stolen if the new one
//     outranks it, otherwise the new sound is dropped.
//  3. Global cap: same, across all categories.
//  Own-champion sounds (priority >= PRIORITY_OWN) may always steal.

/** Sound categories (each has its own voice cap). */
export const Cat = { Cast: 0, Auto: 1, Minion: 2, Structure: 3, Event: 4, Ui: 5 } as const;
export const CAT_COUNT = 6;
export const CAT_NAMES = ['cast', 'auto', 'minion', 'structure', 'event', 'ui'] as const;

/** Priority of the own champion's sounds; they steal from everything and skip the dedupe cooldown (short guard only). */
export const PRIORITY_OWN = 100;

export interface VoiceLimits {
  /** Simultaneous voices over all categories. */
  global: number;
  /** Per category (index = Cat). */
  perCat: readonly number[];
}

export const DEFAULT_LIMITS: VoiceLimits = {
  global: 20,
  perCat: [8, 6, 4, 3, 5, 5],
};

export interface VoiceStats {
  started: number;
  /** Dropped by the per-key cooldown. */
  deduped: number;
  /** Dropped because a cap was full and nothing of lower priority was playing. */
  denied: number;
  /** Running voices cut to make room for a higher-priority sound. */
  stolen: number;
  peak: number;
}

const FREE = -1;
/** Own sounds retrigger no faster than this (seconds) even though they skip the cooldown. */
const OWN_GUARD = 0.012;
const KEY_PRUNE_SIZE = 512;
const KEY_MAX_AGE = 5;

export class VoiceAllocator {
  readonly limits: VoiceLimits;
  readonly stats: VoiceStats = { started: 0, deduped: 0, denied: 0, stolen: 0, peak: 0 };
  /** Slot cut by the last successful `request` (the caller must silence it), or -1. */
  lastStolen = -1;

  private readonly n: number;
  private readonly slotCat: Int8Array;
  private readonly slotPrio: Float32Array;
  private readonly slotStart: Float64Array;
  private readonly slotEnd: Float64Array;
  private readonly catCount = new Int32Array(CAT_COUNT);
  private readonly lastStart = new Map<number, number>();
  private total = 0;

  constructor(limits: VoiceLimits = DEFAULT_LIMITS) {
    this.limits = limits;
    this.n = limits.global + 1; // one spare: a steal frees its slot before the new voice takes one
    this.slotCat = new Int8Array(this.n).fill(FREE);
    this.slotPrio = new Float32Array(this.n);
    this.slotStart = new Float64Array(this.n);
    this.slotEnd = new Float64Array(this.n);
  }

  get active(): number {
    return this.total;
  }

  activeIn(cat: number): number {
    return this.catCount[cat]!;
  }

  isActive(slot: number): boolean {
    return this.slotCat[slot] !== FREE;
  }

  /**
   * Ask for a voice. Returns the slot index, or -1 when the sound must not play. `key` is the dedupe key (0 = no
   * dedupe), `cooldown` in seconds, `now` the audio clock in seconds. If a running voice had to be cut, `lastStolen`
   * names its slot (otherwise -1).
   */
  request(cat: number, priority: number, key: number, cooldown: number, now: number): number {
    this.lastStolen = -1;
    this.prune(now);
    const own = priority >= PRIORITY_OWN;
    if (key !== 0) {
      const last = this.lastStart.get(key);
      if (last !== undefined && now - last < (own ? OWN_GUARD : cooldown)) {
        this.stats.deduped++;
        return -1;
      }
    }
    // decide on a victim first, so a denied request never cuts anything
    let victim = -1;
    if (this.catCount[cat]! >= this.limits.perCat[cat]!) {
      victim = this.weakest(cat);
      if (!this.outranks(priority, victim, own)) {
        this.stats.denied++;
        return -1;
      }
    } else if (this.total >= this.limits.global) {
      victim = this.weakest(-1);
      if (!this.outranks(priority, victim, own)) {
        this.stats.denied++;
        return -1;
      }
    }
    if (victim >= 0) {
      this.free(victim);
      this.lastStolen = victim;
      this.stats.stolen++;
    }
    const slot = this.freeSlot();
    this.slotCat[slot] = cat;
    this.slotPrio[slot] = priority;
    this.slotStart[slot] = now;
    this.slotEnd[slot] = now + 10; // provisional until setEnd
    this.catCount[cat]!++;
    this.total++;
    if (this.total > this.stats.peak) this.stats.peak = this.total;
    this.stats.started++;
    if (key !== 0) {
      this.lastStart.set(key, now);
      if (this.lastStart.size > KEY_PRUNE_SIZE) this.pruneKeys(now);
    }
    return slot;
  }

  /** When the voice's last source ends (audio clock seconds). */
  setEnd(slot: number, end: number): void {
    this.slotEnd[slot] = end;
  }

  release(slot: number): void {
    if (this.slotCat[slot] !== FREE) this.free(slot);
  }

  /** Free voices whose end time has passed. */
  prune(now: number): void {
    for (let i = 0; i < this.n; i++) if (this.slotCat[i] !== FREE && this.slotEnd[i]! <= now) this.free(i);
  }

  private outranks(priority: number, victim: number, own: boolean): boolean {
    if (victim < 0) return true;
    const vp = this.slotPrio[victim]!;
    return priority > vp || (own && priority >= vp);
  }

  /** Lowest priority; ties go to the voice that started first (it is closest to its end anyway). */
  private weakest(cat: number): number {
    let best = -1;
    for (let i = 0; i < this.n; i++) {
      if (this.slotCat[i] === FREE || (cat >= 0 && this.slotCat[i] !== cat)) continue;
      if (best < 0 || this.slotPrio[i]! < this.slotPrio[best]! || (this.slotPrio[i] === this.slotPrio[best] && this.slotStart[i]! < this.slotStart[best]!)) best = i;
    }
    return best;
  }

  private freeSlot(): number {
    for (let i = 0; i < this.n; i++) if (this.slotCat[i] === FREE) return i;
    return this.n - 1; // unreachable: the caps are enforced before
  }

  private free(slot: number): void {
    this.catCount[this.slotCat[slot]!]!--;
    this.slotCat[slot] = FREE;
    this.total--;
  }

  private pruneKeys(now: number): void {
    for (const [k, t] of this.lastStart) if (now - t > KEY_MAX_AGE) this.lastStart.delete(k);
  }
}
