// combat-helpers first: it imports sim.ts before any system module (systems <-> sim import cycle).
import { CX, CY, NO_RUNES, place, steps } from './combat-helpers';
import { describe, expect, it } from 'vitest';
import { createSim, step } from '../src/sim/sim';
import { sec } from '../src/sim/types';
import { dealDamage } from '../src/sim/damage';
import { buffs } from '../src/sim/buffs';
import { inventory, quote } from '../src/sim/items/inventory';
import { runePageOf, wardDurationMult } from '../src/sim/items/runeHooks';
import { defaultRunes } from '../src/sim/items/runes';
import { abilityHit, autos, duel } from './itemHelpers';

const page = (keystone: string, ...minor: string[]): typeof NO_RUNES => ({
  keystone,
  minor: [minor[0] ?? 'none', minor[1] ?? 'none', minor[2] ?? 'none'],
});
const buffPct = (sim: ReturnType<typeof duel>['sim'], eid: number, id: string): number =>
  buffs(sim, eid).find((b) => b.id === id && b.until > sim.tick)?.pct ?? 0;

describe('rune pages', () => {
  it('missing PlayerSetup.runes uses the champion default preset', () => {
    const sim = createSim({ seed: 1, mode: 'sandbox', minionsEnabled: false, players: [{ slot: 0, team: 0, champion: 'mira', role: 'adc', summoners: ['sprung', 'heilen'], isHuman: true }] });
    step(sim);
    expect(runePageOf(sim, sim.slots[0]!)).toEqual(defaultRunes('mira'));
    // mira default: Präzision + 8 % AS minor
    const bare = duel();
    expect(sim.c.Stats.as[sim.slots[0]!]).toBeCloseTo(bare.sim.c.Stats.as[bare.me]! * 1.08, 6);
  });

  it('stat minors are permanent stats; adaptive picks AD or AP (+9 AD / +15 AP)', () => {
    const base = duel();
    const r = duel({ runes: page('none', 'adaptiv', 'ruestung', 'lebenskraft') });
    const { Stats, Hp } = r.sim.c;
    expect(Stats.ad[r.me]! - base.sim.c.Stats.ad[base.me]!).toBeCloseTo(9, 6); // marksman, no items: AD
    expect(Stats.armor[r.me]! - base.sim.c.Stats.armor[base.me]!).toBeCloseTo(6, 6);
    expect(Hp.max[r.me]! - base.sim.c.Hp.max[base.me]!).toBeCloseTo(65, 6);
    const ap = duel({ runes: page('none', 'adaptiv'), items: ['verstaerkerbuch'] });
    expect(ap.sim.c.Stats.ap[ap.me]).toBeCloseTo(20 + 15, 6);
    const hast = duel({ runes: page('none', 'hast', 'blutdurst', 'schnellfuss') });
    expect(hast.sim.c.Stats.haste[hast.me]! - base.sim.c.Stats.haste[base.me]!).toBeCloseTo(8, 6);
    expect(hast.sim.c.Stats.lifesteal[hast.me]! - base.sim.c.Stats.lifesteal[base.me]!).toBeCloseTo(0.04, 6);
    expect(hast.sim.c.Stats.ms[hast.me]).toBeGreaterThan(base.sim.c.Stats.ms[base.me]!);
  });
});

describe('keystones', () => {
  it('Dauerhafter Schaden: 3 separate hits within 3 s add bonus damage, then 25 s cooldown', () => {
    const { sim, me, foe } = duel({ runes: page('dauerhafter_schaden') });
    const n = abilityHit(sim, me, foe).length;
    steps(sim, 10);
    expect(abilityHit(sim, me, foe).length).toBe(n);
    steps(sim, 10);
    const third = abilityHit(sim, me, foe);
    expect(third.length).toBe(n + 1);
    expect(third[third.length - 1]!.type).toBe('phys'); // adaptive: marksman without items
    for (let i = 0; i < 3; i++) {
      steps(sim, 10);
      expect(abilityHit(sim, me, foe).length).toBe(n); // cooldown
    }
  });

  it('Dauerhafter Schaden: hits spread over more than 3 s do not proc', () => {
    const { sim, me, foe } = duel({ runes: page('dauerhafter_schaden') });
    const n = abilityHit(sim, me, foe).length;
    steps(sim, sec(1.6));
    abilityHit(sim, me, foe);
    steps(sim, sec(1.6));
    expect(abilityHit(sim, me, foe).length).toBe(n);
  });

  it('Präzision: autos on champions stack +8 % AS (max 6, 6 s)', () => {
    const { sim, me, foe } = duel({ runes: page('praezision') });
    autos(sim, me, foe, 2);
    expect(buffPct(sim, me, 'praezision')).toBe(16);
    autos(sim, me, foe, 6);
    expect(buffPct(sim, me, 'praezision')).toBe(48);
    step(sim, [{ slot: 0, cmd: { t: 'stop' } }]);
    steps(sim, sec(6) + 1);
    expect(buffPct(sim, me, 'praezision')).toBe(0);
  });

  it('Zähigkeit: after 4 s in combat the next auto on a champion heals 2 % and deals 3 % max HP', () => {
    const { sim, me, foe } = duel({ runes: page('zaehigkeit') });
    const ev = autos(sim, me, foe, 5);
    const first = ev.find((e) => e.type === 'phys')!.tick;
    const procs = ev.filter((e) => e.type === 'magic');
    expect(procs.length).toBe(1);
    expect(procs[0]!.tick - first).toBeGreaterThanOrEqual(sec(4) - 1);
    const maxHp = sim.c.Hp.max[me]!;
    const mit = 100 / (100 + sim.c.Stats.mr[foe]!);
    expect(procs[0]!.amount).toBeCloseTo(maxHp * 0.03 * mit, 3);
  });

  it('Inspiration: boots -10 % before 12:00, free boots at 12:00, +10 haste', () => {
    const base = duel();
    const { sim, me } = duel({ runes: page('inspiration') });
    expect(sim.c.Stats.haste[me]! - base.sim.c.Stats.haste[base.me]!).toBeCloseTo(10, 6);
    const f = sim.map.sides[0].fountain;
    place(sim, me, f.x, f.y);
    expect(quote(sim, me, 'stiefel_schnelligkeit').price).toBe(990);
    expect(quote(base.sim, base.me, 'stiefel_schnelligkeit').price).toBe(1100);
    sim.tick = sec(12 * 60) - 5;
    steps(sim, 40);
    expect(inventory(sim, me)).toContain('stiefel_hast');
    expect(quote(sim, me, 'stiefel_schnelligkeit').price).toBe(1100);
  });
});

describe('hook minors', () => {
  it('Mana-Flow: champion ability hits add +25 max mana (6 s apart, max 250)', () => {
    const { sim, me, foe } = duel({ runes: page('none', 'manafluss') });
    const m0 = sim.c.Mana.max[me]!;
    abilityHit(sim, me, foe);
    abilityHit(sim, me, foe);
    step(sim);
    expect(sim.c.Mana.max[me]! - m0).toBeCloseTo(25, 6);
    for (let i = 0; i < 12; i++) {
      steps(sim, sec(6));
      abilityHit(sim, me, foe);
    }
    step(sim);
    expect(sim.c.Mana.max[me]! - m0).toBeCloseTo(250, 6);
  });

  it('Zweiter Wind: champion damage regenerates 6 % missing HP over 10 s', () => {
    const run = (runes: typeof NO_RUNES): number => {
      const { sim, me, foe } = duel({ runes });
      dealDamage(sim, foe, me, 200, 'true');
      steps(sim, sec(10) + 2);
      return sim.c.Hp.cur[me]!;
    };
    expect(run(page('none', 'zweiter_wind')) - run(NO_RUNES)).toBeCloseTo(12, 3);
  });

  it('Gnadenstoß: +8 % damage to champions below 40 % HP', () => {
    const { sim, me, foe } = duel({ runes: page('none', 'gnadenstoss') });
    expect(dealDamage(sim, me, foe, 100, 'true')).toBeCloseTo(100);
    sim.c.Hp.cur[foe] = sim.c.Hp.max[foe]! * 0.3;
    expect(dealDamage(sim, me, foe, 100, 'true')).toBeCloseTo(108);
  });

  it('Wachsamkeit: +5 haste, wards last 10 % longer', () => {
    const base = duel();
    const { sim, me } = duel({ runes: page('none', 'wachsamkeit') });
    expect(sim.c.Stats.haste[me]! - base.sim.c.Stats.haste[base.me]!).toBeCloseTo(5, 6);
    expect(wardDurationMult(sim, me)).toBe(1.1);
    expect(wardDurationMult(base.sim, base.me)).toBe(1);
  });
});

describe('determinism with items + runes', () => {
  it('same inputs -> same state hash', async () => {
    const { stateHash } = await import('../src/sim/sim');
    const run = (): string => {
      const { sim, me, foe } = duel({ runes: page('dauerhafter_schaden', 'manafluss', 'zweiter_wind', 'adaptiv'), items: ['brandglas', 'funkenkelch', 'sturmgewand', 'trank'] });
      place(sim, foe, CX + 300, CY);
      autos(sim, me, foe, 3);
      for (let i = 0; i < 5; i++) (abilityHit(sim, me, foe), steps(sim, 20));
      step(sim, [{ slot: 0, cmd: { t: 'item', slot: 3 } }]);
      steps(sim, 200);
      return stateHash(sim);
    };
    expect(run()).toBe(run());
  });
});
