// combat-helpers first: it imports sim.ts before any system module (systems <-> sim import cycle).
import { CX, CY, place, steps } from './combat-helpers';
import { describe, expect, it } from 'vitest';
import { step, type Sim } from '../src/sim/sim';
import { Kind, sec, type Command } from '../src/sim/types';
import { dealDamage, kill } from '../src/sim/damage';
import { buffs, hasBuff } from '../src/sim/buffs';
import { MINION_STATS, spawnMinion } from '../src/sim/systems/minions';
import { passiveHooksOf } from '../src/sim/champions';
import { inventory } from '../src/sim/items/inventory';
import { HUNTER_FANG, givingLampQuestDone, minionGoldMult, stormMantleLeft } from '../src/sim/items/itemHooks';
import { buildSnapshot } from '../src/sim/snapshot';
import { abilityHit, autos, duel } from './itemHelpers';

const use = (sim: Sim, slot: number): void => step(sim, [{ slot: 0, cmd: { t: 'item', slot } as Command }]);
const buff = (sim: Sim, eid: number, id: string) => buffs(sim, eid).find((b) => b.id === id && b.until > sim.tick);

describe('legendary item passives', () => {
  it('Sturmbogen: crits slow the target (30 %, 1 s)', () => {
    const { sim, me, foe } = duel({ items: ['sturmbogen'] });
    sim.c.Stats.crit[me] = 1; // crit is delta-applied, so the write persists
    const ev = autos(sim, me, foe, 1);
    expect(ev.find((e) => e.type === 'phys')?.crit).toBe(true);
    expect(hasBuff(sim, foe, 'slow', 'stormbow')).toBe(true);
    expect(buff(sim, foe, 'stormbow')!.pct).toBe(30);
  });

  it('Blutkrone: lifesteal beyond full HP becomes a shield', () => {
    const { sim, me, foe } = duel({ items: ['blutkrone'] });
    expect(sim.c.Hp.cur[me]).toBe(sim.c.Hp.max[me]);
    const hit = autos(sim, me, foe, 1).find((e) => e.type === 'phys')!;
    const sh = buff(sim, me, 'blood_crown');
    expect(sh).toBeDefined();
    expect(sh!.amount).toBeCloseTo(hit.amount * 0.12, 3);
    expect(sim.c.Hp.shield[me]).toBeGreaterThan(0);
  });

  it('Scharfrichterbeil: +15 % damage to targets below 40 % HP', () => {
    const { sim, me, foe } = duel({ items: ['scharfrichterbeil'] });
    expect(dealDamage(sim, me, foe, 100, 'true')).toBeCloseTo(100);
    sim.c.Hp.cur[foe] = sim.c.Hp.max[foe]! * 0.3;
    expect(dealDamage(sim, me, foe, 100, 'true')).toBeCloseTo(115);
  });

  it('Schwarze Kette: hits stack -6 % armor up to 5 times', () => {
    const { sim, me, foe } = duel({ items: ['schwarze_kette'] });
    const armor0 = sim.c.Stats.armor[foe]!;
    autos(sim, me, foe, 2);
    expect(buff(sim, foe, 'black_chain')!.pct).toBe(-12);
    for (let i = 0; i < 6; i++) abilityHit(sim, me, foe);
    expect(buff(sim, foe, 'black_chain')!.pct).toBe(-30);
    step(sim);
    expect(sim.c.Stats.armor[foe]).toBeCloseTo(armor0 * 0.7, 5);
  });

  it('Schleierstab: +35 % AP multiplicative', () => {
    const { sim, me } = duel({ items: ['schleierstab'] });
    expect(sim.c.Stats.ap[me]).toBeCloseTo(120 * 1.35, 5);
    inventory(sim, me)[1] = 'grosser_stab';
    step(sim);
    expect(sim.c.Stats.ap[me]).toBeCloseTo((120 + 65) * 1.35, 5);
  });

  it('Frostkern: ability hits slow 25 %', () => {
    const { sim, me, foe } = duel({ items: ['frostkern'] });
    abilityHit(sim, me, foe);
    expect(buff(sim, foe, 'frost_core')?.pct).toBe(25);
    autos(sim, me, foe, 1);
    steps(sim, 31);
    expect(hasBuff(sim, foe, 'slow', 'frost_core')).toBe(false); // autos do not slow
  });

  it('Brandglas: ability hits burn for 3 s (3 magic ticks)', () => {
    const { sim, me, foe } = duel({ items: ['brandglas'] });
    abilityHit(sim, me, foe);
    expect(hasBuff(sim, foe, 'dot', 'burning_glass')).toBe(true);
    let ticks = 0;
    for (let i = 0; i < sec(4); i++) {
      step(sim);
      ticks += sim.events.filter((e) => e.e === 'damage' && e.src === me && e.dst === foe && e.type === 'magic').length;
    }
    expect(ticks).toBe(3);
  });

  it('Funkenkelch: next ability hit deals bonus lightning damage, every 1.5 s', () => {
    const { sim, me, foe } = duel({ items: ['funkenkelch'] });
    const first = abilityHit(sim, me, foe).length;
    const second = abilityHit(sim, me, foe).length;
    expect(first).toBe(second + 1);
    steps(sim, sec(1.5));
    expect(abilityHit(sim, me, foe).length).toBe(first);
  });

  it('Wallherz: nearby enemies -10 % attack speed', () => {
    const { sim, me, foe } = duel();
    const as0 = sim.c.Stats.as[foe]!;
    inventory(sim, me)[0] = 'wallherz';
    steps(sim, 12);
    expect(buff(sim, foe, 'rampart_heart')?.pct).toBe(-10);
    expect(sim.c.Stats.as[foe]).toBeLessThan(as0);
    place(sim, foe, CX + 1200, CY);
    steps(sim, 30);
    expect(buff(sim, foe, 'rampart_heart')).toBeUndefined();
  });

  it('Sturmgewand: absorbs magic damage, recharges 40 s later', () => {
    const { sim, me, foe } = duel({ items: ['sturmgewand'] });
    const { Hp } = sim.c;
    const full = stormMantleLeft(sim, me);
    expect(full).toBe(180 + 12);
    const hp = Hp.cur[me]!;
    const dealt = dealDamage(sim, foe, me, 100, 'magic');
    expect(Hp.cur[me]).toBeCloseTo(hp, 5);
    expect(stormMantleLeft(sim, me)).toBeCloseTo(full - dealt, 5);
    dealDamage(sim, foe, me, 100, 'phys'); // physical damage is not absorbed
    expect(Hp.cur[me]).toBeLessThan(hp);
    const before = Hp.cur[me]!;
    const big = dealDamage(sim, foe, me, 1000, 'magic');
    expect(Hp.cur[me]).toBeCloseTo(before - (big - (full - dealt)), 5);
    expect(stormMantleLeft(sim, me)).toBeCloseTo(0, 5);
    steps(sim, sec(40) + 2);
    expect(stormMantleLeft(sim, me)).toBe(full);
  });

  it('Lebenswurzel: heals 1.5 % max HP per 5 s while in combat', () => {
    const gain = (items: string[], combat: boolean): { gain: number; max: number } => {
      const { sim, me, foe } = duel({ items });
      sim.c.Hp.cur[me] = 400;
      if (combat) dealDamage(sim, foe, me, 1, 'true');
      const h0 = sim.c.Hp.cur[me]!;
      steps(sim, 30);
      return { gain: sim.c.Hp.cur[me]! - h0, max: sim.c.Hp.max[me]! };
    };
    const a = gain(['lebenswurzel'], true);
    const b = gain([], true);
    expect(a.gain - b.gain).toBeCloseTo(a.max * 0.003, 3);
    expect(gain(['lebenswurzel'], false).gain).toBeCloseTo(gain([], false).gain, 5);
  });

  it('Hüterstab +12 % and Hüterlampe +8 % heal/shield power', () => {
    const power = (items: string[]): number => {
      const { sim, me } = duel({ items });
      let a = 100;
      for (const h of passiveHooksOf(sim, me)) if (h.modifyHeal) a = h.modifyHeal(sim, me, me, a);
      return a;
    };
    expect(power([])).toBe(100);
    expect(power(['hueterstab'])).toBeCloseTo(112);
    expect(power(['hueterlampe'])).toBeCloseTo(108);
  });
});

describe('starter item passives', () => {
  it('Zauberring: last hits restore 6 mana', () => {
    const { sim, me } = duel({ items: ['zauberring'] });
    sim.c.Mana.cur[me] = 100;
    const m = spawnMinion(sim, Kind.MinionMelee, 1, 0, CX + 200, CY);
    kill(sim, m, me);
    expect(sim.c.Mana.cur[me]).toBe(106);
  });

  it('Dornenklinge: melee hits on champions heal 3 HP', () => {
    const { sim, me, foe } = duel({ champ: 'gorvam', items: ['dornenklinge'] });
    const { Hp } = sim.c;
    place(sim, foe, CX + 150, CY);
    Hp.cur[me] = 300;
    step(sim, [{ slot: 0, cmd: { t: 'attack', target: foe } }]);
    for (let i = 0; i < 120; i++) {
      const h = Hp.cur[me]!;
      step(sim);
      if (sim.events.some((e) => e.e === 'damage' && e.src === me && e.dst === foe)) {
        expect(Hp.cur[me]! - h).toBeCloseTo(3 + Hp.regen[me]! / 30, 5);
        return;
      }
    }
    throw new Error('no hit');
  });

  it('Jägerzahn: +80 % vs monsters (+ companion true damage and heal on autos), 50 % lane-minion gold until 14:00', () => {
    const { sim, me } = duel({ items: ['jaegerzahn'] });
    const { Hp } = sim.c;
    const mon = spawnMinion(sim, Kind.MinionMelee, 2, 0, CX + 200, CY);
    sim.c.Unit.kind[mon] = Kind.Monster;
    Hp.max[mon] = Hp.cur[mon] = 2000;
    expect(dealDamage(sim, me, mon, 100, 'true')).toBeCloseTo(100 * HUNTER_FANG.monsterMult);
    const m = spawnMinion(sim, Kind.MinionMelee, 1, 0, CX + 200, CY);
    const g = sim.c.Champ.gold[me]!;
    kill(sim, m, me);
    expect(sim.c.Champ.gold[me]! - g).toBeCloseTo(MINION_STATS[Kind.MinionMelee]!.gold * 0.5);
    expect(minionGoldMult(sim, me)).toBe(0.5);
    sim.tick = sec(14 * 60);
    expect(minionGoldMult(sim, me)).toBe(1);
  });

  it('Spenderlampe: 3 charges of 15 gold for me and the nearest ally; quest at 500 gold', () => {
    const { sim, me, foe, allies } = duel({ items: ['spenderlampe'], allies: [300] });
    const { Champ } = sim.c;
    const g0 = Champ.gold[me]!;
    const a0 = Champ.gold[allies[0]!]!;
    autos(sim, me, foe, 4); // 4 hits ~1.5 s apart: 3 charges, no regen yet (10 s)
    expect(Champ.gold[me]! - g0).toBe(45);
    expect(Champ.gold[allies[0]!]! - a0).toBe(45);
    expect(givingLampQuestDone(sim, me)).toBe(false);
    for (let i = 0; i < 34; i++) {
      steps(sim, sec(10));
      abilityHit(sim, me, foe);
      sim.c.Hp.cur[foe] = sim.c.Hp.max[foe]!;
    }
    expect(givingLampQuestDone(sim, me)).toBe(true);
  }, 60_000);
});

describe('item actives + consumables', () => {
  it('Zeitglas: 2.5 s stasis via the item command, 120 s cooldown in the HUD', () => {
    const { sim, me, foe } = duel({ items: ['zeitglas'] });
    use(sim, 0);
    expect(hasBuff(sim, me, 'stasis', 'zeitglas')).toBe(true);
    expect(sim.c.Unit.invulnerable[me]).toBe(1);
    expect(dealDamage(sim, foe, me, 500, 'true')).toBe(0);
    const hud = buildSnapshot(sim, 0, 0).me!;
    expect(hud.itemCds[0]!.total).toBe(120);
    expect(hud.itemCds[0]!.left).toBeGreaterThan(119);
    steps(sim, sec(2.5));
    expect(sim.c.Unit.invulnerable[me]).toBe(0);
    use(sim, 0); // still on cooldown
    expect(hasBuff(sim, me, 'stasis')).toBe(false);
    steps(sim, sec(118));
    use(sim, 0);
    expect(hasBuff(sim, me, 'stasis', 'zeitglas')).toBe(true);
  });

  it('Kettenrelais: shields allies within 500 (90 at level 1), not beyond', () => {
    const { sim, me, allies } = duel({ items: ['kettenrelais'], allies: [300, 800] });
    use(sim, 0);
    expect(buff(sim, me, 'kettenrelais')?.amount).toBeCloseTo(90);
    expect(buff(sim, allies[0]!, 'kettenrelais')?.amount).toBeCloseTo(90);
    expect(buff(sim, allies[1]!, 'kettenrelais')).toBeUndefined();
    expect(buildSnapshot(sim, 0, 0).me!.itemCds[0]!.total).toBe(90);
  });

  it('Trank: consumed on use, heals 120 over 15 s', () => {
    const run = (drink: boolean): { sim: Sim; me: number } => {
      const d = duel({ items: ['trank', 'trank'] });
      d.sim.c.Hp.cur[d.me] = 200;
      if (drink) use(d.sim, 0);
      else step(d.sim);
      return d;
    };
    const a = run(true);
    const b = run(false);
    expect(inventory(a.sim, a.me).slice(0, 2)).toEqual([null, 'trank']);
    steps(a.sim, sec(7.5));
    steps(b.sim, sec(7.5));
    expect(a.sim.c.Hp.cur[a.me]! - b.sim.c.Hp.cur[b.me]!).toBeCloseTo(60, 0);
    steps(a.sim, sec(10));
    steps(b.sim, sec(10));
    expect(a.sim.c.Hp.cur[a.me]! - b.sim.c.Hp.cur[b.me]!).toBeCloseTo(120, 3);
  });

  it('items without an active do nothing on use', () => {
    const { sim, me } = duel({ items: ['langschwert'] });
    use(sim, 0);
    expect(inventory(sim, me)[0]).toBe('langschwert');
  });
});
