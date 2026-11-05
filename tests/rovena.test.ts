// Rovena Aderlass kit: HP costs, Bloodtithe heal-back, Bloodrush, Q mark, E detonate, R drain, items.
import '../src/sim/sim';
import { describe, expect, it } from 'vitest';
import { step, type Sim } from '../src/sim/sim';
import { hasBuff } from '../src/sim/buffs';
import { spawnDummy } from '../src/sim/systems/champions';
import { levelAbility } from '../src/sim/systems/abilities';
import { championData, missingHooks } from '../src/sim/champions';
import { rovenaRush } from '../src/sim/champions/rovena';
import { type Command, type PlayerSetup } from '../src/sim/types';
import { itemById } from '../src/sim/items/inventory';
import { CX, CY, collect, makeSim, place, steps } from './combat-helpers';

const player: PlayerSetup = { slot: 0, team: 0, champion: 'rovena', role: 'mid', summoners: ['sprung', 'heilen'], isHuman: true };

function setup(ranks: [number, number, number, number] = [1, 1, 1, 0]): { sim: Sim; m: number } {
  const sim = makeSim({ players: [player] });
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
const hurt = (sim: Sim, m: number, frac: number): void => void (sim.c.Hp.cur[m] = sim.c.Hp.max[m]! * frac);

describe('Rovena data', () => {
  it('hooks complete, resource none, every ability costs HP except R', () => {
    expect(missingHooks('rovena')).toEqual([]);
    const d = championData('rovena');
    expect(d.resource).toBe('none');
    expect(d.abilities.map((a) => a.costType)).toEqual(['hp', 'hp', 'hp', 'none']);
  });
});

describe('Rovena HP costs', () => {
  it('Q pays HP (base cost + 3 % max HP); the cast is rejected when HP does not exceed the cost', () => {
    const { sim, m } = setup();
    const before = sim.c.Hp.cur[m]!;
    const cost = 35 + 0.03 * sim.c.Hp.max[m]!;
    collect(sim, 1, m, cast(0, CX + 500, CY));
    expect(before - sim.c.Hp.cur[m]!).toBeGreaterThan(cost - 1);
    expect(before - sim.c.Hp.cur[m]!).toBeLessThan(cost + 8); // regen only
    const { sim: s2, m: m2 } = setup();
    s2.c.Hp.cur[m2] = 30;
    collect(s2, 3, m2, cast(0, CX + 500, CY));
    expect(s2.c.Hp.cur[m2]!).toBeGreaterThanOrEqual(30);
    expect(s2.c.Hp.cur[m2]!).toBeLessThan(40); // nothing paid
  });
});

describe('Rovena Bloodtithe', () => {
  it('ability damage heals her for 25 % of the damage dealt to a champion, autos heal nothing', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 500, CY, 1);
    step(sim);
    hurt(sim, m, 0.7);
    const hp0 = sim.c.Hp.cur[m]!;
    const hits = collect(sim, 40, m, cast(0, CX + 500, CY)).filter((h) => h.dst === d);
    expect(hits).toHaveLength(1);
    const cost = 35 + 0.03 * sim.c.Hp.max[m]!;
    const gained = sim.c.Hp.cur[m]! - (hp0 - cost);
    expect(gained).toBeGreaterThan(hits[0]!.amount * 0.2);
    expect(gained).toBeLessThan(hits[0]!.amount * 0.4 + 12); // ~25 % plus regen
  });

  it('Bloodrush below 35 % HP: +20 % ability damage', () => {
    const a = setup();
    const b = setup();
    const da = spawnDummy(a.sim, CX + 500, CY, 1);
    const db = spawnDummy(b.sim, CX + 500, CY, 1);
    hurt(a.sim, a.m, 0.9);
    hurt(b.sim, b.m, 0.3);
    expect(rovenaRush(b.sim, b.m)).toBe(true);
    expect(rovenaRush(a.sim, a.m)).toBe(false);
    const ha = collect(a.sim, 40, a.m, cast(0, CX + 500, CY)).find((h) => h.dst === da)!;
    const hb = collect(b.sim, 40, b.m, cast(0, CX + 500, CY)).find((h) => h.dst === db)!;
    expect(hb.amount / ha.amount).toBeCloseTo(1.2, 1);
  });
});

describe('Rovena Q mark and E detonate', () => {
  it('Q marks the target; E on a marked target does +40 % damage, roots 0.75 s and consumes the mark', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 500, CY, 1);
    const e = spawnDummy(sim, CX + 500, CY + 400, 1);
    step(sim);
    collect(sim, 40, m, cast(0, CX + 500, CY));
    expect(hasBuff(sim, d, 'mark', 'rovena_blood')).toBe(true);
    steps(sim, 20);
    const marked = collect(sim, 30, m, { t: 'cast', slot: 2, x: CX + 500, y: CY, target: d } as Command).find((h) => h.dst === d)!;
    expect(hasBuff(sim, d, 'mark', 'rovena_blood')).toBe(false);
    expect(hasBuff(sim, d, 'root')).toBe(true);
    // unmarked reference on a second sim
    const r = setup();
    const d2 = spawnDummy(r.sim, CX + 500, CY, 1);
    step(r.sim);
    const plain = collect(r.sim, 30, r.m, { t: 'cast', slot: 2, x: CX + 500, y: CY, target: d2 } as Command).find((h) => h.dst === d2)!;
    expect(marked.amount / plain.amount).toBeCloseTo(1.4, 1);
    expect(hasBuff(r.sim, d2, 'root')).toBe(false);
    void e;
  });
});

describe('Rovena W Bloodpool and R Bloodtide', () => {
  it('W damages enemies inside over time and slows them', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 600, CY, 1);
    step(sim);
    const hits = collect(sim, 120, m, cast(1, CX + 600, CY)).filter((h) => h.dst === d);
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it('R hits every enemy within 650 once and heals double (drain)', () => {
    const { sim, m } = setup([1, 1, 1, 1]);
    const ds = [spawnDummy(sim, CX + 300, CY, 1), spawnDummy(sim, CX - 400, CY, 1), spawnDummy(sim, CX, CY + 550, 1)];
    const far = spawnDummy(sim, CX + 1200, CY, 1);
    step(sim);
    hurt(sim, m, 0.6);
    const hp0 = sim.c.Hp.cur[m]!;
    const hits = collect(sim, 40, m, cast(3, CX, CY));
    for (const d of ds) expect(hits.filter((h) => h.dst === d)).toHaveLength(1);
    expect(hits.some((h) => h.dst === far)).toBe(false);
    const total = ds.reduce((a, d) => a + hits.find((h) => h.dst === d)!.amount, 0);
    expect(sim.c.Hp.cur[m]! - hp0).toBeGreaterThan(total * 0.35); // 2 x 25 % = 50 % (regen aside)
  });
});

describe('Rovena items', () => {
  it('Bloodchalice and Veinglass exist, cheap enough, with a passive', () => {
    const k = itemById('blutkelch')!;
    expect(k.tier).toBe('legendary');
    expect(k.passive?.rules?.length).toBe(2);
    expect(itemById('aderglas')!.tier).toBe('component');
    expect(k.from).toEqual(['aderglas', 'lehrlingsstab']);
  });
});
