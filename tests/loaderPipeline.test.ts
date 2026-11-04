// Load pipeline: combined progress, per-step watchdog and time limit, graceful fallback, late swap, shared steps.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSteps, StepRunner, type StepDef } from '../src/render/loader/pipeline';

type Def<T> = StepDef<T>;
const def = <T>(key: string, weight: number, start: Def<T>['start'], fallback: T, o: Partial<Def<T>> = {}): Def<T> => ({
  key,
  label: key,
  weight,
  stallMs: 1000,
  hardMs: 10_000,
  start,
  fallback: () => fallback,
  ...o,
});

describe('load pipeline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('runs steps in order and reports a combined, weighted, monotonic progress that ends at 1', async () => {
    const order: string[] = [];
    const a = def('a', 3, async (report) => {
      order.push('a');
      report(0.5);
      report(1);
      return 'A';
    }, 'a?');
    const b = def('b', 1, async (report) => {
      order.push('b');
      report(0.5);
      return 'B';
    }, 'b?');
    const seen: number[] = [];
    const r = await runSteps(new StepRunner(), [a, b] as [Def<string>, Def<string>], (k) => seen.push(k));
    expect(order).toEqual(['a', 'b']);
    expect(r.outcomes.map((o) => o.value)).toEqual(['A', 'B']);
    expect(r.degraded).toEqual([]);
    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(1);
    expect(seen).toEqual([...seen].sort((x, y) => x - y)); // never goes backwards
    expect(seen).toContain(0.375); // a at 50 %: 0.5 * 3/4
    expect(seen).toContain(0.75); // a done, b not started
  });

  it('a step that never answers is given up after the stall time and its fallback is used', async () => {
    const hang = def('hang', 1, () => new Promise<string>(() => undefined), 'placeholder', { stallMs: 500 });
    const p = runSteps(new StepRunner(), [hang] as [Def<string>]);
    await vi.advanceTimersByTimeAsync(499);
    let done = false;
    void p.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false); // not yet
    await vi.advanceTimersByTimeAsync(2);
    const r = await p;
    expect(r.outcomes[0]).toMatchObject({ value: 'placeholder', degraded: true });
    expect(r.degraded).toEqual(['hang']);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('no progress for 500 ms'));
  });

  it('progress keeps the step alive past the stall time until the hard limit', async () => {
    let report: (k: number) => void = () => undefined;
    const slow = def('slow', 1, (r) => ((report = r), new Promise<string>(() => undefined)), 'ph', { stallMs: 400, hardMs: 2000 });
    const p = runSteps(new StepRunner(), [slow] as [Def<string>]);
    // a report every 300 ms re-arms the 400 ms stall watchdog, so only the 2000 ms hard limit can end the step
    for (let i = 1; i <= 8; i++) {
      await vi.advanceTimersByTimeAsync(300);
      report(i * 0.05);
    }
    const r = await p;
    expect(r.outcomes[0]).toMatchObject({ value: 'ph', degraded: true, reason: 'not finished after 2000 ms' });
  });

  it('a rejected step falls back at once and is retried by the next caller', async () => {
    const runner = new StepRunner();
    let calls = 0;
    const flaky = def('flaky', 1, async () => {
      if (++calls === 1) throw new Error('boom');
      return 'real';
    }, 'ph');
    const first = await runSteps(runner, [flaky] as [Def<string>]);
    expect(first.outcomes[0]).toMatchObject({ value: 'ph', degraded: true });
    expect(first.outcomes[0]!.reason).toContain('boom');
    const second = await runSteps(runner, [flaky] as [Def<string>]);
    expect(second.outcomes[0]).toMatchObject({ value: 'real', degraded: false });
  });

  it('a step that finishes after the time limit delivers the real value late, and later callers get it at once', async () => {
    const runner = new StepRunner();
    let finish: (v: string) => void = () => undefined;
    const late = def('late', 1, () => new Promise<string>((res) => (finish = res)), 'ph', { stallMs: 100 });
    const got: unknown[] = [];
    const p = runSteps(runner, [late] as [Def<string>], undefined, (i, v) => got.push([i, v]));
    await vi.advanceTimersByTimeAsync(150);
    expect((await p).outcomes[0]!.degraded).toBe(true);
    finish('REAL');
    await vi.advanceTimersByTimeAsync(0);
    expect(got).toEqual([[0, 'REAL']]);
    const again = await runSteps(runner, [late] as [Def<string>]);
    expect(again.outcomes[0]).toMatchObject({ value: 'REAL', degraded: false });
  });

  it('the same step is started once and shared (loading screen, then the game)', async () => {
    const runner = new StepRunner();
    let starts = 0;
    const shared = def('shared', 1, async (report) => {
      starts++;
      report(1);
      return 'x';
    }, 'ph');
    await runSteps(runner, [shared] as [Def<string>]);
    const seen: number[] = [];
    const r = await runSteps(runner, [shared] as [Def<string>], (k) => seen.push(k));
    expect(starts).toBe(1);
    expect(r.outcomes[0]!.value).toBe('x');
    expect(seen.at(-1)).toBe(1);
  });

  it('a synchronous throw in start() is a failed step, not a crash', async () => {
    const bad = def('bad', 1, () => {
      throw new Error('sync');
    }, 'ph');
    const r = await runSteps(new StepRunner(), [bad] as [Def<string>]);
    expect(r.outcomes[0]).toMatchObject({ value: 'ph', degraded: true });
  });
});
