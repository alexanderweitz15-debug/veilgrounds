import { describe, expect, it } from 'vitest';
import { query } from 'bitecs';
import { step, spawnUnit, type Sim } from '../src/sim/sim';
import { softCapMs } from '../src/sim/systems/stats';
import { Kind } from '../src/sim/types';
import { lineWalkable, walkable } from '../src/sim/map';
import { sees } from '../src/sim/vision';
import { strongestSlow } from '../src/sim/buffs';
import { spawnDummy } from '../src/sim/systems/champions';
import { abilityHud, levelAbility } from '../src/sim/systems/abilities';
import { CHAMPION_DATA, missingHooks } from '../src/sim/champions';
import { validateChampion } from '../src/data/champions/validate';
import type { ChampionData } from '../src/sim/champions/schema';
import { CX, CY, cmd, collect, makeSim, mira, place, steps } from './combat-helpers';

function setup(level = 1, points = 1, champion = 'mira'): { sim: Sim; m: number } {
  const sim = makeSim(champion === 'mira' ? {} : { players: [{ slot: 0, team: 0, champion, role: 'adc', summoners: ['sprung', 'heilen'], isHuman: true }] });
  const m = mira(sim);
  place(sim, m, CX, CY);
  sim.c.Champ.level[m] = level;
  sim.c.Champ.skillPoints[m] = points;
  step(sim);
  return { sim, m };
}

describe('champion data', () => {
  it('mira.json validates and all its hooks resolve', () => {
    expect(validateChampion(CHAMPION_DATA.mira, 'mira.json')).toEqual([]);
    expect(missingHooks('mira')).toEqual([]);
  });
});

describe('ability ranks', () => {
  it('rank n needs level 2n-1 (Q/W/E, max 5); R needs 6/11/16 (max 3)', () => {
    const { sim, m } = setup(1, 30);
    const rank = (slot: number) => abilityHud(sim, m)[slot]!.rank;
    levelAbility(sim, m, 0);
    levelAbility(sim, m, 0);
    expect(rank(0)).toBe(1);
    levelAbility(sim, m, 3);
    expect(rank(3)).toBe(0);
    sim.c.Champ.level[m] = 3;
    levelAbility(sim, m, 0);
    levelAbility(sim, m, 0);
    expect(rank(0)).toBe(2);
    sim.c.Champ.level[m] = 6;
    levelAbility(sim, m, 3);
    levelAbility(sim, m, 3);
    expect(rank(3)).toBe(1);
    sim.c.Champ.level[m] = 18;
    for (let i = 0; i < 10; i++) levelAbility(sim, m, 0), levelAbility(sim, m, 3);
    expect(rank(0)).toBe(5);
    expect(rank(3)).toBe(3);
  });
  it('consumes skill points', () => {
    const { sim, m } = setup(1, 1);
    levelAbility(sim, m, 1);
    levelAbility(sim, m, 2);
    expect(abilityHud(sim, m).map((h) => h.rank).slice(0, 4)).toEqual([0, 1, 0, 0]);
    expect(sim.c.Champ.skillPoints[m]).toBe(0);
  });
});

describe('line skillshot (Mira W)', () => {
  const castW = (sim: Sim, m: number) => {
    levelAbility(sim, m, 1);
    return collect(sim, 60, m, { t: 'cast', slot: 1, x: CX + 1000, y: CY });
  };
  it('hits exactly at radius + width/2', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 600, CY + 65 + 30, 1);
    const hits = castW(sim, m);
    expect(hits).toEqual([{ tick: expect.any(Number), dst: d, amount: 80 + 60, crit: undefined }]);
  });
  it('misses just outside', () => {
    const { sim, m } = setup();
    spawnDummy(sim, CX + 600, CY + 65 + 30 + 0.01, 1);
    expect(castW(sim, m)).toHaveLength(0);
  });
  it('costs mana, goes on cooldown, has a 0.25 s wind-up', () => {
    const { sim, m } = setup();
    levelAbility(sim, m, 1);
    const mana = sim.c.Mana.cur[m]!;
    cmd(sim, { t: 'cast', slot: 1, x: CX + 1000, y: CY });
    expect(sim.c.Mana.cur[m]).toBeCloseTo(mana - 50, 0); // + one tick of regen
    expect(abilityHud(sim, m)[1]!.cdLeft).toBeCloseTo(12 - 1 / 30, 6);
    expect(sim.c.Stats.ms[m]).toBe(0); // stands still during wind-up
    steps(sim, 9); // resolves on tick +8 (abilities run after stats), free to move from the next tick
    expect(sim.c.Stats.ms[m]).toBe(340);
  });
  it('is blocked by the first minion', () => {
    const { sim, m } = setup();
    const minion = spawnUnit(sim, Kind.MinionMelee, 1, CX + 300, CY, 48);
    sim.c.Hp.max[minion] = sim.c.Hp.cur[minion] = 1000;
    const d = spawnDummy(sim, CX + 600, CY, 1);
    const hits = castW(sim, m);
    expect(hits.map((h) => h.dst)).toEqual([minion]);
    expect(hits.some((h) => h.dst === d)).toBe(false);
  });
  it('without blocked_by_minions it passes minions and hits champions only', () => {
    const base = CHAMPION_DATA.mira!;
    const nb: ChampionData = { ...base, id: 'mira_nb', abilities: [base.abilities[0], { ...base.abilities[1], flags: [] }, base.abilities[2], base.abilities[3]] };
    CHAMPION_DATA.mira_nb = nb;
    const { sim, m } = setup(1, 1, 'mira_nb');
    const minion = spawnUnit(sim, Kind.MinionMelee, 1, CX + 300, CY, 48);
    sim.c.Hp.max[minion] = sim.c.Hp.cur[minion] = 1000;
    const d = spawnDummy(sim, CX + 600, CY, 1);
    expect(castW(sim, m).map((h) => h.dst)).toEqual([d]);
    delete CHAMPION_DATA.mira_nb;
  });
  it('reveals the target for 3 s', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 1350, CY, 1); // outside Mira's 1200 vision
    step(sim);
    expect(sees(sim, 0, d)).toBe(false);
    expect(castW(sim, m)).toHaveLength(1);
    expect(sees(sim, 0, d)).toBe(true);
    steps(sim, 90);
    expect(sees(sim, 0, d)).toBe(false);
  });
});

describe('Mira kit', () => {
  it('passive: every third auto fires a second arrow for 50 %', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 400, CY, 1);
    step(sim);
    const hits = collect(sim, 150, m, { t: 'attack', target: d });
    expect(hits.slice(0, 4).map((h) => h.amount)).toEqual([60, 60, 60, 30]);
    expect(hits[2]!.tick).toBe(hits[3]!.tick);
  });
  it('Q: +40 % AS at rank 1, extended by autos', () => {
    const { sim, m } = setup();
    levelAbility(sim, m, 0);
    cmd(sim, { t: 'cast', slot: 0, x: CX, y: CY });
    step(sim);
    expect(sim.c.Stats.as[m]).toBeCloseTo(0.658 * 1.4, 9);
    steps(sim, 150);
    expect(sim.c.Stats.as[m]).toBeCloseTo(0.658, 9); // expired after 5 s without autos
  });
  it('E: dashes 300 toward the cursor and arms the double shot', () => {
    const { sim, m } = setup();
    levelAbility(sim, m, 2);
    const d = spawnDummy(sim, CX + 700, CY, 1);
    cmd(sim, { t: 'cast', slot: 2, x: CX + 1000, y: CY });
    steps(sim, 15);
    expect(sim.c.Pos.x[m]).toBeCloseTo(CX + 300, 6);
    const hits = collect(sim, 60, m, { t: 'attack', target: d });
    expect(hits.slice(0, 2).map((h) => h.amount)).toEqual([60, 30]);
  });
  it('R: telegraphed zone resolves after 1 s with damage and 40 % slow', () => {
    const { sim, m } = setup(6, 1);
    levelAbility(sim, m, 3);
    const d = spawnDummy(sim, CX + 900, CY + 300, 1);
    cmd(sim, { t: 'cast', slot: 3, x: CX + 900, y: CY });
    const castTick = sim.tick - 1;
    let zoneAt = -1;
    const hits: { tick: number; amount: number }[] = [];
    for (let i = 0; i < 60; i++) {
      step(sim);
      for (const e of sim.events) {
        if (e.e === 'zone') zoneAt = e.at;
        if (e.e === 'damage' && e.src === m && e.dst === d) hits.push({ tick: sim.tick - 1, amount: e.amount });
      }
    }
    expect(zoneAt).toBe(castTick + 8 + 30);
    expect(hits).toEqual([{ tick: zoneAt, amount: 200 + 1.25 * sim.c.Stats.ad[m]! }]);
    expect(strongestSlow(sim, d)).toBe(40);
  });
});

describe('summoners', () => {
  it('Flash blinks 400 (or to the cursor if closer) and goes on cooldown', () => {
    const { sim, m } = setup();
    cmd(sim, { t: 'spell', slot: 0, x: CX + 1000, y: CY });
    expect(sim.c.Pos.x[m]).toBe(CX + 400);
    expect(sim.c.Pos.y[m]).toBe(CY);
    cmd(sim, { t: 'spell', slot: 0, x: CX, y: CY });
    expect(sim.c.Pos.x[m]).toBe(CX + 400);
    expect(abilityHud(sim, m)[4]!.cdLeft).toBeGreaterThan(299);
  });
  it('Flash cooldown override for trainers', () => {
    const sim = makeSim({}, { sprung: 5 });
    const m = mira(sim);
    place(sim, m, CX, CY);
    cmd(sim, { t: 'spell', slot: 0, x: CX + 100, y: CY });
    expect(sim.c.Pos.x[m]).toBe(CX + 100);
    steps(sim, 149);
    cmd(sim, { t: 'spell', slot: 0, x: CX + 200, y: CY });
    expect(sim.c.Pos.x[m]).toBe(CX + 200);
  });
  it('Flash into a wall lands at the farthest walkable point on the line; over a thin wall it passes', () => {
    const sim = makeSim({}, { sprung: 0 });
    const m = mira(sim);
    const nav = sim.map.nav;
    let into: [number, number] | null = null;
    let over: [number, number] | null = null;
    for (let x = 1000; x < 15000 && (!into || !over); x += 50) {
      for (let y = 1000; y < 15000 && (!into || !over); y += 50) {
        if (!walkable(nav, x, y)) continue;
        if (!into && !walkable(nav, x + 400, y) && walkable(nav, x + 100, y)) into = [x, y];
        if (!over && walkable(nav, x + 400, y) && !lineWalkable(nav, x, y, x + 400, y)) over = [x, y];
      }
    }
    expect(into && over).toBeTruthy();
    place(sim, m, into![0], into![1]);
    cmd(sim, { t: 'spell', slot: 0, x: into![0] + 1000, y: into![1] });
    const lx = sim.c.Pos.x[m]!;
    expect(sim.c.Pos.y[m]).toBe(into![1]);
    expect(lx).toBeGreaterThan(into![0] + 90);
    expect(lx).toBeLessThan(into![0] + 400);
    expect(walkable(nav, lx, into![1])).toBe(true);
    expect(walkable(nav, lx + 10, into![1])).toBe(false);
    place(sim, m, over![0], over![1]);
    cmd(sim, { t: 'spell', slot: 0, x: over![0] + 1000, y: over![1] });
    expect(sim.c.Pos.x[m]).toBe(over![0] + 400);
  });
  it('Ignite deals 60 true damage over 5 s at level 1', () => {
    const sim = makeSim({ players: [{ slot: 0, team: 0, champion: 'mira', role: 'adc', summoners: ['entflammen', 'geist'], isHuman: true }] });
    const m = mira(sim);
    place(sim, m, CX, CY);
    const d = spawnDummy(sim, CX + 300, CY, 1);
    step(sim);
    const hits = collect(sim, 200, m, { t: 'spell', slot: 0, x: CX + 300, y: CY, target: d });
    expect(hits).toHaveLength(5);
    expect(hits.reduce((s, h) => s + h.amount, 0)).toBeCloseTo(60, 9);
  });
});

describe('engine details', () => {
  it('Q is extended 0.5 s per auto, capped at 8 s total', () => {
    const { sim, m } = setup();
    levelAbility(sim, m, 0);
    const d = spawnDummy(sim, CX + 400, CY, 1);
    step(sim);
    cmd(sim, { t: 'cast', slot: 0, x: CX, y: CY });
    cmd(sim, { t: 'attack', target: d });
    steps(sim, 30 * 6);
    expect(sim.c.Stats.as[m]).toBeCloseTo(0.658 * 1.4, 9); // past 5 s thanks to autos
    steps(sim, 30 * 2 + 2);
    expect(sim.c.Stats.as[m]).toBeCloseTo(0.658, 9); // never beyond 8 s
  });
  it('stun during the wind-up interrupts the cast and refunds mana and cooldown', async () => {
    const { addBuff } = await import('../src/sim/buffs');
    const { sim, m } = setup();
    levelAbility(sim, m, 1);
    const mana = sim.c.Mana.cur[m]!;
    cmd(sim, { t: 'cast', slot: 1, x: CX + 1000, y: CY });
    addBuff(sim, m, { kind: 'stun', id: 'test', ticks: 30 });
    step(sim);
    expect(abilityHud(sim, m)[1]!.cdLeft).toBe(0);
    expect(sim.c.Mana.cur[m]).toBeGreaterThan(mana - 1);
    let projectiles = 0;
    for (let i = 0; i < 30; i++) {
      step(sim);
      projectiles += query(sim.world, [sim.c.Proj]).length;
    }
    expect(projectiles).toBe(0);
  });
  it('Heal restores 90 HP at level 1 and grants 30 % MS for 1 s', () => {
    const { sim, m } = setup();
    sim.c.Hp.cur[m] = 300;
    cmd(sim, { t: 'spell', slot: 1, x: CX, y: CY });
    expect(sim.c.Hp.cur[m]).toBeGreaterThanOrEqual(390);
    step(sim);
    expect(sim.c.Stats.ms[m]).toBeCloseTo(softCapMs(340 * 1.3), 9);
  });
});
