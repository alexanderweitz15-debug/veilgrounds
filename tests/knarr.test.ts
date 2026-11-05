// Knarr Zangenfels kit: Claw Grab (Q), Shell Stance toggle (W: Fortress slow + resist + taunt, Sidestep fast + auto damage),
// Sidestep dash (E: short in Fortress), Pincer Break (R), tidal armor, Urchin Plate. combat-helpers first (sim import order).
import { CX, CY, cmd, makeSim, place, steps } from './combat-helpers';
import { describe, expect, it, vi } from 'vitest';
import { step, type Sim } from '../src/sim/sim';
import type { PlayerSetup } from '../src/sim/types';
import { missingHooks, passiveHooksOf } from '../src/sim/champions';
import { knarrSidestep } from '../src/sim/champions/knarr';
import { spawnDummy } from '../src/sim/systems/champions';
import { levelAbility } from '../src/sim/systems/abilities';
import { hasBuff, strongestSlow } from '../src/sim/buffs';
import { champions } from '../src/data/champions';

vi.hoisted(() => {
  (globalThis as { Path2D?: unknown }).Path2D ??= class { rect(): void {} };
});

const foePlayer = (champion = 'mira'): PlayerSetup => ({ slot: 5, team: 1, champion, role: 'mid', summoners: ['sprung', 'heilen'], isHuman: false });

function setup(ranks: [number, number, number, number] = [1, 1, 1, 0], foe = false): { sim: Sim; m: number; f: number } {
  const players: PlayerSetup[] = [{ slot: 0, team: 0, champion: 'knarr', role: 'top', summoners: ['sprung', 'heilen'], isHuman: true }];
  if (foe) players.push(foePlayer());
  const sim = makeSim({ players });
  const m = sim.slots[0]!;
  place(sim, m, CX, CY);
  sim.c.Champ.level[m] = ranks[3] > 0 ? 6 : 5;
  sim.c.Champ.skillPoints[m] = 30;
  ranks.forEach((r, slot) => {
    for (let i = 0; i < r; i++) levelAbility(sim, m, slot);
  });
  sim.c.Mana.cur[m] = sim.c.Mana.max[m]!;
  const f = foe ? sim.slots[5]! : -1;
  if (foe) place(sim, f, CX + 5000, CY);
  step(sim);
  return { sim, m, f };
}
const castAt = (sim: Sim, slot: 0 | 1 | 2 | 3, x: number, y: number, target?: number): void => cmd(sim, { t: 'cast', slot, x, y, target });

describe('Knarr data and kit', () => {
  it('hooks exist; tank numbers sit next to brom / dagny; the drawer is his own (non-human)', async () => {
    expect(missingHooks('knarr')).toEqual([]);
    const k = champions.knarr!;
    expect(k.roles).toEqual(['top']);
    expect(k.attackType).toBe('melee');
    for (const other of ['brom', 'dagny']) {
      expect(Math.abs(k.base.hp - champions[other]!.base.hp)).toBeLessThanOrEqual(30);
      expect(Math.abs(k.base.armor - champions[other]!.base.armor)).toBeLessThanOrEqual(3);
    }
    const { championKit, framesOf, worldSizeOf } = await import('../src/render/champions');
    const { rendererOf } = await import('../src/render/champions/atlas');
    expect(rendererOf('knarr')).toBe('drawer');
    expect(championKit('knarr')!.name).toBe('Knarr Zangenfels');
    for (const a of ['idle', 'run', 'attack', 'cast', 'death'] as const) expect(framesOf('knarr', a)).toBeGreaterThan(0);
    expect(worldSizeOf('knarr')).toBeGreaterThan(champions.knarr!.base.radius * 2);
  }, 30000);
});

describe('Knarr Shell Stance (W)', () => {
  it('Fortress (default): 20 % slower, +resist; Sidestep: 15 % faster; the toggle swaps them', () => {
    const { sim, m } = setup();
    const { Stats } = sim.c;
    const armorF = Stats.armor[m]!;
    const msF = Stats.ms[m]!;
    expect(knarrSidestep(sim, m)).toBe(false);
    expect(msF).toBeCloseTo(champions.knarr!.base.ms * 0.8, 0);
    castAt(sim, 1, CX, CY);
    steps(sim, 3);
    expect(knarrSidestep(sim, m)).toBe(true);
    expect(Stats.ms[m]!).toBeCloseTo(champions.knarr!.base.ms * 1.15, 0);
    expect(armorF - Stats.armor[m]!).toBeCloseTo(30, 5); // rank 1 Fortress resist
    expect(Stats.mr[m]!).toBeLessThan(Stats.armor[m]! + 10);
  });

  it('entering Fortress taunts enemy champions in 450: they are ordered to attack Knarr', () => {
    const { sim, m, f } = setup([1, 1, 0, 0], true);
    place(sim, f, CX + 300, CY);
    castAt(sim, 1, CX, CY); // -> Sidestep
    steps(sim, 20);
    sim.c.Atk.target[f] = -1;
    // wait out the cooldown (8 s) and swap back to Fortress
    steps(sim, 240);
    castAt(sim, 1, CX, CY);
    steps(sim, 3);
    expect(knarrSidestep(sim, m)).toBe(false);
    expect(sim.c.Atk.target[f]!).toBe(m);
    expect(sim.c.Move.mode[f]!).toBe(2);
    steps(sim, 60); // taunt over (1 s): orders are no longer forced
    sim.c.Atk.target[f] = -1;
    steps(sim, 3);
    expect(sim.c.Atk.target[f]!).not.toBe(m);
  });

  it('Sidestep autos deal +10 % (rank 1); Fortress does not', () => {
    const { sim, m, f } = setup([0, 1, 0, 0], true);
    const mod = (): number => passiveHooksOf(sim, m).reduce((a, h) => h.modifyDamage?.(sim, m, f, a, 'phys', true) ?? a, 100);
    expect(mod()).toBe(100);
    castAt(sim, 1, CX, CY);
    steps(sim, 3);
    expect(mod()).toBeCloseTo(110, 5);
  });
});

describe('Knarr tidal armor', () => {
  it('+3 armor per enemy champion within 600 (max 15)', () => {
    const { sim, m, f } = setup([0, 0, 0, 0], true);
    const far = sim.c.Stats.armor[m]!;
    place(sim, f, CX + 400, CY);
    steps(sim, 2);
    expect(sim.c.Stats.armor[m]!).toBe(far + 3);
  });
});

describe('Knarr Q Claw Grab', () => {
  it('damages, pulls the first enemy to him and roots it', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 450, CY, 1);
    step(sim);
    castAt(sim, 0, CX + 450, CY);
    steps(sim, 25);
    expect(sim.c.Hp.cur[d]!).toBeLessThan(1000);
    expect(sim.c.Pos.x[d]!).toBeLessThan(CX + 450 - 100);
    expect(hasBuff(sim, d, 'root')).toBe(true);
    void m;
  });
});

describe('Knarr E Sidestep dash', () => {
  it('Fortress: a 150 shuffle with 60 % damage; Sidestep: the full 420 leap with the slow', () => {
    for (const side of [false, true]) {
      const { sim, m } = setup([1, 1, 1, 0]);
      const d = spawnDummy(sim, CX + 600, CY, 1);
      step(sim);
      if (side) {
        castAt(sim, 1, CX, CY);
        steps(sim, 3);
      }
      const x0 = sim.c.Pos.x[m]!;
      castAt(sim, 2, CX + 700, CY);
      steps(sim, 30);
      const dx = sim.c.Pos.x[m]! - x0;
      if (side) {
        expect(dx).toBeGreaterThan(330);
        expect(strongestSlow(sim, d)).toBeGreaterThan(0);
        expect(sim.c.Hp.cur[d]!).toBeLessThan(1000);
      } else {
        expect(dx).toBeLessThan(200);
        expect(dx).toBeGreaterThan(80);
      }
    }
  });
});

describe('Knarr R Pincer Break and Urchin Plate', () => {
  it('stuns the target, damages it and shields Knarr', () => {
    const { sim, m } = setup([1, 0, 0, 1]);
    const d = spawnDummy(sim, CX + 350, CY, 1);
    step(sim);
    castAt(sim, 3, CX + 350, CY, d);
    steps(sim, 15);
    expect(hasBuff(sim, d, 'stun')).toBe(true);
    expect(sim.c.Hp.cur[d]!).toBeLessThanOrEqual(1000 - 200);
    expect(hasBuff(sim, m, 'shield')).toBe(true);
  });

  it('Urchin Plate is priced fairly and reflects magic damage on a basic attack hit', async () => {
    const { duel } = await import('./itemHelpers');
    const { itemById } = await import('../src/sim/items/inventory');
    const { goldEfficiency } = await import('../src/ui/goldEfficiency');
    const ge = goldEfficiency(itemById('seeigelpanzer')!)!;
    expect(ge.pct).toBeGreaterThan(85);
    expect(ge.pct).toBeLessThan(115);
    const { sim, me, foe } = duel({ champ: 'knarr', items: ['seeigelpanzer'] });
    place(sim, foe, CX + 150, CY);
    const hp = sim.c.Hp.cur[foe]!;
    sim.c.Atk.target[foe] = me;
    sim.c.Atk.targetSerial[foe] = sim.c.Unit.serial[me]!;
    sim.c.Move.mode[foe] = 2;
    steps(sim, 200);
    expect(sim.c.Hp.cur[foe]!).toBeLessThan(hp);
  });
});
