// Truda Sporenhauch kit: spore fields (Q lob, W root), poison + slow, spreading while enemies stand inside (cap),
// Overgrowth (E) and Spore Burst (R), the Blight passive, Rotwood Staff. combat-helpers first (sim import order).
import { CX, CY, cmd, makeSim, place, steps } from './combat-helpers';
import { describe, expect, it, vi } from 'vitest';
import { step, type Sim } from '../src/sim/sim';
import { missingHooks } from '../src/sim/champions';
import { FIELD_CAP, trudaFieldCount, trudaFields } from '../src/sim/champions/truda';
import { spawnDummy } from '../src/sim/systems/champions';
import { levelAbility } from '../src/sim/systems/abilities';
import { hasBuff, strongestSlow } from '../src/sim/buffs';
import { champions } from '../src/data/champions';

vi.hoisted(() => {
  (globalThis as { Path2D?: unknown }).Path2D ??= class { rect(): void {} };
});

function setup(ranks: [number, number, number, number] = [1, 1, 1, 0], level = 5): { sim: Sim; m: number } {
  const sim = makeSim({ players: [{ slot: 0, team: 0, champion: 'truda', role: 'mid', summoners: ['sprung', 'heilen'], isHuman: true }] });
  const m = sim.slots[0]!;
  place(sim, m, CX, CY);
  sim.c.Champ.level[m] = ranks[3] > 0 ? Math.max(level, 6) : level;
  sim.c.Champ.skillPoints[m] = 30;
  ranks.forEach((r, slot) => {
    for (let i = 0; i < r; i++) levelAbility(sim, m, slot);
  });
  sim.c.Mana.cur[m] = sim.c.Mana.max[m]!;
  step(sim);
  return { sim, m };
}
const castAt = (sim: Sim, slot: 0 | 1 | 2 | 3, x: number, y: number, target?: number): void => cmd(sim, { t: 'cast', slot, x, y, target });

describe('Truda data and kit', () => {
  it('hooks exist; mid-mage numbers sit next to aurel / ilvane; the kit is her own', async () => {
    expect(missingHooks('truda')).toEqual([]);
    const t = champions.truda!;
    expect(t.roles).toEqual(['mid']);
    for (const other of ['aurel', 'ilvane']) {
      expect(Math.abs(t.base.hp - champions[other]!.base.hp)).toBeLessThanOrEqual(30);
      expect(Math.abs(t.base.mana - champions[other]!.base.mana)).toBeLessThanOrEqual(40);
    }
    const { championKit, framesOf } = await import('../src/render/champions');
    const k = championKit('truda')!;
    expect(k.props.length).toBe(4);
    expect(k.feature).toContain('mushroom');
    for (const a of ['idle', 'run', 'attack', 'cast', 'death'] as const) expect(framesOf('truda', a)).toBeGreaterThan(0);
  }, 30000);
});

describe('Truda Q Spore Toss and the fields', () => {
  it('lobs a field that damages, poisons and slows; standing in it for 0.5 s spreads it to adjacent ground', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 600, CY, 1);
    step(sim);
    castAt(sim, 0, CX + 600, CY);
    steps(sim, 20);
    expect(trudaFieldCount(sim, m)).toBe(1);
    expect(sim.c.Hp.cur[d]!).toBeLessThan(1000);
    expect(hasBuff(sim, d, 'dot', 'truda_poison')).toBe(true);
    expect(strongestSlow(sim, d)).toBeGreaterThanOrEqual(20);
    steps(sim, 60);
    expect(trudaFieldCount(sim, m)).toBeGreaterThanOrEqual(2); // a child grew toward the enemy
    const [a, b] = trudaFields(sim, m);
    expect(b!.gen).toBe(a!.gen + 1);
  });

  it('never more than 6 fields; fields expire', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 600, CY, 1);
    step(sim);
    castAt(sim, 0, CX + 600, CY);
    for (let i = 0; i < 400; i++) {
      step(sim);
      expect(trudaFieldCount(sim, m)).toBeLessThanOrEqual(FIELD_CAP);
    }
    void d;
    expect(trudaFieldCount(sim, m)).toBe(0); // 5 s + 4 s children, nobody refreshes them
  });
});

describe('Truda W Mycelium Grasp', () => {
  it('roots the target and grows a field under it', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 500, CY, 1);
    step(sim);
    castAt(sim, 1, CX + 500, CY, d);
    steps(sim, 15);
    expect(hasBuff(sim, d, 'root')).toBe(true);
    expect(trudaFieldCount(sim, m)).toBe(1);
    expect(trudaFields(sim, m)[0]!.x).toBeCloseTo(sim.c.Pos.x[d]!, 0);
  });
});

describe('Truda E Overgrowth', () => {
  it('spreads every field at once (capped) and gives move speed', () => {
    const { sim, m } = setup();
    castAt(sim, 0, CX + 500, CY);
    steps(sim, 16);
    expect(trudaFieldCount(sim, m)).toBe(1);
    steps(sim, 20); // Q cooldown does not matter: E needs no enemy
    castAt(sim, 2, CX, CY);
    steps(sim, 10);
    expect(trudaFieldCount(sim, m)).toBe(2);
    expect(sim.c.Stats.ms[m]!).toBeGreaterThan(champions.truda!.base.ms);
  });
});

describe('Truda R Spore Burst', () => {
  it('bursts all fields: damage once per enemy and a stun; the fields are gone', () => {
    const { sim, m } = setup([1, 0, 0, 1]);
    const d = spawnDummy(sim, CX + 600, CY, 1);
    step(sim);
    castAt(sim, 0, CX + 600, CY);
    steps(sim, 20);
    const hp = sim.c.Hp.cur[d]!;
    castAt(sim, 3, CX, CY);
    steps(sim, 15);
    expect(hasBuff(sim, d, 'stun')).toBe(true);
    expect(sim.c.Hp.cur[d]!).toBeLessThanOrEqual(hp - 150);
    expect(trudaFieldCount(sim, m)).toBe(0);
  });

  it('without fields nothing happens and the mana and cooldown come back', () => {
    const { sim, m } = setup([0, 0, 0, 1]);
    const mana = sim.c.Mana.cur[m]!;
    castAt(sim, 3, CX, CY);
    steps(sim, 15);
    expect(sim.c.Mana.cur[m]!).toBeGreaterThanOrEqual(mana - 1);
    castAt(sim, 3, CX, CY);
    steps(sim, 15);
    expect(sim.c.Mana.cur[m]!).toBeGreaterThanOrEqual(mana - 1); // castable again at once
  });
});

describe('Truda Blight passive and Rotwood Staff', () => {
  it('autos on a poisoned enemy deal extra magic damage; Rotwood Staff cuts healing on ability hits', async () => {
    const { duel } = await import('./itemHelpers');
    const { itemById } = await import('../src/sim/items/inventory');
    const { goldEfficiency } = await import('../src/ui/goldEfficiency');
    const { addBuff, buffs } = await import('../src/sim/buffs');
    const { sec } = await import('../src/sim/types');
    const { sim, me, foe } = duel({ champ: 'truda', items: ['faeulnisstab'] });
    const ge = goldEfficiency(itemById('faeulnisstab')!)!;
    expect(ge.pct).toBeGreaterThan(85);
    expect(ge.pct).toBeLessThan(115);
    const { passiveHooksOf } = await import('../src/sim/champions');
    const mod = (): number => passiveHooksOf(sim, me).reduce((amt, h) => h.modifyDamage?.(sim, me, foe, amt, 'phys', true) ?? amt, 100);
    expect(mod()).toBe(100);
    sim.c.Champ.level[me] = 5;
    sim.c.Champ.skillPoints[me] = 5;
    levelAbility(sim, me, 0);
    cmd(sim, { t: 'cast', slot: 0, x: CX + 400, y: CY });
    steps(sim, 20);
    expect(buffs(sim, foe).some((b) => b.kind === 'grievous' && b.id === 'rotwood' && b.until > sim.tick)).toBe(true);
    addBuff(sim, foe, { kind: 'dot', id: 'truda_poison', src: me, amount: 1, period: sec(1), dmgType: 'magic', ticks: sec(5) });
    expect(mod()).toBeGreaterThan(100);
  });
});
