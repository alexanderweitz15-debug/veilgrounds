// structuresHelpers first: it imports sim.ts before any system module (systems <-> sim import cycle).
import { newSim, stepA, stepUntil } from './structuresHelpers';
import { describe, expect, it } from 'vitest';
import { query } from 'bitecs';
import { Kind, Lane, isMinion, sec } from '../src/sim/types';
import { FIRST_WAVE_TICK, nextWaveInfo } from '../src/sim/systems/waves';
import { MINION_STATS, spawnMinion, waveState } from '../src/sim/systems/minions';
import { kill } from '../src/sim/damage';
import { structureAt } from '../src/sim/systems/towers';
import { createSim, type Sim } from '../src/sim/sim';

const minions = (sim: Sim): number[] =>
  [...query(sim.world, [sim.c.Unit])].filter((e) => sim.c.Unit.alive[e] && isMinion(sim.c.Unit.kind[e]!));

describe('wave schedule', () => {
  it('first wave at 1:05 with 3 melee + 3 casters per lane and team', () => {
    const sim = newSim();
    stepUntil(sim, FIRST_WAVE_TICK);
    expect(minions(sim)).toHaveLength(0);
    stepA(sim);
    const ms = minions(sim);
    expect(ms).toHaveLength(36);
    const k = (kind: number): number => ms.filter((e) => sim.c.Unit.kind[e] === kind).length;
    expect(k(Kind.MinionMelee)).toBe(18);
    expect(k(Kind.MinionCaster)).toBe(18);
    expect(sim.events.filter((e) => e.e === 'wave')).toHaveLength(6);
    const m = ms.find((e) => sim.c.Unit.kind[e] === Kind.MinionMelee)!;
    expect(sim.c.Hp.max[m]).toBe(460);
    expect(sim.c.Move.mode[m]).toBe(1);
  });

  it('cadence 30 s / 25 s from 15:00 / 20 s from 25:00; siege every 3rd, 2nd, every wave', () => {
    const sim = newSim(false); // schedule runs with minions off (cheap)
    const waves: { tick: number; siege: boolean }[] = [];
    while (sim.tick < sec(30 * 60)) {
      const before = nextWaveInfo(sim);
      stepA(sim);
      if (nextWaveInfo(sim).index !== before.index) waves.push({ tick: sim.tick - 1, siege: before.siege });
    }
    expect(waves[0]).toEqual({ tick: 1950, siege: false });
    const gaps = waves.slice(1).map((w, i) => [waves[i]!.tick, w.tick - waves[i]!.tick]);
    for (const [t, gap] of gaps) expect(gap).toBe(t! < sec(900) ? sec(30) : t! < sec(1500) ? sec(25) : sec(20));
    const early = waves.filter((w) => w.tick < sec(900));
    early.forEach((w, i) => expect(w.siege).toBe((i + 1) % 3 === 0));
    expect(early.filter((w) => w.siege)).toHaveLength(Math.floor(early.length / 3));
    // 18 waves spawn before 10:00 (17 of them reach the lane by then, DECISIONS.md), 6 with siege
    expect(waves.filter((w) => w.tick < sec(600))).toHaveLength(18);
    expect(waves.filter((w) => w.tick < sec(600) && w.siege)).toHaveLength(6);
    const mid = waves.filter((w) => w.tick >= sec(900) && w.tick < sec(1500));
    for (let i = 1; i < mid.length; i++) expect(mid[i]!.siege).not.toBe(mid[i - 1]!.siege);
    expect(waves.filter((w) => w.tick >= sec(1500)).every((w) => w.siege)).toBe(true);
  });

  it('a siege wave spawns 7 minions per lane; siege HP 900 x scaling', () => {
    const sim = newSim();
    sim.config.minionLanes = [Lane.Mid];
    stepUntil(sim, FIRST_WAVE_TICK + 2 * sec(30) + 1);
    const ms = minions(sim);
    expect(ms).toHaveLength(3 * 2 * 6 + 2);
    const s = ms.find((e) => sim.c.Unit.kind[e] === Kind.MinionSiege)!;
    expect(sim.c.Hp.max[s]).toBeCloseTo(900 * 1.03); // spawned at 2:05 -> one 90 s step
  });

  it('respects flags.minions and config.minionLanes', () => {
    const off = newSim(false);
    stepUntil(off, FIRST_WAVE_TICK + 1);
    expect(minions(off)).toHaveLength(0);
    const sim = createSim({ seed: 1, mode: 'sandbox', players: [], minionLanes: [Lane.Bot] });
    stepUntil(sim, FIRST_WAVE_TICK + 1);
    const ms = minions(sim);
    expect(ms).toHaveLength(12);
    expect(ms.every((e) => sim.c.Unit.lane[e] === Lane.Bot)).toBe(true);
  });

  it('a destroyed inhibitor adds one super minion to the enemy waves of that lane', () => {
    const sim = newSim();
    sim.config.minionLanes = [Lane.Top];
    kill(sim, structureAt(sim, 1, Kind.Inhibitor, Lane.Top)!.eid, -1);
    stepUntil(sim, FIRST_WAVE_TICK + 1);
    const sup = minions(sim).filter((e) => sim.c.Unit.kind[e] === Kind.MinionSuper);
    expect(sup).toHaveLength(1);
    expect(sim.c.Unit.team[sup[0]!]).toBe(0);
  });

  it('minion HP and AD grow 3 % per 90 s; tower %-damage ignores it', () => {
    const sim = newSim(false);
    sim.tick = sec(9 * 60); // 6 steps
    const m = spawnMinion(sim, Kind.MinionCaster, 0, Lane.Mid, 8000, 8000);
    expect(sim.c.Hp.max[m]).toBeCloseTo(290 * 1.18);
    expect(sim.c.Stats.ad[m]).toBeCloseTo(23 * 1.18);
    expect(MINION_STATS[Kind.MinionCaster]!.towerPct).toBe(0.7);
  });
});

describe('wave arrival', () => {
  it('waves meet in the lane middle at ~1:28 mid and ~1:38 side (+-3 s)', () => {
    const sim = newSim();
    const meet: (number | null)[] = [null, null, null];
    const { Unit, Pos } = sim.c;
    while (sim.tick < sec(120) && meet.includes(null)) {
      stepA(sim);
      const ms = minions(sim);
      for (const lane of [0, 1, 2]) {
        if (meet[lane] !== null) continue;
        const b = ms.filter((e) => Unit.lane[e] === lane && Unit.team[e] === 0);
        const r = ms.filter((e) => Unit.lane[e] === lane && Unit.team[e] === 1);
        let best = Infinity;
        for (const x of b) for (const y of r) best = Math.min(best, Math.hypot(Pos.x[x]! - Pos.x[y]!, Pos.y[x]! - Pos.y[y]!));
        if (best <= 500) {
          meet[lane] = sim.tick / 30;
          // they meet near the middle of the lane
          const ws = waveState(sim, 0, lane as 0 | 1 | 2);
          expect(ws.frontProgress).toBeGreaterThan(0.45);
          expect(ws.frontProgress).toBeLessThan(0.55);
        }
      }
    }
    expect(Math.abs(meet[Lane.Mid]! - 88)).toBeLessThanOrEqual(3);
    expect(Math.abs(meet[Lane.Top]! - 98)).toBeLessThanOrEqual(3);
    expect(Math.abs(meet[Lane.Bot]! - 98)).toBeLessThanOrEqual(3);
  });

  it('waveState reports front, minion difference and next wave', () => {
    const sim = newSim();
    sim.config.minionLanes = [Lane.Mid];
    stepUntil(sim, FIRST_WAVE_TICK + sec(10));
    const ws = waveState(sim, 0, Lane.Mid);
    expect(ws.minionDiff).toBe(6);
    expect(ws.frontProgress).toBeGreaterThan(0);
    expect(ws.frontProgress).toBeLessThan(0.5);
    expect(ws.nextWaveIn).toBeCloseTo(20, 0);
    expect(ws.siegeInWave).toBe(false);
    expect(ws.nextWaveSiege).toBe(false);
    const red = waveState(sim, 1, Lane.Mid);
    expect(red.frontProgress).toBeCloseTo(ws.frontProgress, 1);
  });
});
