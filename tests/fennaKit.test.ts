// Fenna sprite kit + Duskband (item): every champion has a sprite kit (no stand-in warning in the renderer),
// Fenna's kit has the moth look, the item's Bond Spark follows the heal/shield flow.
// combat-helpers first: it imports sim.ts before any system module (systems <-> sim import cycle).
import { CX, CY, cmd, steps } from './combat-helpers';
import { describe, expect, it, vi } from 'vitest';

// the kit registry module builds a Path2D at load time (browser only)
vi.hoisted(() => {
  (globalThis as { Path2D?: unknown }).Path2D ??= class { rect(): void {} };
});
import { champions } from '../src/data/champions';
import { CHAMPION_IDS, championKit, framesOf, worldSizeOf } from '../src/render/champions';
import { buffs } from '../src/sim/buffs';
import { passiveHooksOf } from '../src/sim/champions';
import { levelAbility } from '../src/sim/systems/abilities';
import { BAND } from '../src/sim/items/itemHooks';
import { itemById } from '../src/sim/items/inventory';
import { goldEfficiency } from '../src/ui/goldEfficiency';
import { duel } from './itemHelpers';

describe('sprite kits', () => {
  it('every champion in the data has a sprite kit (no stand-in drawn in a match)', () => {
    for (const id of Object.keys(champions)) {
      expect([id, championKit(id) !== undefined]).toEqual([id, true]);
      expect([id, CHAMPION_IDS.includes(id)]).toEqual([id, true]);
    }
  });

  it('Fenna has her own kit: moth wings, antennae, flame and thread props, all five animations', () => {
    const k = championKit('fenna')!;
    expect(k.name).toBe('Fenna Staubflügel');
    expect(k.props.length).toBe(4);
    expect(k.look).toContain('wings');
    expect(k.feature).toContain('wing');
    for (const a of ['idle', 'run', 'attack', 'cast', 'death'] as const) expect(framesOf('fenna', a)).toBeGreaterThan(0);
    expect(worldSizeOf('fenna')).toBeGreaterThan(150);
    expect(championKit('mira')!.look).not.toBe(k.look);
  });
});

describe('Duskband', () => {
  it('is a priced support item in the shop and in Fenna\'s build', () => {
    const it = itemById('daemmerband')!;
    expect(it.passive?.hook).toBe('dusk_band');
    const ge = goldEfficiency(it)!;
    expect(ge.pct).toBeGreaterThan(85);
    expect(ge.pct).toBeLessThan(115);
  });

  it('Bond Spark: a shield on an ally gives +12 % move speed once per ally every 6 s; no spark on self', () => {
    const { sim, me, allies } = duel({ champ: 'fenna', allies: [300], items: ['daemmerband'] });
    sim.c.Champ.level[me] = 5;
    sim.c.Champ.skillPoints[me] = 5;
    levelAbility(sim, me, 1);
    const ally = allies[0]!;
    cmd(sim, { t: 'cast', slot: 1, x: CX - 300, y: CY, target: ally });
    steps(sim, 8);
    const spark = () => buffs(sim, ally).find((b) => b.id === 'dusk_band' && b.until > sim.tick);
    expect(spark()?.pct).toBe(BAND.pct);
    const until = spark()!.until;
    // second shield right away: internal cooldown, the spark is not refreshed
    steps(sim, 20);
    for (const h of passiveHooksOf(sim, me)) h.modifyHeal?.(sim, me, ally, 100);
    expect(spark()?.until ?? until).toBe(until);
    for (const h of passiveHooksOf(sim, me)) h.modifyHeal?.(sim, me, me, 100);
    expect(buffs(sim, me).some((b) => b.id === 'dusk_band')).toBe(false);
  });
});
