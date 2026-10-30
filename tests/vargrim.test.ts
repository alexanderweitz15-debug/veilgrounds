// Vargrim Nebelhuf kit: passive (AD from bonus MS), Q whirl, W mist, E charge ramp + knock-back, R fear + riders.
import '../src/sim/sim';
import { describe, expect, it } from 'vitest';
import { step, type Sim } from '../src/sim/sim';
import { addBuff, hasBuff } from '../src/sim/buffs';
import { spawnDummy } from '../src/sim/systems/champions';
import { cooldownLeft, levelAbility } from '../src/sim/systems/abilities';
import { championData, missingHooks } from '../src/sim/champions';
import { vargrimChargeDist, vargrimStacks } from '../src/sim/champions/vargrim';
import { buildSnapshot } from '../src/sim/snapshot';
import { dealDamage } from '../src/sim/damage';
import { sec, type Command, type PlayerSetup } from '../src/sim/types';
import { CX, CY, cmd, collect, makeSim, place, steps } from './combat-helpers';

const player: PlayerSetup = { slot: 0, team: 0, champion: 'vargrim', role: 'jungle', summoners: ['sprung', 'heilen'], isHuman: true };

function setup(ranks: [number, number, number, number] = [1, 1, 1, 0]): { sim: Sim; m: number } {
  const sim = makeSim({ players: [player] });
  const m = sim.slots[0]!;
  place(sim, m, CX, CY);
  sim.c.Champ.level[m] = Math.max(ranks[3] > 0 ? 6 : 1, ...ranks.slice(0, 3).map((r) => 2 * r - 1));
  sim.c.Champ.skillPoints[m] = 30;
  ranks.forEach((r, slot) => {
    for (let i = 0; i < r; i++) levelAbility(sim, m, slot);
  });
  step(sim);
  return { sim, m };
}
const cast = (slot: 0 | 1 | 2 | 3, x: number, y: number): Command => ({ t: 'cast', slot, x, y });
const hp = (sim: Sim, e: number): number => sim.c.Hp.cur[e]!;

describe('Vargrim data', () => {
  it('hook module exports every hook id', () => {
    expect(missingHooks('vargrim')).toEqual([]);
    expect(championData('vargrim').roles).toEqual(['jungle', 'top']);
  });
});

describe('Vargrim passive Hoofbeat', () => {
  it('bonus AD = 6 % of total move speed, extra speed adds AD that is gone again without it', () => {
    const { sim, m } = setup();
    const ad0 = sim.c.Stats.ad[m]!;
    addBuff(sim, m, { kind: 'stat', stat: 'ms', id: 't', src: m, flat: 100, ticks: 60 });
    step(sim);
    expect(sim.c.Stats.ad[m]! - ad0).toBeCloseTo(0.06 * (sim.c.Stats.ms[m]! - 345), 4);
    expect(sim.c.Stats.bonusAd[m]!).toBeGreaterThan(15);
    steps(sim, 70);
    expect(sim.c.Stats.ad[m]!).toBeCloseTo(ad0, 4);
  });
});

describe('Vargrim Q Lance Whirl', () => {
  it('hits everything within 350, refunds 0.6 s per enemy hit and stacks +15 % damage', () => {
    const { sim, m } = setup();
    const near = [spawnDummy(sim, CX + 200, CY, 1), spawnDummy(sim, CX - 250, CY + 100, 1)];
    const far = spawnDummy(sim, CX + 600, CY, 1);
    step(sim);
    const h1 = collect(sim, 30, m, cast(0, CX, CY));
    const first = h1.filter((h) => h.dst === near[0]);
    expect(first).toHaveLength(1);
    expect(h1.some((h) => h.dst === near[1])).toBe(true);
    expect(hp(sim, far)).toBe(1000);
    expect(vargrimStacks(sim, m)).toBe(1);
    // cooldown 5 s, minus 2 x 0.6 s refund
    expect(cooldownLeft(sim, m, 0)).toBeLessThan(sec(5 - 1.2 - 0.5));
    // second whirl (stack): 15 % more
    steps(sim, sec(2.85));
    const h2 = collect(sim, 30, m, cast(0, CX, CY)).filter((h) => h.dst === near[0]);
    expect(h2[0]!.amount / first[0]!.amount).toBeCloseTo(1.15, 2);
    expect(vargrimStacks(sim, m)).toBe(2);
  });
});

describe('Vargrim Q while riding', () => {
  it('casts on the move: no wind-up stop', () => {
    const { sim, m } = setup();
    cmd(sim, { t: 'move', x: CX + 1000, y: CY });
    steps(sim, 5);
    const x0 = sim.c.Pos.x[m]!;
    cmd(sim, cast(0, CX, CY));
    steps(sim, 9);
    expect(sim.c.Pos.x[m]! - x0).toBeGreaterThan(80); // ~345 u/s for 0.47 s, never stood still
  });
});

describe('Vargrim W Dread Mist', () => {
  it('ticks damage on enemies inside for 4 s and heals him for 25 % of it', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 300, CY, 1);
    const out = spawnDummy(sim, CX + 700, CY, 1);
    step(sim);
    sim.c.Hp.cur[m] = 300;
    const hits = collect(sim, 4 * 30 + 20, m, cast(1, CX, CY));
    const mine = hits.filter((h) => h.dst === d);
    expect(mine.length).toBe(8);
    expect(hp(sim, out)).toBe(1000);
    const dealt = mine.reduce((a, h) => a + h.amount, 0);
    const healed = hp(sim, m) - 300;
    expect(healed).toBeGreaterThan(dealt * 0.2);
    expect(healed).toBeLessThan(dealt * 0.3 + 5 * 8); // plus natural regen
    // mist visual while it lasts
    const s2 = setup();
    spawnDummy(s2.sim, CX + 300, CY, 1);
    cmd(s2.sim, cast(1, CX, CY));
    steps(s2.sim, 5);
    expect(buildSnapshot(s2.sim, 0, 0).objects.some((o) => o.tag === 'vargrim_w_mist')).toBe(true);
  });
});

describe('Vargrim E Storm Gallop', () => {
  it('move speed ramps to +40 % over 3 s; the next auto knocks back, harder after a longer ride', () => {
    const run = (ride: number) => {
      const { sim, m } = setup();
      const d = spawnDummy(sim, CX + 1300, CY, 1);
      step(sim);
      cmd(sim, cast(2, CX, CY));
      cmd(sim, { t: 'move', x: CX + 1300, y: CY });
      steps(sim, 3);
      const ms1 = sim.c.Stats.ms[m]!;
      steps(sim, ride);
      const ms3 = sim.c.Stats.ms[m]!;
      cmd(sim, { t: 'attack', target: d });
      const dmg: number[] = [];
      let x0 = 0;
      for (let i = 0; i < 90; i++) {
        step(sim);
        if (!x0 && hasBuff(sim, d, 'airborne')) x0 = sim.c.Pos.x[d]!;
        for (const e of sim.events) if (e.e === 'damage' && e.src === m && e.dst === d) dmg.push(e.amount);
      }
      return { ms1, ms3, dmg, d, sim, m };
    };
    const long = run(sec(2.7));
    expect(long.ms1).toBeLessThan(345 * 1.05);
    expect(long.ms3).toBeGreaterThan(345 * 1.3);
    expect(vargrimChargeDist(long.sim, long.m)).toBeGreaterThan(600);
    // knocked back (target ended further from the line than where the auto landed)
    expect(long.sim.c.Pos.x[long.d]!).toBeGreaterThan(CX + 1300 + 200);
    // second run: attack right after the cast, little distance travelled -> far less damage
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 200, CY, 1);
    step(sim);
    cmd(sim, cast(2, CX, CY));
    cmd(sim, { t: 'attack', target: d });
    const short: number[] = [];
    for (let i = 0; i < 60; i++) {
      step(sim);
      for (const e of sim.events) if (e.e === 'damage' && e.src === m && e.dst === d) short.push(e.amount);
    }
    expect(short.length).toBeGreaterThan(0);
    expect(Math.max(...long.dmg)).toBeGreaterThan(Math.max(...short) * 1.2); // passive now counts total MS, so the ride adds less on top
    expect(hasBuff(sim, m, 'stat', 'vargrim_e')).toBe(false); // ramp ends with the auto
  });

  it('rides after the knocked-back target and ends right behind it', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 200, CY, 1);
    step(sim);
    cmd(sim, cast(2, CX, CY));
    cmd(sim, { t: 'attack', target: d });
    let x0 = 0;
    for (let i = 0; i < 60; i++) {
      step(sim);
      if (!x0 && hasBuff(sim, d, 'airborne')) x0 = sim.c.Pos.x[m]!;
    }
    expect(x0).toBeGreaterThan(0);
    expect(sim.c.Pos.x[m]! - x0).toBeGreaterThan(200); // he moved with the knock-back
    expect(Math.abs(sim.c.Pos.x[d]! - sim.c.Pos.x[m]!)).toBeLessThan(450); // still on the target
  });
});

describe('Vargrim R Spectral Legion', () => {
  it('charges to the point, riders hit enemies on the way once, landing fears champions', () => {
    const { sim, m } = setup([1, 0, 0, 1]);
    const path = spawnDummy(sim, CX + 500, CY + 100, 1);
    const target = spawnDummy(sim, CX + 1000, CY, 1);
    const mid = spawnDummy(sim, CX + 1000, CY + 200, 1);
    step(sim);
    const hits = collect(sim, 60, m, cast(3, CX + 1000, CY));
    expect(sim.c.Pos.x[m]!).toBeGreaterThan(CX + 900);
    expect(hits.filter((h) => h.dst === path)).toHaveLength(1); // rider strike, once
    expect(hits.filter((h) => h.dst === target).length).toBeGreaterThanOrEqual(1);
    expect(hasBuff(sim, target, 'fear')).toBe(true);
    expect(hasBuff(sim, mid, 'fear')).toBe(true);
    expect(hasBuff(sim, path, 'fear')).toBe(false);
    // fear lasts about 1.25 s
    steps(sim, sec(1.6));
    expect(hasBuff(sim, target, 'fear')).toBe(false);
    expect(hp(sim, target)).toBeLessThan(1000);
    dealDamage(sim, m, target, 1, 'true');
  });

  it('shows riders in the snapshot during the charge', () => {
    const { sim } = setup([1, 0, 0, 1]);
    spawnDummy(sim, CX + 1000, CY, 1);
    cmd(sim, cast(3, CX + 1000, CY));
    let seen = 0;
    for (let i = 0; i < 40; i++) {
      step(sim);
      seen = Math.max(seen, buildSnapshot(sim, 0, 0).objects.filter((o) => o.tag === 'vargrim_rider').length);
    }
    expect(seen).toBe(3);
  });
});
