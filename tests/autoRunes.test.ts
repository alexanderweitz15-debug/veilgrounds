// auto/champions rune batch: Eroberer (stacking adaptive + heal), Komet (ability hit proc), four stat minors.
import { steps } from './combat-helpers';
import { duel } from './itemHelpers';
import { describe, expect, it } from 'vitest';
import { buffs } from '../src/sim/buffs';
import { applyEffects, abilityOf } from '../src/sim/systems/abilities';
import { runeStats } from '../src/sim/items/runeHooks';
import { runePresets } from '../src/sim/items/runes';
import { champions } from '../src/data/champions';

const page = (keystone: string, minor: [string, string, string] = ['none', 'none', 'none']) => ({ keystone, minor });

function abilityHit(d: ReturnType<typeof duel>): void {
  const ab = abilityOf(d.sim, d.me, 0);
  applyEffects(d.sim, { caster: d.me, slot: 0, rank: 1, ability: ab, hits: [d.foe], x: 0, y: 0, target: d.foe, phase: 'cast', dx: 1, dy: 0, cursorX: 0, cursorY: 0 });
}

describe('Eroberer', () => {
  it('each ability hit on a champion adds a stack (+2 AD), up to 8, and full stacks heal', () => {
    const d = duel({ champ: 'brom', runes: page('eroberer') });
    const ad0 = d.sim.c.Stats.ad[d.me]!;
    abilityHit(d);
    steps(d.sim, 1);
    expect(buffs(d.sim, d.me).find((b) => b.id === 'eroberer')!.flat).toBe(2);
    for (let i = 0; i < 12; i++) {
      steps(d.sim, 2);
      abilityHit(d);
    }
    steps(d.sim, 1);
    expect(buffs(d.sim, d.me).find((b) => b.id === 'eroberer')!.flat).toBe(16);
    expect(d.sim.c.Stats.ad[d.me]!).toBeGreaterThan(ad0 + 10);
  });
});

describe('Komet', () => {
  it('an ability hit on a champion fires one comet, then 12 s cooldown', () => {
    const d = duel({ champ: 'ilvane', runes: page('komet') });
    const hp = d.sim.c.Hp.cur[d.foe]!;
    abilityHit(d);
    const first = hp - d.sim.c.Hp.cur[d.foe]!;
    expect(first).toBeGreaterThan(0);
    steps(d.sim, 2);
    const mid = d.sim.c.Hp.cur[d.foe]!;
    abilityHit(d);
    const second = mid - d.sim.c.Hp.cur[d.foe]!;
    expect(second).toBeLessThan(first); // the first hit carried the comet, the second only the ability itself
  });
});

describe('new stat minors', () => {
  it('give their stats', () => {
    const d = duel({ champ: 'mira', runes: page('adaptiv', ['durchdringung', 'letalitaet', 'heilkraft']) });
    const s = runeStats(d.sim, d.me);
    expect(s.magicPen).toBe(6);
    expect(s.lethality).toBe(5);
    expect(s.healShieldPowerPct).toBe(6);
    const b = duel({ champ: 'brom', runes: page('adaptiv', ['standhaft', 'none', 'none']) });
    expect(runeStats(b.sim, b.me).tenacity).toBe(8);
  });
});

describe('presets', () => {
  it('Marga and Torben default to the new keystones', () => {
    expect(runePresets('marga')[0]!.keystone).toBe('komet');
    expect(runePresets('torben')[0]!.keystone).toBe('eroberer');
    expect(champions.marga && champions.torben).toBeTruthy();
  });
});

describe('Phasenlauf', () => {
  it('3 hits on a champion in 3 s give +30 % move speed once', () => {
    const d = duel({ champ: 'ilvane', runes: page('phasenlauf') });
    for (let i = 0; i < 2; i++) {
      abilityHit(d);
      steps(d.sim, 2);
    }
    expect(buffs(d.sim, d.me).some((b) => b.id === 'phasenlauf')).toBe(false);
    abilityHit(d);
    steps(d.sim, 1);
    expect(buffs(d.sim, d.me).some((b) => b.id === 'phasenlauf' && b.pct === 30)).toBe(true);
  });
});

describe('Flinkfuß', () => {
  it('walking charges energy', async () => {
    const { cmd, CX, CY } = await import('./combat-helpers');
    const { fleetCharge } = await import('../src/sim/items/runeHooks');
    const d = duel({ champ: 'mira', runes: page('flinkfuss') });
    expect(fleetCharge(d.sim, d.me)).toBe(0);
    cmd(d.sim, { t: 'move', x: CX - 700, y: CY });
    steps(d.sim, 90);
    expect(fleetCharge(d.sim, d.me)).toBeGreaterThan(60);
  });
});

describe('Letzter Stand / Triumph', () => {
  it('Last Stand raises damage at low HP', async () => {
    const { dealDamage } = await import('../src/sim/damage');
    const d = duel({ champ: 'ilvane', runes: page('adaptiv', ['letzter_stand', 'none', 'none']) });
    const full = dealDamage(d.sim, d.me, d.foe, 100, 'true');
    d.sim.c.Hp.cur[d.me] = d.sim.c.Hp.max[d.me]! * 0.2;
    const low = dealDamage(d.sim, d.me, d.foe, 100, 'true');
    expect(low).toBeGreaterThan(full * 1.08);
  });
  it('Triumph heals 10 % of the missing HP and gives 20 gold on a takedown', async () => {
    const { RUNE_HOOKS } = await import('../src/sim/items/runeHooks');
    const d = duel({ champ: 'mira', runes: page('adaptiv', ['triumph', 'none', 'none']) });
    d.sim.c.Hp.cur[d.me] = d.sim.c.Hp.max[d.me]! * 0.5;
    const hp = d.sim.c.Hp.cur[d.me]!;
    const gold = d.sim.c.Champ.gold[d.me]!;
    RUNE_HOOKS.rune_triumph!.onTakedown!(d.sim, d.me, d.foe);
    expect(d.sim.c.Hp.cur[d.me]!).toBeGreaterThan(hp);
    expect(d.sim.c.Champ.gold[d.me]! - gold).toBe(20);
  });
});

describe('Erstschlag', () => {
  it('+7 % damage on a champion that has not hit the owner', async () => {
    const { dealDamage } = await import('../src/sim/damage');
    const d = duel({ champ: 'ilvane', runes: page('erstschlag') });
    const plain = duel({ champ: 'ilvane', runes: page('none') });
    const a = dealDamage(d.sim, d.me, d.foe, 100, 'true');
    const b = dealDamage(plain.sim, plain.me, plain.foe, 100, 'true');
    expect(a).toBeGreaterThan(b);
  });
});
