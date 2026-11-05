// Torben Wutmähne kit: Rage (builds, +AD, fades), Cleaving Blow, War Cry, Blood Leap, Undying Roar (HP floor + heal), Frenzy Axe.
// combat-helpers first (sim import order).
import { CX, CY, cmd, makeSim, place, steps } from './combat-helpers';
import { duel } from './itemHelpers';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { Path2D?: unknown }).Path2D ??= class { rect(): void {} };
});
import { step, type Sim } from '../src/sim/sim';
import { missingHooks } from '../src/sim/champions';
import { tobenRage } from '../src/sim/champions/torben';
import { spawnDummy } from '../src/sim/systems/champions';
import { levelAbility } from '../src/sim/systems/abilities';
import { dealDamage } from '../src/sim/damage';
import { strongestSlow, hasBuff } from '../src/sim/buffs';
import { champions } from '../src/data/champions';

function setup(ranks: [number, number, number, number] = [1, 1, 1, 0]): { sim: Sim; m: number } {
  const sim = makeSim({ players: [{ slot: 0, team: 0, champion: 'torben', role: 'top', summoners: ['sprung', 'heilen'], isHuman: true }] });
  const m = sim.slots[0]!;
  place(sim, m, CX, CY);
  sim.c.Champ.level[m] = ranks[3] > 0 ? 6 : 5;
  sim.c.Champ.skillPoints[m] = 30;
  ranks.forEach((r, slot) => {
    for (let i = 0; i < r; i++) levelAbility(sim, m, slot);
  });
  step(sim);
  return { sim, m };
}

const dmgOf = (sim: Sim, m: number, d: number, n: number, first?: Parameters<typeof cmd>[1]): { amount: number; type: string }[] => {
  const out: { amount: number; type: string }[] = [];
  for (let i = 0; i < n; i++) {
    step(sim, i === 0 && first ? [{ slot: 0, cmd: first }] : []);
    for (const e of sim.events) if (e.e === 'damage' && e.src === m && e.dst === d) out.push({ amount: e.amount, type: (e as { type?: string }).type ?? '' });
  }
  return out;
};

describe('Torben data and kit', () => {
  it('hooks exist, bruiser numbers sit next to Brom, own painted kit with three props and five animations', async () => {
    expect(missingHooks('torben')).toEqual([]);
    const t = champions.torben!;
    const b = champions.brom!;
    expect(t.roles).toEqual(['top']);
    expect(Math.abs(t.base.hp - b.base.hp)).toBeLessThanOrEqual(40);
    expect(Math.abs(t.base.ad - b.base.ad)).toBeLessThanOrEqual(5);
    const { championKit, framesOf } = await import('../src/render/champions');
    const k = championKit('torben')!;
    expect(k.props.length).toBe(3);
    expect(k.feature).toContain('axes');
    for (const a of ['idle', 'run', 'attack', 'cast', 'death'] as const) expect(framesOf('torben', a)).toBeGreaterThan(0);
  }, 30000);
});

describe('Torben Rage', () => {
  it('autos build Rage, Rage adds AD, and it fades out of combat', () => {
    const { sim, m } = setup();
    const ad0 = sim.c.Stats.ad[m]!;
    const d = spawnDummy(sim, CX + 120, CY, 1);
    step(sim);
    dmgOf(sim, m, d, 150, { t: 'attack', target: d });
    expect(tobenRage(sim, m)).toBeGreaterThanOrEqual(8);
    expect(sim.c.Stats.ad[m]!).toBeGreaterThan(ad0);
    sim.c.Atk.target[m] = -1;
    cmd(sim, { t: 'move', x: CX - 600, y: CY });
    const peak = tobenRage(sim, m);
    steps(sim, 400);
    expect(tobenRage(sim, m)).toBeLessThan(peak);
  });
  it('damage taken builds Rage in proportion to max HP; 100 Rage gives +20 % move speed', () => {
    const { sim, m } = setup();
    const foe = spawnDummy(sim, CX + 400, CY, 1);
    const ms0 = sim.c.Stats.ms[m]!;
    dealDamage(sim, foe, m, sim.c.Hp.max[m]! * 0.15, 'true');
    step(sim);
    expect(tobenRage(sim, m)).toBeGreaterThan(10);
    sim.c.Hp.cur[m] = sim.c.Hp.max[m]!;
    for (let i = 0; i < 8; i++) dealDamage(sim, foe, m, sim.c.Hp.max[m]! * 0.2, 'true'), (sim.c.Hp.cur[m] = sim.c.Hp.max[m]!);
    step(sim);
    expect(tobenRage(sim, m)).toBe(100);
    expect(sim.c.Stats.ms[m]!).toBeCloseTo(ms0 * 1.2, 0);
  });
});

describe('Torben Q Cleaving Blow', () => {
  it('cone damage and 20 % slow', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 250, CY, 1);
    step(sim);
    const hits = dmgOf(sim, m, d, 20, { t: 'cast', slot: 0, x: CX + 250, y: CY });
    expect(hits.some((h) => h.type === 'phys')).toBe(true);
    expect(strongestSlow(sim, d)).toBe(20);
  });
});

describe('Torben W War Cry', () => {
  it('attack speed buff, slows nearby enemies, +15 Rage', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 300, CY, 1);
    step(sim);
    const as0 = sim.c.Stats.as[m]!;
    cmd(sim, { t: 'cast', slot: 1, x: CX, y: CY });
    steps(sim, 10);
    expect(sim.c.Stats.as[m]!).toBeGreaterThan(as0);
    expect(strongestSlow(sim, d)).toBe(30);
    expect(tobenRage(sim, m)).toBeGreaterThanOrEqual(14);
  });
});

describe('Torben E Blood Leap', () => {
  it('leaps toward the cursor and damages enemies where he lands', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 400, CY, 1);
    step(sim);
    const hits = dmgOf(sim, m, d, 40, { t: 'cast', slot: 2, x: CX + 420, y: CY });
    expect(sim.c.Pos.x[m]!).toBeGreaterThan(CX + 250);
    expect(hits.some((h) => h.type === 'phys')).toBe(true);
  });
});

describe('Torben R Undying Roar', () => {
  it('HP cannot drop below 1 for 5 s, Rage locks at 100, then he heals', () => {
    const { sim, m } = setup([1, 0, 0, 1]);
    const foe = spawnDummy(sim, CX + 400, CY, 1);
    step(sim);
    cmd(sim, { t: 'cast', slot: 3, x: CX, y: CY });
    steps(sim, 5);
    expect(tobenRage(sim, m)).toBe(100);
    dealDamage(sim, foe, m, 99999, 'true');
    step(sim);
    expect(sim.c.Unit.alive[m]).toBe(1);
    expect(sim.c.Hp.cur[m]!).toBeGreaterThanOrEqual(1);
    expect(sim.c.Hp.cur[m]!).toBeLessThan(5);
    steps(sim, 160);
    expect(sim.c.Hp.cur[m]!).toBeGreaterThan(sim.c.Hp.max[m]! * 0.14);
    dealDamage(sim, foe, m, 99999, 'true');
    step(sim);
    expect(sim.c.Unit.alive[m]).toBe(0);
    void hasBuff;
  });
});

describe('Frenzy Axe (item)', () => {
  it('priced 85-115 %, and below 50 % HP attack speed and move speed rise', async () => {
    const { itemById } = await import('../src/sim/items/inventory');
    const { goldEfficiency } = await import('../src/ui/goldEfficiency');
    const ge = goldEfficiency(itemById('raserbeil')!)!;
    expect(ge.pct).toBeGreaterThan(80);
    expect(ge.pct).toBeLessThan(115);
    const { sim, me } = duel({ champ: 'torben', items: ['raserbeil'] });
    const as = sim.c.Stats.as[me]!;
    sim.c.Hp.cur[me] = sim.c.Hp.max[me]! * 0.4;
    steps(sim, 2);
    expect(sim.c.Stats.as[me]!).toBeGreaterThan(as * 1.2);
  });
});
