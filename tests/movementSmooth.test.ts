// mech-movement: seeded stuck / jitter checks (wall click, click spam, walking through a minion wave, wall corners).
import { describe, expect, it } from 'vitest';
import { step } from '../src/sim/sim';
import { Kind, Lane } from '../src/sim/types';
import { spawnMinion } from '../src/sim/systems/minions';
import { CELL, nearestWalkable, walkable } from '../src/sim/map';
import { CX, CY, makeSim, place } from './combat-helpers';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const moveCmd = (x: number, y: number) => [{ slot: 0, cmd: { t: 'move', x, y } as never }];

describe('movement smoothness', () => {
  it('clicking into a wall walks to the nearest reachable point', () => {
    const sim = makeSim();
    const m = sim.slots[0]!;
    place(sim, m, CX, CY);
    const nav = sim.map.nav;
    // first blocked cell found by spiralling outward from the lane centre
    let wall: { x: number; y: number } | null = null;
    for (let r = 4; r < 120 && !wall; r++)
      for (let a = 0; a < 64 && !wall; a++) {
        const x = CX + Math.cos((a / 64) * 6.2832) * r * CELL;
        const y = CY + Math.sin((a / 64) * 6.2832) * r * CELL;
        if (!walkable(nav, x, y)) wall = { x, y };
      }
    expect(wall).not.toBeNull();
    step(sim, moveCmd(wall!.x, wall!.y));
    for (let i = 0; i < 600; i++) step(sim);
    const { Pos } = sim.c;
    expect(walkable(nav, Pos.x[m]!, Pos.y[m]!)).toBe(true);
    const goal = nearestWalkable(nav, wall!.x, wall!.y);
    expect(Math.hypot(Pos.x[m]! - goal.x, Pos.y[m]! - goal.y)).toBeLessThan(CELL * 2);
  });

  it('click spam: no stall, no teleport, steady progress', () => {
    const sim = makeSim();
    const m = sim.slots[0]!;
    place(sim, m, CX, CY);
    const r = rng(7);
    const { Pos, Stats } = sim.c;
    let maxJump = 0;
    let moved = 0;
    for (let i = 0; i < 240; i++) {
      const px = Pos.x[m]!;
      const py = Pos.y[m]!;
      // a new click every 2 ticks, all in one half plane (a human sweeping the cursor)
      step(sim, i % 2 === 0 ? moveCmd(CX + 600 + r() * 400, CY - 300 + r() * 600) : []);
      const d = Math.hypot(Pos.x[m]! - px, Pos.y[m]! - py);
      maxJump = Math.max(maxJump, d);
      moved += d;
    }
    expect(maxJump).toBeLessThanOrEqual(Stats.ms[m]! * (1 / 30) * 1.5 + 1);
    expect(moved).toBeGreaterThan(100);
  });

  it('walks through an enemy minion wave without stalling and without jitter', () => {
    const sim = makeSim();
    const m = sim.slots[0]!;
    place(sim, m, CX - 700, CY);
    for (let i = 0; i < 8; i++) spawnMinion(sim, i % 2 ? Kind.MinionCaster : Kind.MinionMelee, 1, Lane.Mid, CX - 100 + (i % 4) * 30, CY - 90 + Math.floor(i / 4) * 60);
    const { Pos } = sim.c;
    step(sim, moveCmd(CX + 700, CY));
    let reversals = 0;
    let lastDx = 0;
    let arrived = -1;
    for (let i = 0; i < 400; i++) {
      const px = Pos.x[m]!;
      step(sim);
      const dx = Pos.x[m]! - px;
      if (dx * lastDx < 0) reversals++;
      if (dx !== 0) lastDx = dx;
      if (arrived < 0 && Math.abs(Pos.x[m]! - (CX + 700)) < 30) arrived = i;
    }
    expect(arrived).toBeGreaterThan(0);
    expect(reversals).toBeLessThanOrEqual(2);
  });

  it('no unit ends inside a wall after a long mixed run', () => {
    const sim = makeSim();
    const m = sim.slots[0]!;
    place(sim, m, CX, CY);
    const r = rng(3);
    for (let i = 0; i < 6; i++) spawnMinion(sim, Kind.MinionMelee, 1, Lane.Mid, CX + r() * 300, CY + r() * 300);
    for (let i = 0; i < 600; i++) {
      step(sim, i % 40 === 0 ? moveCmd(CX + (r() - 0.5) * 6000, CY + (r() - 0.5) * 6000) : []);
      expect(walkable(sim.map.nav, sim.c.Pos.x[m]!, sim.c.Pos.y[m]!)).toBe(true);
    }
  });
});
