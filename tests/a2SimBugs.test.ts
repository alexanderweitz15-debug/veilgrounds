// Regression tests of the A2 bug hunt (Wave 0, docs/BUGS.md). Each fix has a test that failed before the fix.
// structuresHelpers first: it imports sim.ts before any system module (systems <-> sim import cycle).
import { newSim } from './structuresHelpers';
import { describe, expect, it } from 'vitest';
import { step } from '../src/sim/sim';
import { Kind, Lane } from '../src/sim/types';
import { spawnMinion } from '../src/sim/systems/minions';
import { inBush } from '../src/sim/map';
import { structureAt } from '../src/sim/systems/towers';
import { cmd, makeSim, mira, place, steps } from './combat-helpers';

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

  it('a move order onto the own tower ends at its rim instead of walking into it for ever', () => {
    // bots send champions to tower positions; the order stayed Move.mode 1 (matchProbe: aurel at 15:36, thessaly at 17:55)
    const sim = makeSim();
    const t = structureAt(sim, 0, Kind.Tower, Lane.Mid, 0)!.eid;
    const tx = sim.c.Pos.x[t]!;
    const ty = sim.c.Pos.y[t]!;
    const m = mira(sim);
    place(sim, m, tx - 500, ty - 500);
    cmd(sim, { t: 'move', x: tx, y: ty });
    steps(sim, 30 * 8);
    expect(sim.c.Move.mode[m]).toBe(0);
    expect(Math.hypot(sim.c.Pos.x[m]! - tx, sim.c.Pos.y[m]! - ty)).toBeLessThan(sim.c.Unit.radius[t]! + sim.c.Unit.radius[m]! + 30);
  });
});
