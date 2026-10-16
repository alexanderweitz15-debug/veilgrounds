// C2: client-side objective tracker (src/game/objectives.ts): respawn timers match the sim exactly, Leviathan
// stacks / soul, Schleierwaechter buff, inhibitor respawn, and sim snapshot fields win once they exist.
import { describe, expect, it } from 'vitest';
import { ObjectiveTracker } from '../src/game/objectives';
import { SummonerTimers, baseSummonerCd } from '../src/game/summonerTimers';
import { buildSnapshot, type ScoreRow, type Snapshot } from '../src/sim/snapshot';
import { kill } from '../src/sim/damage';
import { step } from '../src/sim/sim';
import { Kind, type SimEvent } from '../src/sim/types';
import { LEVIATHAN_MAX_STACKS } from '../src/sim/systems/jungle';
import { INHIB_RESPAWN } from '../src/sim/systems/towers';
import raw from '../src/data/map.json';
import { makeSim, NO_RUNES } from './combat-helpers';

const OBJ = raw.neutral.objectives;

function row(slot: number, team: number, champ: string, dead = false, level = 6): ScoreRow {
  return { slot, team, champ, level, kills: 0, deaths: 0, assists: 0, cs: 0, dead, itemValue: 0 };
}
const ROWS = (): ScoreRow[] => [row(0, 0, 'mira'), row(1, 0, 'brom'), row(5, 1, 'wren'), row(6, 1, 'oda')];

function snap(tick: number, events: SimEvent[], players = ROWS(), extra: Partial<Snapshot> = {}): Snapshot {
  return { tick, time: tick / 30, team: 0, entities: [], projectiles: [], objects: [], me: null, events, players, ...extra };
}
const death = (kind: number, team: number, x: number, y: number, more: Partial<Extract<SimEvent, { e: 'death' }>> = {}): SimEvent => ({
  e: 'death', eid: 900, kind, team, killer: 3, x, y, ...more,
});
const monsterKill = (at: { x: number; y: number }, killerTeam: number, killerKind: number = Kind.Champion): SimEvent =>
  death(Kind.Monster, 2, at.x, at.y, { killerTeam, killerKind });

describe('respawn timers', () => {
  it('match the sim respawn time of a champion of either team', () => {
    const sim = makeSim({
      mode: 'classic',
      minionsEnabled: false,
      players: [
        { slot: 0, team: 0, champion: 'mira', role: 'adc', summoners: ['sprung', 'heilen'], isHuman: true, runes: NO_RUNES },
        { slot: 5, team: 1, champion: 'wren', role: 'mid', summoners: ['sprung', 'heilen'], isHuman: false, runes: NO_RUNES },
      ],
    });
    for (let i = 0; i < 40; i++) step(sim);
    const me = sim.slots[0]!;
    const foe = sim.slots[5]!;
    sim.c.Champ.level[foe] = 9;
    const tr = new ObjectiveTracker();
    // a death inside a step: the snapshot after that step carries the event (tick already incremented)
    sim.events.length = 0;
    kill(sim, foe, me);
    sim.tick++;
    let s = buildSnapshot(sim, 0, 0);
    tr.ingest(s);
    const foeRow = (x: Snapshot): ScoreRow => x.players.find((p) => p.slot === 5)!;
    expect(foeRow(s).dead).toBe(true);
    const expected = (sim.c.Champ.respawnAt[foe]! - sim.tick) / 30;
    expect(expected).toBeGreaterThan(10);
    expect(tr.respawnIn(foeRow(s))).toBeCloseTo(expected, 5);
    // counts down with the sim and clears on respawn
    for (let i = 0; i < 90; i++) step(sim);
    s = buildSnapshot(sim, 0, 0);
    tr.ingest(s);
    expect(tr.respawnIn(foeRow(s))).toBeCloseTo((sim.c.Champ.respawnAt[foe]! - sim.tick) / 30, 5);
    expect(tr.deadList().map((d) => d.row.champ)).toEqual(['wren']);
    while (!sim.c.Unit.alive[foe]) step(sim);
    tr.ingest(buildSnapshot(sim, 0, 0));
    expect(tr.deadList()).toEqual([]);
  });

  it('own champion: same value as the sim HUD respawn timer', () => {
    const sim = makeSim({
      mode: 'classic',
      minionsEnabled: false,
      players: [
        { slot: 0, team: 0, champion: 'mira', role: 'adc', summoners: ['sprung', 'heilen'], isHuman: true, runes: NO_RUNES },
        { slot: 5, team: 1, champion: 'wren', role: 'mid', summoners: ['sprung', 'heilen'], isHuman: false, runes: NO_RUNES },
      ],
    });
    step(sim);
    const tr = new ObjectiveTracker();
    sim.events.length = 0;
    kill(sim, sim.slots[0]!, sim.slots[5]!);
    sim.tick++;
    for (let i = 0; i < 5; i++) {
      const s = buildSnapshot(sim, 0, 0);
      tr.ingest(s);
      expect(tr.respawnIn(s.players.find((p) => p.slot === 0)!)).toBeCloseTo(s.me!.respawnIn, 5);
      step(sim);
    }
  });

  it('prefers ScoreRow.respawnIn from the sim; alive rows have none', () => {
    const tr = new ObjectiveTracker();
    const dead = { ...row(5, 1, 'wren', true), respawnIn: 12.5 } as ScoreRow;
    tr.ingest(snap(100, [], [row(0, 0, 'mira'), dead]));
    expect(tr.respawnIn(dead)).toBe(12.5);
    expect(tr.respawnIn(row(0, 0, 'mira'))).toBeNull();
  });
});

describe('manual enemy summoner timers', () => {
  it('count down the base cooldown, Teleport late cooldown after 10:00, second click clears', () => {
    const tm = new SummonerTimers();
    expect(tm.toggle(5, 0, 'sprung', 100)).toBe(true);
    expect(tm.left(5, 0, 160)).toEqual({ left: 240, total: 300 });
    expect(tm.left(5, 0, 400)).toBeNull();
    expect(baseSummonerCd('teleport', 300)).toBe(360);
    expect(baseSummonerCd('teleport', 600)).toBe(240);
    tm.toggle(6, 1, 'heilen', 50);
    expect(tm.toggle(6, 1, 'heilen', 60)).toBe(false);
    expect(tm.left(6, 1, 61)).toBeNull();
    expect(tm.toggle(6, 1, 'unknown', 60)).toBe(false);
  });
});

describe('objectives', () => {
  it('counts Leviathan stacks per killer team, champion kills only, soul at the maximum', () => {
    const tr = new ObjectiveTracker();
    tr.ingest(snap(10, [monsterKill(OBJ.leviathan, 1, Kind.MinionMelee)]));
    expect(tr.team(1).leviathan).toBe(0);
    for (let i = 0; i < LEVIATHAN_MAX_STACKS + 1; i++) tr.ingest(snap(20 + i, [monsterKill(OBJ.leviathan, 0)]));
    tr.ingest(snap(40, [monsterKill(OBJ.leviathan, 1)]));
    expect(tr.team(0)).toMatchObject({ leviathan: LEVIATHAN_MAX_STACKS, soul: true });
    expect(tr.team(1)).toMatchObject({ leviathan: 1, soul: false });
  });

  it('Schleierwaechter buff: 180 s for the killing team, ends when every holder died', () => {
    const tr = new ObjectiveTracker();
    const players = ROWS();
    players[1]!.dead = true; // brom dead at the kill: no buff for him
    tr.ingest(snap(3000, [monsterKill(OBJ.schleierwaechter, 0)], players, {}), () => ({ radius: 160 }));
    expect(tr.team(0).schleierLeft).toBeCloseTo(180 - 1 / 30, 5);
    expect(tr.team(1).schleierLeft).toBe(0);
    tr.ingest(snap(3300, [], players));
    expect(tr.team(0).schleierLeft).toBeCloseTo(170 - 1 / 30, 5);
    tr.ingest(snap(3400, [death(Kind.Champion, 0, 0, 0, { champ: 'mira' })], players));
    expect(tr.team(0).schleierLeft).toBe(0);
  });

  it('inhibitor respawn timer until it stands again', () => {
    const tr = new ObjectiveTracker();
    tr.ingest(snap(600, [death(Kind.Inhibitor, 1, 11000, 3500)]));
    expect(tr.team(1).inhibRespawn).toEqual([(INHIB_RESPAWN - 1) / 30]);
    expect(tr.team(0).inhibRespawn).toEqual([]);
    const inhib = { id: 7, kind: Kind.Inhibitor, team: 1, x: 11000, y: 3500, alive: true } as Snapshot['entities'][number];
    tr.ingest(snap(700, [], ROWS(), { entities: [inhib] }));
    expect(tr.team(1).inhibRespawn).toEqual([]);
  });

  it('Kesselbrut: own count from the snapshot, enemy unknown unless seen or sent by the sim', () => {
    const tr = new ObjectiveTracker();
    tr.ingest(snap(10, [], ROWS(), { kesselbrut: 3 }));
    expect(tr.team(0).kesselbrut).toBe(3);
    expect(tr.team(1).kesselbrut).toBeNull();
    tr.ingest(snap(11, [monsterKill(OBJ.kesselbrut, 1)], ROWS(), { kesselbrut: 3 }), () => ({ radius: 70, variant: 'kesselbrut' }));
    expect(tr.team(1).kesselbrut).toBe(1);
    const withSim = { ...snap(12, [], ROWS(), { kesselbrut: 3 }), objectives: { kesselbrut: [3, 2] as [number, number], leviathan: [1, 2] as [number, number] } };
    tr.ingest(withSim);
    expect(tr.team(1)).toMatchObject({ kesselbrut: 2, leviathan: 2 });
  });
});
