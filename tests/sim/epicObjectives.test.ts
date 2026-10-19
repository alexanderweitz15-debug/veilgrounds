// B6 (AGENTS-PLAN §4): Kesselbrut (with Leviathan, Schleierwaechter) is an epic objective: flag on the camp, kills
// announced to both teams (death event `epic`), monsters marked `epic` in the snapshot; normal camps stay in the fog.
import { describe, expect, it } from 'vitest';
import { sec } from '../../src/sim/types';
import { kill } from '../../src/sim/damage';
import { CAMPS, isEpicMonster, jungleState } from '../../src/sim/systems/jungle';
import { buildSnapshot, teamEvents } from '../../src/sim/snapshot';
import { makeSim, mira, steps } from '../combat-helpers';
import { step } from '../../src/sim/sim';

describe('B6 epic objectives', () => {
  it('Kesselbrut kills reach the enemy team, a normal camp kill in the fog does not', () => {
    expect([CAMPS.kesselbrut.epic, CAMPS.leviathan.epic, CAMPS.schleierwaechter.epic, CAMPS.dornenbock.epic]).toEqual([true, true, true, undefined]);
    const sim = makeSim();
    steps(sim, sec(360) + 2);
    const me = mira(sim);
    const camp = (id: string) => jungleState(sim).camps.find((c) => c.id === id)!;
    const grub = camp('kesselbrut').members.find((m) => sim.c.Unit.alive[m.eid])!.eid;
    const buck = camp('dornenbock').members[0]!.eid;
    expect(isEpicMonster(sim, grub)).toBe(true);
    expect(isEpicMonster(sim, buck)).toBe(false);
    // a visible epic monster carries the flag (team 0 sees it only if in vision: use the spectator view)
    expect(buildSnapshot(sim, 2, -1).entities.find((e) => e.id === grub)!.epic).toBe(true);
    // red (team 1, no units near either camp) gets the epic kill, not the camp kill
    kill(sim, grub, me);
    kill(sim, buck, me);
    const ev = teamEvents(sim, 1).events.filter((e) => e.e === 'death');
    expect(ev.some((e) => e.e === 'death' && e.eid === grub && e.epic)).toBe(true);
    expect(ev.some((e) => e.e === 'death' && e.eid === buck)).toBe(false);
    step(sim);
  });
});
