// A2 bug hunt (docs/BUGS.md): ward visibility. Stealth wards seen / unseen by the right team over the whole life,
// expiry, control wards (Siegelward) revealing and un-revealing.
// structuresHelpers first: it imports sim.ts before any system module (systems <-> sim import cycle).
import { newSim } from './structuresHelpers';
import { describe, expect, it } from 'vitest';
import { createSim, step, type Sim } from '../src/sim/sim';
import type { Command } from '../src/sim/types';
import { buildSnapshot } from '../src/sim/snapshot';
import { sees } from '../src/sim/vision';
import { inventory } from '../src/sim/items/inventory';
import { dealDamage } from '../src/sim/damage';
import { SEAL, VEIL, WARD_VISION, wardsOf } from '../src/sim/wards';
import { CX, CY, place, steps } from './combat-helpers';

void newSim;

function duel(): { sim: Sim; a: number; b: number } {
  const sim = createSim({
    seed: 3,
    mode: 'sandbox',
    minionsEnabled: false,
    players: [
      { slot: 0, team: 0, champion: 'mira', role: 'adc', summoners: ['sprung', 'heilen'], isHuman: true },
      { slot: 5, team: 1, champion: 'brom', role: 'top', summoners: ['sprung', 'heilen'], isHuman: true },
    ],
  });
  const [a, b] = [sim.slots[0]!, sim.slots[5]!];
  place(sim, a, CX, CY);
  place(sim, b, CX + 3000, CY);
  step(sim);
  return { sim, a, b };
}
const as = (sim: Sim, slot: number, c: Command): void => step(sim, [{ slot, cmd: c }]);
const inSnap = (sim: Sim, team: number, eid: number): boolean => buildSnapshot(sim, team, team === 0 ? 0 : 5).entities.some((e) => e.id === eid);

describe('Schleierward visibility over its whole life', () => {
  it('never in the enemy snapshot, not even with the enemy champion standing on it; in the own snapshot until the tick it expires', () => {
    const { sim, a, b } = duel();
    as(sim, 0, { t: 'ward', x: CX + 200, y: CY });
    const w = wardsOf(sim, 0)[0]!.eid;
    place(sim, b, CX + 220, CY); // enemy right on top of the ward
    let seenByEnemy = 0;
    let missingOwn = 0;
    const born = sim.tick;
    while (wardsOf(sim, 0).length > 0 && sim.tick < born + VEIL.ticks + 5) {
      place(sim, b, CX + 220, CY);
      step(sim);
      if (sees(sim, 1, w) || inSnap(sim, 1, w)) seenByEnemy++;
      if (wardsOf(sim, 0).length > 0 && !inSnap(sim, 0, w)) missingOwn++;
    }
    expect(seenByEnemy).toBe(0);
    expect(missingOwn).toBe(0);
    expect(sim.tick - born).toBe(VEIL.ticks); // gone exactly at the lifetime end
    expect(wardsOf(sim, 0)).toHaveLength(0);
    expect(inSnap(sim, 0, w)).toBe(false);
    void a;
  });

  it('gives its team vision until it expires and none one tick later', () => {
    const { sim, a, b } = duel();
    as(sim, 0, { t: 'ward', x: CX + 200, y: CY });
    const born = sim.tick;
    place(sim, a, CX - 6000, CY); // owner far away: only the ward spots brom
    place(sim, b, CX + 500, CY);
    step(sim);
    expect(sees(sim, 0, b)).toBe(true);
    while (sim.tick < born + VEIL.ticks - 3) {
      place(sim, b, CX + 500, CY);
      step(sim);
    }
    expect(sees(sim, 0, b)).toBe(true);
    steps(sim, 10);
    place(sim, b, CX + 500, CY);
    step(sim);
    expect(wardsOf(sim, 0)).toHaveLength(0);
    expect(sees(sim, 0, b)).toBe(false);
  });
});

describe('Siegelward (control ward)', () => {
  it('reveals and disables an enemy Schleierward in 450; once it dies the ward is hidden and sees again', () => {
    const { sim, a, b } = duel();
    place(sim, b, CX + 900, CY);
    step(sim);
    as(sim, 5, { t: 'ward', x: CX + 700, y: CY + 100 });
    const enemyWard = wardsOf(sim, 1)[0]!.eid;
    place(sim, b, CX + 6000, CY);
    step(sim);
    inventory(sim, a)[0] = 'siegelward';
    as(sim, 0, { t: 'item', slot: 0, x: CX + 300, y: CY });
    const seal = wardsOf(sim, 0).find((x) => x.type === 'seal')!.eid;
    step(sim);
    step(sim);
    expect(sees(sim, 0, enemyWard)).toBe(true);
    expect(sim.c.Vision.r[enemyWard]).toBe(0);
    // brom comes back and kills the seal ward (it is visible): the enemy ward is hidden again and sees again
    place(sim, b, CX + 450, CY);
    place(sim, a, CX - 3000, CY);
    step(sim);
    for (let i = 0; i < SEAL.hp + 1; i++) dealDamage(sim, b, seal, 999, 'phys', { isAuto: true });
    step(sim);
    step(sim);
    step(sim);
    expect(wardsOf(sim, 0).some((x) => x.eid === seal)).toBe(false);
    expect(sees(sim, 0, enemyWard)).toBe(false);
    expect(sim.c.Vision.r[enemyWard]).toBe(WARD_VISION);
  });
});
