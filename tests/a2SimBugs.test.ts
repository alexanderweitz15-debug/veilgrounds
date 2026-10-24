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
