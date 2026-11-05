// Kerrin Fesselschatten kit: passive Chain Mark, Q hook (to units, over walls), W whirl, E shackle, R execute at three marks,
// the execute line in the snapshot, the item Fesselklinge and the sprite kit.
import { CX, CY, makeSim, place, steps } from './combat-helpers';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { Path2D?: unknown }).Path2D ??= class { rect(): void {} };
});
import { step, type Sim } from '../src/sim/sim';
import { addBuff, hasBuff } from '../src/sim/buffs';
import { dealDamage } from '../src/sim/damage';
import { spawnDummy } from '../src/sim/systems/champions';
import { levelAbility, setCooldown } from '../src/sim/systems/abilities';
import { championData, missingHooks } from '../src/sim/champions';
import { kerrinMarks } from '../src/sim/champions/kerrin';
import { blockTerrain, wallCells } from '../src/sim/summons';
import { buildSnapshot } from '../src/sim/snapshot';
import { sec, type Command, type PlayerSetup } from '../src/sim/types';
import { championKit, framesOf } from '../src/render/champions';
import { itemById } from '../src/sim/items/inventory';
import { goldEfficiency } from '../src/ui/goldEfficiency';
import { duel } from './itemHelpers';

const player: PlayerSetup = { slot: 0, team: 0, champion: 'kerrin', role: 'jungle', summoners: ['sprung', 'heilen'], isHuman: true };
const cast = (slot: 0 | 1 | 2 | 3, x: number, y: number, target?: number): Command => ({ t: 'cast', slot, x, y, ...(target !== undefined ? { target } : {}) });

function setup(ranks: [number, number, number, number] = [1, 1, 1, 1]): { sim: Sim; m: number } {
  const sim = makeSim({ players: [player] });
  const m = sim.slots[0]!;
  place(sim, m, CX, CY);
  sim.c.Champ.level[m] = 9;
  sim.c.Champ.skillPoints[m] = 30;
  ranks.forEach((r, slot) => {
    for (let i = 0; i < r; i++) levelAbility(sim, m, slot);
  });
  step(sim);
  return { sim, m };
}
/** Cast `slot`, reset its cooldown and mana so the next cast is free (marks are the subject here). */
function fire(sim: Sim, m: number, c: Command, n = 40): void {
  step(sim, [{ slot: 0, cmd: c }]);
  steps(sim, n);
  for (const s of [0, 1, 2, 3]) setCooldown(sim, m, s, 0);
  sim.c.Mana.cur[m] = sim.c.Mana.max[m]!;
}
const wallAt = (sim: Sim, x: number): void => blockTerrain(sim, wallCells(sim, x, CY - 500, x, CY + 500, 100), 900);

describe('Kerrin data', () => {
  it('hooks exist, jungler with the chain kit', () => {
    expect(missingHooks('kerrin')).toEqual([]);
    const d = championData('kerrin');
    expect(d.roles).toEqual(['jungle']);
    expect(d.abilities[0]!.flags).toContain('mobility');
  });
  it('is tuned like the other melee junglers (HP within 10 % of Vessa / Kaelen)', () => {
    const k = championData('kerrin').base;
    for (const id of ['vessa', 'kaelen']) {
      const o = championData(id).base;
      expect(k.hp / o.hp).toBeGreaterThan(0.85);
      expect(k.hp / o.hp).toBeLessThan(1.1);
      expect(k.ad / o.ad).toBeLessThan(1.1);
    }
  });
});

describe('Q Hook Throw', () => {
  it('hits an enemy and pulls Kerrin next to it, giving a mark', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 700, CY, 1);
    step(sim);
    step(sim, [{ slot: 0, cmd: cast(0, CX + 700, CY) }]);
    steps(sim, 50);
    expect(sim.c.Pos.x[m]!).toBeGreaterThan(CX + 450);
    expect(sim.c.Pos.x[m]!).toBeLessThan(CX + 700);
    expect(kerrinMarks(sim, m, d)).toBe(1);
    expect(sim.c.Hp.cur[d]!).toBeLessThan(sim.c.Hp.max[d]!);
  });

  it('with nothing in the way she stays put (no pull)', () => {
    const { sim, m } = setup();
    step(sim, [{ slot: 0, cmd: cast(0, CX + 700, CY) }]);
    steps(sim, 60);
    expect(Math.abs(sim.c.Pos.x[m]! - CX)).toBeLessThan(5);
  });

  it('hooks a wall and pulls her over it', () => {
    const { sim, m } = setup();
    wallAt(sim, CX + 500);
    step(sim, [{ slot: 0, cmd: cast(0, CX + 800, CY) }]);
    steps(sim, 60);
    expect(sim.c.Pos.x[m]!).toBeGreaterThan(CX + 540);
    expect(sim.c.Pos.x[m]!).toBeLessThan(CX + 1100);
  });
});

describe('Passive Chain Mark', () => {
  it('stacks to 3, adds +4 % damage per mark, expires after 6 s', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 200, CY, 1);
    step(sim);
    expect(dealDamage(sim, m, d, 100, 'true')).toBeCloseTo(100);
    fire(sim, m, cast(1, CX + 200, CY)); // W whirl
    expect(kerrinMarks(sim, m, d)).toBe(1);
    expect(dealDamage(sim, m, d, 100, 'true')).toBeCloseTo(104);
    fire(sim, m, cast(1, CX + 200, CY));
    fire(sim, m, cast(1, CX + 200, CY));
    fire(sim, m, cast(1, CX + 200, CY));
    expect(kerrinMarks(sim, m, d)).toBe(3);
    expect(dealDamage(sim, m, d, 100, 'true')).toBeCloseTo(112);
    steps(sim, sec(7));
    expect(kerrinMarks(sim, m, d)).toBe(0);
  });
});

describe('W Chain Whirl', () => {
  it('damages and slows everything within 350', () => {
    const { sim, m } = setup();
    const near = spawnDummy(sim, CX + 250, CY, 1);
    const far = spawnDummy(sim, CX + 600, CY, 1);
    step(sim);
    step(sim, [{ slot: 0, cmd: cast(1, CX + 250, CY) }]);
    steps(sim, 12);
    expect(sim.c.Hp.cur[near]!).toBeLessThan(sim.c.Hp.max[near]!);
    expect(hasBuff(sim, near, 'slow')).toBe(true);
    expect(sim.c.Hp.cur[far]).toBe(sim.c.Hp.max[far]);
    expect(m).toBe(sim.slots[0]);
  });
});

describe('E Shadow Shackle', () => {
  it('speeds her up and the next auto roots the target', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 150, CY, 1);
    step(sim);
    const ms0 = sim.c.Stats.ms[m]!;
    step(sim, [{ slot: 0, cmd: cast(2, CX + 150, CY) }]);
    step(sim);
    expect(sim.c.Stats.ms[m]!).toBeGreaterThan(ms0 * 1.2);
    step(sim, [{ slot: 0, cmd: { t: 'attack', target: d } }]);
    let rooted = false;
    for (let i = 0; i < 40; i++) {
      step(sim);
      rooted = rooted || hasBuff(sim, d, 'root');
    }
    expect(rooted).toBe(true);
    expect(kerrinMarks(sim, m, d)).toBe(1);
  });
});

describe('R Headsman Chains', () => {
  const threeMarks = (sim: Sim, m: number, d: number): void => {
    for (let i = 0; i < 3; i++) fire(sim, m, cast(1, CX + 200, CY));
    expect(kerrinMarks(sim, m, d)).toBe(3);
  };

  it('executes a target with three marks below the threshold', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 200, CY, 1);
    step(sim);
    threeMarks(sim, m, d);
    sim.c.Hp.max[d] = 100000;
    sim.c.Hp.cur[d] = 17500; // 17.5 %: below the 18 % threshold of rank 1, far above what the R hit alone deals
    step(sim, [{ slot: 0, cmd: cast(3, CX + 200, CY, d) }]);
    steps(sim, 20);
    expect(sim.c.Hp.cur[d]).toBe(100000); // practice dummies never die: it was reset to full after lethal damage
  });

  it('does not execute above the threshold; the marks are consumed', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 200, CY, 1);
    step(sim);
    threeMarks(sim, m, d);
    sim.c.Hp.max[d] = 100000;
    sim.c.Hp.cur[d] = 60000;
    step(sim, [{ slot: 0, cmd: cast(3, CX + 200, CY, d) }]);
    steps(sim, 20);
    expect(sim.c.Hp.cur[d]!).toBeLessThan(60000);
    expect(kerrinMarks(sim, m, d)).toBe(0);
  });

  it('does not execute without three marks', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 200, CY, 1);
    step(sim);
    fire(sim, m, cast(1, CX + 200, CY));
    sim.c.Hp.max[d] = 100000;
    sim.c.Hp.cur[d] = 15000; // 15 %: below the threshold, but only one mark
    step(sim, [{ slot: 0, cmd: cast(3, CX + 200, CY, d) }]);
    steps(sim, 20);
    expect(sim.c.Hp.cur[d]!).toBeGreaterThan(14000);
    expect(sim.c.Hp.cur[d]!).toBeLessThan(15000);
  });

  it('shows three marks and the execute line (fraction of max HP) in the snapshot', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 200, CY, 1);
    step(sim);
    threeMarks(sim, m, d);
    const snap = buildSnapshot(sim, 0, 0);
    const mk = snap.entities.find((e) => e.id === d)?.marks?.find((x) => x.id === 'kerrin_mal');
    expect(mk).toMatchObject({ n: 3, max: 3 });
    expect(mk!.exec).toBeCloseTo(0.18, 5);
    expect(snap.me?.passive?.stacks).toBe(3);
  });
});

describe('Fesselklinge', () => {
  it('is a legendary with a fair gold efficiency and a unique recipe', () => {
    const it = itemById('fesselklinge')!;
    expect(it.tier).toBe('legendary');
    expect(it.from).toEqual(['klingenbrecher', 'kaltstahl']);
    const e = goldEfficiency(it)!;
    expect(e.pct).toBeGreaterThan(85);
    expect(e.pct).toBeLessThan(115);
  });

  it('+8 % damage per fetter (slow, root, stun) on champions', () => {
    const { sim, me, foe } = duel({ champ: 'kerrin', items: ['fesselklinge'] });
    expect(dealDamage(sim, me, foe, 100, 'true')).toBeCloseTo(100);
    addBuff(sim, foe, { kind: 'slow', id: 't', src: me, ticks: 90, pct: 30 });
    expect(dealDamage(sim, me, foe, 100, 'true')).toBeCloseTo(108);
    addBuff(sim, foe, { kind: 'root', id: 't2', src: me, ticks: 90 });
    expect(dealDamage(sim, me, foe, 100, 'true')).toBeCloseTo(116.64, 1);
  });
});

describe('Kerrin sprite kit', () => {
  it('has its own chain kit with three props and every animation', () => {
    const k = championKit('kerrin')!;
    expect(k.name).toBe('Kerrin Fesselschatten');
    expect(k.props.length).toBe(3);
    expect(k.look).toContain('chain');
    for (const a of ['idle', 'run', 'attack', 'cast', 'death'] as const) expect(framesOf('kerrin', a)).toBeGreaterThan(0);
    expect(championKit('fenna')!.look).not.toBe(k.look);
  });
});
