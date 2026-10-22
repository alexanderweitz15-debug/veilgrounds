// C8: the client predicts the attack-move target (highlight before the click); it must equal what the sim picks.
import { describe, expect, it } from 'vitest';
import { step } from '../src/sim/sim';
import { Kind, Lane } from '../src/sim/types';
import { spawnDummy } from '../src/sim/systems/champions';
import { spawnMinion } from '../src/sim/systems/minions';
import { buildSnapshot } from '../src/sim/snapshot';
import { attackMoveTarget } from '../src/input/attackMove';
import { CX, CY, makeSim, place } from './combat-helpers';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

describe('C8 attack-move target prediction', () => {
  it('matches the sim (A + click, nearest to the click) in 40 random minion layouts', () => {
    const r = rng(9);
    let compared = 0;
    for (let trial = 0; trial < 40; trial++) {
      const sim = makeSim();
      const m = sim.slots[0]!;
      place(sim, m, CX, CY);
      for (let i = 0; i < 6; i++) {
        const kind = i % 2 ? Kind.MinionCaster : Kind.MinionMelee;
        spawnMinion(sim, kind, 1, Lane.Mid, CX + (r() - 0.3) * 1300, CY + (r() - 0.5) * 900);
      }
      // freeze the minions where they are (they would walk their lane)
      step(sim);
      const snap = buildSnapshot(sim, 0, 0);
      const me = snap.entities.find((e) => e.id === m)!;
      const gx = CX + (r() - 0.3) * 1200;
      const gy = CY + (r() - 0.5) * 800;
      const want = attackMoveTarget({ entities: snap.entities, myTeam: 0, me, range: snap.me!.stats.range, gx, gy, nearCursor: true, hover: null });
      step(sim, [{ slot: 0, cmd: { t: 'attackMove', x: gx, y: gy, cursor: true } }]);
      const got = sim.c.Atk.target[m]!;
      if (want) {
        compared++;
        expect(got).toBe(want.id);
      } else expect(got).toBe(-1);
    }
    expect(compared).toBeGreaterThan(10);
  });

  it('a unit under the cursor wins; allies, plants and out-of-range units never count', () => {
    const sim = makeSim();
    const m = sim.slots[0]!;
    place(sim, m, CX, CY);
    const near = spawnDummy(sim, CX + 300, CY, 1);
    const far = spawnDummy(sim, CX + 1150, CY, 1);
    const ally = spawnDummy(sim, CX + 320, CY + 40, 0);
    step(sim);
    const snap = buildSnapshot(sim, 0, 0);
    const me = snap.entities.find((e) => e.id === m)!;
    const ctx = { entities: snap.entities, myTeam: 0, me, range: snap.me!.stats.range, gx: CX + 330, gy: CY + 40, nearCursor: true, hover: null };
    expect(attackMoveTarget(ctx)?.id).toBe(near);
    const farE = snap.entities.find((e) => e.id === far)!;
    expect(attackMoveTarget({ ...ctx, gx: CX + 1150, gy: CY })?.id).toBe(near); // far dummy is out of range
    expect(attackMoveTarget({ ...ctx, hover: farE })?.id).toBe(far); // hovered: attacked directly
    expect(attackMoveTarget({ ...ctx, entities: snap.entities.filter((e) => e.id !== near) })).toBeNull();
    expect(ally).toBeGreaterThan(0);
  });
});
