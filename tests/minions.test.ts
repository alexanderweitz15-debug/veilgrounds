// structuresHelpers first: it imports sim.ts before any system module (systems <-> sim import cycle).
import { newSim, spawnChamp, stepA } from './structuresHelpers';
import { describe, expect, it } from 'vitest';
import { Kind, Lane, SimEvent } from '../src/sim/types';
import { CHASE_LEASH, minionsSystem, noteAggression, recordCombat, spawnMinion } from '../src/sim/systems/minions';
import { structureAt } from '../src/sim/systems/towers';
import { kill } from '../src/sim/damage';
import { computeVision } from '../src/sim/vision';
import type { Sim } from '../src/sim/sim';

// Mid lane around (8000, 8000) is ~2260 away from both outer mid towers.
const X = 8000;

function run(sim: Sim): void {
  computeVision(sim);
  minionsSystem.update(sim);
}

describe('minion aggro', () => {
  it('idle minion walks its lane', () => {
    const sim = newSim(false);
    const m = spawnMinion(sim, Kind.MinionMelee, 0, Lane.Mid, X, X);
    run(sim);
    expect(sim.c.Move.mode[m]).toBe(1);
    expect(sim.paths.get(m)!.at(-1)).toEqual({ x: 14200, y: 14200 });
    const before = sim.c.Pos.x[m]!;
    for (let i = 0; i < 30; i++) stepA(sim);
    expect(sim.c.Pos.x[m]!).toBeGreaterThan(before + 150);
  });

  it('drops an idle champion target for a minion that comes into aggro range', () => {
    const sim = newSim(false);
    const m = spawnMinion(sim, Kind.MinionMelee, 0, Lane.Mid, X, X);
    const champ = spawnChamp(sim, 1, X + 150, X + 150);
    run(sim);
    expect(sim.c.Atk.target[m]).toBe(champ);
    const enemy = spawnMinion(sim, Kind.MinionMelee, 1, Lane.Mid, X - 300, X - 300);
    run(sim);
    expect(sim.c.Atk.target[m]).toBe(enemy);
  });

  it('stops chasing an idle champion that leaves aggro range', () => {
    const sim = newSim(false);
    const m = spawnMinion(sim, Kind.MinionMelee, 0, Lane.Mid, X, X);
    const champ = spawnChamp(sim, 1, X + 150, X + 150);
    run(sim);
    expect(sim.c.Atk.target[m]).toBe(champ);
    sim.c.Pos.x[champ] = X + 700;
    sim.c.Pos.y[champ] = X + 700;
    run(sim);
    expect(sim.c.Atk.target[m]).toBe(-1);
  });

  it('prefers the nearest enemy minion over a nearer champion (no calls)', () => {
    const sim = newSim(false);
    const m = spawnMinion(sim, Kind.MinionMelee, 0, Lane.Mid, X, X);
    const champ = spawnChamp(sim, 1, X + 150, X + 150);
    const far = spawnMinion(sim, Kind.MinionMelee, 1, Lane.Mid, X + 330, X + 330);
    const near = spawnMinion(sim, Kind.MinionMelee, 1, Lane.Mid, X + 250, X + 250);
    run(sim);
    expect(sim.c.Atk.target[m]).toBe(near);
    expect(sim.c.Move.mode[m]).toBe(2);
    void champ;
    void far;
  });

  it('idle champion only when close to the minion attack range (no lane-wide chasing)', () => {
    const sim = newSim(false);
    const m = spawnMinion(sim, Kind.MinionMelee, 0, Lane.Mid, X, X);
    const champ = spawnChamp(sim, 1, X + 600, X);
    run(sim);
    expect(sim.c.Atk.target[m]).toBe(-1);
    sim.c.Pos.x[champ] = X + 400;
    run(sim);
    expect(sim.c.Atk.target[m]).toBe(-1);
    sim.c.Pos.x[champ] = X + 200;
    run(sim);
    expect(sim.c.Atk.target[m]).toBe(champ);
  });

  it('priority: champ->champ beats minion->champ beats minion->minion', () => {
    const sim = newSim(false);
    const m = spawnMinion(sim, Kind.MinionMelee, 0, Lane.Mid, X, X);
    const allyChamp = spawnChamp(sim, 0, X - 300, X - 300);
    const allyMinion = spawnMinion(sim, Kind.MinionMelee, 0, Lane.Mid, X + 100, X - 100);
    const r1 = spawnMinion(sim, Kind.MinionMelee, 1, Lane.Mid, X + 200, X + 200); // attacks ally minion
    const r2 = spawnMinion(sim, Kind.MinionCaster, 1, Lane.Mid, X + 450, X + 450); // attacks ally champion
    const enemyChamp = spawnChamp(sim, 1, X + 600, X + 400);
    noteAggression(sim, r1, allyMinion);
    run(sim);
    expect(sim.c.Atk.target[m]).toBe(r1); // P3
    // new target picks: reset
    sim.c.Atk.target[m] = -1;
    noteAggression(sim, r2, allyChamp);
    run(sim);
    expect(sim.c.Atk.target[m]).toBe(r2); // P2 beats P3 although r1 is nearer
    sim.c.Atk.target[m] = -1;
    noteAggression(sim, enemyChamp, allyChamp);
    run(sim);
    expect(sim.c.Atk.target[m]).toBe(enemyChamp); // P1
  });

  it('keeps its target on lower calls but switches at once on champion-attacks-champion', () => {
    const sim = newSim(false);
    const m = spawnMinion(sim, Kind.MinionMelee, 0, Lane.Mid, X, X);
    const allyChamp = spawnChamp(sim, 0, X - 300, X - 300);
    const target = spawnMinion(sim, Kind.MinionMelee, 1, Lane.Mid, X + 200, X + 200);
    const r2 = spawnMinion(sim, Kind.MinionCaster, 1, Lane.Mid, X + 450, X + 450);
    const enemyChamp = spawnChamp(sim, 1, X + 600, X + 400);
    run(sim);
    expect(sim.c.Atk.target[m]).toBe(target); // P4
    noteAggression(sim, r2, allyChamp); // P2 call: no switch
    sim.tick++;
    run(sim);
    expect(sim.c.Atk.target[m]).toBe(target);
    noteAggression(sim, enemyChamp, allyChamp); // P1 call: switch
    sim.tick++;
    run(sim);
    expect(sim.c.Atk.target[m]).toBe(enemyChamp);
    // drops it when it dies; the P2 call is still fresh, so it answers that next
    kill(sim, enemyChamp, -1);
    sim.tick++;
    run(sim);
    expect(sim.c.Atk.target[m]).toBe(r2);
  });

  it('call for help: victim must be within 1000', () => {
    const sim = newSim(false);
    const m = spawnMinion(sim, Kind.MinionMelee, 0, Lane.Mid, X, X);
    const allyChamp = spawnChamp(sim, 0, X - 900, X - 900); // ~1270 away
    const enemyChamp = spawnChamp(sim, 1, X - 450, X - 450);
    const r = spawnMinion(sim, Kind.MinionMelee, 1, Lane.Mid, X + 250, X + 250);
    noteAggression(sim, enemyChamp, allyChamp);
    run(sim);
    expect(sim.c.Atk.target[m]).toBe(r);
  });

  it('drops a target that leaves the leash range and returns to the lane', () => {
    const sim = newSim(false);
    const m = spawnMinion(sim, Kind.MinionMelee, 0, Lane.Mid, X, X);
    const champ = spawnChamp(sim, 1, X + 300, X);
    run(sim);
    expect(sim.c.Atk.target[m]).toBe(champ);
    sim.c.Pos.x[champ] = X + 1200;
    run(sim);
    expect(sim.c.Atk.target[m]).toBe(-1);
    expect(sim.c.Move.mode[m]).toBe(1);
  });

  it('gives up a kiting champion after a short chase (CHASE_LEASH) and walks back to the lane', () => {
    const sim = newSim(false);
    const m = spawnMinion(sim, Kind.MinionMelee, 0, Lane.Mid, X, X);
    const ally = spawnChamp(sim, 0, X - 200, X - 200);
    const enemy = spawnChamp(sim, 1, X + 250, X - 250);
    let maxOff = 0;
    for (let i = 0; i < 150; i++) {
      // the enemy keeps hitting our champion (call for help) while walking away across the lane, a bit faster than
      // a minion: before the leash the minion followed it until 1000 apart, i.e. thousands of units off its lane
      noteAggression(sim, enemy, ally);
      sim.c.Pos.x[enemy] = sim.c.Pos.x[enemy]! + 8.5;
      sim.c.Pos.y[enemy] = sim.c.Pos.y[enemy]! - 8.5;
      stepA(sim);
      maxOff = Math.max(maxOff, Math.hypot(sim.c.Pos.x[m]! - X, sim.c.Pos.y[m]! - X));
    }
    expect(maxOff).toBeLessThan(CHASE_LEASH + 60);
    expect(sim.c.Atk.target[m]).not.toBe(enemy);
    // walked back to its lane (the mid diagonal)
    expect(Math.abs(sim.c.Pos.x[m]! - sim.c.Pos.y[m]!) / Math.SQRT2).toBeLessThan(300);
  });

  it('attacks enemy structures when no units are around, never protected ones', () => {
    const sim = newSim(false);
    const tower = structureAt(sim, 1, Kind.Tower, Lane.Mid, 0)!; // (9350, 9350)
    const m = spawnMinion(sim, Kind.MinionCaster, 0, Lane.Mid, 9250, 9250);
    run(sim);
    expect(sim.c.Atk.target[m]).toBe(tower.eid);
    const inner = structureAt(sim, 1, Kind.Tower, Lane.Mid, 1)!; // (10625, 10625), protected
    const m2 = spawnMinion(sim, Kind.MinionCaster, 0, Lane.Mid, 10700, 10700);
    run(sim);
    expect(sim.c.Atk.target[m2]).not.toBe(inner.eid);
  });

  it('records attack/damage events into the aggression ledger (economy.update path)', () => {
    const sim = newSim(false);
    const m = spawnMinion(sim, Kind.MinionMelee, 0, Lane.Mid, X, X);
    const allyChamp = spawnChamp(sim, 0, X - 300, X - 300);
    const enemyChamp = spawnChamp(sim, 1, X + 400, X + 300);
    const r = spawnMinion(sim, Kind.MinionMelee, 1, Lane.Mid, X + 200, X + 200);
    sim.events.push({ e: 'attack', src: enemyChamp, dst: allyChamp } as SimEvent);
    recordCombat(sim);
    sim.events.length = 0;
    sim.tick++;
    run(sim);
    expect(sim.c.Atk.target[m]).toBe(enemyChamp);
    void r;
  });
});
