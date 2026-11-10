// Hedda Fellwechsel kit: two forms (range, speed, AD), Q mark, W toggle, E heal/swipe by form, R pounce + shift, hunted bonus.
import { CX, CY, cmd, makeSim, place, steps } from './combat-helpers';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { Path2D?: unknown }).Path2D ??= class { rect(): void {} };
});
import { step, type Sim } from '../src/sim/sim';
import { missingHooks } from '../src/sim/champions';
import { heddaPanther } from '../src/sim/champions/hedda';
import { spawnDummy } from '../src/sim/systems/champions';
import { levelAbility, setCooldown } from '../src/sim/systems/abilities';
import { hasBuff } from '../src/sim/buffs';
import { champions } from '../src/data/champions';

function setup(ranks: [number, number, number, number] = [1, 1, 1, 0]): { sim: Sim; m: number } {
  const sim = makeSim({ players: [{ slot: 0, team: 0, champion: 'hedda', role: 'jungle', summoners: ['sprung', 'heilen'], isHuman: true }] });
  const m = sim.slots[0]!;
  place(sim, m, CX, CY);
  sim.c.Champ.level[m] = ranks[3] > 0 ? 6 : 5;
  sim.c.Champ.skillPoints[m] = 30;
  ranks.forEach((r, slot) => {
    for (let i = 0; i < r; i++) levelAbility(sim, m, slot);
  });
  sim.c.Mana.cur[m] = sim.c.Mana.max[m]!;
  step(sim);
  return { sim, m };
}

const shift = (sim: Sim, m: number): void => {
  setCooldown(sim, m, 1, 0);
  cmd(sim, { t: 'cast', slot: 1, x: CX, y: CY });
  steps(sim, 4);
};

describe('Hedda data and kit', () => {
  it('hooks exist, own painted kit with two props and five animations', async () => {
    expect(missingHooks('hedda')).toEqual([]);
    expect(champions.hedda!.roles).toEqual(['jungle']);
    expect(champions.hedda!.abilities[1].botManual).toBe(true);
    const { championKit, framesOf } = await import('../src/render/champions');
    const k = championKit('hedda')!;
    expect(k.props.length).toBe(2);
    expect(k.feature).toContain('tail');
    for (const an of ['idle', 'run', 'attack', 'cast', 'death'] as const) expect(framesOf('hedda', an)).toBeGreaterThan(0);
  }, 30000);
});

describe('Hedda forms', () => {
  it('W toggles: panther has short range, more speed and AD; back to human heals a bit', () => {
    const { sim, m } = setup();
    const range = sim.c.Stats.range[m]!;
    const ms = sim.c.Stats.ms[m]!;
    const ad = sim.c.Stats.ad[m]!;
    expect(heddaPanther(sim, m)).toBe(false);
    shift(sim, m);
    expect(heddaPanther(sim, m)).toBe(true);
    expect(sim.c.Stats.range[m]!).toBeLessThan(range - 300);
    expect(sim.c.Stats.ms[m]!).toBeGreaterThan(ms * 1.1);
    expect(sim.c.Stats.ad[m]!).toBeGreaterThan(ad * 1.1);
    sim.c.Hp.cur[m] = sim.c.Hp.max[m]! * 0.5;
    const hp = sim.c.Hp.cur[m]!;
    shift(sim, m);
    expect(heddaPanther(sim, m)).toBe(false);
    expect(sim.c.Hp.cur[m]!).toBeGreaterThan(hp);
    expect(sim.c.Stats.range[m]!).toBe(range);
  });
});

describe('Hedda Q / E / R', () => {
  it('Q marks the target as hunted', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 500, CY, 1);
    step(sim);
    cmd(sim, { t: 'cast', slot: 0, x: CX + 500, y: CY });
    steps(sim, 30);
    expect(hasBuff(sim, d, 'mark', 'hedda_hunt')).toBe(true);
    void m;
  });
  it('E heals as human and swipes as panther', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 150, CY, 1);
    step(sim);
    sim.c.Hp.cur[m] = sim.c.Hp.max[m]! * 0.5;
    const hp = sim.c.Hp.cur[m]!;
    cmd(sim, { t: 'cast', slot: 2, x: CX, y: CY });
    steps(sim, 12);
    expect(sim.c.Hp.cur[m]!).toBeGreaterThan(hp);
    expect(sim.c.Hp.cur[d]!).toBe(sim.c.Hp.max[d]!);
    shift(sim, m);
    setCooldown(sim, m, 2, 0);
    cmd(sim, { t: 'cast', slot: 2, x: CX, y: CY });
    steps(sim, 12);
    expect(sim.c.Hp.cur[d]!).toBeLessThan(sim.c.Hp.max[d]!);
  });
  it('R leaps, shifts into the panther and hurts where she lands', () => {
    const { sim, m } = setup([1, 0, 0, 1]);
    const d = spawnDummy(sim, CX + 450, CY, 1);
    step(sim);
    cmd(sim, { t: 'cast', slot: 3, x: CX + 500, y: CY });
    steps(sim, 30);
    expect(sim.c.Pos.x[m]!).toBeGreaterThan(CX + 300);
    expect(heddaPanther(sim, m)).toBe(true);
    expect(sim.c.Hp.cur[d]!).toBeLessThan(sim.c.Hp.max[d]!);
  });
  it('as panther, ability damage on a hunted target is 50 % higher', () => {
    const a = setup();
    const da = spawnDummy(a.sim, CX + 150, CY, 1);
    step(a.sim);
    shift(a.sim, a.m);
    cmd(a.sim, { t: 'cast', slot: 0, x: CX + 150, y: CY });
    steps(a.sim, 25);
    const hpA = a.sim.c.Hp.cur[da]!;
    // the first Q hits an unmarked target, the second one a hunted target
    setCooldown(a.sim, a.m, 0, 0);
    cmd(a.sim, { t: 'cast', slot: 0, x: CX + 150, y: CY });
    steps(a.sim, 25);
    const first = a.sim.c.Hp.max[da]! - hpA;
    const second = hpA - a.sim.c.Hp.cur[da]!;
    expect(second).toBeGreaterThan(first * 1.3);
  });
});
