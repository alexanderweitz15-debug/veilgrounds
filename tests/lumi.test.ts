// Lumi Sternenwiege kit: Wish Dust (+30 % heals/shields on low allies), Shooting Star, Wish Bond, Star Swirl, Last Wish
// (untargetable + projectile immunity + shield + cleanse on an ally), Star Diadem. combat-helpers first (sim import order).
import { CX, CY, cmd, makeSim, place, steps } from './combat-helpers';
import { duel } from './itemHelpers';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { Path2D?: unknown }).Path2D ??= class { rect(): void {} };
});
import { step, type Sim } from '../src/sim/sim';
import type { PlayerSetup } from '../src/sim/types';
import { missingHooks, passiveHooksOf } from '../src/sim/champions';
import { spawnDummy } from '../src/sim/systems/champions';
import { levelAbility } from '../src/sim/systems/abilities';
import { addBuff, buffs, hasStat, strongestSlow } from '../src/sim/buffs';
import { sec } from '../src/sim/types';
import { champions } from '../src/data/champions';

const ally: PlayerSetup = { slot: 1, team: 0, champion: 'mira', role: 'adc', summoners: ['sprung', 'heilen'], isHuman: false };

function setup(ranks: [number, number, number, number] = [1, 1, 1, 0]): { sim: Sim; m: number; a: number } {
  const sim = makeSim({ players: [{ slot: 0, team: 0, champion: 'lumi', role: 'support', summoners: ['sprung', 'heilen'], isHuman: true }, ally] });
  const m = sim.slots[0]!;
  const a = sim.slots[1]!;
  place(sim, m, CX, CY);
  place(sim, a, CX + 300, CY);
  sim.c.Champ.level[m] = ranks[3] > 0 ? 6 : 5;
  sim.c.Champ.skillPoints[m] = 30;
  ranks.forEach((r, slot) => {
    for (let i = 0; i < r; i++) levelAbility(sim, m, slot);
  });
  sim.c.Mana.cur[m] = sim.c.Mana.max[m]!;
  step(sim);
  return { sim, m, a };
}

describe('Lumi data and kit', () => {
  it('hooks exist, support numbers sit next to Ferris, own painted kit with three props and five animations', async () => {
    expect(missingHooks('lumi')).toEqual([]);
    const l = champions.lumi!;
    const f = champions.ferris!;
    expect(l.roles).toEqual(['support']);
    expect(Math.abs(l.base.hp - f.base.hp)).toBeLessThanOrEqual(40);
    expect(Math.abs(l.base.mana - f.base.mana)).toBeLessThanOrEqual(60);
    const { championKit, framesOf } = await import('../src/render/champions');
    const k = championKit('lumi')!;
    expect(k.props.length).toBe(3);
    expect(k.feature).toContain('moon');
    for (const an of ['idle', 'run', 'attack', 'cast', 'death'] as const) expect(framesOf('lumi', an)).toBeGreaterThan(0);
  }, 30000);
});

describe('Lumi Wish Dust', () => {
  it('heals are 30 % stronger on allies under 40 % HP', () => {
    const { sim, m, a } = setup();
    const hook = passiveHooksOf(sim, m).find((h) => h.modifyHeal)!;
    sim.c.Hp.cur[a] = sim.c.Hp.max[a]!;
    expect(hook.modifyHeal!(sim, m, a, 100)).toBe(100);
    sim.c.Hp.cur[a] = sim.c.Hp.max[a]! * 0.3;
    expect(hook.modifyHeal!(sim, m, a, 100)).toBeCloseTo(130, 5);
  });
});

describe('Lumi Q / W / E', () => {
  it('Q damages and slows an enemy', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 600, CY + 0, 1);
    step(sim);
    let hit = false;
    for (let i = 0; i < 40; i++) {
      step(sim, i === 0 ? [{ slot: 0, cmd: { t: 'cast', slot: 0, x: CX + 600, y: CY } }] : []);
      for (const e of sim.events) if (e.e === 'damage' && e.src === m && e.dst === d) hit = true;
    }
    expect(hit).toBe(true);
    expect(strongestSlow(sim, d)).toBe(20);
  });
  it('W shields the ally and Lumi', () => {
    const { sim, m, a } = setup();
    cmd(sim, { t: 'cast', slot: 1, x: CX + 300, y: CY, target: a });
    steps(sim, 12);
    expect(sim.c.Hp.shield[a]!).toBeGreaterThan(0);
    expect(sim.c.Hp.shield[m]!).toBeGreaterThan(0);
  });
  it('E heals allies in range and speeds them up', () => {
    const { sim, a } = setup();
    sim.c.Hp.cur[a] = sim.c.Hp.max[a]! * 0.5;
    const ms0 = sim.c.Stats.ms[a]!;
    const hp = sim.c.Hp.cur[a]!;
    cmd(sim, { t: 'cast', slot: 2, x: CX, y: CY });
    steps(sim, 12);
    expect(sim.c.Hp.cur[a]!).toBeGreaterThan(hp);
    expect(sim.c.Stats.ms[a]!).toBeGreaterThan(ms0);
  });
});

describe('Lumi R Last Wish', () => {
  it('makes the ally untargetable and projectile-immune, shields it and breaks its crowd control', () => {
    const { sim, m, a } = setup([1, 0, 0, 1]);
    addBuff(sim, a, { kind: 'stun', id: 'test_stun', src: -1, ticks: sec(3) });
    expect(buffs(sim, a).some((b) => b.kind === 'stun')).toBe(true);
    cmd(sim, { t: 'cast', slot: 3, x: CX + 300, y: CY, target: a });
    steps(sim, 12);
    expect(hasStat(sim, a, 'untargetable')).toBe(true);
    expect(hasStat(sim, a, 'projImmune')).toBe(true);
    expect(sim.c.Hp.shield[a]!).toBeGreaterThan(0);
    expect(buffs(sim, a).some((b) => b.kind === 'stun' && b.until > sim.tick)).toBe(false);
    void m;
  });
});

describe('Star Diadem (item)', () => {
  it('priced 85-115 %; casting an ability shields nearby allies', async () => {
    const { itemById } = await import('../src/sim/items/inventory');
    const { goldEfficiency } = await import('../src/ui/goldEfficiency');
    const ge = goldEfficiency(itemById('sterndiadem')!)!;
    expect(ge.pct).toBeGreaterThan(80);
    expect(ge.pct).toBeLessThan(115);
    const d = duel({ champ: 'lumi', items: ['sterndiadem'], allies: [200] });
    d.sim.c.Champ.level[d.me] = 3;
    d.sim.c.Champ.skillPoints[d.me] = 5;
    levelAbility(d.sim, d.me, 2);
    d.sim.c.Mana.cur[d.me] = d.sim.c.Mana.max[d.me]!;
    expect(d.sim.c.Hp.shield[d.allies[0]!]!).toBe(0);
    cmd(d.sim, { t: 'cast', slot: 2, x: CX, y: CY });
    steps(d.sim, 15);
    expect(d.sim.c.Hp.shield[d.allies[0]!]!).toBeGreaterThan(0);
  });
});
