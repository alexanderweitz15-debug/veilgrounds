// structuresHelpers first: it imports sim.ts before any system module (systems <-> sim import cycle).
import { newSim, spawnChamp, stepA, stepUntil } from './structuresHelpers';
import { describe, expect, it } from 'vitest';
import { dealDamage, kill } from '../src/sim/damage';
import { Kind, Lane, sec } from '../src/sim/types';
import {
  PLATE_GOLD,
  TOWER_KILL_LAST_HIT_GOLD,
  TOWER_KILL_TEAM_GOLD,
  structureAt,
  towerBaseDamage,
  towerShotDamage,
  towerState,
  towersSystem,
} from '../src/sim/systems/towers';
import { noteAggression, spawnMinion } from '../src/sim/systems/minions';
import { computeVision } from '../src/sim/vision';
import { MAP_SIZE } from '../src/sim/map';
import type { Sim } from '../src/sim/sim';

/** Shots of `tower` until `m` dies. */
function shotsToKill(sim: Sim, tower: number, m: number): number {
  let n = 0;
  while (sim.c.Unit.alive[m] && n < 50) {
    const s = towerShotDamage(sim, tower, m);
    dealDamage(sim, tower, m, s.amount, s.type, { raw: s.raw });
    n++;
  }
  return n;
}

/** Mid point of the map (the mid lane runs along the diagonal through it). */
const MID = MAP_SIZE / 2;
const outer = (sim: Sim, team: number, lane: number): number => structureAt(sim, team, Kind.Tower, lane, 0)!.eid;

describe('structures', () => {
  it('spawns 11 towers, 3 inhibitors and a nexus per team', () => {
    const sim = newSim(false);
    for (const team of [0, 1]) {
      const l = towerState(sim).list.filter((r) => r.team === team);
      expect(l.filter((r) => r.kind === Kind.Tower)).toHaveLength(11);
      expect(l.filter((r) => r.kind === Kind.Inhibitor)).toHaveLength(3);
      expect(l.filter((r) => r.kind === Kind.Nexus)).toHaveLength(1);
    }
    const t = outer(sim, 0, Lane.Mid);
    expect(sim.c.Vision.r[t]).toBe(1350);
    expect(sim.c.Stats.range[t]).toBe(750);
    expect(sim.c.Stats.as[t]).toBeCloseTo(0.83);
  });

  it.each([0, sec(20 * 60)])('tower shot counts vs minions are exact (spawned at tick %i)', (tick) => {
    const sim = newSim(false);
    sim.tick = tick;
    const t = outer(sim, 0, Lane.Mid);
    const melee = spawnMinion(sim, Kind.MinionMelee, 1, Lane.Mid, MID, MID);
    // LoL: melee 3 shots (two shots leave 10 %: shot-shot-auto), caster 2 shots (auto-shot-auto)
    expect(shotsToKill(sim, t, melee)).toBe(3);
    const siege = spawnMinion(sim, Kind.MinionSiege, 1, Lane.Mid, MID, MID);
    const n = shotsToKill(sim, t, siege);
    expect(n).toBeGreaterThanOrEqual(6);
    expect(n).toBeLessThanOrEqual(7);
    // caster: one tower shot leaves 30 %; at 1:05 a level-1 ADC (60 AD) needs auto - shot - auto
    const caster = spawnMinion(sim, Kind.MinionCaster, 1, Lane.Mid, MID, MID);
    const adc = spawnChamp(sim, 0, MID, MID);
    if (tick === 0) {
      dealDamage(sim, adc, caster, 60, 'phys', { isAuto: true });
      expect(sim.c.Unit.alive[caster]).toBe(1);
    }
    const before = sim.c.Hp.cur[caster]!;
    const s = towerShotDamage(sim, t, caster);
    dealDamage(sim, t, caster, s.amount, s.type, { raw: s.raw });
    expect(sim.c.Unit.alive[caster]).toBe(1);
    expect(sim.c.Hp.cur[caster]).toBeCloseTo(before - sim.c.Hp.max[caster]! * 0.7);
    if (tick === 0) {
      dealDamage(sim, adc, caster, 60, 'phys', { isAuto: true });
      expect(sim.c.Unit.alive[caster]).toBe(0);
    }
    const m2 = spawnMinion(sim, Kind.MinionMelee, 1, Lane.Mid, MID, MID);
    for (let i = 0; i < 2; i++) {
      const sh = towerShotDamage(sim, t, m2);
      dealDamage(sim, t, m2, sh.amount, sh.type, { raw: sh.raw });
    }
    expect(sim.c.Hp.cur[m2]).toBeCloseTo(sim.c.Hp.max[m2]! * 0.1);
    const c2 = spawnMinion(sim, Kind.MinionCaster, 1, Lane.Mid, MID, MID);
    expect(shotsToKill(sim, t, c2)).toBe(2);
  });

  it('tower damage scales 170 -> 320 over 20 minutes and warms up on champions', () => {
    expect(towerBaseDamage(0, 0)).toBe(170);
    expect(towerBaseDamage(0, sec(10 * 60))).toBeCloseTo(245);
    expect(towerBaseDamage(0, sec(20 * 60))).toBe(320);
    expect(towerBaseDamage(0, sec(40 * 60))).toBe(320);
    const sim = newSim(false);
    const t = outer(sim, 0, Lane.Mid);
    const c = spawnChamp(sim, 1, 7050, 7050);
    const shots = [0, 1, 2, 3, 4].map(() => towerShotDamage(sim, t, c).amount);
    expect(shots.map((x) => Math.round(x))).toEqual([170, 238, 306, 374, 374]);
    expect(towerShotDamage(sim, t, c).type).toBe('phys');
  });

  it('protection: each structure only becomes vulnerable after the previous one fell', () => {
    const sim = newSim(false);
    const { Unit } = sim.c;
    const inner = structureAt(sim, 1, Kind.Tower, Lane.Top, 1)!;
    const inhibT = structureAt(sim, 1, Kind.Tower, Lane.Top, 2)!;
    const inhib = structureAt(sim, 1, Kind.Inhibitor, Lane.Top)!;
    const nt = towerState(sim).list.filter((r) => r.team === 1 && r.tier === 3);
    const nexus = structureAt(sim, 1, Kind.Nexus, 255)!;
    expect(Unit.untargetable[outer(sim, 1, Lane.Top)]).toBe(0);
    for (const r of [inner, inhibT, inhib, ...nt, nexus]) expect(Unit.untargetable[r.eid]).toBe(1);
    expect(dealDamage(sim, -1, inner.eid, 500, 'true')).toBe(0); // invulnerable

    kill(sim, outer(sim, 1, Lane.Top), -1);
    stepA(sim);
    expect(Unit.untargetable[inner.eid]).toBe(0);
    expect(Unit.untargetable[inhibT.eid]).toBe(1);
    kill(sim, inner.eid, -1);
    stepA(sim);
    kill(sim, inhibT.eid, -1);
    stepA(sim);
    expect(Unit.untargetable[inhib.eid]).toBe(0);
    for (const r of nt) expect(Unit.untargetable[r.eid]).toBe(1);
    kill(sim, inhib.eid, -1);
    stepA(sim);
    for (const r of nt) expect(Unit.untargetable[r.eid]).toBe(0);
    expect(Unit.untargetable[nexus.eid]).toBe(1);
    kill(sim, nt[0]!.eid, -1);
    stepA(sim);
    expect(Unit.untargetable[nexus.eid]).toBe(1);
    kill(sim, nt[1]!.eid, -1);
    stepA(sim);
    expect(Unit.untargetable[nexus.eid]).toBe(0);
    kill(sim, nexus.eid, -1);
    expect(sim.state.winner).toBe(0);
    expect(sim.events.some((e) => e.e === 'gameOver' && e.winner === 0)).toBe(true);
  });

  it('inhibitor respawns after 5 minutes; nexus towers become protected again', () => {
    const sim = newSim(false);
    for (const tier of [0, 1, 2]) {
      kill(sim, structureAt(sim, 1, Kind.Tower, Lane.Mid, tier)!.eid, -1);
      stepA(sim);
    }
    const inhib = structureAt(sim, 1, Kind.Inhibitor, Lane.Mid)!;
    kill(sim, inhib.eid, -1);
    const diedAt = sim.tick;
    stepA(sim);
    const nt = towerState(sim).list.find((r) => r.team === 1 && r.tier === 3)!;
    expect(sim.c.Unit.untargetable[nt.eid]).toBe(0);
    stepUntil(sim, diedAt + sec(300) - 1);
    expect(inhib.alive).toBe(false);
    stepUntil(sim, diedAt + sec(300) + 1);
    expect(inhib.alive).toBe(true);
    expect(sim.c.Hp.cur[inhib.eid]).toBe(4000);
    expect(sim.c.Unit.untargetable[nt.eid]).toBe(1);
  });

  it('tower kill pays 250 to every member of the killing team and 150 extra to the last hitter', () => {
    const sim = newSim(false);
    const a = spawnChamp(sim, 0, 3000, 3000);
    const b = spawnChamp(sim, 0, 3000, 3000);
    const enemy = spawnChamp(sim, 1, 3000, 3000);
    kill(sim, outer(sim, 1, Lane.Bot), a);
    expect(sim.c.Champ.gold[a]).toBe(TOWER_KILL_TEAM_GOLD + TOWER_KILL_LAST_HIT_GOLD);
    expect(sim.c.Champ.gold[b]).toBe(TOWER_KILL_TEAM_GOLD);
    expect(sim.c.Champ.gold[enemy]).toBe(0);
  });
});

describe('plates', () => {
  it('a champion breaking a plate before 14:00 gets 120 gold; plates fall at 14:00 with -50 % armor', () => {
    const sim = newSim(false);
    const t = outer(sim, 1, Lane.Mid);
    const c = spawnChamp(sim, 0, 9000, 9000);
    const { Tower, Champ, Stats } = sim.c;
    expect(Tower.plates[t]).toBe(5);
    dealDamage(sim, c, t, 700, 'true');
    stepA(sim);
    expect(Tower.plates[t]).toBe(5);
    expect(Champ.gold[c]).toBe(0);
    dealDamage(sim, c, t, 150, 'true'); // 4150 HP: first plate breaks
    stepA(sim);
    expect(Tower.plates[t]).toBe(4);
    expect(Champ.gold[c]).toBe(PLATE_GOLD);
    // a minion breaking a plate: split between enemy champions within 1000 of the tower
    const c2 = spawnChamp(sim, 0, 9300, 9300);
    const m = spawnMinion(sim, Kind.MinionMelee, 0, Lane.Mid, 9500, 9500);
    dealDamage(sim, m, t, 800, 'true');
    stepA(sim);
    expect(Tower.plates[t]).toBe(3);
    expect(Champ.gold[c]).toBe(PLATE_GOLD + PLATE_GOLD / 2);
    expect(Champ.gold[c2]).toBe(PLATE_GOLD / 2);

    stepUntil(sim, sec(14 * 60) + 1);
    expect(Tower.plates[t]).toBe(0);
    expect(Stats.armor[t]).toBe(20);
    const before = Champ.gold[c]!;
    dealDamage(sim, c, t, 1000, 'true');
    stepA(sim);
    expect(Champ.gold[c]).toBe(before);
  });

  it('plate events are emitted', () => {
    const sim = newSim(false);
    const t = outer(sim, 0, Lane.Top);
    const c = spawnChamp(sim, 1, 1300, 10000);
    dealDamage(sim, c, t, 1700, 'true'); // two plates in one go
    stepA(sim);
    expect(sim.events.filter((e) => e.e === 'plate' && e.tower === t)).toHaveLength(2);
    expect(sim.c.Champ.gold[c]).toBe(2 * PLATE_GOLD);
  });
});

describe('tower targeting', () => {
  it('prefers minions, switches at once to a champion attacking an allied champion within 1400', () => {
    const sim = newSim(false);
    const t = outer(sim, 0, Lane.Mid); // blue mid outer (offsets are along the mid diagonal, from the tower: map-scale independent)
    const P = sim.c.Pos.x[t]!;
    const minion = spawnMinion(sim, Kind.MinionMelee, 1, Lane.Mid, P + 500, P + 500);
    const enemy = spawnChamp(sim, 1, P + 350, P + 350);
    const ally = spawnChamp(sim, 0, P + 200, P + 200);
    stepA(sim); // vision
    towersSystem.update(sim);
    expect(sim.c.Atk.target[t]).toBe(minion);
    noteAggression(sim, enemy, ally); // enemy auto-attacks our champion
    towersSystem.update(sim);
    expect(sim.c.Atk.target[t]).toBe(enemy);
    sim.tick += 60; // call expired, keeps the champion while the minion is still around
    towersSystem.update(sim);
    expect(sim.c.Atk.target[t]).toBe(enemy);
  });

  it('ignores champion fights further than 1400 away and shoots champions only without minions', () => {
    const sim = newSim(false);
    const t = outer(sim, 0, Lane.Mid);
    const P = sim.c.Pos.x[t]!;
    const minion = spawnMinion(sim, Kind.MinionMelee, 1, Lane.Mid, P + 500, P + 500);
    const enemy = spawnChamp(sim, 1, P + 350, P + 350);
    const ally = spawnChamp(sim, 0, P - 1400, P - 1400); // ~2000 from the tower
    stepA(sim);
    noteAggression(sim, enemy, ally);
    towersSystem.update(sim);
    expect(sim.c.Atk.target[t]).toBe(minion);
    kill(sim, minion, -1);
    computeVision(sim);
    towersSystem.update(sim);
    expect(sim.c.Atk.target[t]).toBe(enemy);
  });

  it('drops the target when it leaves range; warming resets on a new target', () => {
    const sim = newSim(false);
    const t = outer(sim, 0, Lane.Mid);
    const tx = sim.c.Pos.x[t]!;
    const ty = sim.c.Pos.y[t]!;
    const enemy = spawnChamp(sim, 1, tx + 300, ty + 300);
    stepA(sim);
    towersSystem.update(sim);
    expect(sim.c.Atk.target[t]).toBe(enemy);
    towerShotDamage(sim, t, enemy);
    towerShotDamage(sim, t, enemy);
    expect(sim.c.Tower.shotsOnSame[t]).toBe(2);
    sim.c.Pos.x[enemy] = tx + 2000; // far out of range
    sim.c.Pos.y[enemy] = ty + 2000;
    towersSystem.update(sim);
    expect(sim.c.Atk.target[t]).toBe(-1);
    sim.c.Pos.x[enemy] = tx + 300;
    sim.c.Pos.y[enemy] = ty + 300;
    towersSystem.update(sim);
    expect(sim.c.Atk.target[t]).toBe(enemy);
    expect(sim.c.Tower.shotsOnSame[t]).toBe(0); // stacks gone after the retarget
  });
});
