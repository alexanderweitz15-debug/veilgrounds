// Dorrak Sandschlund kit: burrow (untargetable, fast, disarmed, regen, dust trail), Q shred, E eruption knock-up (+ from
// underground), R maw, recast, items, bot burrow rule.
import '../src/sim/sim';
import { describe, expect, it } from 'vitest';
import { step, type Sim } from '../src/sim/sim';
import { hasBuff } from '../src/sim/buffs';
import { spawnDummy } from '../src/sim/systems/champions';
import { levelAbility } from '../src/sim/systems/abilities';
import { championData, missingHooks } from '../src/sim/champions';
import { dorrakBurrowed } from '../src/sim/champions/dorrak';
import { buildSnapshot } from '../src/sim/snapshot';
import { type Command, type PlayerSetup } from '../src/sim/types';
import { itemById } from '../src/sim/items/inventory';
import { goldEfficiency } from '../src/ui/goldEfficiency';
import { burrowStep } from '../src/ai/bot/burrow';
import { CX, CY, collect, makeSim, place, steps } from './combat-helpers';
import { abilityHit, duel } from './itemHelpers';

const player: PlayerSetup = { slot: 0, team: 0, champion: 'dorrak', role: 'jungle', summoners: ['sprung', 'heilen'], isHuman: true };

function setup(ranks: [number, number, number, number] = [1, 1, 1, 0]): { sim: Sim; m: number } {
  const sim = makeSim({ players: [player, { slot: 5, team: 1, champion: 'mira', role: 'mid', summoners: ['sprung', 'heilen'], isHuman: false }] });
  const m = sim.slots[0]!;
  place(sim, m, CX, CY);
  sim.c.Champ.level[m] = Math.max(ranks[3] > 0 ? 6 : 1, ...ranks.slice(0, 3).map((r) => 2 * r - 1));
  sim.c.Champ.skillPoints[m] = 30;
  ranks.forEach((r, slot) => {
    for (let i = 0; i < r; i++) levelAbility(sim, m, slot);
  });
  step(sim);
  return { sim, m };
}
const cast = (slot: 0 | 1 | 2 | 3, x: number, y: number): Command => ({ t: 'cast', slot, x, y });

describe('Dorrak data', () => {
  it('hook module exports every hook id; non-human jungle melee', () => {
    expect(missingHooks('dorrak')).toEqual([]);
    const d = championData('dorrak');
    expect(d.roles).toEqual(['jungle']);
    expect(d.attackType).toBe('melee');
  });
});

describe('Dorrak W Burrow', () => {
  it('untargetable, +35 % move speed, disarmed, regenerates, leaves a dust trail seen by the enemy team', () => {
    const { sim, m } = setup();
    const ms0 = sim.c.Stats.ms[m]!;
    sim.c.Hp.cur[m] = sim.c.Hp.max[m]! * 0.5;
    const hp0 = sim.c.Hp.cur[m]!;
    collect(sim, 12, m, cast(1, CX, CY));
    expect(dorrakBurrowed(sim, m)).toBe(true);
    expect(sim.c.Unit.untargetable[m]).toBe(1);
    expect(hasBuff(sim, m, 'disarm')).toBe(true);
    expect(sim.c.Stats.ms[m]! / ms0).toBeCloseTo(1.35, 1);
    step(sim, [{ slot: 0, cmd: { t: 'move', x: CX + 3000, y: CY } }]);
    steps(sim, 60);
    // 3 % max HP per second for ~2.4 s (regen of the base excluded: well above it)
    expect(sim.c.Hp.cur[m]! - hp0).toBeGreaterThan(sim.c.Hp.max[m]! * 0.05);
    place(sim, sim.slots[5]!, CX + 500, CY + 300); // an enemy champion near the path sees the trail
    step(sim);
    const enemyView = buildSnapshot(sim, 1, 5).objects.filter((o) => o.tag === 'dorrak_trail');
    expect(enemyView.length).toBeGreaterThan(2);
    expect(buildSnapshot(sim, 0, 0).objects.filter((o) => o.tag === 'dorrak_trail').length).toBeGreaterThan(2);
  });

  it('cannot attack while burrowed, can again after the burrow ends (timer)', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 120, CY, 1);
    step(sim);
    collect(sim, 12, m, cast(1, CX, CY));
    const during = collect(sim, 30, m, { t: 'attack', target: d });
    expect(during.length).toBe(0);
    steps(sim, 4 * 30);
    expect(dorrakBurrowed(sim, m)).toBe(false);
    expect(sim.c.Unit.untargetable[m]).toBe(0);
    const after = collect(sim, 60, m, { t: 'attack', target: d });
    expect(after.length).toBeGreaterThan(0);
  });

  it('a recast surfaces at once', () => {
    const { sim, m } = setup();
    collect(sim, 14, m, cast(1, CX, CY));
    expect(dorrakBurrowed(sim, m)).toBe(true);
    steps(sim, 12);
    collect(sim, 12, m, cast(1, CX, CY));
    expect(dorrakBurrowed(sim, m)).toBe(false);
    expect(hasBuff(sim, m, 'disarm')).toBe(false);
  });
});

describe('Dorrak Q, E, R', () => {
  it('Q hits the cone, shreds armor 15 % for 3 s and surfaces him', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 250, CY, 1);
    const far = spawnDummy(sim, CX + 700, CY, 1);
    step(sim);
        collect(sim, 12, m, cast(1, CX, CY));
    const hits = collect(sim, 30, m, cast(0, CX + 250, CY));
    expect(hits.some((h) => h.dst === d)).toBe(true);
    expect(hits.some((h) => h.dst === far)).toBe(false);
    expect(dorrakBurrowed(sim, m)).toBe(false);
    expect(hasBuff(sim, d, 'stat', 'dorrak_q')).toBe(true);
  });

  it('E erupts after 0.45 s in 330: knock-up; from underground +30 % damage, longer knock-up, surfaces', () => {
    const a = setup();
    const b = setup();
    const da = spawnDummy(a.sim, CX + 250, CY, 1);
    const db = spawnDummy(b.sim, CX + 250, CY, 1);
    const farB = spawnDummy(b.sim, CX + 700, CY, 1);
    step(a.sim);
    step(b.sim);
    collect(b.sim, 12, b.m, cast(1, CX, CY));
    expect(dorrakBurrowed(b.sim, b.m)).toBe(true);
    const ha = collect(a.sim, 30, a.m, cast(2, CX, CY)).find((h) => h.dst === da)!;
    const hb = collect(b.sim, 30, b.m, cast(2, CX, CY));
    expect(hasBuff(a.sim, da, 'airborne')).toBe(true);
    expect(hb.find((h) => h.dst === db)!.amount / ha.amount).toBeCloseTo(1.3, 1);
    expect(hb.some((h) => h.dst === farB)).toBe(false);
    expect(dorrakBurrowed(b.sim, b.m)).toBe(false);
    // the underground eruption lifts for 1.0 s, the plain one for 0.75 s
    steps(a.sim, 17);
    steps(b.sim, 17);
    expect(hasBuff(a.sim, da, 'airborne')).toBe(false);
    expect(hasBuff(b.sim, db, 'airborne')).toBe(true);
  });

  it('R: circle at range, damage and a 1.25 s knock-up', () => {
    const { sim, m } = setup([1, 1, 1, 1]);
    const d = spawnDummy(sim, CX + 700, CY, 1);
    step(sim);
    const hits = collect(sim, 50, m, cast(3, CX + 700, CY));
    expect(hits.some((h) => h.dst === d)).toBe(true);
    expect(hasBuff(sim, d, 'airborne')).toBe(true);
  });
});

describe('Dorrak items', () => {
  it('Sand Carapace is priced sanely and Duststeel grants armor + MR after an ability hit on a champion (8 s icd)', () => {
    expect(itemById('wuehlerzahn')!.tier).toBe('component');
    const ge = goldEfficiency(itemById('sandpanzer')!)!;
    expect(ge.pct).toBeGreaterThan(80);
    expect(ge.pct).toBeLessThan(120);
    const { sim, me, foe } = duel({ champ: 'dorrak', items: ['sandpanzer'] });
    sim.c.Champ.skillPoints[me] = 3;
    levelAbility(sim, me, 0);
    const armor0 = sim.c.Stats.armor[me]!;
    const mr0 = sim.c.Stats.mr[me]!;
    abilityHit(sim, me, foe);
    steps(sim, 2);
    expect(sim.c.Stats.armor[me]! - armor0).toBeCloseTo(25, 0);
    expect(sim.c.Stats.mr[me]! - mr0).toBeCloseTo(25, 0);
    steps(sim, 90);
    expect(sim.c.Stats.armor[me]! - armor0).toBeCloseTo(0, 0);
  });
});

describe('Dorrak bot burrow rule', () => {
  const ctx = { champ: championData('dorrak') } as never;
  const mk = (o: { dist: number; enemyAt?: number; tick?: number }): never => {
    const self = { x: 0, y: 0, moving: true, hp: 900, maxHp: 900, shield: 0, mana: 300 };
    return {
      tick: 100,
      self,
      me: { dead: false, abilities: [null, { rank: 1, cdLeft: 0, cost: 40 }, null, null] },
      enemies: o.enemyAt ? [{ x: o.enemyAt, y: 0 }] : [],
      __goal: o.dist,
    } as never;
  };
  const mem = (dist: number): never => ({ lastMove: { x: dist, y: 0, tick: 90 } }) as never;

  it('burrows on a long trip with no enemy near, not on a short trip or with an enemy close', () => {
    expect(burrowStep(mk({ dist: 3000 }), ctx, mem(3000))).toMatchObject({ cmd: { t: 'cast', slot: 1 } });
    expect(burrowStep(mk({ dist: 900 }), ctx, mem(900))).toBeNull();
    expect(burrowStep(mk({ dist: 3000, enemyAt: 800 }), ctx, mem(3000))).toBeNull();
  });
});
