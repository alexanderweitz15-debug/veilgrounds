import { describe, expect, it } from 'vitest';
import { step, spawnUnit } from '../src/sim/sim';
import { dealDamage, mitigation } from '../src/sim/damage';
import { Kind } from '../src/sim/types';
import { addBuff } from '../src/sim/buffs';
import { softCapMs } from '../src/sim/systems/stats';
import { spawnDummy } from '../src/sim/systems/champions';
import { CX, CY, collect, cmd, makeSim, mira, place, steps } from './combat-helpers';

/** Mira at (CX,CY) with a red dummy 400 units east; one tick stepped so vision is computed. */
function duel(armor = 0) {
  const sim = makeSim({ dummies: [{ x: CX + 400, y: CY, team: 1, armor }] });
  const m = mira(sim);
  place(sim, m, CX, CY);
  step(sim);
  const dummy = [...Array(sim.c.Unit.kind.length).keys()].find((e) => sim.c.Unit.kind[e] === Kind.Dummy && sim.c.Unit.alive[e])!;
  return { sim, m, dummy };
}

describe('mitigation', () => {
  it('follows 100/(100+R) and 2-100/(100-R)', () => {
    expect(mitigation(0)).toBe(1);
    expect(mitigation(100)).toBe(0.5);
    expect(mitigation(-50)).toBeCloseTo(2 - 100 / 150, 12);
  });
  it('applies armor to autos (60 AD vs 100 armor = 30)', () => {
    const { sim, m, dummy } = duel(100);
    const hits = collect(sim, 90, m, { t: 'attack', target: dummy });
    expect(hits[0]!.amount).toBeCloseTo(30, 9);
  });
});

describe('practice dummy', () => {
  it('never dies', () => {
    const { sim, dummy } = duel();
    dealDamage(sim, -1, dummy, 5000, 'true');
    expect(sim.c.Unit.alive[dummy]).toBe(1);
    expect(sim.c.Hp.cur[dummy]).toBe(1000);
  });
});

describe('auto attacks', () => {
  it('windup scales with AS and attack timer averages exactly 1/AS', () => {
    const { sim, m, dummy } = duel();
    const starts: number[] = [];
    for (let i = 0; i < 700; i++) {
      step(sim, i === 0 ? [{ slot: 0, cmd: { t: 'attack', target: dummy } }] : []);
      for (const e of sim.events) if (e.e === 'attack' && e.src === m) starts.push(sim.tick - 1);
    }
    const as = sim.c.Stats.as[m]!;
    expect(as).toBeCloseTo(0.658, 9);
    const gaps = starts.slice(1).map((t, i) => t - starts[i]!);
    for (const g of gaps) expect([45, 46]).toContain(g);
    const avg = (starts[starts.length - 1]! - starts[0]!) / gaps.length;
    expect(Math.abs(avg - 30 / as)).toBeLessThan(0.1);
  });

  it('crits are deterministic per seed and deal 175 %', () => {
    const run = () => {
      const { sim, m, dummy } = duel();
      sim.c.Stats.crit[m] = 0.5;
      return collect(sim, 30 * 30, m, { t: 'attack', target: dummy }).map((h) => `${h.crit ? 'C' : '-'}${h.amount}`);
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(a.some((s) => s === 'C105')).toBe(true);
    expect(a.some((s) => s === '-60')).toBe(true);
  });

  it('move during windup cancels without damage and allows an immediate retry', () => {
    const { sim, m, dummy } = duel();
    cmd(sim, { t: 'attack', target: dummy });
    expect(sim.c.Atk.phase[m]).toBe(1);
    const ready = sim.c.Atk.nextReady[m]!;
    steps(sim, 5);
    const hits = collect(sim, 60, m, { t: 'move', x: CX - 50, y: CY });
    expect(hits).toHaveLength(0);
    expect(sim.c.Atk.nextReady[m]).toBe(ready);
    cmd(sim, { t: 'attack', target: dummy });
    expect(sim.events.some((e) => e.e === 'attack' && e.src === m)).toBe(true);
  });

  it('move during backswing keeps damage and the attack timer (orbwalk)', () => {
    const { sim, m, dummy } = duel();
    cmd(sim, { t: 'attack', target: dummy });
    while (sim.c.Atk.phase[m] !== 2) step(sim);
    const ready = sim.c.Atk.nextReady[m]!;
    const hits = collect(sim, 20, m, { t: 'move', x: CX - 300, y: CY });
    expect(hits).toHaveLength(1); // the arrow in flight still lands
    expect(sim.c.Atk.phase[m]).toBe(0);
    expect(sim.c.Atk.nextReady[m]).toBe(ready);
    // re-attack: no new attack before the timer is up
    const startTicks: number[] = [];
    for (let i = 0; i < 60; i++) {
      step(sim, i === 0 ? [{ slot: 0, cmd: { t: 'attack', target: dummy } }] : []);
      if (sim.events.some((e) => e.e === 'attack' && e.src === m)) startTicks.push(sim.tick - 1);
    }
    expect(startTicks[0]).toBeGreaterThanOrEqual(ready);
  });

  it('attack-move acquires the nearest enemy', () => {
    const { sim, m } = duel();
    const hits = collect(sim, 90, m, { t: 'attackMove', x: CX + 1200, y: CY });
    expect(hits.length).toBeGreaterThan(0);
  });

  it('minion autos deal 60 % to champions', () => {
    const { sim, m } = duel();
    const minion = spawnUnit(sim, Kind.MinionMelee, 1, CX + 120, CY, 48);
    sim.c.Hp.max[minion] = sim.c.Hp.cur[minion] = 500;
    sim.c.Stats.ad[minion] = 20;
    sim.c.Stats.as[minion] = 1;
    sim.c.Stats.range[minion] = 100;
    sim.c.Vision.r[minion] = 800;
    step(sim);
    sim.c.Atk.target[minion] = m;
    sim.c.Atk.targetSerial[minion] = sim.c.Unit.serial[m]!;
    const hits = collect(sim, 40, minion);
    const armor = sim.c.Stats.armor[m]!;
    expect(hits[0]!.amount).toBeCloseTo(20 * 0.6 * mitigation(armor), 9);
  });
});

describe('slows', () => {
  it('only the strongest slow applies', () => {
    const sim = makeSim();
    const m = mira(sim);
    addBuff(sim, m, { kind: 'slow', id: 'a', src: -1, pct: 20, ticks: 60 });
    addBuff(sim, m, { kind: 'slow', id: 'b', src: -1, pct: 40, ticks: 60 });
    step(sim);
    expect(sim.c.Stats.ms[m]).toBeCloseTo(softCapMs(340 * 0.6), 9);
    steps(sim, 60);
    expect(sim.c.Stats.ms[m]).toBe(340);
  });
  it('root stops movement; tenacity shortens CC but not airborne', () => {
    const sim = makeSim();
    const m = mira(sim);
    addBuff(sim, m, { kind: 'root', id: 'r', ticks: 30 });
    step(sim);
    expect(sim.c.Stats.ms[m]).toBe(0);
    sim.c.Stats.tenacity[m] = 0.5;
    addBuff(sim, m, { kind: 'stun', id: 's', ticks: 30 });
    addBuff(sim, m, { kind: 'airborne', id: 'k', ticks: 30 });
    const list = (sim.state.buffs as { ents: Map<number, { list: { kind: string; until: number; start: number }[] }> }).ents.get(m)!.list;
    expect(list.find((b) => b.kind === 'stun')!.until - sim.tick).toBe(15);
    expect(list.find((b) => b.kind === 'airborne')!.until - sim.tick).toBe(30);
  });
});

describe('spawn', () => {
  it('champion spawns at own fountain with level 1, one skill point, hitbox 55', () => {
    const sim = makeSim();
    const m = mira(sim);
    const f = sim.map.sides[0].fountain;
    expect(Math.hypot(sim.c.Pos.x[m]! - f.x, sim.c.Pos.y[m]! - f.y)).toBeLessThan(f.r);
    expect(sim.c.Champ.level[m]).toBe(1);
    expect(sim.c.Champ.skillPoints[m]).toBe(1);
    expect(sim.c.Unit.radius[m]).toBe(55);
    expect(sim.c.Hp.cur[m]).toBe(630);
    expect(sim.championIds[sim.c.Unit.champ[m]!]).toBe('mira');
  });
  it('spawnDummy has 1000 HP and configurable resists', () => {
    const sim = makeSim();
    const d = spawnDummy(sim, CX, CY, 1, 50, 30);
    expect(sim.c.Hp.max[d]).toBe(1000);
    step(sim);
    expect(sim.c.Stats.armor[d]).toBe(50);
    expect(sim.c.Stats.mr[d]).toBe(30);
  });
});
