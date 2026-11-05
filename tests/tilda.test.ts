// Tilda Saitenwind kit: notes (spawn, fog, pickup, caps), songs empowered per colour, R uses all, items, bot note walk, kit.
import { CX, CY, collect, makeSim, place, steps } from './combat-helpers';
import { describe, expect, it, vi } from 'vitest';

// the kit registry module builds a Path2D at load time (browser only)
vi.hoisted(() => {
  (globalThis as { Path2D?: unknown }).Path2D ??= class { rect(): void {} };
});
import { step, type Sim } from '../src/sim/sim';
import { hasBuff, statMods } from '../src/sim/buffs';
import { levelAbility } from '../src/sim/systems/abilities';
import { championData, missingHooks } from '../src/sim/champions';
import { tildaNotes } from '../src/sim/champions/tilda';
import { buildSnapshot } from '../src/sim/snapshot';
import { type Command, type PlayerSetup } from '../src/sim/types';
import { itemById } from '../src/sim/items/inventory';
import { goldEfficiency } from '../src/ui/goldEfficiency';
import { noteStep } from '../src/ai/bot/notes';
import { CHAMPION_IDS, championKit, framesOf } from '../src/render/champions';
import { duel } from './itemHelpers';

const mk = (slot: number, team: 0 | 1, champion: string, human = false): PlayerSetup => ({ slot, team, champion, role: 'support', summoners: ['sprung', 'heilen'], isHuman: human });
type Notes = Map<number, { stacks: number[] }>;
const stacksOf = (sim: Sim, m: number): number[] => (sim.state.tilda as Notes).get(m)!.stacks;

function setup(ranks: [number, number, number, number] = [1, 1, 1, 0]): { sim: Sim; m: number; ally: number; foe: number } {
  const sim = makeSim({ players: [mk(0, 0, 'tilda', true), mk(1, 0, 'mira'), mk(5, 1, 'mira')] });
  const m = sim.slots[0]!;
  place(sim, m, CX, CY);
  place(sim, sim.slots[1]!, CX + 300, CY);
  place(sim, sim.slots[5]!, CX + 700, CY + 100);
  sim.c.Champ.level[m] = Math.max(ranks[3] > 0 ? 6 : 1, ...ranks.slice(0, 3).map((r) => 2 * r - 1));
  sim.c.Champ.skillPoints[m] = 30;
  ranks.forEach((r, slot) => {
    for (let i = 0; i < r; i++) levelAbility(sim, m, slot);
  });
  step(sim);
  return { sim, m, ally: sim.slots[1]!, foe: sim.slots[5]! };
}
const cast = (slot: 0 | 1 | 2 | 3, x: number, y: number): Command => ({ t: 'cast', slot, x, y });
const noteObjs = (sim: Sim, team: number, me: number) => buildSnapshot(sim, team, me).objects.filter((o) => o.tag === 'tilda_note');
const sumNotes = (sim: Sim, m: number): number => [0, 1, 2].reduce((a, c) => a + tildaNotes(sim, m, c), 0);

/** Q on a hurt ally; returns the heal the ally got. */
function healBy(s: { sim: Sim; m: number; ally: number }): number {
  s.sim.c.Hp.cur[s.ally] = 100;
  steps(s.sim, 1);
  const h = s.sim.c.Hp.cur[s.ally]!;
  collect(s.sim, 14, s.m, cast(0, CX, CY));
  return s.sim.c.Hp.cur[s.ally]! - h;
}

describe('Tilda data', () => {
  it('hooks complete, support', () => {
    expect(missingHooks('tilda')).toEqual([]);
    expect(championData('tilda').roles).toEqual(['support']);
  });
});

describe('Tilda notes', () => {
  it('a note appears after 3 s near her, own team sees it, the enemy team does not', () => {
    const { sim, m } = setup();
    steps(sim, 3 * 30 + 5);
    const mine = noteObjs(sim, 0, m);
    expect(mine.length).toBe(1);
    const d = Math.hypot(mine[0]!.x - sim.c.Pos.x[m]!, mine[0]!.y - sim.c.Pos.y[m]!);
    expect(d).toBeGreaterThan(200); // the walkable snap can pull it in
    expect(d).toBeLessThan(1400);
    expect(noteObjs(sim, 1, sim.slots[5]!).length).toBe(0);
  });

  it('walking over a note stores it; at most 4 on the map, 3 per colour', () => {
    const { sim, m } = setup();
    steps(sim, 30 * 40);
    expect(noteObjs(sim, 0, m).length).toBeLessThanOrEqual(4);
    const n = noteObjs(sim, 0, m)[0]!;
    const before = sumNotes(sim, m);
    place(sim, m, n.x, n.y);
    steps(sim, 2);
    expect(sumNotes(sim, m) - before).toBe(1);
    for (let c = 0; c < 3; c++) expect(tildaNotes(sim, m, c)).toBeLessThanOrEqual(3);
  });

  it('the notes are deterministic for a seed', () => {
    const a = setup();
    const b = setup();
    steps(a.sim, 30 * 20);
    steps(b.sim, 30 * 20);
    expect(noteObjs(a.sim, 0, a.m).map((o) => [o.x, o.y])).toEqual(noteObjs(b.sim, 0, b.m).map((o) => [o.x, o.y]));
  });
});

describe('Tilda songs', () => {
  it('Q heals allies in 650; green notes add 25 % each and are used up', () => {
    const base = healBy(setup());
    expect(base).toBeGreaterThan(40);
    const boosted = setup();
    stacksOf(boosted.sim, boosted.m)[0] = 2;
    const gained = healBy(boosted);
    expect(gained / base).toBeGreaterThan(1.35);
    expect(gained / base).toBeLessThan(1.65);
    expect(tildaNotes(boosted.sim, boosted.m, 0)).toBe(0);
  });

  it('W: allies get the move speed, blue notes add 8 % each', () => {
    const { sim, m, ally } = setup();
    stacksOf(sim, m)[1] = 3;
    collect(sim, 12, m, cast(1, CX, CY));
    expect(hasBuff(sim, ally, 'stat', 'tilda_note_ms')).toBe(true);
    expect(statMods(sim, ally, 'ms')[0]).toBeGreaterThanOrEqual(20 + 24 - 1);
    expect(tildaNotes(sim, m, 1)).toBe(0);
  });

  it('E: slow only without notes, stun 0.4 s + 0.2 s per red note with them', () => {
    const a = setup();
    collect(a.sim, 25, a.m, cast(2, CX + 700, CY + 100));
    expect(hasBuff(a.sim, a.foe, 'stun')).toBe(false);
    const b = setup();
    stacksOf(b.sim, b.m)[2] = 2;
    collect(b.sim, 25, b.m, cast(2, CX + 700, CY + 100));
    expect(hasBuff(b.sim, b.foe, 'stun')).toBe(true);
    steps(b.sim, 24); // 0.8 s stun in total
    expect(hasBuff(b.sim, b.foe, 'stun')).toBe(false);
    expect(tildaNotes(b.sim, b.m, 2)).toBe(0);
  });

  it('R stuns enemies in 750, heals allies, and uses up every colour', () => {
    const { sim, m, ally, foe } = setup([1, 1, 1, 1]);
    const st = stacksOf(sim, m);
    st[0] = 1;
    st[1] = 1;
    st[2] = 3;
    sim.c.Hp.cur[ally] = 100;
    steps(sim, 1);
    const h = sim.c.Hp.cur[ally]!;
    collect(sim, 30, m, cast(3, CX, CY));
    expect(hasBuff(sim, foe, 'stun')).toBe(true);
    expect(sim.c.Hp.cur[ally]! - h).toBeGreaterThan(80);
    expect(sumNotes(sim, m)).toBe(0);
  });
});

describe('Tilda items', () => {
  it('Songbook is priced sanely; Refrain heals allies in 600 on a cast', () => {
    expect(itemById('taktstock')!.tier).toBe('component');
    const ge = goldEfficiency(itemById('liederbuch')!)!;
    expect(ge.pct).toBeGreaterThan(80);
    expect(ge.pct).toBeLessThan(120);
    const d = duel({ champ: 'tilda', items: ['liederbuch'], allies: [300] });
    const { sim, me } = d;
    const ally = d.allies[0]!;
    sim.c.Hp.cur[ally] = 100;
    steps(sim, 1);
    const a0 = sim.c.Hp.cur[ally]!;
    sim.c.Champ.skillPoints[me] = 3;
    levelAbility(sim, me, 1);
    collect(sim, 8, me, cast(1, CX, CY)); // W has no heal of its own
    expect(sim.c.Hp.cur[ally]! - a0).toBeGreaterThan(10);
  });
});

describe('Tilda bot note walk', () => {
  const ctx = { champ: championData('tilda') } as never;
  const view = (enemyAt?: number): never =>
    ({
      tick: 100,
      self: { x: 0, y: 0 },
      me: { dead: false, recallLeft: 0 },
      enemies: enemyAt ? [{ x: enemyAt, y: 0 }] : [],
      enemyTowers: [],
      snap: { objects: [{ tag: 'tilda_note', x: 400, y: 0 }, { tag: 'tilda_note', x: 2000, y: 0 }, { tag: 'other', x: 100, y: 0 }] },
    }) as never;
  it('walks to the nearest note, holds the lane leaf off, ignores notes with an enemy near or while fighting', () => {
    const mem = { mode: 'jungle', holdUntil: 0 };
    expect(noteStep(view(), ctx, mem as never)).toEqual({ cmd: { t: 'move', x: 400, y: 0 } });
    expect(mem.holdUntil).toBeGreaterThan(100);
    expect(noteStep(view(600), ctx, { mode: 'lane', holdUntil: 0 } as never)).toBeNull();
    expect(noteStep(view(), ctx, { mode: 'fight', holdUntil: 0 } as never)).toBeNull();
  });
});

describe('Tilda kit', () => {
  it('has her own sprite kit: plume, lute, notes, all five animations', () => {
    const k = championKit('tilda')!;
    expect(CHAMPION_IDS).toContain('tilda');
    expect(k.props.length).toBe(3);
    expect(k.feature).toContain('lute');
    for (const a of ['idle', 'run', 'attack', 'cast', 'death'] as const) expect(framesOf('tilda', a)).toBeGreaterThan(0);
  });
});
