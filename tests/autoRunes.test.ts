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
