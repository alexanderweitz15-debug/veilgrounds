import { describe, expect, it } from 'vitest';
import { createSim, step } from '../src/sim/sim';
import { buildSnapshot } from '../src/sim/snapshot';
import { addGroundObject } from '../src/sim/summons';

describe('snapshot fog for ground objects', () => {
  it('hidden traps only for the owner team; blades follow vision', () => {
    const sim = createSim({ seed: 1, mode: 'sandbox', minionsEnabled: false, players: [
      { slot: 0, team: 0, champion: 'grimald', role: 'jungle', summoners: ['sprung', 'bannen'], isHuman: true },
      { slot: 5, team: 1, champion: 'renn', role: 'mid', summoners: ['sprung', 'entflammen'], isHuman: false },
    ] });
    step(sim);
    const blue = sim.slots[0]!;
    const red = sim.slots[5]!;
    const { Pos } = sim.c;
    // stealthed trap inside red's vision but not under anyone (red sees the spot, yet stealth hides it from enemies)
    addGroundObject(sim, { owner: blue, tag: 'grimald_trap', x: Pos.x[red]! - 600, y: Pos.y[red]! - 600, r: 75, ticks: 900, stealth: true });
    // red blade far away from any blue vision
    addGroundObject(sim, { owner: red, tag: 'renn_blade', x: 8000, y: 8000, r: 40, ticks: 900 });
    step(sim);
    const blueView = buildSnapshot(sim, 0, 0);
    const redView = buildSnapshot(sim, 1, 5);
    expect(blueView.objects.map((o) => o.tag)).toEqual(['grimald_trap']);
    expect(redView.objects.map((o) => o.tag)).toEqual(['renn_blade']);
  });
});
