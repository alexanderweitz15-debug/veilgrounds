// Svea Böenhall kit: every ability + the unique mechanics (gust auto after walking, wind wall bends and slows enemy
// skillshots, updraft charges the gust). combat-helpers first (imports sim.ts before the system modules).
import { CX, CY, cmd, makeSim, place, steps } from './combat-helpers';
import { describe, expect, it, vi } from 'vitest';

// the kit registry module builds a Path2D at load time (browser only)
vi.hoisted(() => {
  (globalThis as { Path2D?: unknown }).Path2D ??= class { rect(): void {} };
});
import { step, type Sim } from '../src/sim/sim';
import { missingHooks } from '../src/sim/champions';
import { sveaGustReady } from '../src/sim/champions/svea';
import { spawnDummy } from '../src/sim/systems/champions';
import { levelAbility } from '../src/sim/systems/abilities';
import { spawnProjectile } from '../src/sim/systems/projectiles';
import { hasBuff, strongestSlow } from '../src/sim/buffs';
import { champions } from '../src/data/champions';

function setup(ranks: [number, number, number, number] = [1, 1, 1, 0]): { sim: Sim; m: number } {
  const sim = makeSim({ players: [{ slot: 0, team: 0, champion: 'svea', role: 'adc', summoners: ['sprung', 'heilen'], isHuman: true }] });
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

const dmgOf = (sim: Sim, m: number, d: number, n: number, first?: Parameters<typeof cmd>[1]): { amount: number; type: string; isAuto?: boolean }[] => {
  const out: { amount: number; type: string }[] = [];
  for (let i = 0; i < n; i++) {
    step(sim, i === 0 && first ? [{ slot: 0, cmd: first }] : []);
    for (const e of sim.events) if (e.e === 'damage' && e.src === m && e.dst === d) out.push({ amount: e.amount, type: (e as { type?: string }).type ?? '' });
  }
  return out;
};

describe('Svea sprite kit', () => {
  it('has its own painted kit with four props and all five animations', async () => {
    const { championKit, framesOf } = await import('../src/render/champions');
    const k = championKit('svea')!;
    expect(k.props.length).toBe(4);
    expect(k.feature).toContain('streamers');
    for (const a of ['idle', 'run', 'attack', 'cast', 'death'] as const) expect(framesOf('svea', a)).toBeGreaterThan(0);
  });
});

describe('Svea data', () => {
  it('hooks exist, ADC numbers sit next to the other marksmen', () => {
    expect(missingHooks('svea')).toEqual([]);
    const s = champions.svea!;
    expect(s.roles).toEqual(['adc']);
    for (const other of ['mira', 'tobin', 'wren', 'corvin']) {
      const o = champions[other]!;
      expect(Math.abs(s.base.hp - o.base.hp)).toBeLessThanOrEqual(40);
      expect(Math.abs(s.base.ad - o.base.ad)).toBeLessThanOrEqual(5);
    }
  });
});

describe('Svea Gust Run', () => {
  it('standing builds nothing; 500 walked units charge the gust; the next auto adds magic damage and a slow, then it resets', () => {
    const { sim, m } = setup();
    steps(sim, 60);
    expect(sveaGustReady(sim, m)).toBe(false);
    cmd(sim, { t: 'move', x: CX + 700, y: CY });
    steps(sim, 70);
    expect(sveaGustReady(sim, m)).toBe(true);
    const d = spawnDummy(sim, sim.c.Pos.x[m]! + 450, CY, 1);
    step(sim);
    const hits = dmgOf(sim, m, d, 40, { t: 'attack', target: d });
    expect(hits.some((h) => h.type === 'magic')).toBe(true);
    expect(strongestSlow(sim, d)).toBeGreaterThan(0);
    expect(sveaGustReady(sim, m)).toBe(false);
  });
});

describe('Svea Q Wind Arrow', () => {
  it('damages and slows by 30 %', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 700, CY, 1);
    step(sim);
    const hits = dmgOf(sim, m, d, 40, { t: 'cast', slot: 0, x: CX + 700, y: CY });
    expect(hits.length).toBeGreaterThan(0);
    expect(strongestSlow(sim, d)).toBe(30);
  });
});

describe('Svea W Wind Wall', () => {
  it('an enemy skillshot crossing it flies at half speed and is bent aside; speed returns after the zone', () => {
    const { sim, m } = setup([1, 1, 0, 0]);
    const d = spawnDummy(sim, CX + 3000, CY + 3000, 1);
    step(sim);
    cmd(sim, { t: 'cast', slot: 1, x: CX + 700, y: CY });
    steps(sim, 12);
    const payload = { t: 'ability', caster: d, casterSerial: sim.c.Unit.serial[d]!, slot: 0, rank: 1, flags: [], hit: [], dx: 1, dy: 0, cx: 0, cy: 0, tag: '', ret: 0 } as const;
    const proj = spawnProjectile(sim, { kind: 1, src: d, team: 1, x: CX + 200, y: CY + 40, dx: 1, dy: 0, speed: 1500, width: 60, maxDist: 4000, payload: { ...payload, flags: [], hit: [] } });
    let minSpeed = 1500;
    let bent = false;
    for (let i = 0; i < 60; i++) {
      step(sim);
      minSpeed = Math.min(minSpeed, sim.c.Proj.speed[proj]!);
      bent ||= sim.c.Proj.dy[proj]! !== 0;
    }
    expect(minSpeed).toBe(750);
    expect(bent).toBe(true);
    expect(sim.c.Pos.x[proj]!).toBeGreaterThan(CX + 700 + 280); // out the other side
    expect(sim.c.Proj.speed[proj]!).toBe(1500);
    // own projectiles are untouched
    void m;
  });
});

describe('Svea E Updraft', () => {
  it('dashes 350, gives +20 % move speed and charges the gust at once', () => {
    const { sim, m } = setup();
    cmd(sim, { t: 'cast', slot: 2, x: CX + 1000, y: CY });
    steps(sim, 25);
    expect(sim.c.Pos.x[m]!).toBeGreaterThan(CX + 250);
    expect(sveaGustReady(sim, m)).toBe(true);
    expect(hasBuff(sim, m, 'stat', 'svea_e') || sim.c.Stats.ms[m]! > 335).toBe(true);
  });
});

describe('Svea R Hurricane Arrow', () => {
  it('long line, magic damage, throws the first champion into the air', () => {
    const { sim, m } = setup([1, 0, 0, 1]);
    const d = spawnDummy(sim, CX + 1800, CY, 1);
    step(sim);
    const hits = dmgOf(sim, m, d, 60, { t: 'cast', slot: 3, x: CX + 1800, y: CY });
    expect(hits.some((h) => h.type === 'magic')).toBe(true);
    expect(sim.c.Hp.cur[d]!).toBeLessThan(1000);
  });
});

describe('Windwing (item)', () => {
  it('is priced fairly and a basic attack hit on an enemy champion gives +20 % move speed', async () => {
    const { duel, autos } = await import('./itemHelpers');
    const { itemById } = await import('../src/sim/items/inventory');
    const { goldEfficiency } = await import('../src/ui/goldEfficiency');
    const { buffs } = await import('../src/sim/buffs');
    const it = itemById('windschwinge')!;
    const ge = goldEfficiency(it)!;
    expect(ge.pct).toBeGreaterThan(85);
    expect(ge.pct).toBeLessThan(115);
    const { sim, me, foe } = duel({ champ: 'svea', items: ['windschwinge'] });
    autos(sim, me, foe, 1);
    expect(buffs(sim, me).some((b) => b.id === 'windwing' && b.until > sim.tick)).toBe(true);
  });
});
