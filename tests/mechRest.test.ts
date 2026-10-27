// swarm/mech-rest: tower data json + plate gold 160 + fortification, Reinigen vs fear, stun stops an own dash,
// minion target tiers (turret / champion attacking an allied minion), 2 super minions when all inhibitors are down.
// structuresHelpers first: it imports sim.ts before any system module (systems <-> sim import cycle).
import { newSim, spawnChamp, stepA } from './structuresHelpers';
import { describe, expect, it } from 'vitest';
import { Kind, Lane, sec } from '../src/sim/types';
import { dealDamage, kill } from '../src/sim/damage';
import { spawnUnit, step, type Sim } from '../src/sim/sim';
import { addBuff, hasBuff } from '../src/sim/buffs';
import { levelAbility, abilityHud } from '../src/sim/systems/abilities';
import { PLATE_COUNT, PLATE_GOLD, TOWER_TIERS, structureAt } from '../src/sim/systems/towers';
import { minionsSystem, noteAggression, spawnMinion } from '../src/sim/systems/minions';
import { spawnWave, superCount } from '../src/sim/systems/waves';
import { computeVision } from '../src/sim/vision';
import { MAP_SIZE } from '../src/sim/map';
import towerData from '../src/data/towers.json';
import waveData from '../src/data/minionWave.json';
import { CX, CY, cmd, makeSim, place } from './combat-helpers';

const X = MAP_SIZE / 2;

describe('towers.json', () => {
  it('feeds the constants; plate gold is the LoL 160', () => {
    expect(PLATE_GOLD).toBe(160);
    expect(PLATE_GOLD).toBe(towerData.plates.gold);
    expect(PLATE_COUNT).toBe(towerData.plates.count);
    expect(TOWER_TIERS).toBe(towerData.tiers);
  });

  it('fortification: outer towers take reduced damage until 5:00', () => {
    const sim = newSim(false);
    const c = spawnChamp(sim, 0, 9000, 9000);
    const outer = structureAt(sim, 1, Kind.Tower, Lane.Mid, 0)!.eid;
    const { Hp } = sim.c;
    const hit = (t: number): number => {
      const before = Hp.cur[t]!;
      dealDamage(sim, c, t, 400, 'true');
      return before - Hp.cur[t]!;
    };
    expect(hit(outer)).toBeCloseTo(400 * towerData.fortification.damageMult);
    sim.tick = sec(towerData.fortification.untilSec);
    expect(hit(outer)).toBeCloseTo(400);
  });
});

describe('Reinigen vs fear', () => {
  it('is castable while feared and removes the fear', () => {
    const sim2 = makeSim({ players: [{ slot: 0, team: 0, champion: 'mira', role: 'adc', summoners: ['reinigen', 'heilen'], isHuman: true }] });
    const a = sim2.slots[0]!;
    place(sim2, a, CX, CY);
    step(sim2);
    addBuff(sim2, a, { kind: 'fear', id: 'f', src: -1, ticks: sec(2) });
    expect(hasBuff(sim2, a, 'fear')).toBe(true);
    cmd(sim2, { t: 'spell', slot: 0, x: CX, y: CY });
    expect(hasBuff(sim2, a, 'fear')).toBe(false);
    expect(abilityHud(sim2, a)[4]!.cdLeft).toBeGreaterThan(0);
    // airborne still blocks it
    addBuff(sim2, a, { kind: 'airborne', id: 'x', src: -1, ticks: sec(2) });
    expect(hasBuff(sim2, a, 'airborne')).toBe(true);
  });
});

describe('CC stops an own dash', () => {
  const dashDist = (cc: 'stun' | 'fear' | 'root' | null): number => {
    const sim = makeSim();
    const a = sim.slots[0]!;
    place(sim, a, CX, CY);
    step(sim);
    sim.c.Champ.skillPoints[a] = 1;
    levelAbility(sim, a, 2); // Mira E: 300 dash
    cmd(sim, { t: 'cast', slot: 2, x: CX + 300, y: CY });
    if (cc) addBuff(sim, a, { kind: cc, id: 'cc', src: -1, ticks: sec(2) });
    for (let i = 0; i < 12; i++) step(sim);
    return sim.c.Pos.x[a]! - CX;
  };

  it('stun and fear end the dash early, root does not', () => {
    const free = dashDist(null);
    expect(free).toBeGreaterThan(250);
    expect(dashDist('stun')).toBeLessThan(free * 0.6);
    expect(dashDist('fear')).toBeLessThan(free * 0.6);
    expect(dashDist('root')).toBeGreaterThan(250);
  });
});

describe('minion target tiers', () => {
  function run(sim: Sim): void {
    computeVision(sim);
    minionsSystem.update(sim);
  }
  function setup() {
    const sim = newSim(false);
    const m = spawnMinion(sim, Kind.MinionMelee, 0, Lane.Mid, X, X);
    const allyMinion = spawnMinion(sim, Kind.MinionMelee, 0, Lane.Mid, X + 100, X - 100);
    const near = spawnMinion(sim, Kind.MinionMelee, 1, Lane.Mid, X + 150, X + 150); // plain nearest minion (tier 6)
    const tower = spawnUnit(sim, Kind.Tower, 1, X + 500, X + 300, 88);
    const champ = spawnChamp(sim, 1, X + 350, X + 450);
    return { sim, m, allyMinion, near, tower, champ };
  }

  it('turret attacking an allied minion beats the nearest minion', () => {
    const { sim, m, allyMinion, near, tower } = setup();
    run(sim);
    expect(sim.c.Atk.target[m]).toBe(near);
    sim.c.Atk.target[m] = -1;
    noteAggression(sim, tower, allyMinion);
    run(sim);
    expect(sim.c.Atk.target[m]).toBe(tower);
  });

  it('champion attacking an allied minion beats the nearest minion', () => {
    const { sim, m, allyMinion, champ } = setup();
    noteAggression(sim, champ, allyMinion);
    run(sim);
    expect(sim.c.Atk.target[m]).toBe(champ);
  });

  it('order: minion->minion beats turret->minion beats champion->minion', () => {
    const { sim, m, allyMinion, near, tower, champ } = setup();
    noteAggression(sim, champ, allyMinion);
    noteAggression(sim, tower, allyMinion);
    run(sim);
    expect(sim.c.Atk.target[m]).toBe(tower);
    sim.c.Atk.target[m] = -1;
    noteAggression(sim, near, allyMinion);
    run(sim);
    expect(sim.c.Atk.target[m]).toBe(near);
  });
});

describe('super minions', () => {
  it('1 when this lane inhibitor is down, 2 when all three enemy inhibitors are down', () => {
    const sim = newSim(false);
    const down = (lane: number): void => kill(sim, structureAt(sim, 1, Kind.Inhibitor, lane)!.eid, -1);
    expect(superCount(sim, 0, Lane.Mid)).toBe(0);
    down(Lane.Mid);
    stepA(sim);
    expect(superCount(sim, 0, Lane.Mid)).toBe(waveData.superMinionsLaneDown);
    expect(superCount(sim, 0, Lane.Top)).toBe(0);
    down(Lane.Top);
    down(Lane.Bot);
    stepA(sim);
    expect(superCount(sim, 0, Lane.Mid)).toBe(2);
    expect(superCount(sim, 1, Lane.Mid)).toBe(0); // own inhibitors are up
    const ids = spawnWave(sim, 0, Lane.Mid, false, superCount(sim, 0, Lane.Mid));
    expect(ids.filter((e) => sim.c.Unit.kind[e] === Kind.MinionSuper)).toHaveLength(2);
  });
});
