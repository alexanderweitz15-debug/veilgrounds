// Regression tests of the A2 bug hunt (Wave 0, docs/BUGS.md). Each fix has a test that failed before the fix.
// structuresHelpers first: it imports sim.ts before any system module (systems <-> sim import cycle).
import { newSim } from './structuresHelpers';
import { describe, expect, it } from 'vitest';
import { step } from '../src/sim/sim';
import { Kind, Lane } from '../src/sim/types';
import { spawnMinion } from '../src/sim/systems/minions';
import { inBush } from '../src/sim/map';

describe('BUG-01: minions chasing a minion hidden in a bush', () => {
  it('an enemy minion outside the bush neither stands idle chasing it forever nor loses its lane', () => {
    // matchProbe seed 11 --brain=new, 33:53: red minions stood 10 s+ in chase mode (Move.mode 2) next to a blue caster
    // minion in the red bot-lane bush (15180, 3100): the attack system refuses unseen targets (attack.canTarget
    // needs vision), the minion aggro (minions.attackable) accepts every minion.
    const sim = newSim(false);
    const bx = 15033;
    const by = 3190;
    expect(inBush(sim.map, bx, by)).toBeGreaterThanOrEqual(0);
    const hidden = spawnMinion(sim, Kind.MinionCaster, 0, Lane.Bot, bx, by);
    const red = spawnMinion(sim, Kind.MinionMelee, 1, Lane.Bot, 15025, 3286);
    expect(inBush(sim.map, 15025, 3286)).toBe(-1);
    sim.c.Hp.max[hidden] = sim.c.Hp.cur[hidden] = 1e9; // keeps the target alive; it stays where it stands
    const x0 = sim.c.Pos.x[red]!;
    const y0 = sim.c.Pos.y[red]!;
    let chasedHidden = 0;
    for (let i = 0; i < 30 * 5; i++) {
      sim.c.Pos.x[hidden] = bx;
      sim.c.Pos.y[hidden] = by;
      sim.c.Move.mode[hidden] = 0;
      step(sim);
      if (sim.c.Atk.target[red] === hidden) chasedHidden++;
    }
    // it never picks the unseen minion as its target (it could not attack it) and goes on down its lane instead
    expect(chasedHidden).toBe(0);
    expect(Math.hypot(sim.c.Pos.x[red]! - x0, sim.c.Pos.y[red]! - y0)).toBeGreaterThan(300);
  });
});

describe('BUG-03: two friendly minions block each other at a lane vertex', () => {
  it('minions on either side of the bot-lane corner (14800, 1200) both walk on (matchProbe seed 12, new brain, 12:58; 20 s+ stalls at 2:34, 7:02, 12:06)', () => {
    // exact state from the probe: the vertex lies between the two bodies, each walks toward it, the separation pushes
    // each back by exactly the step: positions identical after every tick
    const sim = newSim(false);
    const path = (): { x: number; y: number }[] => [{ x: 14800, y: 1200 }, { x: 14800, y: 13000 }, { x: 14200, y: 14200 }];
    const a = spawnMinion(sim, Kind.MinionCaster, 0, Lane.Bot, 14748.237144426728, 1216.1893633337138);
    const b = spawnMinion(sim, Kind.MinionCaster, 0, Lane.Bot, 14819.18156447219, 1194.000769217421);
    sim.c.Face.x[a] = 0.9544092382797514;
    sim.c.Face.y[a] = -0.29850126613846134;
    sim.c.Face.x[b] = -0.9544092382797466;
    sim.c.Face.y[b] = 0.29850126613847716;
    for (const m of [a, b]) {
      sim.paths.set(m, path());
      sim.c.Move.mode[m] = 1;
    }
    for (let i = 0; i < 30 * 5; i++) step(sim);
    expect(sim.c.Pos.y[a]!).toBeGreaterThan(1800);
    expect(sim.c.Pos.y[b]!).toBeGreaterThan(1800);
  });
});

describe('BUG-02: a waypoint inside a structure never completes', () => {
  it('a siege minion at the rim of its own tower walks on (matchProbe seed 13: stuck for good at 2:41)', () => {
    // exact state from the probe: the lane vertex (1200, 11267) lies inside the collision circle of the outer top tower
    // (1300, 11300); the push-out kept the minion on a fixed point of walk-in / push-out for ever
    const sim = newSim(false);
    const m = spawnMinion(sim, Kind.MinionSiege, 0, Lane.Top, 1155.2117692165352, 11250.508907603547);
    sim.c.Face.x[m] = 0.9555492125467194;
    sim.c.Face.y[m] = 0.2948316509490533;
    sim.paths.set(m, [{ x: 1200, y: 11266.613553357407 }, { x: 1200, y: 14800 }, { x: 13000, y: 14800 }, { x: 14200, y: 14200 }]);
    sim.c.Move.mode[m] = 1;
    for (let i = 0; i < 30 * 8; i++) step(sim);
    expect(sim.c.Pos.y[m]!).toBeGreaterThan(11600);
  });
});
