// Replay random access: checkpoints (compact deep copies of the sim) and seeking must reproduce a straight run bit for
// bit; recording markers / pattern detection must not change the sim; detection over a re-simulation equals live.
import { describe, expect, it } from 'vitest';
import { createSim, step, stateHash } from '../src/sim/sim';
import { buildSnapshot } from '../src/sim/snapshot';
import { Recorder, playReplay } from '../src/replay/replay';
import { cloneSim, freezeSim, thawSim } from '../src/replay/cloneSim';
import { ReplayEngine } from '../src/replay/engine';
import { recordBotGame } from './replayHelpers';

const TICKS = 3600; // 2:00, first waves have met

describe('replay seek', () => {
  const replay = recordBotGame(1, TICKS);

  it('recording with the observer does not change the sim (hash equals a plain re-simulation)', () => {
    expect(replay.ticks).toBe(TICKS);
    expect(stateHash(playReplay(replay))).toBe(replay.hash);
  });

  it('cloneSim / freezeSim copies continue bit-identically (state hash and fog-filtered snapshots)', () => {
    const a = createSim(structuredClone(replay.config));
    while (a.tick < 2000) step(a, replay.inputs[a.tick] ?? []);
    const full = cloneSim(a);
    const frozen = thawSim(freezeSim(a));
    expect(stateHash(full)).toBe(stateHash(a));
    expect(stateHash(frozen)).toBe(stateHash(a));
    while (a.tick < TICKS) {
      const inputs = replay.inputs[a.tick] ?? [];
      step(a, inputs);
      step(full, inputs);
      step(frozen, inputs);
      if (a.tick % 300 === 0) {
        const s = JSON.stringify(buildSnapshot(a, 0, 0));
        expect(JSON.stringify(buildSnapshot(full, 0, 0))).toBe(s);
        expect(JSON.stringify(buildSnapshot(frozen, 0, 0))).toBe(s);
      }
    }
    expect(stateHash(full)).toBe(replay.hash);
    expect(stateHash(frozen)).toBe(replay.hash);
  }, 60_000);

  it('a frozen checkpoint is restorable repeatedly and does not alias the live sim', () => {
    const a = createSim(structuredClone(replay.config));
    while (a.tick < 2000) step(a, replay.inputs[a.tick] ?? []);
    const cp = freezeSim(a);
    const h = stateHash(a);
    // advancing the original must not disturb the checkpoint
    while (a.tick < 2600) step(a, replay.inputs[a.tick] ?? []);
    const b = thawSim(cp);
    expect(stateHash(b)).toBe(h);
    while (b.tick < 2600) step(b, replay.inputs[b.tick] ?? []);
    expect(stateHash(b)).toBe(stateHash(a));
    const c = thawSim(cp);
    expect(stateHash(c)).toBe(h);
  }, 60_000);

  it('seek: state hash at tick t equals a straight run (forward, backward, from checkpoints, to the end)', () => {
    const engine = new ReplayEngine(replay, 600);
    const straight = createSim(structuredClone(replay.config));
    const want = new Map<number, string>();
    const targets = [2700, 900, 1300, 0, 3599, 1999, 2001, 600, TICKS, 1201];
    const set = new Set(targets);
    while (straight.tick < TICKS) {
      step(straight, replay.inputs[straight.tick] ?? []);
      if (set.has(straight.tick)) want.set(straight.tick, stateHash(straight));
    }
    want.set(0, stateHash(createSim(structuredClone(replay.config))));
    for (const t of targets) {
      engine.seek(t);
      expect(engine.tick).toBe(t);
      expect(engine.hash(), `tick ${t}`).toBe(want.get(t));
    }
    // seeks added checkpoints on the way; the end state matches the recorded hash
    expect(engine.checkpoints.has(600)).toBe(true);
    engine.seek(TICKS);
    expect(engine.hash()).toBe(replay.hash);
  }, 120_000);

  it('background index pass builds checkpoints and later seeks re-simulate at most one interval', () => {
    const engine = new ReplayEngine(replay, 600);
    let guard = 0;
    while (!engine.advanceIndex(500) && guard++ < 100);
    expect(engine.indexed).toBe(true);
    expect(engine.indexProgress).toBe(1);
    expect(engine.checkpoints.size).toBe(Math.floor(TICKS / 600) + 1);
    const steps = engine.seek(3199);
    expect(steps).toBeLessThanOrEqual(600);
    expect(engine.tick).toBe(3199);
    // playing on one tick at a time keeps matching
    const ref = playReplay(replay, undefined, 3203);
    for (let i = 0; i < 4; i++) engine.stepOnce();
    expect(engine.hash()).toBe(stateHash(ref));
  }, 120_000);

  it('detection over a re-simulation equals the live detection (markers and player patterns)', () => {
    const rec = new Recorder(structuredClone(replay.config));
    const sim = createSim(structuredClone(replay.config));
    while (sim.tick < replay.ticks) {
      const inputs = replay.inputs[sim.tick] ?? [];
      rec.record(sim.tick, inputs);
      step(sim, inputs);
      rec.observe(sim);
    }
    const again = rec.finish(sim);
    expect(again.markers).toEqual(replay.markers);
    expect(again.player).toEqual(replay.player);
    expect(again.hash).toBe(replay.hash);
  }, 60_000);

  it('markers are tick-ordered and well-formed', () => {
    const m = replay.markers!;
    for (let i = 1; i < m.length; i++) expect(m[i]!.tick).toBeGreaterThanOrEqual(m[i - 1]!.tick);
    for (const k of m) {
      expect(k.tick).toBeGreaterThanOrEqual(0);
      expect(k.tick).toBeLessThanOrEqual(replay.ticks);
      expect([0, 1]).toContain(k.team);
    }
  });
});
