// structuresHelpers first: it imports sim.ts before any system module (systems <-> sim import cycle).
import { newSim, spawnChamp, stepA, stepUntil } from './structuresHelpers';
import { describe, expect, it } from 'vitest';
import { Kind, Lane, sec } from '../src/sim/types';
import {
  CUM_XP,
  START_GOLD,
  bounty,
  cancelRecall,
  deathTimerTicks,
  economySystem,
  grantXp,
  startRecall,
  xpToNext,
} from '../src/sim/systems/economy';
import { spawnMinion } from '../src/sim/systems/minions';
import { dealDamage, kill } from '../src/sim/damage';
import type { Sim } from '../src/sim/sim';

const X = 8000;

/** Minions in LoL kill order: per wave 3 melee, then 3 casters; every 3rd wave also a siege minion. */
function killOrder(n: number): number[] {
  const out: number[] = [];
  for (let w = 1; out.length < n; w++) {
    out.push(Kind.MinionMelee, Kind.MinionMelee, Kind.MinionMelee, Kind.MinionCaster, Kind.MinionCaster, Kind.MinionCaster);
    if (w % 3 === 0) out.push(Kind.MinionSiege);
  }
  return out.slice(0, n);
}

/** Number of minion deaths nearby until `champ` reaches `level`. */
function minionsToLevel(sim: Sim, champ: number, level: number): number {
  const order = killOrder(200);
  for (let i = 0; i < order.length; i++) {
    const m = spawnMinion(sim, order[i]!, 1, Lane.Mid, X + 100, X);
    kill(sim, m, -1);
    if (sim.c.Champ.level[champ]! >= level) return i + 1;
  }
  return -1;
}

describe('XP and levels', () => {
  it('curve 280, 380, ... with level 18 at 18360', () => {
    expect(CUM_XP[2]).toBe(280);
    expect(CUM_XP[3]).toBe(660);
    expect(CUM_XP[18]).toBe(18360);
    const sim = newSim(false);
    const c = spawnChamp(sim, 0, X, X);
    expect(xpToNext(sim, c)).toBe(280);
    grantXp(sim, c, 18360);
    expect(sim.c.Champ.level[c]).toBe(18);
    expect(sim.c.Champ.skillPoints[c]).toBe(17);
    expect(xpToNext(sim, c)).toBe(0);
    expect(sim.events.filter((e) => e.e === 'level')).toHaveLength(17);
  });

  it('cheat-style grantXp(xpToNext) levels exactly once', () => {
    const sim = newSim(false);
    const c = spawnChamp(sim, 0, X, X);
    grantXp(sim, c, 59.4 * 0.65);
    for (let l = 2; l <= 18; l++) {
      grantXp(sim, c, xpToNext(sim, c));
      expect(sim.c.Champ.level[c]).toBe(l);
    }
  });

  it('solo: level 2 after 7 minions, level 3 after 15', () => {
    const sim = newSim(false);
    const c = spawnChamp(sim, 0, X, X);
    expect(minionsToLevel(sim, c, 2)).toBe(7);
    const sim2 = newSim(false);
    const c2 = spawnChamp(sim2, 0, X, X);
    expect(minionsToLevel(sim2, c2, 3)).toBe(15);
  });

  it('duo: level 2 after 9 minions, level 3 after 22 (65 % share each)', () => {
    const sim = newSim(false);
    const a = spawnChamp(sim, 0, X, X);
    spawnChamp(sim, 0, X, X + 200);
    expect(minionsToLevel(sim, a, 2)).toBe(9);
    const sim2 = newSim(false);
    const b = spawnChamp(sim2, 0, X, X);
    spawnChamp(sim2, 0, X, X + 200);
    expect(minionsToLevel(sim2, b, 3)).toBe(22);
  });

  it('XP only within 1500 and only for the enemy team; share table', () => {
    const sim = newSim(false);
    const near = spawnChamp(sim, 0, X, X);
    const far = spawnChamp(sim, 0, X + 1700, X);
    const enemy = spawnChamp(sim, 1, X, X);
    kill(sim, spawnMinion(sim, Kind.MinionMelee, 1, Lane.Mid, X + 100, X), -1);
    expect(sim.c.Champ.xp[near]).toBeCloseTo(59.4);
    expect(sim.c.Champ.xp[far]).toBe(0);
    expect(sim.c.Champ.xp[enemy]).toBe(0);
    for (const [n, share] of [[3, 0.43], [4, 0.33], [5, 0.26]] as const) {
      const s = newSim(false);
      const cs = Array.from({ length: n }, (_, i) => spawnChamp(s, 0, X, X + i * 10));
      kill(s, spawnMinion(s, Kind.MinionMelee, 1, Lane.Mid, X, X), -1);
      for (const c of cs) expect(s.c.Champ.xp[c]).toBeCloseTo(59.4 * share);
    }
  });
});

describe('gold', () => {
  it('starts with 500 gold; passive 20 per 10 s from 1:05', () => {
    const sim = newSim(false);
    const c = spawnChamp(sim, 0, X, X);
    economySystem.init!(sim);
    expect(sim.c.Champ.gold[c]).toBe(START_GOLD);
    stepUntil(sim, 1950);
    expect(sim.c.Champ.gold[c]).toBe(START_GOLD);
    stepUntil(sim, 1950 + sec(10) + 1);
    expect(sim.c.Champ.gold[c]).toBe(START_GOLD + 20);
    stepUntil(sim, 1950 + sec(60) + 1);
    expect(sim.c.Champ.gold[c]).toBe(START_GOLD + 120);
  });

  it('minion gold and CS only for champion last hits', () => {
    const sim = newSim(false);
    const c = spawnChamp(sim, 0, X, X);
    const m1 = spawnMinion(sim, Kind.MinionMelee, 1, Lane.Mid, X + 100, X);
    const m2 = spawnMinion(sim, Kind.MinionCaster, 1, Lane.Mid, X + 100, X);
    const m3 = spawnMinion(sim, Kind.MinionSiege, 1, Lane.Mid, X + 100, X);
    const allyMinion = spawnMinion(sim, Kind.MinionMelee, 0, Lane.Mid, X, X);
    dealDamage(sim, c, m1, 1000, 'true');
    dealDamage(sim, c, m2, 1000, 'true');
    dealDamage(sim, allyMinion, m3, 5000, 'true'); // denied by a minion: no gold
    expect(sim.c.Champ.cs[c]).toBe(2);
    expect(sim.c.Champ.gold[c]).toBe(21 + 14);
    expect(sim.events.filter((e) => e.e === 'gold')).toHaveLength(2);
  });

  it('champion kill: 300 + first blood, 50 % shared by assisters, streak bounties', () => {
    const sim = newSim(false);
    const k = spawnChamp(sim, 0, X, X);
    const a1 = spawnChamp(sim, 0, X, X);
    const a2 = spawnChamp(sim, 0, X, X);
    const v = spawnChamp(sim, 1, X + 100, X);
    dealDamage(sim, a1, v, 100, 'true');
    economySystem.update(sim); // records this tick's damage events
    sim.events.length = 0;
    sim.tick++;
    dealDamage(sim, a2, v, 100, 'true'); // same tick as the kill: read from sim.events in onDeath
    dealDamage(sim, k, v, 1000, 'true');
    expect(sim.c.Unit.alive[v]).toBe(0);
    expect(sim.c.Champ.gold[k]).toBe(400);
    expect(sim.c.Champ.gold[a1]).toBe(100);
    expect(sim.c.Champ.gold[a2]).toBe(100);
    // streaks: k has 1 kill; after two more kills k is worth 300 + 100 * 2
    const v2 = spawnChamp(sim, 1, X, X);
    kill(sim, v2, k);
    expect(sim.c.Champ.gold[k]).toBe(700);
    const v3 = spawnChamp(sim, 1, X, X);
    kill(sim, v3, k);
    expect(bounty(sim, k)).toBe(500);
    // death streak lowers v's bounty
    expect(bounty(sim, v)).toBe(270);
  });

  it('assist window is 10 s; executions credit the last champion damager', () => {
    const sim = newSim(false);
    const old = spawnChamp(sim, 0, X, X);
    const last = spawnChamp(sim, 0, X, X);
    const v = spawnChamp(sim, 1, X + 100, X);
    dealDamage(sim, old, v, 50, 'true');
    economySystem.update(sim);
    stepUntil(sim, sec(11));
    dealDamage(sim, last, v, 50, 'true');
    economySystem.update(sim);
    sim.events.length = 0;
    sim.tick++;
    kill(sim, v, -1); // e.g. tower execution
    expect(sim.c.Champ.gold[last]).toBe(400);
    expect(sim.c.Champ.gold[old]).toBe(0);
  });
});

describe('death, respawn, recall, regen', () => {
  it('death timer endpoints: 10 s at level 1, 52.5 s at 18, +50 % by 55:00, no factor before 15:00', () => {
    expect(deathTimerTicks(1, 0)).toBe(sec(10));
    expect(deathTimerTicks(18, 0)).toBe(Math.round(52.5 * 30));
    expect(deathTimerTicks(18, sec(15 * 60))).toBe(Math.round(52.5 * 30));
    expect(deathTimerTicks(18, sec(55 * 60))).toBe(Math.round(52.5 * 1.5 * 30));
    expect(deathTimerTicks(18, sec(70 * 60))).toBe(Math.round(52.5 * 1.5 * 30));
    expect(deathTimerTicks(1, sec(35 * 60))).toBe(Math.round(10 * 1.25 * 30));
  });

  it('dead champion respawns at the fountain with full HP after the timer', () => {
    const sim = newSim(false);
    const c = spawnChamp(sim, 0, X, X);
    kill(sim, c, -1);
    expect(sim.c.Unit.alive[c]).toBe(0);
    expect(sim.c.Champ.respawnAt[c]).toBe(sim.tick + sec(10));
    const at = sim.c.Champ.respawnAt[c]!;
    stepUntil(sim, at);
    expect(sim.c.Unit.alive[c]).toBe(0);
    stepA(sim);
    expect(sim.c.Unit.alive[c]).toBe(1);
    expect(sim.events.some((e) => e.e === 'respawn' && e.eid === c)).toBe(true);
    expect(sim.c.Hp.cur[c]).toBe(600);
    expect(sim.c.Pos.x[c]).toBe(sim.map.sides[0].fountain.x);
  });

  it('recall: 8 s channel to the fountain, cancelled by damage', () => {
    const sim = newSim(false);
    const c = spawnChamp(sim, 0, X, X);
    startRecall(sim, c);
    const end = sim.c.Champ.recallAt[c]!;
    expect(end).toBe(sim.tick + sec(8));
    stepUntil(sim, end);
    expect(sim.c.Pos.x[c]).toBe(X);
    stepA(sim);
    expect(sim.c.Pos.x[c]).toBe(sim.map.sides[0].fountain.x);
    expect(sim.c.Champ.recallAt[c]).toBe(0);

    sim.c.Pos.x[c] = X;
    sim.c.Pos.y[c] = X;
    startRecall(sim, c);
    stepUntil(sim, sim.tick + 60);
    const e = spawnChamp(sim, 1, X, X);
    // damage lands during the tick (attack/projectiles run before economy)
    sim.events.length = 0;
    dealDamage(sim, e, c, 10, 'true');
    economySystem.update(sim);
    expect(sim.c.Champ.recallAt[c]).toBe(0);
    startRecall(sim, c);
    cancelRecall(sim, c);
    expect(sim.c.Champ.recallAt[c]).toBe(0);
  });

  it('applies HP/mana regen per second and fountain heals 10 %/s', () => {
    const sim = newSim(false);
    const c = spawnChamp(sim, 0, X, X);
    const { Hp, Mana } = sim.c;
    Hp.cur[c] = 300;
    Hp.regen[c] = 3;
    Mana.max[c] = 400;
    Mana.cur[c] = 100;
    Mana.regen[c] = 6;
    stepUntil(sim, sec(1));
    expect(Hp.cur[c]).toBeCloseTo(303);
    expect(Mana.cur[c]).toBeCloseTo(106);
    const f = sim.map.sides[0].fountain;
    sim.c.Pos.x[c] = f.x;
    sim.c.Pos.y[c] = f.y;
    Hp.regen[c] = 0;
    Mana.regen[c] = 0;
    stepUntil(sim, sec(2));
    expect(Hp.cur[c]).toBeCloseTo(363);
    expect(Mana.cur[c]).toBeCloseTo(146);
  });
});
