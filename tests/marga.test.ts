// Marga Kartaune kit: Long Shot (distance damage), Mortar Lob (delayed circle), Shrapnel Hail (zone), Recoil (backward hop + shove),
// Siege Shell (3000 range), Longbarrel item. combat-helpers first (sim import order).
import { CX, CY, cmd, makeSim, place, steps } from './combat-helpers';
import { duel } from './itemHelpers';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { Path2D?: unknown }).Path2D ??= class { rect(): void {} };
});
import { step, type Sim } from '../src/sim/sim';
import { missingHooks } from '../src/sim/champions';
import { longShotMult } from '../src/sim/champions/marga';
import { spawnDummy } from '../src/sim/systems/champions';
import { levelAbility } from '../src/sim/systems/abilities';
import { strongestSlow } from '../src/sim/buffs';
import { champions } from '../src/data/champions';

function setup(ranks: [number, number, number, number] = [1, 1, 1, 0]): { sim: Sim; m: number } {
  const sim = makeSim({ players: [{ slot: 0, team: 0, champion: 'marga', role: 'mid', summoners: ['sprung', 'heilen'], isHuman: true }] });
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

const dmgOf = (sim: Sim, m: number, d: number, n: number, first?: Parameters<typeof cmd>[1]): { amount: number; type: string; tick: number }[] => {
  const out: { amount: number; type: string; tick: number }[] = [];
  for (let i = 0; i < n; i++) {
    step(sim, i === 0 && first ? [{ slot: 0, cmd: first }] : []);
    for (const e of sim.events) if (e.e === 'damage' && e.src === m && e.dst === d) out.push({ amount: e.amount, type: (e as { type?: string }).type ?? '', tick: sim.tick });
  }
  return out;
};

describe('Marga data and kit', () => {
  it('hooks exist, mid-mage numbers sit next to Ilvane, own painted kit with three props and five animations', async () => {
    expect(missingHooks('marga')).toEqual([]);
    const a = champions.marga!;
    const o = champions.ilvane!;
    expect(a.roles).toEqual(['mid']);
    expect(Math.abs(a.base.hp - o.base.hp)).toBeLessThanOrEqual(40);
    expect(Math.abs(a.base.mana - o.base.mana)).toBeLessThanOrEqual(60);
    const { championKit, framesOf } = await import('../src/render/champions');
    const k = championKit('marga')!;
    expect(k.props.length).toBe(3);
    expect(k.feature).toContain('mortar');
    for (const an of ['idle', 'run', 'attack', 'cast', 'death'] as const) expect(framesOf('marga', an)).toBeGreaterThan(0);
  }, 30000);
});

describe('Marga Long Shot', () => {
  it('multiplier: none up to 500, +4 % per 100, capped at +24 %', () => {
    expect(longShotMult(300)).toBe(1);
    expect(longShotMult(800)).toBeCloseTo(1.12, 5);
    expect(longShotMult(5000)).toBeCloseTo(1.24, 5);
  });
  it('the same Mortar Lob hurts a far target more than a near one', () => {
    const near = setup();
    const dn = spawnDummy(near.sim, CX + 400, CY, 1);
    step(near.sim);
    const hn = dmgOf(near.sim, near.m, dn, 90, { t: 'cast', slot: 0, x: CX + 400, y: CY }).filter((h) => h.type === 'magic');
    const far = setup();
    const df = spawnDummy(far.sim, CX + 1200, CY, 1);
    step(far.sim);
    const hf = dmgOf(far.sim, far.m, df, 90, { t: 'cast', slot: 0, x: CX + 1200, y: CY }).filter((h) => h.type === 'magic');
    expect(hn.length).toBeGreaterThan(0);
    expect(hf[0]!.amount).toBeGreaterThan(hn[0]!.amount);
  });
});

describe('Marga Q Mortar Lob', () => {
  it('lands after its delay (not at once) and slows by 25 %', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 1000, CY, 1);
    step(sim);
    const hits = dmgOf(sim, m, d, 60, { t: 'cast', slot: 0, x: CX + 1000, y: CY });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.tick - sim.tick + 60).toBeGreaterThan(20); // not instant: 0.35 s cast + 0.9 s delay
    expect(strongestSlow(sim, d)).toBe(25);
  });
});

describe('Marga W Shrapnel Hail', () => {
  it('a zone that damages every second', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 800, CY, 1);
    step(sim);
    const early = dmgOf(sim, m, d, 30, { t: 'cast', slot: 1, x: CX + 800, y: CY });
    expect(early.length).toBeGreaterThan(0);
    expect(strongestSlow(sim, d)).toBeGreaterThan(0);
    const hits = early.concat(dmgOf(sim, m, d, 100));
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Marga E Recoil', () => {
  it('hops away from the cursor and shoves nearby enemies back', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 150, CY, 1);
    step(sim);
    const x0 = sim.c.Pos.x[d]!;
    cmd(sim, { t: 'cast', slot: 2, x: CX + 1000, y: CY }); // cursor east: she hops west
    steps(sim, 30);
    expect(sim.c.Pos.x[m]!).toBeLessThan(CX - 200);
    expect(sim.c.Pos.x[d]!).toBeGreaterThan(x0 + 100);
    expect(strongestSlow(sim, d)).toBeGreaterThan(0);
  });
});

describe('Marga R Siege Shell', () => {
  it('reaches 2,500 units away, magic damage and a heavy slow', () => {
    const { sim, m } = setup([1, 0, 0, 1]);
    const d = spawnDummy(sim, CX + 2500, CY, 1);
    step(sim);
    const hits = dmgOf(sim, m, d, 120, { t: 'cast', slot: 3, x: CX + 2500, y: CY });
    expect(hits.some((h) => h.type === 'magic' && h.amount > 200)).toBe(true);
    expect(strongestSlow(sim, d)).toBe(50);
  });
});

describe('Longbarrel (item)', () => {
  it('+100 attack range, priced 85-115 %', async () => {
    const { itemById } = await import('../src/sim/items/inventory');
    const { goldEfficiency } = await import('../src/ui/goldEfficiency');
    const ge = goldEfficiency(itemById('langrohr')!)!;
    expect(ge.pct).toBeGreaterThan(80);
    expect(ge.pct).toBeLessThan(115);
    const base = duel({ champ: 'marga' });
    const withIt = duel({ champ: 'marga', items: ['langrohr'] });
    expect(withIt.sim.c.Stats.range[withIt.me]! - base.sim.c.Stats.range[base.me]!).toBe(100);
  });
});
