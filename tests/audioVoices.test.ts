// Voice allocator (src/audio/voices.ts): caps, priority stealing, dedupe, determinism. No AudioContext involved.
import { describe, expect, it } from 'vitest';
import { Cat, PRIORITY_OWN, VoiceAllocator, type VoiceLimits } from '../src/audio/voices';

const LIM: VoiceLimits = { global: 6, perCat: [3, 3, 2, 2, 3, 3] };

describe('VoiceAllocator', () => {
  it('starts voices until the category cap, then drops equal-priority requests', () => {
    const a = new VoiceAllocator(LIM);
    expect(a.request(Cat.Minion, 10, 0, 0, 0)).toBeGreaterThanOrEqual(0);
    expect(a.request(Cat.Minion, 10, 0, 0, 0)).toBeGreaterThanOrEqual(0);
    expect(a.request(Cat.Minion, 10, 0, 0, 0)).toBe(-1);
    expect(a.activeIn(Cat.Minion)).toBe(2);
    expect(a.stats.denied).toBe(1);
    expect(a.lastStolen).toBe(-1);
  });

  it('steals the lowest-priority voice of the category for a higher-priority sound', () => {
    const a = new VoiceAllocator(LIM);
    const lo = a.request(Cat.Cast, 20, 0, 0, 0);
    a.request(Cat.Cast, 40, 0, 0, 0);
    a.request(Cat.Cast, 30, 0, 0, 0);
    const s = a.request(Cat.Cast, 50, 0, 0, 0);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(a.lastStolen).toBe(lo);
    expect(a.activeIn(Cat.Cast)).toBe(3);
    expect(a.stats.stolen).toBe(1);
  });

  it('a denied request never cuts a running voice', () => {
    const a = new VoiceAllocator(LIM);
    for (let i = 0; i < 3; i++) a.request(Cat.Cast, 40, 0, 0, 0);
    expect(a.request(Cat.Cast, 10, 0, 0, 0)).toBe(-1);
    expect(a.lastStolen).toBe(-1);
    expect(a.activeIn(Cat.Cast)).toBe(3);
  });

  it('enforces the global cap across categories and steals the globally weakest', () => {
    const a = new VoiceAllocator(LIM);
    const weak = a.request(Cat.Minion, 5, 0, 0, 0);
    a.request(Cat.Cast, 40, 0, 0, 0);
    a.request(Cat.Cast, 40, 0, 0, 0);
    a.request(Cat.Auto, 40, 0, 0, 0);
    a.request(Cat.Auto, 40, 0, 0, 0);
    a.request(Cat.Event, 40, 0, 0, 0);
    expect(a.active).toBe(6);
    expect(a.request(Cat.Ui, 20, 0, 0, 0)).toBeGreaterThanOrEqual(0);
    expect(a.lastStolen).toBe(weak);
    expect(a.active).toBe(6);
    // nothing weaker than 20 is left: a priority-15 sound is dropped
    expect(a.request(Cat.Structure, 15, 0, 0, 0)).toBe(-1);
  });

  it('own-champion sounds steal even from equal priority and never get denied by caps', () => {
    const a = new VoiceAllocator(LIM);
    for (let i = 0; i < 3; i++) a.request(Cat.Cast, PRIORITY_OWN, 0, 0, i);
    expect(a.request(Cat.Cast, PRIORITY_OWN, 0, 0, 3)).toBeGreaterThanOrEqual(0);
    expect(a.lastStolen).toBeGreaterThanOrEqual(0);
    expect(a.activeIn(Cat.Cast)).toBe(3);
  });

  it('ties are stolen oldest first', () => {
    const a = new VoiceAllocator(LIM);
    const first = a.request(Cat.Cast, 30, 0, 0, 0);
    a.request(Cat.Cast, 30, 0, 0, 1);
    a.request(Cat.Cast, 30, 0, 0, 2);
    a.request(Cat.Cast, 31, 0, 0, 3);
    expect(a.lastStolen).toBe(first);
  });

  it('dedupes by key within the cooldown and allows it afterwards', () => {
    const a = new VoiceAllocator(LIM);
    expect(a.request(Cat.Event, 30, 77, 0.1, 0)).toBeGreaterThanOrEqual(0);
    expect(a.request(Cat.Event, 30, 77, 0.1, 0.05)).toBe(-1);
    expect(a.request(Cat.Event, 30, 78, 0.1, 0.05)).toBeGreaterThanOrEqual(0); // other key
    expect(a.request(Cat.Event, 30, 77, 0.1, 0.11)).toBeGreaterThanOrEqual(0);
    expect(a.stats.deduped).toBe(1);
  });

  it('own sounds skip the cooldown but keep a short retrigger guard', () => {
    const a = new VoiceAllocator(LIM);
    expect(a.request(Cat.Auto, PRIORITY_OWN, 5, 0.5, 0)).toBeGreaterThanOrEqual(0);
    expect(a.request(Cat.Auto, PRIORITY_OWN, 5, 0.5, 0.005)).toBe(-1);
    expect(a.request(Cat.Auto, PRIORITY_OWN, 5, 0.5, 0.05)).toBeGreaterThanOrEqual(0);
  });

  it('a request denied by the caps does not start the cooldown', () => {
    const a = new VoiceAllocator({ global: 2, perCat: [1, 1, 1, 1, 1, 1] });
    a.request(Cat.Cast, 50, 0, 0, 0);
    expect(a.request(Cat.Cast, 10, 9, 1, 0.01)).toBe(-1); // denied by the cap
    a.release(0);
    expect(a.request(Cat.Cast, 10, 9, 1, 0.02)).toBeGreaterThanOrEqual(0); // not blocked by a cooldown
  });

  it('voices expire at their end time and free their slot', () => {
    const a = new VoiceAllocator(LIM);
    const s = a.request(Cat.Cast, 30, 0, 0, 0);
    a.setEnd(s, 0.5);
    a.request(Cat.Cast, 30, 0, 0, 0.1);
    a.request(Cat.Cast, 30, 0, 0, 0.1);
    expect(a.request(Cat.Cast, 30, 0, 0, 0.2)).toBe(-1);
    expect(a.request(Cat.Cast, 30, 0, 0, 0.6)).toBe(s); // the first one ended
  });

  it('release frees the slot immediately; double release is harmless', () => {
    const a = new VoiceAllocator(LIM);
    const s = a.request(Cat.Ui, 30, 0, 0, 0);
    a.release(s);
    a.release(s);
    expect(a.active).toBe(0);
    expect(a.activeIn(Cat.Ui)).toBe(0);
  });

  it('never exceeds the caps under a randomized teamfight and is deterministic', () => {
    const run = (): string => {
      const a = new VoiceAllocator();
      let seed = 12345;
      const rnd = (): number => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      let peakCat = 0;
      let violations = 0;
      for (let tick = 0; tick < 3000; tick++) {
        const now = tick / 30;
        for (let k = 0; k < 6; k++) {
          const cat = Math.floor(rnd() * 6);
          const own = rnd() < 0.05;
          const s = a.request(cat, own ? PRIORITY_OWN : Math.floor(rnd() * 90), Math.floor(rnd() * 40), rnd() * 0.1, now);
          if (s >= 0) a.setEnd(s, now + 0.05 + rnd() * 0.8);
          if (a.active > a.limits.global) violations++;
          for (let c = 0; c < 6; c++) {
            if (a.activeIn(c) > a.limits.perCat[c]!) violations++;
            peakCat = Math.max(peakCat, a.activeIn(c));
          }
        }
      }
      expect(violations).toBe(0);
      return JSON.stringify([a.stats, peakCat]);
    };
    const first = run();
    expect(run()).toBe(first);
    expect(JSON.parse(first)[0].peak).toBeLessThanOrEqual(20);
  });

  it('teamfight: own and enemy-champion sounds survive a minion flood', () => {
    const a = new VoiceAllocator();
    // flood: 10 minion clacks plus footsteps fill the minion category and the global cap
    for (let i = 0; i < 40; i++) a.request(i % 2 ? Cat.Minion : Cat.Event, 8, 0, 0, 0);
    expect(a.active).toBeLessThanOrEqual(20);
    const enemy = a.request(Cat.Cast, 65, 0, 0, 0.01);
    const own = a.request(Cat.Cast, PRIORITY_OWN, 0, 0, 0.01);
    expect(enemy).toBeGreaterThanOrEqual(0);
    expect(own).toBeGreaterThanOrEqual(0);
  });
});
