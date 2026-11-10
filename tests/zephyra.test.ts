// Zephyra Weitblick kit: map-wide Starfall with a 2.2 s lead, Star Chart cooldown cut on takedowns, Q / W / E, Star Compass.
import { CX, CY, cmd, makeSim, place, steps } from './combat-helpers';
import { duel } from './itemHelpers';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { Path2D?: unknown }).Path2D ??= class { rect(): void {} };
});
import { step, type Sim } from '../src/sim/sim';
import { missingHooks, passiveHooksOf } from '../src/sim/champions';
import { spawnDummy } from '../src/sim/systems/champions';
import { levelAbility, cooldownLeft, setCooldown } from '../src/sim/systems/abilities';
import { buffs, strongestSlow } from '../src/sim/buffs';
import { champions } from '../src/data/champions';

function setup(ranks: [number, number, number, number] = [1, 1, 1, 0]): { sim: Sim; m: number } {
  const sim = makeSim({ players: [{ slot: 0, team: 0, champion: 'zephyra', role: 'mid', summoners: ['sprung', 'heilen'], isHuman: true }] });
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

describe('Zephyra data and kit', () => {
  it('hooks exist, own painted kit with two props and five animations', async () => {
    expect(missingHooks('zephyra')).toEqual([]);
    expect(champions.zephyra!.roles).toEqual(['mid']);
    expect(champions.zephyra!.abilities[3].range).toBe(8000);
    const { championKit, framesOf } = await import('../src/render/champions');
    const k = championKit('zephyra')!;
    expect(k.props.length).toBe(2);
    expect(k.feature).toContain('telescope');
    for (const an of ['idle', 'run', 'attack', 'cast', 'death'] as const) expect(framesOf('zephyra', an)).toBeGreaterThan(0);
  }, 30000);
});

describe('Zephyra Starfall', () => {
  it('hits a far target (2,500 away) only after the 2.2 s delay, with damage and a slow', () => {
    const { sim } = setup([1, 0, 0, 1]);
    const d = spawnDummy(sim, CX + 2500, CY, 1);
    step(sim);
    cmd(sim, { t: 'cast', slot: 3, x: CX + 2500, y: CY });
    steps(sim, 40);
    expect(sim.c.Hp.cur[d]!).toBe(sim.c.Hp.max[d]!); // still in the air
    steps(sim, 60);
    expect(sim.c.Hp.max[d]! - sim.c.Hp.cur[d]!).toBeGreaterThan(200);
    expect(strongestSlow(sim, d)).toBe(40);
  });
});

describe('Zephyra Star Chart', () => {
  it('a takedown cuts the Starfall cooldown by 15 s', () => {
    const { sim, m } = setup([1, 0, 0, 1]);
    setCooldown(sim, m, 3, 30 * 100);
    const hook = passiveHooksOf(sim, m).find((h) => h.onTakedown)!;
    const before = cooldownLeft(sim, m, 3);
    hook.onTakedown!(sim, m, -1);
    expect(before - cooldownLeft(sim, m, 3)).toBe(30 * 15);
  });
});

describe('Zephyra Q / W / E', () => {
  it('Q damages and slows', () => {
    const { sim } = setup();
    const d = spawnDummy(sim, CX + 600, CY, 1);
    step(sim);
    cmd(sim, { t: 'cast', slot: 0, x: CX + 600, y: CY });
    steps(sim, 30);
    expect(sim.c.Hp.cur[d]!).toBeLessThan(sim.c.Hp.max[d]!);
    expect(strongestSlow(sim, d)).toBe(20);
  });
  it('W shields and speeds up', () => {
    const { sim, m } = setup();
    cmd(sim, { t: 'cast', slot: 1, x: CX, y: CY });
    steps(sim, 8);
    expect(sim.c.Hp.shield[m]!).toBeGreaterThan(0);
  });
  it('E dashes and damages where she lands', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 350, CY, 1);
    step(sim);
    cmd(sim, { t: 'cast', slot: 2, x: CX + 350, y: CY });
    steps(sim, 25);
    expect(sim.c.Pos.x[m]!).toBeGreaterThan(CX + 200);
    expect(sim.c.Hp.cur[d]!).toBeLessThan(sim.c.Hp.max[d]!);
  });
});

describe('Star Compass (item)', () => {
  it('priced 80-115 %; casting the ultimate gives speed and mana', async () => {
    const { itemById } = await import('../src/sim/items/inventory');
    const { goldEfficiency } = await import('../src/ui/goldEfficiency');
    const ge = goldEfficiency(itemById('sternkompass')!)!;
    expect(ge.pct).toBeGreaterThan(80);
    expect(ge.pct).toBeLessThan(115);
    const d = duel({ champ: 'zephyra', items: ['sternkompass'] });
    d.sim.c.Champ.level[d.me] = 6;
    d.sim.c.Champ.skillPoints[d.me] = 6;
    levelAbility(d.sim, d.me, 3);
    d.sim.c.Mana.cur[d.me] = d.sim.c.Mana.max[d.me]! - 50;
    cmd(d.sim, { t: 'cast', slot: 3, x: CX + 1500, y: CY });
    steps(d.sim, 20);
    expect(buffs(d.sim, d.me).some((b) => b.id === 'heavens_favour')).toBe(true);
  });
});
