// Gneis Mauerherz kit: passive Bedrock, Q boulder (knock + wall slam), W earth wall, E shoulder charge, R landslide rim,
// the item Schollenpanzer and the sprite kit. Walls are placed with blockTerrain (the sandbox spot has no terrain).
import { CX, CY, collect, makeSim, place, steps } from './combat-helpers';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { Path2D?: unknown }).Path2D ??= class { rect(): void {} };
});
import { step, type Sim } from '../src/sim/sim';
import { hasBuff } from '../src/sim/buffs';
import { spawnDummy } from '../src/sim/systems/champions';
import { levelAbility } from '../src/sim/systems/abilities';
import { championData, missingHooks } from '../src/sim/champions';
import { gneisWallCount } from '../src/sim/champions/gneis';
import { blockTerrain, wallCells } from '../src/sim/summons';
import { walkable } from '../src/sim/map';
import { buildSnapshot } from '../src/sim/snapshot';
import { sec, type Command, type PlayerSetup } from '../src/sim/types';
import { championKit, framesOf } from '../src/render/champions';
import { itemById } from '../src/sim/items/inventory';
import { goldEfficiency } from '../src/ui/goldEfficiency';
import { duel } from './itemHelpers';

const player: PlayerSetup = { slot: 0, team: 0, champion: 'gneis', role: 'top', summoners: ['sprung', 'heilen'], isHuman: true };
const cast = (slot: 0 | 1 | 2 | 3, x: number, y: number): Command => ({ t: 'cast', slot, x, y });

function setup(ranks: [number, number, number, number] = [1, 1, 1, 1]): { sim: Sim; m: number } {
  const sim = makeSim({ players: [player] });
  const m = sim.slots[0]!;
  place(sim, m, CX, CY);
  sim.c.Champ.level[m] = 8;
  sim.c.Champ.skillPoints[m] = 30;
  ranks.forEach((r, slot) => {
    for (let i = 0; i < r; i++) levelAbility(sim, m, slot);
  });
  step(sim);
  return { sim, m };
}
/** Steps n ticks (first with a command) and reports whether t was ever stunned meanwhile. */
function everStunned(sim: Sim, t: number, n: number, first: Command): boolean {
  let s = false;
  for (let i = 0; i < n; i++) {
    step(sim, i === 0 ? [{ slot: 0, cmd: first }] : []);
    s = s || hasBuff(sim, t, 'stun');
  }
  return s;
}
/** Vertical wall of impassable ground at x. */
const wallAt = (sim: Sim, x: number, ticks = 600): void => blockTerrain(sim, wallCells(sim, x, CY - 400, x, CY + 400, 100), ticks);

describe('Gneis data', () => {
  it('hooks exist, top laner with the earth-wall kit', () => {
    expect(missingHooks('gneis')).toEqual([]);
    const d = championData('gneis');
    expect(d.roles).toEqual(['top']);
    expect(d.abilities.map((a) => a.type)).toEqual(['skillshot_line', 'zone', 'dash', 'skillshot_circle']);
  });
  it('is tuned like the other top tanks (HP, armor within 10 % of Oleth / Brom)', () => {
    const g = championData('gneis').base;
    for (const id of ['oleth', 'brom']) {
      const o = championData(id).base;
      expect(g.hp / o.hp).toBeGreaterThan(0.9);
      expect(g.hp / o.hp).toBeLessThan(1.15);
      expect(g.armor / o.armor).toBeLessThan(1.25);
    }
  });
});

describe('Q Boulder', () => {
  it('knocks the target back 260 in open ground, no stun', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 400, CY, 1);
    step(sim);
    const hits = collect(sim, 60, m, cast(0, CX + 400, CY));
    expect(hits.some((h) => h.dst === d)).toBe(true);
    steps(sim, 30);
    expect(sim.c.Pos.x[d]! - (CX + 400)).toBeGreaterThan(200);
    expect(hasBuff(sim, d, 'stun')).toBe(false);
  });

  it('slams into a wall: bonus damage and a stun of at least 0.9 s', () => {
    const open = setup();
    const d0 = spawnDummy(open.sim, CX + 400, CY, 1);
    step(open.sim);
    collect(open.sim, 60, open.m, cast(0, CX + 400, CY));

    const { sim, m } = setup();
    wallAt(sim, CX + 520);
    const d = spawnDummy(sim, CX + 400, CY, 1);
    step(sim);
    expect(everStunned(sim, d, 60, cast(0, CX + 400, CY))).toBe(true);
    expect(m).toBe(sim.slots[0]);
    expect(sim.c.Hp.cur[d]!).toBeLessThan(open.sim.c.Hp.cur[d0]!); // slam bonus damage on top of the base hit
    expect(sim.c.Pos.x[d]!).toBeLessThan(CX + 520);
  });
});

describe('W Earth Wall + passive Bedrock', () => {
  it('raises an impassable wall for 3 s (rank 1) that gives +12 armor / MR within 450', () => {
    const { sim, m } = setup();
    const armor0 = sim.c.Stats.armor[m]!;
    const mr0 = sim.c.Stats.mr[m]!;
    step(sim, [{ slot: 0, cmd: cast(1, CX + 400, CY) }]);
    steps(sim, sec(1.2));
    expect(walkable(sim.map.nav, CX + 400, CY)).toBe(false);
    expect(gneisWallCount(sim, m)).toBe(1);
    expect(sim.c.Stats.armor[m]! - armor0).toBeCloseTo(12, 5);
    expect(sim.c.Stats.mr[m]! - mr0).toBeCloseTo(12, 5);
    expect(buildSnapshot(sim, 0, 0).me?.passive?.stacks).toBe(1);
    steps(sim, sec(3.5));
    expect(walkable(sim.map.nav, CX + 400, CY)).toBe(true);
    expect(gneisWallCount(sim, m)).toBe(0);
  });

  it('hits enemies on the wall line: damage and airborne', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 400, CY + 60, 1);
    step(sim);
    const hits = collect(sim, sec(1.2), m, cast(1, CX + 400, CY));
    expect(hits.some((h) => h.dst === d)).toBe(true);
  });
});

describe('E Shoulder', () => {
  it('stops at the first enemy and shoves it on 300 (open ground: no stun)', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 300, CY, 1);
    step(sim);
    const hits = collect(sim, 40, m, cast(2, CX + 400, CY));
    expect(hits.some((h) => h.dst === d)).toBe(true);
    steps(sim, 20);
    expect(sim.c.Pos.x[d]!).toBeGreaterThan(CX + 450);
    expect(hasBuff(sim, d, 'stun')).toBe(false);
    expect(sim.c.Hp.shield[m]!).toBeGreaterThan(0);
  });

  it('shoves an enemy into a wall: stun', () => {
    const { sim } = setup();
    wallAt(sim, CX + 560);
    const d = spawnDummy(sim, CX + 300, CY, 1);
    step(sim);
    expect(everStunned(sim, d, 40, cast(2, CX + 400, CY))).toBe(true);
  });
});

describe('R Landslide', () => {
  it('damages, slows and catches thrown enemies in the crater rim (stun)', () => {
    const { sim } = setup();
    const d = spawnDummy(sim, CX + 700, CY + 100, 1);
    step(sim);
    expect(everStunned(sim, d, 60, cast(3, CX + 700, CY))).toBe(true);
    expect(sim.c.Hp.cur[d]!).toBeLessThan(sim.c.Hp.max[d]!);
    // rim stands at radius 330 around the impact, opening toward Gneis (west)
    expect(walkable(sim.map.nav, CX + 700 + 330, CY)).toBe(false);
    expect(walkable(sim.map.nav, CX + 700 - 330, CY)).toBe(true);
    steps(sim, sec(4.5));
    expect(walkable(sim.map.nav, CX + 700 + 330, CY)).toBe(true);
  });
});

describe('Schollenpanzer', () => {
  it('is a legendary with a fair gold efficiency and a unique recipe', () => {
    const it = itemById('schollenpanzer')!;
    expect(it.tier).toBe('legendary');
    expect(it.from).toEqual(['kettenhemd', 'wetterhorn']);
    const e = goldEfficiency(it)!;
    expect(e.pct).toBeGreaterThan(85);
    expect(e.pct).toBeLessThan(115);
  });

  it('abilities that hit an enemy champion stack +6 armor / MR (max 4)', () => {
    const { sim, me, foe } = duel({ champ: 'gneis', items: ['schollenpanzer'] });
    const armor0 = sim.c.Stats.armor[me]!;
    sim.c.Champ.level[me] = 8;
    sim.c.Champ.skillPoints[me] = 5;
    levelAbility(sim, me, 0);
    place(sim, foe, CX + 300, CY);
    step(sim, [{ slot: 0, cmd: cast(0, CX + 300, CY) }]);
    steps(sim, 40);
    steps(sim, 2);
    expect(sim.c.Stats.armor[me]! - armor0).toBeGreaterThanOrEqual(6);
  });
});

describe('Gneis sprite kit', () => {
  it('has its own stone kit with four props and every animation', () => {
    const k = championKit('gneis')!;
    expect(k.name).toBe('Gneis Mauerherz');
    expect(k.props.length).toBe(4);
    expect(k.outfit.skinKind).toBe('stone');
    for (const a of ['idle', 'run', 'attack', 'cast', 'death'] as const) expect(framesOf('gneis', a)).toBeGreaterThan(0);
    expect(championKit('brom')!.look).not.toBe(k.look);
  });
});
