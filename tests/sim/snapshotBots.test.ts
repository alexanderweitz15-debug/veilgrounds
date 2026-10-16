// B3 (AGENTS-PLAN §4): snapshot additions for the bots, public information only. Plates per outer tower, Kesselbrut
// stacks of both teams, active reveals (own sweep / Siegelward circles, revealed enemies, own units revealed to the
// enemy); atkPhase / atkTarget of visible units (minion and tower target choice) with hidden targets masked.
import { describe, expect, it } from 'vitest';
import { query } from 'bitecs';
import { step, type Sim } from '../../src/sim/sim';
import { Kind, sec, type Command, type PlayerSetup } from '../../src/sim/types';
import { buildSnapshot } from '../../src/sim/snapshot';
import { reveal } from '../../src/sim/buffs';
import { dealDamage } from '../../src/sim/damage';
import { inventory } from '../../src/sim/items/inventory';
import { jungleState } from '../../src/sim/systems/jungle';
import { SEAL, SWEEP, trinket, wardsOf } from '../../src/sim/wards';
import { CX, CY, makeSim, place, steps } from '../combat-helpers';

const player = (slot: number, champion: string): PlayerSetup => ({ slot, team: slot < 5 ? 0 : 1, champion, role: 'mid', summoners: ['sprung', 'heilen'], isHuman: true });

function duel(): { sim: Sim; a: number; b: number } {
  const sim = makeSim({ players: [player(0, 'mira'), player(5, 'brom')] });
  const [a, b] = [sim.slots[0]!, sim.slots[5]!];
  place(sim, a, CX, CY);
  place(sim, b, CX + 4000, CY);
  step(sim);
  return { sim, a, b };
}
const as = (sim: Sim, slot: number, c: Command): void => step(sim, [{ slot, cmd: c }]);
const snap = (sim: Sim, team: number) => buildSnapshot(sim, team, team === 0 ? 0 : 5);

describe('B3 snapshot additions', () => {
  it('outer towers carry their plate count for both teams', () => {
    const { sim } = duel();
    const towers = snap(sim, 0).entities.filter((e) => e.kind === Kind.Tower);
    const outer = towers.filter((e) => e.plates !== undefined);
    expect(outer.length).toBe(6); // 3 lanes x 2 teams
    expect(outer.every((e) => e.plates === 5)).toBe(true);
    const red = outer.find((e) => e.team === 1)!;
    dealDamage(sim, -1, red.id, 900, 'true');
    step(sim);
    expect(snap(sim, 0).entities.find((e) => e.id === red.id)!.plates).toBe(4);
    expect(snap(sim, 1).entities.find((e) => e.id === red.id)!.plates).toBe(4);
  });

  it('Kesselbrut stacks of both teams are public', () => {
    const { sim } = duel();
    expect(snap(sim, 0).kesselbrutTeams).toBeUndefined();
    jungleState(sim).kesselbrut[1] = 3;
    expect(snap(sim, 0).kesselbrutTeams).toEqual([0, 3]);
    expect(snap(sim, 1).kesselbrutTeams).toEqual([0, 3]);
    expect(snap(sim, 1).kesselbrut).toBe(3); // the old own-team field stays
  });

  it('active reveals: own Siegelward and Suchfeuer circles; revealed enemies; own units exposed', () => {
    const { sim, a, b } = duel();
    inventory(sim, a)[0] = 'siegelward';
    as(sim, 0, { t: 'item', slot: 0, x: CX + 300, y: CY });
    const seal = wardsOf(sim, 0).find((w) => w.type === 'seal')!.eid;
    const s0 = snap(sim, 0);
    expect(s0.reveals).toEqual([{ kind: 'seal', x: sim.c.Pos.x[seal], y: sim.c.Pos.y[seal], r: SEAL.revealR }]);
    expect(snap(sim, 1).reveals).toBeUndefined(); // enemy team: nothing of ours
    // red sweeps from its fountain at level 9
    const f = sim.map.sides[1].fountain;
    place(sim, b, f.x, f.y);
    sim.c.Champ.level[b] = SWEEP.unlockLevel;
    as(sim, 5, { t: 'trinket', id: 'suchfeuer' });
    expect(trinket(sim, b).id).toBe('suchfeuer');
    place(sim, b, CX + 900, CY);
    as(sim, 5, { t: 'ward', x: CX + 400, y: CY });
    const sw = snap(sim, 1).reveals!.find((r) => r.kind === 'sweep')!;
    expect(sw).toMatchObject({ kind: 'sweep', r: SWEEP.r });
    expect(sw.until).toBeGreaterThan(sim.tick);
    // red reveals mira (e.g. Nyx seed): red sees her flagged, blue knows she is exposed
    place(sim, b, CX + 6000, CY);
    reveal(sim, 1, a, sec(3));
    step(sim);
    expect(snap(sim, 1).entities.find((e) => e.id === a)).toMatchObject({ revealed: true });
    expect(snap(sim, 0).entities.find((e) => e.id === a)).toMatchObject({ exposed: true });
    steps(sim, sec(3));
    expect(snap(sim, 0).entities.find((e) => e.id === a)!.exposed).toBeUndefined();
  });

  it('atkTarget: tower and minion target choice is in the view; hidden targets are masked to -1', () => {
    const { sim, a, b } = duel();
    // red champion visible to blue, "attacking" a unit blue cannot see
    place(sim, b, CX + 500, CY);
    const hidden = [...query(sim.world, [sim.c.Unit])].find((e) => sim.c.Unit.kind[e] === Kind.Tower && sim.c.Unit.team[e] === 1)!;
    step(sim);
    sim.c.Atk.target[b] = a;
    expect(snap(sim, 0).entities.find((e) => e.id === b)!.atkTarget).toBe(a);
    // a red ward blue cannot see (stealth) as target: masked
    as(sim, 5, { t: 'ward', x: CX + 700, y: CY });
    const w = wardsOf(sim, 1)[0]!.eid;
    sim.c.Atk.target[b] = w;
    expect(snap(sim, 0).entities.find((e) => e.id === b)!.atkTarget).toBe(-1);
    expect(snap(sim, 1).entities.find((e) => e.id === b)!.atkTarget).toBe(w); // own team keeps it
    // structures are always in the view: a tower target is never masked
    sim.c.Atk.target[b] = hidden;
    expect(snap(sim, 0).entities.find((e) => e.id === b)!.atkTarget).toBe(hidden);
  });
});
