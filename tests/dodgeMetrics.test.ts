// Dodge trainer measurements (FEATURE-GAP 7.4): reaction latency, panic / unnecessary dodges, hit-rate buckets,
// last-hits review on synthetic tick sequences, history trend, and the wiring in the real trainer.
import { describe, expect, it } from 'vitest';
import { createSim, step } from '../src/sim/sim';
import type { PlayerSetup, TickInput } from '../src/sim/types';
import { trainerHud, trainerState } from '../src/sim/trainer';
import { metricsReport, metricsShotFired, metricsShotHit, metricsTick, metricsZoneHit, newMetrics, type DodgeMetrics, type PlayerObs } from '../src/sim/trainer/dodgeMetrics';
import { trainerMetrics, trainerTrend, withoutRun, type MatchRecord } from '../src/stats/history';

// shot from (0,0) flying +x at 900/s (30 per tick), 2000 long, 120 wide; player radius 65 -> hit radius 125
const SHOT = { x0: 0, y0: 0, dx: 1, dy: 0, speed: 900, width: 120, maxDist: 2000 };
const at = (x: number, y: number, ev: PlayerObs['ev'] = null): PlayerObs => ({ x, y, r: 65, ms: 600, ev });

/** Ticks 0..to-1 with the player standing at (x, y); events[tick] = order given that tick. */
function run(m: DodgeMetrics, x: number, y: number, to: number, events: Record<number, PlayerObs['ev']> = {}, from = 0): void {
  for (let k = from; k < to; k++) metricsTick(m, k, at(x, y, events[k] ?? null), []);
}

describe('dodge measurements', () => {
  it('reaction latency: first order after the spawn that leaves the shot path', () => {
    const m = newMetrics();
    metricsShotFired(m, 0, SHOT, at(600, 0)); // stands in the path: threat
    run(m, 600, 0, 11, { 10: { tx: 600, ty: 500 } }); // 10 ticks later he walks sideways at 20 units/tick
    const r = metricsReport(m, false);
    expect(r.reactions).toBe(1);
    expect(r.reactionMs).toBe(333);
    expect(r.panic).toBe(0);
    expect(r.unnecessary).toBe(0);
  });

  it('an order along the path does not count, the later sideways one does', () => {
    const m = newMetrics();
    metricsShotFired(m, 0, SHOT, at(600, 0));
    run(m, 600, 0, 12, { 5: { tx: 300, ty: 0 }, 8: { tx: 600, ty: -500 } });
    expect(m.latencies).toEqual([8]); // tick 5 walks into the shot, tick 8 leaves
    expect(m.shots[0]!.cmds).toBe(2);
  });

  it('too late: an order that cannot clear the path in time is no reaction', () => {
    const m = newMetrics();
    metricsShotFired(m, 0, SHOT, at(600, 0));
    run(m, 600, 0, 20, { 18: { tx: 600, ty: 500 } }); // the shot arrives in 2 ticks, 40 units sideways is not enough
    expect(m.latencies).toEqual([]);
  });

  it('panic: orders with nothing in the air, one episode per burst; ground zones count as relevant', () => {
    const m = newMetrics();
    run(m, 600, 0, 40, { 0: { tx: 1, ty: 1 }, 5: { tx: 2, ty: 2 }, 30: { tx: 3, ty: 3 } });
    expect(m.panic).toBe(2);
    const z = newMetrics();
    metricsTick(z, 0, at(0, 0, { tx: 500, ty: 0 }), [{ x: 100, y: 0, r: 230, at: 20 }]);
    expect(z.panic).toBe(0);
  });

  it('unnecessary: dodging a shot that passes close but would miss; a far shot is just panic', () => {
    const m = newMetrics();
    metricsShotFired(m, 0, SHOT, at(600, 200)); // passes 200 away, hit radius 125 -> no threat, near (< 275)
    expect(m.shots[0]!.threat).toBe(false);
    run(m, 600, 200, 6, { 2: { tx: 600, ty: 900 }, 3: { tx: 600, ty: 1000 } });
    expect(m.unnecessary).toBe(1);
    expect(m.panic).toBe(0);
    const far = newMetrics();
    metricsShotFired(far, 0, SHOT, at(600, 1000));
    run(far, 600, 1000, 3, { 1: { tx: 0, ty: 0 } });
    expect(far.unnecessary).toBe(0);
    expect(far.panic).toBe(1);
  });

  it('hit rate per speed / width bucket counts threatening shots, expired ones included', () => {
    const m = newMetrics();
    const fast = { ...SHOT, speed: 1500 };
    const a = metricsShotFired(m, 0, SHOT, at(600, 0)); // slow, threat, hits
    metricsShotFired(m, 0, { ...SHOT, y0: 1000 }, at(600, 0)); // slow, never a threat: not counted
    metricsShotFired(m, 0, fast, at(600, 0)); // fast, threat, expires without hit (he left, tick 60 is past its range)
    run(m, 600, 0, 5);
    metricsShotHit(m, 1, a, 560, 0, at(600, 0));
    run(m, 5000, 0, 100, {}, 5); // player far away: the fast shot (2000 units / 50 per tick = 40 ticks) expires
    const r = metricsReport(m, true);
    expect(r.threats).toBe(2);
    expect(r.shotHits).toBe(1);
    expect(r.hitRate).toBe(50);
    expect(r.speedBuckets.map((b) => [b.threats, b.hits])).toEqual([[1, 1], [0, 0], [1, 0]]);
    expect(r.widthBuckets[1]).toMatchObject({ lo: 100, hi: 140, threats: 2, hits: 1 });
  });

  it('review keeps the last 10 hits with cause, latency and the player path', () => {
    const m = newMetrics();
    for (let i = 0; i < 12; i++) {
      const id = metricsShotFired(m, i * 40, SHOT, at(600, 0));
      run(m, 600, 0, i * 40 + 3, i === 11 ? { [i * 40 + 1]: { tx: 600, ty: 5 } } : {}, i * 40);
      metricsShotHit(m, i, id, 590, 0, at(600, 0));
    }
    metricsZoneHit(m, 99, { x: 0, y: 0, r: 230 }, at(10, 0));
    const r = metricsReport(m, true);
    expect(r.review).toHaveLength(10);
    expect(r.review![0]!.t).toBe(3);
    const last = r.review![9]!;
    expect(last).toMatchObject({ kind: 'zone', cause: 'zone' });
    const prev = r.review![8]!;
    expect(prev.cause).toBe('wrongWay'); // an order that did not leave the path
    expect(r.review![7]!.cause).toBe('idle');
    expect(prev.path.length).toBeGreaterThan(2);
    expect(metricsReport(m, false).review).toBeUndefined();
    expect(r.zoneHits).toBe(1);
  });
});

describe('dodge trend (history)', () => {
  const rec = (at: number, score: number, reactionMs: number, durationS = 60): MatchRecord =>
    ({ id: String(at), at, mode: 'dodge', durationS, trainer: { kind: 'dodge', score, grade: 'B', metrics: { reactionMs, panic: 2 } } }) as unknown as MatchRecord;

  it('past values per key, delta against their mean, own run dropped', () => {
    const h = [rec(1000, 30, 400), rec(2000, 40, 300), rec(3_000_000, 50, 250, 75)];
    const past = withoutRun(h, { kind: 'dodge', score: 50, durationS: 75, at: 3_010_000 });
    expect(past).toHaveLength(2);
    const t = trainerTrend(past, 'dodge', 'reactionMs', 250);
    expect(t.past).toEqual([400, 300]);
    expect(t.delta).toBe(-100);
    expect(trainerTrend(past, 'dodge', 'score', 50).past).toEqual([30, 40]);
    expect(trainerTrend(past, 'kite', 'score', 1).delta).toBeUndefined();
  });

  it('record metrics skip what was not measured', () => {
    const base = { panic: 1, unnecessary: 0, threats: 0, shotHits: 0, zoneHits: 0, speedBuckets: [], widthBuckets: [], reactions: 0, reactionBestMs: -1 };
    const tr = (reactionMs: number, hitRate: number) => ({ kind: 'dodge', dodge: { ...base, reactionMs, hitRate } }) as unknown as Parameters<typeof trainerMetrics>[0];
    expect(trainerMetrics(tr(-1, -1))).toEqual({ panic: 1, unnecessary: 0 });
    expect(trainerMetrics(tr(280, 40))).toEqual({ panic: 1, unnecessary: 0, reactionMs: 280, hitRate: 40 });
  });
});

describe('dodge trainer wiring', () => {
  const human: PlayerSetup = { slot: 0, team: 0, champion: 'mira', role: 'mid', summoners: ['sprung', 'heilen'], isHuman: true };
  const cfg = { seed: 9, mode: 'dodge' as const, players: [human], minionsEnabled: false, trainer: { difficulty: 2 as const, lives: 8 } };

  it('a standing player: every counted hit is a shot or zone hit, review attached at the end, no reaction', () => {
    const sim = createSim(structuredClone(cfg));
    for (let i = 0; i < 30 * 120 && !trainerHud(sim)!.done; i++) step(sim);
    const h = trainerHud(sim)!;
    const d = h.dodge!;
    expect(h.done).toBe(true);
    expect(d.shotHits + d.zoneHits).toBe(trainerState(sim)!.dodge!.hits);
    expect(d.threats).toBeGreaterThanOrEqual(d.shotHits);
    expect(d.reactionMs).toBe(-1);
    expect(d.panic).toBe(0);
    expect(d.review!.length).toBeGreaterThan(0);
    expect(d.review!.every((r) => r.path.length >= 2)).toBe(true);
    expect(h.stats.map((s) => s.k)).toEqual(expect.arrayContaining(['reaction', 'panic', 'unnecessary', 'hitRate']));
  });

  it('a player who keeps stepping sideways measures reactions and survives longer than a standing one', () => {
    const still = createSim(structuredClone(cfg));
    const mover = createSim(structuredClone(cfg));
    const zig = (sim: ReturnType<typeof createSim>): TickInput[] => (sim.tick % 15 === 0 ? [{ slot: 0, cmd: { t: 'move', x: 2000 + (sim.tick % 30 === 0 ? 600 : -600), y: 14000 + (sim.tick % 60 < 30 ? 500 : -500) } }] : []);
    for (let i = 0; i < 30 * 50; i++) {
      step(still);
      step(mover, zig(mover));
    }
    const d = trainerHud(mover)!.dodge!;
    expect(d.reactions).toBeGreaterThan(0);
    expect(d.reactionMs).toBeGreaterThan(0);
    expect(trainerState(mover)!.dodge!.hits).toBeLessThanOrEqual(trainerState(still)!.dodge!.hits);
  });
});
