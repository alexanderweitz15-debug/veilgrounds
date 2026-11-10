// Ignatz Funkenhammer kit: Heat (third ability hit ignites), Hammer Blow, Forge, Spark Leap, Magma Flow, Forgeheart.
import { CX, CY, cmd, makeSim, place, steps } from './combat-helpers';
import { duel } from './itemHelpers';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { Path2D?: unknown }).Path2D ??= class { rect(): void {} };
});
import { step, type Sim } from '../src/sim/sim';
import { missingHooks } from '../src/sim/champions';
import { spawnDummy } from '../src/sim/systems/champions';
import { levelAbility, setCooldown, applyEffects, abilityOf } from '../src/sim/systems/abilities';
import { buffs, strongestSlow } from '../src/sim/buffs';
import { champions } from '../src/data/champions';

function setup(ranks: [number, number, number, number] = [1, 1, 1, 0]): { sim: Sim; m: number } {
  const sim = makeSim({ players: [{ slot: 0, team: 0, champion: 'ignatz', role: 'mid', summoners: ['sprung', 'heilen'], isHuman: true }] });
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

describe('Ignatz data and kit', () => {
  it('hooks exist, own painted kit with two props and five animations, bruiser-mage numbers', async () => {
    expect(missingHooks('ignatz')).toEqual([]);
    const i = champions.ignatz!;
    expect(i.roles).toEqual(['mid']);
    expect(Math.abs(i.base.hp - champions.seraphyne!.base.hp)).toBeLessThanOrEqual(60);
    const { championKit, framesOf } = await import('../src/render/champions');
    const k = championKit('ignatz')!;
    expect(k.props.length).toBe(2);
    expect(k.feature).toContain('hammer');
    for (const an of ['idle', 'run', 'attack', 'cast', 'death'] as const) expect(framesOf('ignatz', an)).toBeGreaterThan(0);
  }, 30000);
});

describe('Ignatz Heat', () => {
  it('the third ability hit on a target ignites it (magic dot); two hits do not', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 200, CY, 1);
    step(sim);
    const hit = (): void => {
      setCooldown(sim, m, 0, 0);
      sim.c.Mana.cur[m] = sim.c.Mana.max[m]!;
      cmd(sim, { t: 'cast', slot: 0, x: CX + 200, y: CY });
      steps(sim, 12);
    };
    hit();
    hit();
    expect(buffs(sim, d).some((b) => b.id === 'ignatz_burn')).toBe(false);
    hit();
    expect(buffs(sim, d).some((b) => b.id === 'ignatz_burn')).toBe(true);
  });
});

describe('Ignatz Q / W / E / R', () => {
  it('Q cone damages and slows', () => {
    const { sim } = setup();
    const d = spawnDummy(sim, CX + 250, CY, 1);
    step(sim);
    cmd(sim, { t: 'cast', slot: 0, x: CX + 250, y: CY });
    steps(sim, 12);
    expect(sim.c.Hp.cur[d]!).toBeLessThan(sim.c.Hp.max[d]!);
    expect(strongestSlow(sim, d)).toBe(20);
  });
  it('W shields and speeds up', () => {
    const { sim, m } = setup();
    const ms = sim.c.Stats.ms[m]!;
    cmd(sim, { t: 'cast', slot: 1, x: CX, y: CY });
    steps(sim, 8);
    expect(sim.c.Hp.shield[m]!).toBeGreaterThan(0);
    expect(sim.c.Stats.ms[m]!).toBeGreaterThan(ms);
  });
  it('E leaps and damages where he lands', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 400, CY, 1);
    step(sim);
    cmd(sim, { t: 'cast', slot: 2, x: CX + 400, y: CY });
    steps(sim, 30);
    expect(sim.c.Pos.x[m]!).toBeGreaterThan(CX + 250);
    expect(sim.c.Hp.cur[d]!).toBeLessThan(sim.c.Hp.max[d]!);
  });
  it('R zone damages every second', () => {
    const { sim } = setup([1, 0, 0, 1]);
    const d = spawnDummy(sim, CX + 500, CY, 1);
    step(sim);
    cmd(sim, { t: 'cast', slot: 3, x: CX + 500, y: CY });
    steps(sim, 100);
    expect(sim.c.Hp.max[d]! - sim.c.Hp.cur[d]!).toBeGreaterThan(100);
  });
});

describe('Forgeheart (item)', () => {
  it('priced 80-115 %; an ability hit on a champion heals the owner', async () => {
    const { itemById } = await import('../src/sim/items/inventory');
    const { goldEfficiency } = await import('../src/ui/goldEfficiency');
    const ge = goldEfficiency(itemById('schmiedeherz')!)!;
    expect(ge.pct).toBeGreaterThan(80);
    expect(ge.pct).toBeLessThan(115);
    const d = duel({ champ: 'ilvane', items: ['schmiedeherz'] });
    d.sim.c.Hp.cur[d.me] = d.sim.c.Hp.max[d.me]! * 0.5;
    const hp = d.sim.c.Hp.cur[d.me]!;
    const ab = abilityOf(d.sim, d.me, 0);
    applyEffects(d.sim, { caster: d.me, slot: 0, rank: 1, ability: ab, hits: [d.foe], x: 0, y: 0, target: d.foe, phase: 'cast', dx: 1, dy: 0, cursorX: 0, cursorY: 0 });
    expect(d.sim.c.Hp.cur[d.me]!).toBeGreaterThan(hp);
  });
});
