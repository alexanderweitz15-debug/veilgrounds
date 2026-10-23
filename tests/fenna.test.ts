// Fenna Staubflügel kit tests: Lightbond (tether slow, snap, rebind), Q ally<->enemy bounce, W redirect, E pool, R cocoon.
import '../src/sim/sim';
import { describe, expect, it } from 'vitest';
import { step, type Sim } from '../src/sim/sim';
import { hasBuff, statMods, strongestSlow } from '../src/sim/buffs';
import { spawnDummy } from '../src/sim/systems/champions';
import { levelAbility } from '../src/sim/systems/abilities';
import { missingHooks } from '../src/sim/champions';
import { fennaPartner } from '../src/sim/champions/fenna';
import { buildSnapshot } from '../src/sim/snapshot';
import type { Command, PlayerSetup } from '../src/sim/types';
import { CX, CY, cmd, makeSim, place, steps } from './combat-helpers';

const player = (slot: number, champion: string): PlayerSetup => ({ slot, team: 0, champion, role: slot === 0 ? 'support' : 'adc', summoners: ['sprung', 'heilen'], isHuman: slot === 0 });
const cast = (slot: 0 | 1 | 2 | 3, x: number, y: number, target?: number): Command => ({ t: 'cast', slot, x, y, target });

/** Fenna at (CX, CY) with ranks [Q, W, E, R]; allies at the given x offsets (mira, brom, ...). */
function setup(ranks: [number, number, number, number], allies: number[] = []): { sim: Sim; m: number; a: number[] } {
  const sim = makeSim({ players: [player(0, 'fenna'), ...allies.map((_, i) => player(i + 1, i === 0 ? 'mira' : 'brom'))] });
  const m = sim.slots[0]!;
  place(sim, m, CX, CY);
  sim.c.Champ.level[m] = ranks[3] > 0 ? 6 : 5;
  sim.c.Champ.skillPoints[m] = 30;
  ranks.forEach((r, slot) => {
    for (let i = 0; i < r; i++) levelAbility(sim, m, slot);
  });
  const a = allies.map((dx, i) => {
    const e = sim.slots[i + 1]!;
    place(sim, e, CX + dx, CY);
    return e;
  });
  step(sim);
  return { sim, m, a };
}

describe('Fenna data', () => {
  it('every hook id is exported', () => {
    expect(missingHooks('fenna')).toEqual([]);
  });
});

describe('Lightbond', () => {
  it('binds the nearest ally, slows an enemy crossing the tether once per 4 s, snaps beyond 1600 and rebinds after 3 s', () => {
    const { sim, m, a } = setup([0, 0, 0, 0], [400]);
    step(sim);
    expect(fennaPartner(sim, m)).toBe(a[0]);
    const d = spawnDummy(sim, CX + 200, CY, 1);
    steps(sim, 2);
    expect(strongestSlow(sim, d)).toBeGreaterThanOrEqual(25);
    expect(strongestSlow(sim, d)).toBeLessThanOrEqual(40);
    place(sim, d, CX + 200, CY + 600); // away from the line: slow runs out, the 4 s cooldown blocks a second slow
    steps(sim, 40);
    expect(strongestSlow(sim, d)).toBe(0);
    place(sim, d, CX + 200, CY);
    steps(sim, 3);
    expect(strongestSlow(sim, d)).toBe(0);
    steps(sim, 90);
    expect(strongestSlow(sim, d)).toBeGreaterThan(0);
    // snap: ally beyond 1600
    place(sim, a[0]!, CX + 1450, CY);
    place(sim, m, CX - 300, CY);
    steps(sim, 2);
    expect(fennaPartner(sim, m)).toBe(-1);
    place(sim, a[0]!, CX + 500, CY);
    steps(sim, 60);
    expect(fennaPartner(sim, m)).toBe(-1); // rebind delay 3 s
    steps(sim, 50);
    expect(fennaPartner(sim, m)).toBe(a[0]);
  });
});

describe('Q Wingdust', () => {
  it('enemy first: damage + slow, the bonded ally gets a shield and move speed, Fenna a 40 % mirror', () => {
    const { sim, m, a } = setup([1, 0, 0, 0], [-300]);
    const d = spawnDummy(sim, CX + 500, CY, 1);
    step(sim);
    const hp = sim.c.Hp.cur[d]!;
    cmd(sim, cast(0, CX + 500, CY));
    steps(sim, 25);
    expect(sim.c.Hp.cur[d]!).toBeLessThan(hp);
    expect(strongestSlow(sim, d)).toBe(25);
    expect(sim.c.Hp.shield[a[0]!]!).toBeGreaterThan(30);
    expect(statMods(sim, a[0]!, 'ms')[0]).toBe(20);
    expect(sim.c.Hp.shield[m]!).toBeCloseTo(sim.c.Hp.shield[a[0]!]! * 0.4, 3);
  });

  it('ally first: it gets shield + speed and the dust flies on to the enemy for +15 % damage', () => {
    const run = (allyX: number | null): { dmg: number; ally: number; shield: number } => {
      const { sim, a } = setup([1, 0, 0, 0], [allyX ?? -300]);
      const d = spawnDummy(sim, CX + 900, CY, 1);
      step(sim);
      const hp = sim.c.Hp.cur[d]!;
      cmd(sim, cast(0, CX + 900, CY));
      steps(sim, 40);
      return { dmg: hp - sim.c.Hp.cur[d]!, ally: statMods(sim, a[0]!, 'ms')[0], shield: sim.c.Hp.shield[a[0]!]! };
    };
    const direct = run(null);
    const viaAlly = run(300);
    expect(direct.dmg).toBeGreaterThan(0);
    expect(viaAlly.ally).toBe(20);
    expect(viaAlly.shield).toBeGreaterThan(30);
    expect(viaAlly.dmg / direct.dmg).toBeCloseTo(1.15, 2);
  });
});

describe('W Chosen Flame', () => {
  it('shields + bonds the target; the recast moves the remaining shield to another ally and the bond follows', () => {
    const { sim, m, a } = setup([0, 1, 0, 0], [300, -300]);
    cmd(sim, cast(1, CX + 300, CY, a[0]));
    steps(sim, 8);
    const s0 = sim.c.Hp.shield[a[0]!]!;
    expect(s0).toBeGreaterThan(60);
    expect(fennaPartner(sim, m)).toBe(a[0]);
    expect(sim.c.Hp.shield[m]!).toBeCloseTo(s0 * 0.4, 3);
    cmd(sim, cast(1, CX - 300, CY, a[1]));
    steps(sim, 3);
    expect(sim.c.Hp.shield[a[0]!]!).toBe(0);
    expect(sim.c.Hp.shield[a[1]!]!).toBeCloseTo(s0, 0);
    expect(fennaPartner(sim, m)).toBe(a[1]);
    // the snapshot shows the bond line
    const snap = buildSnapshot(sim, 0, 0);
    expect(snap.objects.some((o) => o.tag === 'fenna_p_bond')).toBe(true);
  });
});

describe('E Duskpool', () => {
  it('speeds allies, slows enemies inside, vanishes after its duration', () => {
    const { sim, a } = setup([0, 0, 1, 0], [400]);
    const d = spawnDummy(sim, CX + 450, CY + 150, 1); // off the tether line
    step(sim);
    cmd(sim, cast(2, CX + 400, CY));
    steps(sim, 20);
    expect(statMods(sim, a[0]!, 'ms')[0]).toBe(20);
    expect(strongestSlow(sim, d)).toBe(25);
    steps(sim, Math.round(3.5 * 30) + 20);
    expect(statMods(sim, a[0]!, 'ms')[0]).toBe(0);
    expect(strongestSlow(sim, d)).toBe(0);
  });
});

describe('R Cocoon Light', () => {
  it('allies inside are untargetable for the duration, enemies slowed, then allies heal', () => {
    const { sim, a } = setup([0, 0, 0, 1], [300]);
    const d = spawnDummy(sim, CX + 350, CY + 100, 1);
    step(sim);
    sim.c.Hp.cur[a[0]!] = 100;
    cmd(sim, cast(3, CX + 300, CY));
    steps(sim, 12 + 18 + 4); // wind-up + 0.6 s delay
    expect(sim.c.Unit.untargetable[a[0]!]).toBe(1);
    expect(strongestSlow(sim, d)).toBe(25);
    expect(sim.c.Hp.cur[a[0]!]!).toBeLessThan(110);
    steps(sim, 60);
    expect(hasBuff(sim, a[0]!, 'stat', 'fenna_r')).toBe(false);
    expect(sim.c.Unit.untargetable[a[0]!]).toBe(0);
    expect(sim.c.Hp.cur[a[0]!]!).toBeGreaterThan(200);
  });
});

