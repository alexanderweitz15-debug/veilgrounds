// B3 (AGENTS-PLAN §4): snapshot additions for the bots, public information only. Plates per outer tower, Kesselbrut
// stacks of both teams, active reveals (own sweep / Siegelward circles, revealed enemies, own units revealed to the
// enemy); atkPhase / atkTarget of visible units (minion and tower target choice) with hidden targets masked.
import { describe, expect, it } from 'vitest';
import { query } from 'bitecs';
import { step, type Sim } from '../../src/sim/sim';
import { Kind, sec, type Command, type PlayerSetup } from '../../src/sim/types';
import { buildSnapshot } from '../../src/sim/snapshot';
import { addBuff, reveal } from '../../src/sim/buffs';
import { dealDamage, kill } from '../../src/sim/damage';
import { structureAt } from '../../src/sim/systems/towers';
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

  it('public objectives of both teams: Kesselbrut, Leviathan, Schleier buff, inhibitor timers; respawn + summoner CDs', () => {
    const { sim, a, b } = duel();
    expect(snap(sim, 0).objectives).toEqual({ leviathan: [0, 0], kesselbrut: [0, 0], schleierLeft: [0, 0], inhibs: [] });
    jungleState(sim).kesselbrut[1] = 3;
    jungleState(sim).leviathan[0] = 2;
    addBuff(sim, b, { kind: 'mark', id: 'schleierwaechter', src: b, ticks: sec(100) });
    const o = snap(sim, 0).objectives!;
    expect(o.kesselbrut).toEqual([0, 3]);
    expect(o.leviathan).toEqual([2, 0]);
    expect(o.schleierLeft[1]).toBeCloseTo(100, 0);
    expect(snap(sim, 1).objectives!.kesselbrut).toEqual([0, 3]);
    expect(snap(sim, 1).kesselbrut).toBe(3); // the old own-team field stays
    const inhib = structureAt(sim, 1, Kind.Inhibitor, 0)!;
    kill(sim, inhib.eid, a);
    step(sim);
    expect(snap(sim, 0).objectives!.inhibs).toEqual([expect.objectContaining({ team: 1, lane: 0 })]);
    expect(snap(sim, 0).objectives!.inhibs[0]!.left).toBeGreaterThan(290);
    // respawn timer of a dead enemy champion, summoner CDs only for the own team
    kill(sim, b, a);
    step(sim);
    const row = snap(sim, 0).players.find((r) => r.slot === 5)!;
    expect(row.respawnIn).toBeGreaterThan(0);
    expect(row.summonerCds).toBeUndefined();
    expect(snap(sim, 0).players.find((r) => r.slot === 0)!.summonerCds).toEqual([{ left: 0, total: 300 }, { left: 0, total: 240 }]);
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

  it('enemy items as last seen: shown while visible, frozen in the fog, absent if never seen', () => {
    const { sim, a, b } = duel();
    const row = () => snap(sim, 0).players.find((r) => r.slot === 5)!;
    expect(row().items).toBeUndefined(); // brom was never in blue's vision
    inventory(sim, b)[0] = 'langschwert';
    place(sim, b, CX + 400, CY);
    step(sim);
    expect(row().items![0]).toBe('langschwert');
    const seenAt = row().itemsSeen!;
    place(sim, b, CX + 6000, CY);
    steps(sim, 3);
    inventory(sim, b)[1] = 'langschwert';
    steps(sim, 3);
    expect(row().items![1]).toBeNull(); // bought in the fog: not known
    expect(row().itemsSeen).toBeLessThanOrEqual(seenAt + 3);
    expect(snap(sim, 1).players.find((r) => r.slot === 5)!.items![1]).toBe('langschwert'); // own team: live
    expect(snap(sim, 1).players.find((r) => r.slot === 0)!.items).toBeDefined(); // red saw mira at CX
    void a;
  });

  it('ScoreRow: vision score for both teams, champion damage for the own team only', () => {
    const { sim, a, b } = duel();
    as(sim, 0, { t: 'ward', x: CX + 200, y: CY });
    steps(sim, sec(61));
    expect(snap(sim, 1).players.find((r) => r.slot === 0)!.visionScore).toBe(1);
    dealDamage(sim, a, b, 100, 'true');
    expect(snap(sim, 0).players.find((r) => r.slot === 0)!.champDamage).toBe(100);
    expect(snap(sim, 1).players.find((r) => r.slot === 0)!.champDamage).toBeUndefined();
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
