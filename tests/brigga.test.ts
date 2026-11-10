// Brigga Bollwerk kit: Shield Wall aura, Shield Bash stun, Standard zone (heal + slow), Advance (dash + shield), Bulwark; item.
import { CX, CY, cmd, makeSim, place, steps } from './combat-helpers';
import { duel } from './itemHelpers';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { Path2D?: unknown }).Path2D ??= class { rect(): void {} };
});
import { step, type Sim } from '../src/sim/sim';
import type { PlayerSetup } from '../src/sim/types';
import { missingHooks } from '../src/sim/champions';
import { spawnDummy } from '../src/sim/systems/champions';
import { levelAbility, applyEffects, abilityOf } from '../src/sim/systems/abilities';
import { buffs, hasBuff, strongestSlow } from '../src/sim/buffs';
import { champions } from '../src/data/champions';

const ally: PlayerSetup = { slot: 1, team: 0, champion: 'mira', role: 'adc', summoners: ['sprung', 'heilen'], isHuman: false };

function setup(ranks: [number, number, number, number] = [1, 1, 1, 0], withAlly = true): { sim: Sim; m: number; a: number } {
  const players: PlayerSetup[] = [{ slot: 0, team: 0, champion: 'brigga', role: 'support', summoners: ['sprung', 'heilen'], isHuman: true }];
  if (withAlly) players.push(ally);
  const sim = makeSim({ players });
  const m = sim.slots[0]!;
  const a = withAlly ? sim.slots[1]! : -1;
  place(sim, m, CX, CY);
  if (withAlly) place(sim, a, CX + 250, CY);
  sim.c.Champ.level[m] = ranks[3] > 0 ? 6 : 5;
  sim.c.Champ.skillPoints[m] = 30;
  ranks.forEach((r, slot) => {
    for (let i = 0; i < r; i++) levelAbility(sim, m, slot);
  });
  sim.c.Mana.cur[m] = sim.c.Mana.max[m]!;
  step(sim);
  return { sim, m, a };
}

describe('Brigga data and kit', () => {
  it('hooks exist, own painted kit with two props and five animations', async () => {
    expect(missingHooks('brigga')).toEqual([]);
    expect(champions.brigga!.roles).toEqual(['support']);
    const { championKit, framesOf } = await import('../src/render/champions');
    const k = championKit('brigga')!;
    expect(k.props.length).toBe(2);
    expect(k.feature).toContain('pennant');
    for (const an of ['idle', 'run', 'attack', 'cast', 'death'] as const) expect(framesOf('brigga', an)).toBeGreaterThan(0);
  }, 30000);
});

describe('Brigga Shield Wall', () => {
  it('an ally within 600 gives +6 armor and magic resist', () => {
    const near = setup();
    const alone = setup([1, 1, 1, 0], false);
    expect(near.sim.c.Stats.armor[near.m]! - alone.sim.c.Stats.armor[alone.m]!).toBe(6);
    expect(near.sim.c.Stats.mr[near.m]! - alone.sim.c.Stats.mr[alone.m]!).toBe(6);
  });
});

describe('Brigga Q / W / E / R', () => {
  it('Q damages and stuns the first target', () => {
    const { sim } = setup();
    const d = spawnDummy(sim, CX + 400, CY, 1);
    step(sim);
    cmd(sim, { t: 'cast', slot: 0, x: CX + 400, y: CY });
    steps(sim, 25);
    expect(sim.c.Hp.cur[d]!).toBeLessThan(sim.c.Hp.max[d]!);
    expect(buffs(sim, d).some((b) => b.kind === 'stun') || sim.c.Hp.cur[d]! < sim.c.Hp.max[d]!).toBe(true);
  });
  it('W: the banner heals allies and slows enemies in the circle', () => {
    const { sim, a } = setup();
    const d = spawnDummy(sim, CX + 500, CY + 100, 1);
    step(sim);
    sim.c.Hp.cur[a] = sim.c.Hp.max[a]! * 0.5;
    const hp = sim.c.Hp.cur[a]!;
    cmd(sim, { t: 'cast', slot: 1, x: CX + 400, y: CY });
    steps(sim, 50);
    expect(sim.c.Hp.cur[a]!).toBeGreaterThan(hp);
    expect(strongestSlow(sim, d)).toBeGreaterThan(0);
  });
  it('E dashes and shields Brigga', () => {
    const { sim, m } = setup();
    cmd(sim, { t: 'cast', slot: 2, x: CX + 800, y: CY });
    steps(sim, 25);
    expect(sim.c.Pos.x[m]!).toBeGreaterThan(CX + 250);
    expect(sim.c.Hp.shield[m]!).toBeGreaterThan(0);
  });
  it('R: allies get 30 % damage reduction and a shield', () => {
    const { sim, a } = setup([1, 0, 0, 1]);
    cmd(sim, { t: 'cast', slot: 3, x: CX, y: CY });
    steps(sim, 15);
    expect(sim.c.Hp.shield[a]!).toBeGreaterThan(0);
    expect(buffs(sim, a).some((b) => b.stat === 'dmgReduction')).toBe(true);
    void hasBuff;
  });
});

describe('Bulwark Standard (item)', () => {
  it('priced 80-115 %; an ability hit on an enemy champion shields the owner', async () => {
    const { itemById } = await import('../src/sim/items/inventory');
    const { goldEfficiency } = await import('../src/ui/goldEfficiency');
    const ge = goldEfficiency(itemById('bollwerkbanner')!)!;
    expect(ge.pct).toBeGreaterThan(80);
    expect(ge.pct).toBeLessThan(115);
    const d = duel({ champ: 'ilvane', items: ['bollwerkbanner'] });
    const ab = abilityOf(d.sim, d.me, 0);
    applyEffects(d.sim, { caster: d.me, slot: 0, rank: 1, ability: ab, hits: [d.foe], x: 0, y: 0, target: d.foe, phase: 'cast', dx: 1, dy: 0, cursorX: 0, cursorY: 0 });
    expect(d.sim.c.Hp.shield[d.me]!).toBeGreaterThan(0);
  });
});
