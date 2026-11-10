// Erda Felsruf kit: Stone Ring (blockTerrain ring), Stone Blood armor, Boulder, Rock Shield, Quake; Earth Anchor item.
import { CX, CY, cmd, makeSim, place, steps } from './combat-helpers';
import { duel } from './itemHelpers';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { Path2D?: unknown }).Path2D ??= class { rect(): void {} };
});
import { step, type Sim } from '../src/sim/sim';
import type { PlayerSetup } from '../src/sim/types';
import { missingHooks } from '../src/sim/champions';
import { erdaNearRing } from '../src/sim/champions/erda';
import { spawnDummy } from '../src/sim/systems/champions';
import { levelAbility, applyEffects, abilityOf } from '../src/sim/systems/abilities';
import { buffs, strongestSlow } from '../src/sim/buffs';
import { champions } from '../src/data/champions';

const ally: PlayerSetup = { slot: 1, team: 0, champion: 'mira', role: 'adc', summoners: ['sprung', 'heilen'], isHuman: false };

function setup(ranks: [number, number, number, number] = [1, 1, 1, 0], withAlly = false): { sim: Sim; m: number; a: number } {
  const players: PlayerSetup[] = [{ slot: 0, team: 0, champion: 'erda', role: 'support', summoners: ['sprung', 'heilen'], isHuman: true }];
  if (withAlly) players.push(ally);
  const sim = makeSim({ players });
  const m = sim.slots[0]!;
  const a = withAlly ? sim.slots[1]! : -1;
  place(sim, m, CX, CY);
  if (withAlly) place(sim, a, CX + 200, CY);
  sim.c.Champ.level[m] = ranks[3] > 0 ? 6 : 5;
  sim.c.Champ.skillPoints[m] = 30;
  ranks.forEach((r, slot) => {
    for (let i = 0; i < r; i++) levelAbility(sim, m, slot);
  });
  sim.c.Mana.cur[m] = sim.c.Mana.max[m]!;
  step(sim);
  return { sim, m, a };
}

describe('Erda data and kit', () => {
  it('hooks exist, own painted kit with two props and five animations', async () => {
    expect(missingHooks('erda')).toEqual([]);
    expect(champions.erda!.roles).toEqual(['support']);
    const { championKit, framesOf } = await import('../src/render/champions');
    const k = championKit('erda')!;
    expect(k.props.length).toBe(2);
    expect(k.feature).toContain('boulder');
    for (const an of ['idle', 'run', 'attack', 'cast', 'death'] as const) expect(framesOf('erda', an)).toBeGreaterThan(0);
  }, 30000);
});

describe('Erda Stone Ring', () => {
  it('blocks terrain on the ring edge for 2.5 s and gives Stone Blood armor while she stands near it', () => {
    const { sim, m } = setup();
    const armor = sim.c.Stats.armor[m]!;
    const walk0 = sim.map.nav.walk.reduce((a: number, v: number) => a + v, 0);
    cmd(sim, { t: 'cast', slot: 1, x: CX + 400, y: CY });
    steps(sim, 30);
    expect(erdaNearRing(sim, m)).toBe(true);
    expect(sim.c.Stats.armor[m]! - armor).toBe(20);
    expect(sim.map.nav.walk.reduce((a: number, v: number) => a + v, 0)).toBeLessThan(walk0);
    steps(sim, 90);
    expect(erdaNearRing(sim, m)).toBe(false);
    expect(sim.map.nav.walk.reduce((a: number, v: number) => a + v, 0)).toBe(walk0);
  });
  it('damages enemies in the circle', () => {
    const { sim } = setup();
    const d = spawnDummy(sim, CX + 500, CY, 1);
    step(sim);
    cmd(sim, { t: 'cast', slot: 1, x: CX + 500, y: CY });
    steps(sim, 30);
    expect(sim.c.Hp.cur[d]!).toBeLessThan(sim.c.Hp.max[d]!);
  });
});

describe('Erda Q / E / R', () => {
  it('Q damages and slows', () => {
    const { sim } = setup();
    const d = spawnDummy(sim, CX + 600, CY, 1);
    step(sim);
    cmd(sim, { t: 'cast', slot: 0, x: CX + 600, y: CY });
    steps(sim, 30);
    expect(sim.c.Hp.cur[d]!).toBeLessThan(sim.c.Hp.max[d]!);
    expect(strongestSlow(sim, d)).toBe(25);
  });
  it('E shields Erda and the ally', () => {
    const { sim, m, a } = setup([1, 1, 1, 0], true);
    cmd(sim, { t: 'cast', slot: 2, x: CX, y: CY });
    steps(sim, 10);
    expect(sim.c.Hp.shield[m]!).toBeGreaterThan(0);
    expect(sim.c.Hp.shield[a]!).toBeGreaterThan(0);
  });
  it('R damages and throws enemies in the air', () => {
    const { sim } = setup([1, 0, 0, 1]);
    const d = spawnDummy(sim, CX + 300, CY, 1);
    step(sim);
    cmd(sim, { t: 'cast', slot: 3, x: CX, y: CY });
    steps(sim, 25);
    expect(sim.c.Hp.cur[d]!).toBeLessThan(sim.c.Hp.max[d]!);
    expect(buffs(sim, d).some((b) => b.kind === 'airborne')).toBe(true);
  });
});

describe('Earth Anchor (item)', () => {
  it('priced 80-115 %; an ability hit roots an enemy champion', async () => {
    const { itemById } = await import('../src/sim/items/inventory');
    const { goldEfficiency } = await import('../src/ui/goldEfficiency');
    const ge = goldEfficiency(itemById('erdanker')!)!;
    expect(ge.pct).toBeGreaterThan(80);
    expect(ge.pct).toBeLessThan(115);
    const d = duel({ champ: 'ilvane', items: ['erdanker'] });
    const ab = abilityOf(d.sim, d.me, 0);
    applyEffects(d.sim, { caster: d.me, slot: 0, rank: 1, ability: ab, hits: [d.foe], x: 0, y: 0, target: d.foe, phase: 'cast', dx: 1, dy: 0, cursorX: 0, cursorY: 0 });
    expect(buffs(d.sim, d.foe).some((b) => b.kind === 'root' && b.id === 'earth_anchor')).toBe(true);
  });
});
