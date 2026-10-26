// combat-helpers first: it imports sim.ts before any system module (systems <-> sim import cycle).
import { cmd, makeSim, mira, place, steps } from './combat-helpers';
import { describe, expect, it } from 'vitest';
import { query } from 'bitecs';
import { Kind, sec } from '../src/sim/types';
import type { Sim } from '../src/sim/sim';
import { CAMPS, CLOSED, KESSELBRUT_MAX_STACKS, MONSTER_AD_PER_LEVEL, MONSTER_HP_PER_LEVEL, averageLevel, jungleState, kesselbrutStacks, nebelGold, type Camp } from '../src/sim/systems/jungle';
import { SPRUNG_DIST, leapLanding, plantState, type Plant } from '../src/sim/systems/plants';
import { inventory } from '../src/sim/items/inventory';
import { buildSnapshot } from '../src/sim/snapshot';
import { MAP_SIZE, lineWalkable, walkable } from '../src/sim/map';
import { cosDeg, sinRad } from '../src/sim/vec';
import { dealDamage, kill } from '../src/sim/damage';
import { hasBuff } from '../src/sim/buffs';
import { CUM_XP } from '../src/sim/systems/economy';
import { sees } from '../src/sim/vision';
import { castSummonerSpell } from '../src/sim/summoners';

const monsters = (sim: Sim): number[] => [...query(sim.world, [sim.c.Unit])].filter((e) => sim.c.Unit.kind[e] === Kind.Monster && sim.c.Unit.alive[e]);
const camp = (sim: Sim, id: string, side = 0): Camp => jungleState(sim).camps.find((c) => c.id === id && (side === 2 || c.side === side))!;
const living = (sim: Sim, c: Camp): number[] => c.members.filter((m) => sim.c.Unit.alive[m.eid] && sim.c.Unit.serial[m.eid] === m.serial).map((m) => m.eid);

/** Sim stepped until the side camps are up (1:30). */
function atSpawn(): Sim {
  const sim = makeSim();
  steps(sim, sec(90) + 1);
  return sim;
}

describe('jungle camps', () => {
  it('spawn at 1:30 (side camps) and 3:15 (Nebelschleicher)', () => {
    const sim = makeSim();
    steps(sim, sec(90));
    expect(monsters(sim)).toHaveLength(0);
    steps(sim, 1);
    const perSide = (['dornenbock', 'glutwaechter', 'sumpfunke', 'moosrudel', 'hohlkaefer', 'schattenkrabbe'] as const).reduce((n, id) => n + CAMPS[id].monsters.length, 0);
    expect(monsters(sim)).toHaveLength(2 * perSide);
    expect(living(sim, camp(sim, 'nebelschleicher', 2))).toHaveLength(0);
    steps(sim, sec(195) - sim.tick + 1);
    expect(jungleState(sim).camps.filter((c) => c.id === 'nebelschleicher').every((c) => living(sim, c).length === 1)).toBe(true);
    for (const e of monsters(sim)) expect(sim.c.Unit.team[e]).toBe(2);
  });

  it('monsters attack whoever hit them, then leash back home at full HP', () => {
    const sim = atSpawn();
    const me = mira(sim);
    const c = camp(sim, 'dornenbock');
    const mon = living(sim, c)[0]!;
    place(sim, me, c.x + 400, c.y);
    dealDamage(sim, me, mon, 300, 'true');
    steps(sim, 2);
    expect(c.target).toBe(me);
    expect(sim.c.Atk.target[mon]).toBe(me);
    steps(sim, sec(3));
    expect(sim.c.Hp.cur[me]).toBeLessThan(sim.c.Hp.max[me]!); // got hit back
    // walk away beyond the leash: camp resets and heals
    place(sim, me, c.x + 2500, c.y);
    steps(sim, 2);
    expect(c.resetting).toBe(true);
    expect(sim.c.Atk.target[mon]).toBe(-1);
    steps(sim, sec(8));
    expect(c.resetting).toBe(false);
    expect(sim.c.Hp.cur[mon]).toBe(sim.c.Hp.max[mon]);
  });

  it('rewards gold, XP and CS to the killer and applies the buff', () => {
    const sim = atSpawn();
    const me = mira(sim);
    const { Champ, Stats } = sim.c;
    const c = camp(sim, 'dornenbock');
    const gold = Champ.gold[me]!;
    const xp = Champ.xp[me]!;
    kill(sim, living(sim, c)[0]!, me);
    expect(Champ.gold[me]! - gold).toBe(CAMPS.dornenbock.monsters[0]!.gold);
    expect(Champ.xp[me]! - xp).toBeCloseTo(CAMPS.dornenbock.monsters[0]!.xp);
    expect(Champ.cs[me]).toBe(1);
    expect(hasBuff(sim, me, 'mark', 'dornenbock')).toBe(true);
    steps(sim, 1);
    expect(Stats.haste[me]).toBe(18);
    expect(c.spawnAt).toBe(sim.tick - 1 + sec(300));
  });

  it('Glutwächter buff burns the attack target', () => {
    const sim = atSpawn();
    const me = mira(sim);
    const c = camp(sim, 'glutwaechter');
    kill(sim, living(sim, c)[0]!, me);
    const moos = camp(sim, 'moosrudel');
    const target = living(sim, moos)[0]!;
    place(sim, me, sim.c.Pos.x[target]! + 300, sim.c.Pos.y[target]!);
    steps(sim, 1);
    cmd(sim, { t: 'attack', target });
    let burned = false;
    for (let i = 0; i < sec(4) && !burned; i++) {
      steps(sim, 1);
      burned = hasBuff(sim, target, 'dot', 'glutwaechter');
    }
    expect(burned).toBe(true);
  });

  it('small camp respawns 2:15 after the last monster dies', () => {
    const sim = atSpawn();
    const me = mira(sim);
    const c = camp(sim, 'moosrudel');
    const ms = living(sim, c);
    for (const m of ms) kill(sim, m, me);
    expect(sim.c.Champ.cs[me]).toBe(ms.length);
    expect(c.spawnAt).toBe(sim.tick + sec(135));
    steps(sim, sec(135) + 1);
    expect(living(sim, c)).toHaveLength(ms.length);
  });

  it('buff + two small camps reach level 3', () => {
    const xp = (id: keyof typeof CAMPS): number => CAMPS[id].monsters.reduce((s, m) => s + m.xp, 0);
    expect(xp('dornenbock') + xp('moosrudel') + xp('hohlkaefer')).toBeGreaterThanOrEqual(CUM_XP[3]!);
    // LoL-like camp gold (wolves 95, raptors 85, krugs 125, gromp 80, buffs 90)
    expect(CAMPS.moosrudel.monsters.reduce((s, m) => s + m.gold, 0)).toBe(95);
    expect(CAMPS.hohlkaefer.monsters.reduce((s, m) => s + m.gold, 0)).toBe(85);
    expect(CAMPS.schattenkrabbe.monsters.reduce((s, m) => s + m.gold, 0)).toBe(125);
    expect(CAMPS.sumpfunke.monsters[0]!.gold).toBe(80);
    expect(CAMPS.dornenbock.monsters[0]!.hp).toBe(2300);
    expect(nebelGold(sec(195))).toBe(70);
    expect(nebelGold(sec(1500))).toBe(120);
  });

  it('Nebelschleicher grants river vision to the killer team', () => {
    const sim = makeSim();
    steps(sim, sec(195) + 1);
    const me = mira(sim);
    const c = camp(sim, 'nebelschleicher', 2);
    const neb = living(sim, c)[0]!;
    const x = sim.c.Pos.x[neb]!;
    const y = sim.c.Pos.y[neb]!;
    kill(sim, neb, me);
    steps(sim, 2);
    const ward = [...query(sim.world, [sim.c.Unit])].find((e) => sim.c.Unit.kind[e] === Kind.Ward && sim.c.Unit.alive[e]);
    expect(ward).toBeDefined();
    expect(sim.c.Unit.team[ward!]).toBe(0);
    expect(Math.abs(sim.c.Pos.x[ward!]! - x) + Math.abs(sim.c.Pos.y[ward!]! - y)).toBeLessThan(1);
    // the moosrudel of red side is far away; check a point near the ward is seen via a monster spawned there later
    expect(sees(sim, 0, ward!)).toBe(true);
    steps(sim, sec(75) + 2);
    expect(sim.c.Unit.alive[ward!]).toBe(0);
  });

  it('Bannen (smite) deals true damage to monsters', () => {
    const sim = atSpawn();
    const me = mira(sim);
    const c = camp(sim, 'hohlkaefer');
    const mon = living(sim, c)[0]!;
    place(sim, me, sim.c.Pos.x[mon]! + 300, sim.c.Pos.y[mon]!);
    steps(sim, 1); // vision update: no smiting into the fog
    const hp = sim.c.Hp.cur[mon]!;
    expect(castSummonerSpell(sim, me, 'bannen', sim.c.Pos.x[mon]!, sim.c.Pos.y[mon]!)).toBe(true);
    expect(hp - sim.c.Hp.cur[mon]!).toBeCloseTo(450);
  });
});

describe('jungle fog', () => {
  it('enemy camp kills out of vision do not reach the snapshot', async () => {
    const { buildSnapshot } = await import('../src/sim/snapshot');
    const sim = atSpawn();
    const c = camp(sim, 'hohlkaefer', 1);
    const m = living(sim, c)[0]!;
    kill(sim, m, -1);
    expect(sim.events.some((e) => e.e === 'death' && e.eid === m)).toBe(true);
    expect(buildSnapshot(sim, 0, 0).events.some((e) => e.e === 'death')).toBe(false);
    expect(buildSnapshot(sim, 1, 5).events.some((e) => e.e === 'death')).toBe(false);
  });
});

describe('jungle clear timing', () => {
  it('a level-1 champion with Jägerzahn clearing buff, Sumpfunke and Moosrudel with autos reaches level 3 in time', () => {
    const sim = atSpawn();
    const me = mira(sim);
    inventory(sim, me)[0] = 'jaegerzahn';
    const route = ['dornenbock', 'sumpfunke', 'moosrudel'];
    const first = camp(sim, route[0]!);
    place(sim, me, first.x + 300, first.y); // walked there before 1:30
    let level3 = -1;
    for (const id of route) {
      const c = camp(sim, id);
      for (let guard = 0; guard < sec(120) && living(sim, c).length; guard++) {
        const target = living(sim, c).sort((a, b) => sim.c.Hp.cur[a]! - sim.c.Hp.cur[b]!)[0]!;
        const far = (sim.c.Pos.x[me]! - c.x) ** 2 + (sim.c.Pos.y[me]! - c.y) ** 2 > 700 ** 2;
        if (far && sim.c.Move.mode[me] === 0) cmd(sim, { t: 'move', x: c.x, y: c.y });
        else if (!far && sim.c.Atk.target[me] !== target) cmd(sim, { t: 'attack', target });
        else steps(sim, 1);
        if (level3 < 0 && sim.c.Champ.level[me]! >= 3) level3 = sim.tick;
      }
      expect(sim.c.Unit.alive[me]).toBe(1);
    }
    console.log(`jungle: level 3 at ${(level3 / 30).toFixed(1)} s, HP ${Math.round(sim.c.Hp.cur[me]!)}/${Math.round(sim.c.Hp.max[me]!)}`);
    expect(level3).toBeGreaterThan(0);
    expect(level3).toBeLessThan(sec(185)); // measured 2:47 (LoL ~2:45 for buff + 2 camps)
  });
});

describe('monster scaling and objectives', () => {
  it('camps scale with the average champion level, the Schleierwächter has 12000 HP at 20:00', () => {
    const sim = makeSim();
    const me = mira(sim);
    const c = camp(sim, 'moosrudel');
    c.spawnAt = sim.tick + 1;
    steps(sim, 2);
    const lead = living(sim, c)[0]!;
    expect(sim.c.Hp.max[lead]).toBeCloseTo(1600);
    for (const m of living(sim, c)) kill(sim, m, -1);
    sim.c.Champ.level[me] = 9; // only champion: average level 9
    c.spawnAt = sim.tick + 1;
    steps(sim, 2);
    expect(averageLevel(sim)).toBe(9);
    const l2 = living(sim, c)[0]!;
    expect(sim.c.Hp.max[l2]).toBeCloseTo(1600 * (1 + 8 * MONSTER_HP_PER_LEVEL));
    expect(sim.c.Stats.ad[l2]).toBeCloseTo(CAMPS.moosrudel.monsters[0]!.ad * (1 + 8 * MONSTER_AD_PER_LEVEL));
    const baron = camp(sim, 'schleierwaechter', 2);
    sim.tick = sec(1200);
    baron.spawnAt = sim.tick;
    steps(sim, 1);
    expect(sim.c.Hp.max[living(sim, baron)[0]!]).toBeCloseTo(12000);
  });

  it('Kesselbrut: 3 grubs at 6:00, team stacks boost structure damage, closed after 13:45 and gone at 19:45', () => {
    const sim = makeSim();
    const me = mira(sim);
    const k = camp(sim, 'kesselbrut', 2);
    expect(k.spawnAt).toBe(sec(360));
    steps(sim, sec(360) + 1);
    const grubs = living(sim, k);
    expect(grubs).toHaveLength(3);
    for (const g of grubs) expect(sim.c.Unit.radius[g]).toBeLessThan(130); // not announced as an epic objective
    for (const g of grubs) kill(sim, g, me);
    expect(kesselbrutStacks(sim, 0)).toBe(3);
    expect(kesselbrutStacks(sim, 1)).toBe(0);
    // HUD indicator: own team's stacks only
    expect(buildSnapshot(sim, 0, 0).kesselbrut).toBe(3);
    expect(buildSnapshot(sim, 1, -1).kesselbrut).toBeUndefined();
    expect(k.spawnAt).toBe(sim.tick + sec(240));
    // structure damage: +4 % per stack
    const tower = [...query(sim.world, [sim.c.Unit])].find((e) => sim.c.Unit.kind[e] === Kind.Tower && sim.c.Unit.team[e] === 1)!;
    const hp = sim.c.Hp.cur[tower]!;
    dealDamage(sim, me, tower, 100, 'true');
    expect(hp - sim.c.Hp.cur[tower]!).toBeCloseTo(100 * (1 + 0.04 * 3));
    // second wave 4:00 later, then no third wave (it would start after 13:45)
    steps(sim, k.spawnAt - sim.tick + 1);
    expect(living(sim, k)).toHaveLength(3);
    sim.tick = sec(800);
    for (const g of living(sim, k)) kill(sim, g, me);
    expect(kesselbrutStacks(sim, 0)).toBe(KESSELBRUT_MAX_STACKS);
    expect(k.spawnAt).toBe(CLOSED);
    // a wave still alive at 19:45 leaves the pit
    k.spawnAt = sim.tick + 1;
    steps(sim, 2);
    expect(living(sim, k)).toHaveLength(3);
    sim.tick = sec(1185);
    steps(sim, 1);
    expect(living(sim, k)).toHaveLength(0);
    expect(k.spawnAt).toBe(CLOSED);
  });
});

describe('jungle plants', () => {
  const plants = (sim: Sim, type: string, side = 0): Plant[] =>
    plantState(sim).plants.filter((p) => p.type === type && (side === 0 ? p.x + p.y < MAP_SIZE : p.x + p.y > MAP_SIZE));
  const popWith = (sim: Sim, me: number, p: Plant, fromX: number, fromY: number): void => {
    place(sim, me, fromX, fromY);
    steps(sim, 1);
    cmd(sim, { t: 'attack', target: p.eid });
    for (let i = 0; i < sec(3) && p.spawnAt < 0; i++) steps(sim, 1);
  };

  it('grow at 1:30 as 1-HP neutral units only champions can pop; regrow after 5:00', () => {
    const sim = atSpawn();
    const all = plantState(sim).plants;
    expect(all.length).toBe(24);
    for (const p of all) {
      expect(p.spawnAt).toBe(-1);
      expect(sim.c.Unit.kind[p.eid]).toBe(Kind.Plant);
      expect(sim.c.Hp.max[p.eid]).toBe(1);
      expect(walkable(sim.map.nav, p.x, p.y)).toBe(true);
    }
    const me = mira(sim);
    const p = plants(sim, 'honigfrucht')[0]!;
    // abilities / true damage do nothing
    expect(dealDamage(sim, me, p.eid, 500, 'true')).toBe(0);
    popWith(sim, me, p, p.x + 400, p.y);
    expect(p.spawnAt).toBeGreaterThan(sim.tick);
    expect(p.spawnAt - sim.tick).toBeLessThanOrEqual(sec(300));
  });

  it('Sprungfrucht launches nearby champions away from the plant, over walls', () => {
    const sim = atSpawn();
    const me = mira(sim);
    const p = plants(sim, 'sprungfrucht')[0]!;
    // the first blue Sprungfrucht sits next to a rock: from some side the leap clears it (wall between start and landing)
    let pick: { sx: number; sy: number; land: { x: number; y: number } } | null = null;
    for (let i = 0; i < 16 && !pick; i++) {
      const dx = cosDeg(i * 22.5);
      const dy = sinRad((i * 22.5 * Math.PI) / 180);
      const sx = p.x + dx * 250;
      const sy = p.y + dy * 250;
      if (!walkable(sim.map.nav, sx, sy)) continue;
      const land = leapLanding(sim, sx, sy, dx, dy, SPRUNG_DIST);
      if (!lineWalkable(sim.map.nav, sx, sy, land.x, land.y) && Math.hypot(land.x - sx, land.y - sy) >= SPRUNG_DIST - 1) pick = { sx, sy, land };
    }
    expect(pick).not.toBeNull();
    const { sx, sy, land } = pick!;
    popWith(sim, me, p, sx, sy);
    steps(sim, sec(1));
    expect(Math.hypot(sim.c.Pos.x[me]! - land.x, sim.c.Pos.y[me]! - land.y)).toBeLessThan(30);
    expect(walkable(sim.map.nav, sim.c.Pos.x[me]!, sim.c.Pos.y[me]!)).toBe(true);
    expect(Math.hypot(land.x - sx, land.y - sy)).toBeGreaterThanOrEqual(SPRUNG_DIST - 1);
  });

  it('leapLanding passes a wall to the first walkable spot behind it', () => {
    const sim = makeSim();
    const nav = sim.map.nav;
    let spot: [number, number] | null = null;
    for (let y = 2000; y < MAP_SIZE - 2000 && !spot; y += 100) {
      for (let x = 2000; x < MAP_SIZE - 2000 && !spot; x += 100) {
        if (walkable(nav, x, y) && !walkable(nav, x + 400, y) && walkable(nav, x + 650, y) && walkable(nav, x + 100, y)) spot = [x, y];
      }
    }
    expect(spot).not.toBeNull();
    const land = leapLanding(sim, spot![0], spot![1], 1, 0, SPRUNG_DIST);
    expect(land.x).toBeGreaterThanOrEqual(spot![0] + SPRUNG_DIST);
    expect(walkable(nav, land.x, land.y)).toBe(true);
  });

  it('Honigfrucht drops pieces; walking over one heals, slows and removes it', () => {
    const sim = atSpawn();
    const me = mira(sim);
    const p = plants(sim, 'honigfrucht')[0]!;
    sim.c.Hp.cur[me] = 200;
    popWith(sim, me, p, p.x + 250, p.y);
    const pieces = plantState(sim).pieces;
    expect(pieces.length).toBe(5);
    const piece = pieces[0]!;
    place(sim, me, sim.c.Pos.x[piece.eid]!, sim.c.Pos.y[piece.eid]!);
    steps(sim, sec(1));
    expect(sim.c.Hp.cur[me]).toBeGreaterThan(200 + 10);
    expect(hasBuff(sim, me, 'slow', 'honigstueck')).toBe(true);
    expect(plantState(sim).pieces.length).toBe(4);
    steps(sim, sec(31));
    expect(plantState(sim).pieces.length).toBe(0);
  });

  it('Mana-, Wind- and Schildfrucht give mana, speed and a shield', () => {
    for (const type of ['manafrucht', 'windfrucht', 'schildfrucht']) {
      const sim = atSpawn();
      const me = mira(sim);
      const p = plants(sim, type)[0]!;
      sim.c.Mana.cur[me] = 0;
      popWith(sim, me, p, p.x + 250, p.y);
      if (type === 'manafrucht') expect(sim.c.Mana.cur[me]).toBeGreaterThan(50);
      if (type === 'windfrucht') expect(hasBuff(sim, me, 'stat', 'windfrucht')).toBe(true);
      if (type === 'schildfrucht') expect(hasBuff(sim, me, 'shield', 'schildfrucht')).toBe(true);
    }
  });

  it('Spähfrucht reveals a cone away from the attacker for the popping team', () => {
    const sim = atSpawn();
    const me = mira(sim);
    const p = plants(sim, 'spaehfrucht')[0]!;
    popWith(sim, me, p, p.x - 400, p.y);
    steps(sim, 2);
    const ahead = { x: p.x + 1300, y: p.y };
    const wards = [...query(sim.world, [sim.c.Unit])].filter((e) => sim.c.Unit.kind[e] === Kind.Ward && sim.c.Unit.alive[e] && sim.c.Unit.team[e] === 0);
    expect(wards.length).toBe(3);
    expect(wards.some((w) => Math.hypot(sim.c.Pos.x[w]! - ahead.x, sim.c.Pos.y[w]! - ahead.y) < 200)).toBe(true);
    steps(sim, sec(10) + 2);
    expect(wards.every((w) => !sim.c.Unit.alive[w])).toBe(true);
  });
});
