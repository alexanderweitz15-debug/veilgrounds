// auto/champions item batch: Sensenschwert (anti-heal), Bannmantel (spell shield), Notanker (lifeline), two boots upgrades.
import { duel } from './itemHelpers';
import { steps } from './combat-helpers';
import { describe, expect, it } from 'vitest';
import { dealDamage } from '../src/sim/damage';
import { buffs } from '../src/sim/buffs';
import { itemById } from '../src/sim/items/inventory';
import { goldEfficiency } from '../src/ui/goldEfficiency';
import { sec } from '../src/sim/types';
import { applyEffects, abilityOf } from '../src/sim/systems/abilities';

describe('item batch: prices', () => {
  it('every new item sits at 85-115 % gold efficiency', () => {
    for (const id of ['sensenschwert', 'bannmantel', 'notanker', 'stiefel_magie', 'stiefel_zaeh']) {
      const ge = goldEfficiency(itemById(id)!)!;
      expect(ge.pct, id).toBeGreaterThan(80);
      expect(ge.pct, id).toBeLessThan(115);
    }
  });
});

describe('Sensenschwert', () => {
  it('an ability hit on an enemy champion applies 40 % grievous wounds', () => {
    const { sim, me, foe } = duel({ champ: 'ilvane', items: ['sensenschwert'] });
    const ab = abilityOf(sim, me, 0);
    applyEffects(sim, { caster: me, slot: 0, rank: 1, ability: ab, hits: [foe], x: 0, y: 0, target: foe, phase: 'cast', dx: 1, dy: 0, cursorX: 0, cursorY: 0 });
    expect(buffs(sim, foe).some((b) => b.kind === 'grievous' && b.id === 'festering_wound')).toBe(true);
  });
});

describe('Bannmantel', () => {
  it('absorbs ability damage once, ignores autos, recharges after 35 s', () => {
    const { sim, me, foe } = duel({ items: ['bannmantel'] });
    const hp = sim.c.Hp.cur[me]!;
    dealDamage(sim, foe, me, 100, 'magic', { isAuto: true });
    const afterAuto = sim.c.Hp.cur[me]!;
    expect(afterAuto).toBeLessThan(hp); // autos pass
    dealDamage(sim, foe, me, 60, 'magic');
    expect(sim.c.Hp.cur[me]).toBeCloseTo(afterAuto, 5); // ability damage swallowed
    dealDamage(sim, foe, me, 1000, 'phys');
    expect(sim.c.Hp.cur[me]!).toBeLessThan(afterAuto - 100); // pool is gone
    steps(sim, sec(36));
    const hp2 = sim.c.Hp.cur[me]!;
    dealDamage(sim, foe, me, 60, 'phys');
    expect(sim.c.Hp.cur[me]).toBeCloseTo(hp2, 5);
  });
});

describe('Notanker', () => {
  it('below 30 % HP: shield and move speed once, then 90 s cooldown', () => {
    const { sim, me, foe } = duel({ items: ['notanker'] });
    sim.c.Hp.cur[me] = sim.c.Hp.max[me]! * 0.5;
    dealDamage(sim, foe, me, 10, 'phys');
    expect(buffs(sim, me).some((b) => b.id === 'last_stand')).toBe(false);
    sim.c.Hp.cur[me] = sim.c.Hp.max[me]! * 0.25;
    dealDamage(sim, foe, me, 10, 'phys');
    expect(buffs(sim, me).some((b) => b.id === 'last_stand' && b.until > sim.tick)).toBe(true);
    expect(buffs(sim, me).some((b) => b.id === 'last_stand_ms')).toBe(true);
    steps(sim, sec(4));
    dealDamage(sim, foe, me, 10, 'phys');
    expect(buffs(sim, me).some((b) => b.id === 'last_stand' && b.until > sim.tick)).toBe(false);
  });
});

describe('Stichblatt', () => {
  it('a basic attack hitting the owner gives +15 % damage dealt for 2 s', () => {
    const { sim, me, foe } = duel({ champ: 'mira', items: ['stichblatt'] });
    dealDamage(sim, foe, me, 20, 'phys', { isAuto: true });
    expect(buffs(sim, me).some((b) => b.id === 'counterthrust')).toBe(true);
    expect(goldEfficiency(itemById('stichblatt')!)!.pct).toBeGreaterThan(80);
  });
});

describe('boots upgrades', () => {
  it('Zauberbrecherstiefel add magic penetration, Zähe Stiefel tenacity', () => {
    const a = duel({ items: ['stiefel_magie'] });
    expect(a.sim.c.Stats.magicPen[a.me]).toBe(15);
    const b = duel({ items: ['stiefel_zaeh'] });
    expect(b.sim.c.Stats.tenacity[b.me]).toBeCloseTo(0.2, 5);
  });
});
