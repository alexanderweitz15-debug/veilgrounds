// B4 (AGENTS-PLAN §4): the lobby top laner unlocks Teleport as a third summoner after 1500 gold from lane minions.
import { describe, expect, it } from 'vitest';
import { createSim, step, type Sim } from '../../src/sim/sim';
import { Kind, Lane, type PlayerSetup } from '../../src/sim/types';
import { kill } from '../../src/sim/damage';
import { abilityHud } from '../../src/sim/systems/abilities';
import { spawnMinion } from '../../src/sim/systems/minions';
import { structureAt } from '../../src/sim/systems/towers';
import { teleporting } from '../../src/sim/summoners';
import { buildSnapshot } from '../../src/sim/snapshot';
import { TOP_TP_GOLD, noteLaneMinionGold, topTpGold } from '../../src/sim/topTeleport';
import { CX, CY, NO_RUNES, place } from '../combat-helpers';

const p = (slot: number, role: PlayerSetup['role'], summoners: [string, string] = ['sprung', 'heilen']): PlayerSetup => ({ slot, team: slot < 5 ? 0 : 1, champion: slot < 5 ? 'isolde' : 'brom', role, summoners, isHuman: true, runes: NO_RUNES });
const make = (players: PlayerSetup[]): Sim => createSim({ seed: 1, mode: 'sandbox', minionsEnabled: false, players });

describe('B4 Teleport for top', () => {
  it('lane-minion gold feeds the top laner counter; 1500 unlocks Teleport in slot 2 (event to the own team only)', () => {
    const sim = make([p(0, 'top'), p(5, 'mid')]);
    const top = sim.slots[0]!;
    step(sim);
    place(sim, top, CX, CY);
    const m = spawnMinion(sim, Kind.MinionMelee, 1, 0, CX + 100, CY);
    const before = sim.c.Champ.gold[top]!;
    kill(sim, m, top);
    const g = sim.c.Champ.gold[top]! - before;
    expect(g).toBeGreaterThan(0);
    expect(topTpGold(sim, top)).toBeCloseTo(g, 6);
    expect(TOP_TP_GOLD).toBe(1500);
    expect(abilityHud(sim, top)).toHaveLength(6);
    noteLaneMinionGold(sim, top, TOP_TP_GOLD - g - 1);
    expect(abilityHud(sim, top)).toHaveLength(6);
    noteLaneMinionGold(sim, top, 1);
    const hud = abilityHud(sim, top);
    expect(hud).toHaveLength(7);
    expect(hud[6]).toMatchObject({ id: 'teleport', rank: 1, cdLeft: 0, cdTotal: 360 });
    expect(sim.events.some((e) => e.e === 'tpUnlocked' && e.eid === top && e.slot === 2)).toBe(true);
    expect(buildSnapshot(sim, 0, 0).events.some((e) => e.e === 'tpUnlocked')).toBe(true);
    expect(buildSnapshot(sim, 1, 5).events.some((e) => e.e === 'tpUnlocked')).toBe(false);
    // further minion gold does not add a fourth slot
    noteLaneMinionGold(sim, top, 5000);
    expect(abilityHud(sim, top)).toHaveLength(7);
    // the new slot casts like Teleport: 4 s channel to an own tower
    step(sim);
    const t = structureAt(sim, 0, Kind.Tower, Lane.Top, 0)!;
    step(sim, [{ slot: 0, cmd: { t: 'spell', slot: 2, x: t.x, y: t.y } }]);
    expect(teleporting(sim, top)).toBe(true);
  });

  it('only the lobby top laner; a top laner that took Teleport gets no extra slot', () => {
    const sim = make([p(0, 'mid'), p(1, 'top', ['teleport', 'sprung']), p(5, 'top')]);
    step(sim);
    const [mid, top, red] = [sim.slots[0]!, sim.slots[1]!, sim.slots[5]!];
    for (const e of [mid, top, red]) noteLaneMinionGold(sim, e, 2000);
    expect(abilityHud(sim, mid)).toHaveLength(6);
    expect(abilityHud(sim, top)).toHaveLength(6);
    expect(abilityHud(sim, red)).toHaveLength(7); // red's top laner
    expect(sim.events.filter((e) => e.e === 'tpUnlocked')).toHaveLength(1);
  });
});
