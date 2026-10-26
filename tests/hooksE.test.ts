// Agent E champion hooks: one behavioural test per signature mechanic + hook coverage.
import '../src/sim/sim';
import { describe, expect, it } from 'vitest';
import { query } from 'bitecs';
import { step, type Sim } from '../src/sim/sim';
import { addBuff, buffs, hasBuff, hasStat, strongestSlow } from '../src/sim/buffs';
import { spawnDummy } from '../src/sim/systems/champions';
import { cooldownLeft, levelAbility, setCooldown } from '../src/sim/systems/abilities';
import { missingHooks } from '../src/sim/champions';
import { dealDamage } from '../src/sim/damage';
import { buildSnapshot } from '../src/sim/snapshot';
import { sees } from '../src/sim/vision';
import { groundObjects, petsOf } from '../src/sim/summons';
import { walkable } from '../src/sim/map';
import { bleedStacks } from '../src/sim/champions/brom';
import { Kind, sec, type Command, type PlayerSetup } from '../src/sim/types';
import { CX, CY, cmd, collect, makeSim, place, steps } from './combat-helpers';

const E_CHAMPS = ['ilvane', 'thessaly', 'kaelen', 'brom', 'oleth', 'ferris', 'gorvam', 'vessa', 'nyx', 'harrow', 'seraphyne', 'renn'];

const player = (slot: number, champion: string, team: 0 | 1 = slot < 5 ? 0 : 1): PlayerSetup => ({ slot, team, champion, role: 'mid', summoners: ['sprung', 'heilen'], isHuman: slot === 0 });

/** Champion at (CX, CY) with skill ranks [Q, W, E, R]; extra players (slot >= 5 = enemies) at the given spots. */
function setup(champion: string, ranks: [number, number, number, number] = [1, 1, 1, 0], extra: { p: PlayerSetup; x: number; y: number }[] = []): { sim: Sim; m: number; o: number[] } {
  const sim = makeSim({ players: [player(0, champion), ...extra.map((e) => e.p)] });
  const m = sim.slots[0]!;
  place(sim, m, CX, CY);
  const o = extra.map((e) => {
    const eid = sim.slots[e.p.slot]!;
    place(sim, eid, e.x, e.y);
    return eid;
  });
  sim.c.Champ.level[m] = ranks[3] > 0 ? 6 : 9;
  sim.c.Champ.skillPoints[m] = 30;
  ranks.forEach((r, slot) => {
    for (let i = 0; i < r; i++) levelAbility(sim, m, slot);
  });
  step(sim);
  return { sim, m, o };
}

const cast = (slot: 0 | 1 | 2 | 3, x: number, y: number, target?: number): Command => ({ t: 'cast', slot, x, y, target });
const enemy = (champion: string, x: number, y: number) => ({ p: player(5, champion), x, y });

describe('Agent E hooks coverage', () => {
  it('every hook id of the 12 champions is exported', () => {
    for (const id of E_CHAMPS) expect([id, missingHooks(id)]).toEqual([id, []]);
  });
});

describe('Ilvane', () => {
  it('an auto on a thread-marked target consumes the mark: bonus magic damage and +20 % MS', () => {
    const { sim, m } = setup('ilvane');
    const d = spawnDummy(sim, CX + 400, CY, 1);
    addBuff(sim, d, { kind: 'mark', id: 'ilvane_thread', src: m, ticks: sec(4) });
    step(sim);
    const hits = collect(sim, 40, m, { t: 'attack', target: d });
    expect(hits.length).toBe(2); // auto + mark proc
    expect(hasBuff(sim, d, 'mark', 'ilvane_thread')).toBe(false);
    expect(hasBuff(sim, m, 'stat', 'ilvane_thread_ms')).toBe(true);
  });
  it('E hops away from the cursor and is immune to projectiles at the start', () => {
    const { sim, m } = setup('ilvane');
    cmd(sim, cast(2, CX + 1000, CY));
    steps(sim, 8);
    expect(hasStat(sim, m, 'projImmune')).toBe(true);
    steps(sim, 20);
    expect(sim.c.Pos.x[m]).toBeCloseTo(CX - 350, 6);
  });
});

describe('Thessaly', () => {
  it('passive makes the first ability free; R deals +50 % below 30 % HP', () => {
    const { sim, m } = setup('thessaly', [1, 1, 1, 1]);
    const d = spawnDummy(sim, CX + 400, CY, 1);
    step(sim);
    const mana = sim.c.Mana.cur[m]!;
    cmd(sim, cast(0, CX + 400, CY, d));
    steps(sim, 10);
    expect(sim.c.Mana.cur[m]).toBeGreaterThanOrEqual(mana); // free (+ regen)
    sim.c.Hp.cur[d] = 200;
    const hits = collect(sim, 20, m, cast(3, CX + 400, CY, d));
    expect(hits.map((h) => h.amount)).toEqual([300 * 1.5]);
  });
});

describe('Kaelen', () => {
  it('E hitting an enemy champion reduces the W cooldown by 2 s', () => {
    const { sim, m } = setup('kaelen', [1, 1, 1, 0], [enemy('brom', CX + 200, CY)]);
    setCooldown(sim, m, 1, sec(10));
    cmd(sim, cast(2, CX, CY));
    steps(sim, 8);
    expect(cooldownLeft(sim, m, 1)).toBe(sec(10) - sec(2) - 9);
  });
  it('W toward a marked enemy dashes onto it (up to 900)', () => {
    const { sim, m, o } = setup('kaelen', [1, 1, 1, 0], [enemy('brom', CX + 800, CY)]);
    addBuff(sim, o[0]!, { kind: 'mark', id: 'kaelen_mark', src: m, ticks: sec(3) });
    cmd(sim, cast(1, CX + 800, CY));
    steps(sim, 30);
    expect(sim.c.Pos.x[m]).toBeGreaterThan(CX + 600);
    expect(hasBuff(sim, o[0]!, 'mark', 'kaelen_mark')).toBe(false);
  });
});

describe('Brom', () => {
  it('ability hits stack bleed; an R kill on a champion resets the R cooldown', () => {
    const { sim, m, o } = setup('brom', [1, 1, 1, 1], [enemy('ilvane', CX + 250, CY)]);
    const t = o[0]!;
    cmd(sim, cast(0, CX, CY));
    steps(sim, 25);
    expect(bleedStacks(sim, m, t)).toBe(2); // outer ring: +1 extra stack
    sim.c.Hp.cur[t] = 50;
    cmd(sim, cast(3, CX + 250, CY, t));
    steps(sim, 12);
    expect(sim.c.Unit.alive[t]).toBe(0);
    expect(cooldownLeft(sim, m, 3)).toBe(0);
  });
});

describe('Oleth', () => {
  it('passive: 15 % max HP taken within 2 s grants a shield of 8 % max HP', () => {
    const { sim, m, o } = setup('oleth', [1, 1, 1, 0], [enemy('brom', CX + 300, CY)]);
    const max = sim.c.Hp.max[m]!;
    dealDamage(sim, o[0]!, m, 0.1 * max, 'true');
    expect(sim.c.Hp.shield[m]).toBe(0);
    dealDamage(sim, o[0]!, m, 0.06 * max, 'true');
    expect(sim.c.Hp.shield[m]).toBeCloseTo(0.08 * max, 6);
  });
  it('E stops at the first enemy and knocks it up; Q right after stuns', () => {
    const { sim, m } = setup('oleth');
    const d = spawnDummy(sim, CX + 300, CY, 1);
    cmd(sim, cast(2, CX + 1000, CY));
    steps(sim, 20);
    expect(sim.c.Pos.x[m]).toBeLessThan(CX + 300);
    expect(hasBuff(sim, d, 'airborne')).toBe(true);
    steps(sim, 25);
    cmd(sim, cast(0, CX + 300, CY, d));
    steps(sim, 9);
    expect(hasBuff(sim, d, 'stun')).toBe(true);
  });
});

describe('Oleth R wall', () => {
  it('stuns units on the line, pushes them off and blocks the line for 4 s', () => {
    const { sim, o } = setup('oleth', [1, 1, 1, 1], [enemy('brom', CX + 350, CY + 100)]);
    const t = o[0]!;
    cmd(sim, cast(3, CX + 1000, CY));
    steps(sim, 9 + sec(0.7) + 1);
    expect(hasBuff(sim, t, 'stun', 'oleth_r')).toBe(true);
    expect(walkable(sim.map.nav, CX + 350, CY)).toBe(false);
    expect(walkable(sim.map.nav, sim.c.Pos.x[t]!, sim.c.Pos.y[t]!)).toBe(true);
    expect(sim.c.Pos.x[t]).not.toBe(CX + 350);
    steps(sim, sec(4));
    expect(walkable(sim.map.nav, CX + 350, CY)).toBe(true);
  });
});

describe('Vessa R', () => {
  it('leaps onto the enemy champion near the cursor: damage + airborne on landing', () => {
    const { sim, m, o } = setup('vessa', [1, 1, 1, 1], [enemy('ilvane', CX + 500, CY + 50)]);
    const t = o[0]!;
    // step until the landing hit, then check airborne at that moment (hitbox 65 shortens the leap)
    const hits: ReturnType<typeof collect> = [];
    for (let i = 0; i < 30 && !hits.some((h) => h.dst === t); i++) hits.push(...collect(sim, 1, m, i === 0 ? cast(3, CX + 500, CY + 50) : undefined));
    expect(hits.some((h) => h.dst === t)).toBe(true);
    expect(hasBuff(sim, t, 'airborne')).toBe(true);
    const gap = Math.sqrt((sim.c.Pos.x[t]! - sim.c.Pos.x[m]!) ** 2 + (sim.c.Pos.y[t]! - sim.c.Pos.y[m]!) ** 2);
    expect(gap).toBeLessThan(sim.c.Unit.radius[t]! + sim.c.Unit.radius[m]! + 5);
    expect(hasBuff(sim, m, 'stat', 'vessa_r')).toBe(true);
  });
});

describe('Ferris', () => {
  it('E cleanses slows from the ally and Ferris', () => {
    const { sim, m, o } = setup('ferris', [1, 1, 1, 0], [{ p: player(1, 'brom'), x: CX + 300, y: CY }]);
    const ally = o[0]!;
    for (const e of [m, ally]) addBuff(sim, e, { kind: 'slow', id: 'test', src: -1, pct: 50, ticks: sec(5) });
    cmd(sim, cast(2, CX + 300, CY, ally));
    steps(sim, 8);
    expect(strongestSlow(sim, ally)).toBe(0);
    expect(strongestSlow(sim, m)).toBe(0);
  });
});

describe('Gorvam', () => {
  it('Q drags the first enemy hit to Gorvam', () => {
    const { sim, m, o } = setup('gorvam', [1, 1, 1, 0], [enemy('ilvane', CX + 700, CY)]);
    const t = o[0]!;
    cmd(sim, cast(0, CX + 1000, CY));
    steps(sim, 30);
    expect(hasBuff(sim, t, 'airborne')).toBe(true);
    steps(sim, 45);
    const gap = sim.c.Pos.x[t]! - sim.c.Pos.x[m]!;
    expect(gap).toBeLessThan(sim.c.Unit.radius[t]! + sim.c.Unit.radius[m]! + 5);
  });
  it('pressing Q again during the wind-up does not cancel it (spam = cast)', () => {
    const { sim } = setup('gorvam');
    cmd(sim, cast(0, CX + 1000, CY));
    cmd(sim, cast(0, CX + 1000, CY));
    let projectiles = 0;
    for (let i = 0; i < 20; i++) {
      step(sim);
      projectiles += query(sim.world, [sim.c.Proj]).length;
    }
    expect(projectiles).toBeGreaterThan(0);
  });
});

describe('Vessa', () => {
  it('W: the next auto heals 30 + 10 % missing HP; monster kills stack the trail', () => {
    const { sim, m } = setup('vessa');
    const d = spawnDummy(sim, CX + 200, CY, 1);
    sim.c.Hp.cur[m] = 200;
    cmd(sim, cast(1, CX, CY));
    steps(sim, 8);
    const before = sim.c.Hp.cur[m]!;
    const missing = sim.c.Hp.max[m]! - before;
    collect(sim, 40, m, { t: 'attack', target: d });
    expect(sim.c.Hp.cur[m]! - before).toBeGreaterThanOrEqual(30 + 0.1 * missing - 1);
    const mon = spawnDummy(sim, CX + 200, CY + 100, 1);
    sim.c.Unit.kind[mon] = Kind.Monster;
    dealDamage(sim, m, mon, 5000, 'true');
    step(sim);
    expect(buffs(sim, m).some((b) => b.id === 'vessa_trail' && b.stat === 'as' && b.pct === 1)).toBe(true);
  });
});

describe('Nyx', () => {
  it('W: invisible to the enemy snapshot; the first auto roots and breaks invisibility', () => {
    const { sim, m, o } = setup('nyx', [1, 1, 1, 0], [enemy('brom', CX + 300, CY)]);
    const t = o[0]!;
    expect(buildSnapshot(sim, 1, 5).entities.some((e) => e.id === m)).toBe(true);
    cmd(sim, cast(1, CX, CY));
    steps(sim, 8);
    expect(sees(sim, 1, m)).toBe(false);
    expect(buildSnapshot(sim, 1, 5).entities.some((e) => e.id === m)).toBe(false);
    let rooted = false;
    for (let i = 0; i < 40; i++) {
      step(sim, i === 0 ? [{ slot: 0, cmd: { t: 'attack', target: t } }] : []);
      rooted ||= hasBuff(sim, t, 'root', 'nyx_w');
    }
    expect(rooted).toBe(true);
    expect(sees(sim, 1, m)).toBe(true);
  });
  it('Q flies back and can hit each target twice', () => {
    const { sim, m } = setup('nyx');
    const d = spawnDummy(sim, CX + 400, CY, 1);
    const hits = collect(sim, 60, m, cast(0, CX + 1000, CY));
    expect(hits.filter((h) => h.dst === d)).toHaveLength(2);
  });
});

describe('Harrow', () => {
  it('R spawns 3 allied siege minions for 12 s', () => {
    const { sim, m } = setup('harrow', [1, 1, 1, 1]);
    cmd(sim, cast(3, CX, CY));
    steps(sim, 10);
    const ms = petsOf(sim, m, 'harrow_siege');
    expect(ms).toHaveLength(3);
    for (const e of ms) expect([sim.c.Unit.kind[e], sim.c.Unit.team[e]]).toEqual([Kind.MinionSiege, 0]);
    steps(sim, sec(12));
    expect(petsOf(sim, m, 'harrow_siege')).toHaveLength(0);
  });
});

describe('Seraphyne', () => {
  it('R strikes three times 0.8 s apart; the third stuns', () => {
    const { sim, m } = setup('seraphyne', [1, 1, 1, 1]);
    const d = spawnDummy(sim, CX + 600, CY, 1);
    const hits = collect(sim, 70, m, cast(3, CX + 600, CY));
    expect(hits).toHaveLength(3);
    expect(hits[1]!.tick - hits[0]!.tick).toBe(sec(0.8));
    expect(hits[2]!.tick - hits[1]!.tick).toBe(sec(0.8));
    expect(hasBuff(sim, d, 'stun', 'seraphyne_r')).toBe(true);
  });
});

describe('Renn', () => {
  it('W drops a blade under him after 1.25 s; touching it triggers the spin and sets E to 1.5 s', () => {
    const { sim, m } = setup('renn');
    const d = spawnDummy(sim, CX + 200, CY, 1);
    setCooldown(sim, m, 2, sec(10));
    const hits = collect(sim, 60, m, cast(1, CX, CY));
    expect(hits.filter((h) => h.dst === d)).toHaveLength(1);
    expect(cooldownLeft(sim, m, 2)).toBeLessThanOrEqual(sec(1.5));
    expect(cooldownLeft(sim, m, 2)).toBeGreaterThan(0);
  });
  it('Q bounces to two more enemies and leaves a blade behind the last target', () => {
    const { sim, m } = setup('renn');
    const a = spawnDummy(sim, CX + 400, CY, 1);
    const b = spawnDummy(sim, CX + 700, CY, 1);
    const c = spawnDummy(sim, CX + 1000, CY, 1);
    step(sim);
    const hits = collect(sim, 12, m, cast(0, CX + 400, CY, a));
    expect(hits.map((h) => h.dst)).toEqual([a, b, c]);
    const blades = groundObjects(sim, 'renn_blade', m);
    expect(blades).toHaveLength(1);
    expect(blades[0]!.x).toBeCloseTo(CX + 1350, 0);
  });
  it('R channel throws blades every 0.15 s until he is stunned', () => {
    const { sim, m } = setup('renn', [1, 1, 1, 1]);
    const d = spawnDummy(sim, CX + 300, CY, 1);
    const first = collect(sim, 30, m, cast(3, CX, CY));
    expect(first.length).toBeGreaterThanOrEqual(5);
    expect(hasBuff(sim, d, 'grievous')).toBe(true);
    addBuff(sim, m, { kind: 'stun', id: 'test', src: -1, ticks: 5 });
    step(sim);
    expect(collect(sim, 30, m)).toHaveLength(0);
  });
});
