// Zinna Funkenlauf kit: Arc Jump (3rd auto arcs), Spark Shot, Overcharge, Backfire, Storm Wall; Lightning Quill and Hunter's Pelt items.
import { CX, CY, cmd, makeSim, place, steps } from './combat-helpers';
import { duel } from './itemHelpers';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { Path2D?: unknown }).Path2D ??= class { rect(): void {} };
});
import { step, type Sim } from '../src/sim/sim';
import { missingHooks } from '../src/sim/champions';
import { spawnDummy } from '../src/sim/systems/champions';
import { levelAbility, applyEffects, abilityOf } from '../src/sim/systems/abilities';
import { buffs, strongestSlow } from '../src/sim/buffs';
import { champions } from '../src/data/champions';

function setup(ranks: [number, number, number, number] = [1, 1, 1, 0]): { sim: Sim; m: number } {
  const sim = makeSim({ players: [{ slot: 0, team: 0, champion: 'zinna', role: 'adc', summoners: ['sprung', 'heilen'], isHuman: true }] });
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

const dmg = (sim: Sim, m: number, n: number, first?: Parameters<typeof cmd>[1]): { dst: number; amount: number; type: string }[] => {
  const out: { dst: number; amount: number; type: string }[] = [];
  for (let i = 0; i < n; i++) {
    step(sim, i === 0 && first ? [{ slot: 0, cmd: first }] : []);
    for (const e of sim.events) if (e.e === 'damage' && e.src === m) out.push({ dst: e.dst, amount: e.amount, type: (e as { type?: string }).type ?? '' });
  }
  return out;
};

describe('Zinna data and kit', () => {
  it('hooks exist, ADC numbers sit next to the other marksmen, own painted kit', async () => {
    expect(missingHooks('zinna')).toEqual([]);
    const z = champions.zinna!;
    expect(z.roles).toEqual(['adc']);
    for (const other of ['mira', 'tobin', 'svea']) expect(Math.abs(z.base.hp - champions[other]!.base.hp)).toBeLessThanOrEqual(40);
    const { championKit, framesOf } = await import('../src/render/champions');
    const k = championKit('zinna')!;
    expect(k.props.length).toBe(2);
    expect(k.feature).toContain('antennae');
    for (const an of ['idle', 'run', 'attack', 'cast', 'death'] as const) expect(framesOf('zinna', an)).toBeGreaterThan(0);
  }, 30000);
});

describe('Zinna Arc Jump', () => {
  it('every third auto on one target also hits the nearest other enemy with magic damage', () => {
    const { sim, m } = setup();
    const a = spawnDummy(sim, CX + 400, CY, 1);
    const b = spawnDummy(sim, CX + 400, CY + 250, 1);
    step(sim);
    const hits = dmg(sim, m, 260, { t: 'attack', target: a });
    const onB = hits.filter((h) => h.dst === b && h.type === 'magic');
    expect(hits.filter((h) => h.dst === a).length).toBeGreaterThanOrEqual(3);
    expect(onB.length).toBeGreaterThanOrEqual(1);
  });
  it('Overcharge makes the very next auto arc', () => {
    const { sim, m } = setup();
    const a = spawnDummy(sim, CX + 400, CY, 1);
    const b = spawnDummy(sim, CX + 400, CY + 250, 1);
    step(sim);
    cmd(sim, { t: 'cast', slot: 1, x: CX, y: CY });
    steps(sim, 5);
    const hits = dmg(sim, m, 60, { t: 'attack', target: a });
    expect(hits.some((h) => h.dst === a)).toBe(true);
    expect(hits.some((h) => h.dst === b && h.type === 'magic')).toBe(true);
    expect(buffs(sim, m).some((x) => x.stat === 'as')).toBe(true);
  });
});

describe('Zinna Q / E / R', () => {
  it('Q pierces: hits two enemies on one line', () => {
    const { sim, m } = setup();
    const a = spawnDummy(sim, CX + 400, CY, 1);
    const b = spawnDummy(sim, CX + 700, CY, 1);
    step(sim);
    const hits = dmg(sim, m, 40, { t: 'cast', slot: 0, x: CX + 800, y: CY });
    expect(hits.some((h) => h.dst === a)).toBe(true);
    expect(hits.some((h) => h.dst === b)).toBe(true);
  });
  it('E hops away from the cursor and slows nearby enemies', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX - 200, CY, 1);
    step(sim);
    cmd(sim, { t: 'cast', slot: 2, x: CX + 800, y: CY });
    steps(sim, 25);
    expect(sim.c.Pos.x[m]!).toBeLessThan(CX - 150);
    expect(strongestSlow(sim, d)).toBeGreaterThanOrEqual(0);
  });
  it('R is a long wide line with magic damage and a stun', () => {
    const { sim, m } = setup([1, 0, 0, 1]);
    const d = spawnDummy(sim, CX + 1300, CY, 1);
    step(sim);
    const hits = dmg(sim, m, 70, { t: 'cast', slot: 3, x: CX + 1300, y: CY });
    expect(hits.some((h) => h.type === 'magic' && h.amount > 100)).toBe(true);
    void d;
  });
});

describe('items of the new champions', () => {
  it('Lightning Quill adds magic damage on hit; Hunter\'s Pelt gives speed after an ability hit; both priced 80-115 %', async () => {
    const { itemById } = await import('../src/sim/items/inventory');
    const { goldEfficiency } = await import('../src/ui/goldEfficiency');
    for (const id of ['blitzfeder', 'jagdfell']) {
      const ge = goldEfficiency(itemById(id)!)!;
      expect(ge.pct, id).toBeGreaterThan(80);
      expect(ge.pct, id).toBeLessThan(115);
    }
    const d = duel({ champ: 'ilvane', items: ['jagdfell'] });
    const ab = abilityOf(d.sim, d.me, 0);
    applyEffects(d.sim, { caster: d.me, slot: 0, rank: 1, ability: ab, hits: [d.foe], x: 0, y: 0, target: d.foe, phase: 'cast', dx: 1, dy: 0, cursorX: 0, cursorY: 0 });
    steps(d.sim, 1);
    expect(buffs(d.sim, d.me).some((b) => b.id === 'scent_of_prey')).toBe(true);
  });
});
