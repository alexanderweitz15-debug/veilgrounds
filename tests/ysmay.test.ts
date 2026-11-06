// Ysmay Degenfeld kit: Lunge, Parry (damage given back, riposte stun, passive refund), Blade Whirl, Challenge.
import { CX, CY, cmd, makeSim, place, steps } from './combat-helpers';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { Path2D?: unknown }).Path2D ??= class { rect(): void {} };
});
import { step, type Sim } from '../src/sim/sim';
import type { PlayerSetup } from '../src/sim/types';
import { missingHooks } from '../src/sim/champions';
import { ysmayParrying } from '../src/sim/champions/ysmay';
import { spawnDummy } from '../src/sim/systems/champions';
import { levelAbility, cooldownLeft } from '../src/sim/systems/abilities';
import { dealDamage } from '../src/sim/damage';
import { buffs, strongestSlow } from '../src/sim/buffs';
import { champions } from '../src/data/champions';

const foe: PlayerSetup = { slot: 5, team: 1, champion: 'mira', role: 'mid', summoners: ['sprung', 'heilen'], isHuman: false };

function setup(ranks: [number, number, number, number] = [1, 1, 1, 0], withFoe = false): { sim: Sim; m: number; f: number } {
  const players: PlayerSetup[] = [{ slot: 0, team: 0, champion: 'ysmay', role: 'top', summoners: ['sprung', 'heilen'], isHuman: true }];
  if (withFoe) players.push(foe);
  const sim = makeSim({ players });
  const m = sim.slots[0]!;
  place(sim, m, CX, CY);
  sim.c.Champ.level[m] = ranks[3] > 0 ? 6 : 5;
  sim.c.Champ.skillPoints[m] = 30;
  ranks.forEach((r, slot) => {
    for (let i = 0; i < r; i++) levelAbility(sim, m, slot);
  });
  sim.c.Mana.cur[m] = sim.c.Mana.max[m]!;
  const f = withFoe ? sim.slots[5]! : -1;
  if (withFoe) place(sim, f, CX + 300, CY);
  step(sim);
  return { sim, m, f };
}

const dmgOf = (sim: Sim, m: number, d: number, n: number, first?: Parameters<typeof cmd>[1]): { amount: number; type: string }[] => {
  const out: { amount: number; type: string }[] = [];
  for (let i = 0; i < n; i++) {
    step(sim, i === 0 && first ? [{ slot: 0, cmd: first }] : []);
    for (const e of sim.events) if (e.e === 'damage' && e.src === m && e.dst === d) out.push({ amount: e.amount, type: (e as { type?: string }).type ?? '' });
  }
  return out;
};

describe('Ysmay data and kit', () => {
  it('hooks exist, numbers sit next to Isolde, own painted kit with three props and five animations', async () => {
    expect(missingHooks('ysmay')).toEqual([]);
    const y = champions.ysmay!;
    const i = champions.isolde!;
    expect(y.roles).toEqual(['top']);
    expect(Math.abs(y.base.hp - i.base.hp)).toBeLessThanOrEqual(60);
    expect(Math.abs(y.base.ad - i.base.ad)).toBeLessThanOrEqual(6);
    const { championKit, framesOf } = await import('../src/render/champions');
    const k = championKit('ysmay')!;
    expect(k.props.length).toBe(3);
    expect(k.feature).toContain('rapier');
    for (const a of ['idle', 'run', 'attack', 'cast', 'death'] as const) expect(framesOf('ysmay', a)).toBeGreaterThan(0);
  }, 30000);
});

describe('Ysmay Q Lunge', () => {
  it('dashes forward, stops at the first enemy, damages and slows it', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 250, CY, 1);
    step(sim);
    const hits = dmgOf(sim, m, d, 20, { t: 'cast', slot: 0, x: CX + 600, y: CY });
    expect(hits.some((h) => h.type === 'phys')).toBe(true);
    expect(sim.c.Pos.x[m]!).toBeLessThan(CX + 250);
    expect(strongestSlow(sim, d)).toBe(25);
  });
});

describe('Ysmay W Parry', () => {
  it('gives damage back for 0.8 s, stuns the champion attacker, wakes the passive and halves the cooldown', () => {
    const { sim, m, f } = setup([1, 1, 0, 0], true);
    cmd(sim, { t: 'cast', slot: 1, x: CX, y: CY });
    steps(sim, 3);
    expect(ysmayParrying(sim, m)).toBe(true);
    const hp = sim.c.Hp.cur[m]!;
    const cd = cooldownLeft(sim, m, 1);
    dealDamage(sim, f, m, 100, 'phys');
    expect(sim.c.Hp.cur[m]).toBeCloseTo(hp, 5);
    expect(ysmayParrying(sim, m)).toBe(false);
    expect(buffs(sim, f).some((b) => b.kind === 'stun')).toBe(true);
    expect(buffs(sim, m).some((b) => b.id === 'ysmay_riposte')).toBe(true);
    expect(cooldownLeft(sim, m, 1)).toBeLessThan(cd * 0.6);
    dealDamage(sim, f, m, 100, 'phys'); // only the first hit is parried
    expect(sim.c.Hp.cur[m]!).toBeLessThan(hp);
  });
  it('an unused parry ends after 0.8 s', () => {
    const { sim, m, f } = setup([1, 1, 0, 0], true);
    cmd(sim, { t: 'cast', slot: 1, x: CX, y: CY });
    steps(sim, 40);
    expect(ysmayParrying(sim, m)).toBe(false);
    const hp = sim.c.Hp.cur[m]!;
    dealDamage(sim, f, m, 100, 'phys');
    expect(sim.c.Hp.cur[m]!).toBeLessThan(hp);
  });
});

describe('Ysmay E Blade Whirl', () => {
  it('hits everything around her and slows', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 200, CY, 1);
    step(sim);
    const hits = dmgOf(sim, m, d, 20, { t: 'cast', slot: 2, x: CX, y: CY });
    expect(hits.length).toBeGreaterThan(0);
    expect(strongestSlow(sim, d)).toBe(30);
  });
});

describe('Ysmay R Challenge', () => {
  it('damages a target in range and cuts her damage taken by 25 %', () => {
    const { sim, m } = setup([1, 0, 0, 1]);
    const d = spawnDummy(sim, CX + 500, CY, 1);
    step(sim);
    const hits = dmgOf(sim, m, d, 25, { t: 'cast', slot: 3, x: CX + 500, y: CY, target: d });
    expect(hits.some((h) => h.amount > 100)).toBe(true);
    expect(buffs(sim, m).some((b) => b.stat === 'dmgReduction')).toBe(true);
  });
});
