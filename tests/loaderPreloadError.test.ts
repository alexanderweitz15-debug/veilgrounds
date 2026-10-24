// vite:preloadError after a deploy: exactly one guarded reload, never a reload loop.
import { describe, expect, it } from 'vitest';
import { onPreloadError, RELOAD_WINDOW_MS, type PreloadErrorEnv } from '../src/render/loader/preloadError';

function env(initial: string | null, clock = { t: 1_000_000 }, storageThrows = false) {
  let flag = initial;
  const calls = { reload: 0, banner: 0 };
  const e: PreloadErrorEnv = {
    now: () => clock.t,
    getFlag: () => {
      if (storageThrows) throw new Error('blocked');
      return flag;
    },
    setFlag: (v) => {
      if (storageThrows) throw new Error('blocked');
      flag = v;
    },
    reload: () => void calls.reload++,
    showBanner: () => void calls.banner++,
  };
  return { e, calls, clock, flag: () => flag };
}

describe('vite:preloadError handling', () => {
  it('reloads once and remembers it', () => {
    const x = env(null);
    expect(onPreloadError(x.e)).toBe('reload');
    expect(x.calls).toEqual({ reload: 1, banner: 0 });
    expect(x.flag()).toBe(String(x.clock.t));
  });

  it('a second error right after the reload shows the banner instead of reloading again (no loop)', () => {
    const x = env(null);
    onPreloadError(x.e);
    x.clock.t += 5_000; // the reloaded page fails again
    expect(onPreloadError(x.e)).toBe('banner');
    expect(x.calls).toEqual({ reload: 1, banner: 1 });
  });

  it('a much later error (another deploy during a long session) may reload again', () => {
    const x = env(null);
    onPreloadError(x.e);
    x.clock.t += RELOAD_WINDOW_MS + 1;
    expect(onPreloadError(x.e)).toBe('reload');
    expect(x.calls.reload).toBe(2);
  });

  it('without usable sessionStorage it never reloads (cannot guard against loops) and says so', () => {
    const x = env(null, { t: 5 }, true);
    expect(onPreloadError(x.e)).toBe('banner');
    expect(x.calls).toEqual({ reload: 0, banner: 1 });
  });

  it('a garbage flag counts as "never reloaded"', () => {
    const x = env('not-a-number');
    expect(onPreloadError(x.e)).toBe('reload');
  });
});
