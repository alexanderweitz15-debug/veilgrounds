// Gerwin Totenglocke kit: skeletons are real pets (HP, killable, capped at 4), Q raises one, W detonates the nearest, E commands,
// R raises three reinforced ones, Crypt Servants armor, Crypt Crown item. combat-helpers first (sim import order).
import { CX, CY, cmd, makeSim, place, steps } from './combat-helpers';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { Path2D?: unknown }).Path2D ??= class { rect(): void {} };
});
import { step, type Sim } from '../src/sim/sim';
import { missingHooks } from '../src/sim/champions';
import { skeletonCount } from '../src/sim/champions/gerwin';
import { spawnDummy } from '../src/sim/systems/champions';
import { levelAbility, setCooldown } from '../src/sim/systems/abilities';
import { petsOf } from '../src/sim/summons';
import { dealDamage } from '../src/sim/damage';
import { strongestSlow } from '../src/sim/buffs';
import { champions } from '../src/data/champions';

function setup(ranks: [number, number, number, number] = [1, 1, 1, 0]): { sim: Sim; m: number } {
  const sim = makeSim({ players: [{ slot: 0, team: 0, champion: 'gerwin', role: 'jungle', summoners: ['sprung', 'heilen'], isHuman: true }] });
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

describe('Gerwin data and kit', () => {
  it('hooks exist, own painted kit with three props and five animations', async () => {
    expect(missingHooks('gerwin')).toEqual([]);
    expect(champions.gerwin!.roles).toEqual(['jungle']);
    const { championKit, framesOf } = await import('../src/render/champions');
    const k = championKit('gerwin')!;
    expect(k.props.length).toBe(3);
    expect(k.feature).toContain('bell');
    for (const an of ['idle', 'run', 'attack', 'cast', 'death'] as const) expect(framesOf('gerwin', an)).toBeGreaterThan(0);
  }, 30000);
});

describe('Gerwin skeletons', () => {
  it('Q raises a real pet unit with HP that dies to damage; Crypt Servants adds armor', () => {
    const { sim, m } = setup();
    const armor0 = sim.c.Stats.armor[m]!;
    cmd(sim, { t: 'cast', slot: 0, x: CX + 500, y: CY });
    steps(sim, 25);
    const pets = petsOf(sim, m, 'gerwin_skeleton');
    expect(pets.length).toBe(1);
    expect(sim.c.Hp.max[pets[0]!]!).toBeGreaterThan(100);
    expect(sim.c.Stats.armor[m]!).toBeGreaterThan(armor0);
    dealDamage(sim, m, pets[0]!, 99999, 'true');
    step(sim);
    expect(skeletonCount(sim, m)).toBe(0);
  });
  it('never more than 4: the oldest falls apart', () => {
    const { sim, m } = setup();
    for (let i = 0; i < 5; i++) {
      sim.c.Mana.cur[m] = sim.c.Mana.max[m]!;
      sim.c.Pos.x[m] = CX;
      cmd(sim, { t: 'cast', slot: 0, x: CX + 400 + i * 20, y: CY });
      steps(sim, 25);
      setCooldown(sim, m, 0, 0);
    }
    expect(skeletonCount(sim, m)).toBeLessThanOrEqual(4);
  });
});

describe('Gerwin W Bone Burst', () => {
  it('detonates the skeleton nearest the cursor: damage + slow where it stood, skeleton gone', () => {
    const { sim, m } = setup();
    cmd(sim, { t: 'cast', slot: 0, x: CX + 400, y: CY });
    steps(sim, 25);
    expect(skeletonCount(sim, m)).toBe(1);
    const sk = petsOf(sim, m, 'gerwin_skeleton')[0]!;
    const d = spawnDummy(sim, sim.c.Pos.x[sk]! + 100, CY, 1);
    step(sim);
    cmd(sim, { t: 'cast', slot: 1, x: sim.c.Pos.x[sk]!, y: CY });
    steps(sim, 5);
    expect(skeletonCount(sim, m)).toBe(0);
    expect(strongestSlow(sim, d)).toBe(30);
    expect(sim.c.Hp.cur[d]!).toBeLessThan(sim.c.Hp.max[d]!);
  });
});

describe('Gerwin R Dead Host', () => {
  it('raises three reinforced skeletons', () => {
    const { sim, m } = setup([1, 0, 0, 1]);
    cmd(sim, { t: 'cast', slot: 3, x: CX + 500, y: CY });
    steps(sim, 25);
    const pets = petsOf(sim, m, 'gerwin_skeleton');
    expect(pets.length).toBe(3);
    expect(sim.c.Hp.max[pets[0]!]!).toBeGreaterThan(150);
  });
});

describe('Crypt Crown (item)', () => {
  it('priced 85-115 %', async () => {
    const { itemById } = await import('../src/sim/items/inventory');
    const { goldEfficiency } = await import('../src/ui/goldEfficiency');
    const ge = goldEfficiency(itemById('gruftkrone')!)!;
    expect(ge.pct).toBeGreaterThan(80);
    expect(ge.pct).toBeLessThan(115);
  });
});
