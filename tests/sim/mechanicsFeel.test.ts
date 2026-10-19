// B5 (AGENTS-PLAN §4): mechanic feel, sim side. Instant auto reset (Dagny Q), dash / knock-up progress in the snapshot,
// throttled hit flash (champion hits always, everything else max 4/s per target).
import { describe, expect, it } from 'vitest';
import { step } from '../../src/sim/sim';
import { sec, type PlayerSetup } from '../../src/sim/types';
import { addBuff } from '../../src/sim/buffs';
import { dealDamage, FLASH_MIN_TICKS } from '../../src/sim/damage';
import { levelAbility } from '../../src/sim/systems/abilities';
import { championData } from '../../src/sim/champions';
import { spawnDummy } from '../../src/sim/systems/champions';
import { buildSnapshot } from '../../src/sim/snapshot';
import { inventory } from '../../src/sim/items/inventory';
import { CX, CY, makeSim, place } from '../combat-helpers';

const player = (champion: string): PlayerSetup => ({ slot: 0, team: 0, champion, role: 'top', summoners: ['sprung', 'heilen'], isHuman: true });

describe('B5 mechanic feel (sim)', () => {
  it('Dagny Q: cast time 0, resets the attack timer and ends the backswing: the next auto starts at once', () => {
    expect(championData('dagny').abilities[0]!.castTime).toBe(0);
    const sim = makeSim({ players: [player('dagny')] });
    const m = sim.slots[0]!;
    place(sim, m, CX, CY);
    sim.c.Champ.skillPoints[m] = 1;
    levelAbility(sim, m, 0);
    const d = spawnDummy(sim, CX + 150, CY, 1);
    step(sim); // vision of the new dummy
    step(sim, [{ slot: 0, cmd: { t: 'attack', target: d } }]);
    // wait for the first hit (wind-up -> backswing)
    for (let i = 0; i < sec(2) && sim.c.Atk.phase[m] !== 2; i++) step(sim);
    expect(sim.c.Atk.phase[m]).toBe(2);
    expect(sim.c.Atk.nextReady[m]).toBeGreaterThan(sim.tick + 3);
    step(sim, [{ slot: 0, cmd: { t: 'cast', slot: 0, x: CX + 150, y: CY } }]);
    let started = -1;
    for (let i = 0; i < 3 && started < 0; i++) {
      if (sim.events.some((e) => e.e === 'attack' && e.src === m)) started = i;
      else step(sim);
    }
    expect(started).toBeGreaterThanOrEqual(0); // new auto within 2 ticks of the cast
  });

  it('snapshot: dash progress 0..1 during a dash, knock-up progress while airborne', () => {
    const sim = makeSim({ players: [player('mira')] });
    const m = sim.slots[0]!;
    place(sim, m, CX, CY);
    sim.c.Champ.skillPoints[m] = 1;
    levelAbility(sim, m, 2);
    const d = spawnDummy(sim, CX + 600, CY + 300, 1);
    step(sim);
    step(sim, [{ slot: 0, cmd: { t: 'cast', slot: 2, x: CX + 400, y: CY } }]);
    const prog: number[] = [];
    for (let i = 0; i < 20; i++) {
      const e = buildSnapshot(sim, 0, 0).entities.find((s) => s.id === m)!;
      if (e.dash !== undefined) prog.push(e.dash);
      step(sim);
    }
    expect(prog.length).toBeGreaterThan(1);
    expect(prog.every((p, i) => p >= 0 && p <= 1 && (i === 0 || p >= prog[i - 1]!))).toBe(true);
    expect(buildSnapshot(sim, 0, 0).entities.find((s) => s.id === m)!.dash).toBeUndefined();
    addBuff(sim, d, { kind: 'airborne', id: 'test', src: m, ticks: 30 });
    for (let i = 0; i < 10; i++) step(sim);
    const air = buildSnapshot(sim, 0, 0).entities.find((s) => s.id === d)!.air!;
    expect(air).toBeGreaterThan(0.2);
    expect(air).toBeLessThan(0.5);
  });

  it('attack-move: nearest to the champion by default, nearest to the click with cursor: true', () => {
    const pick = (cursor: boolean): number => {
      const sim = makeSim({ players: [player('mira')] });
      const m = sim.slots[0]!;
      place(sim, m, CX, CY);
      const near = spawnDummy(sim, CX + 250, CY, 1);
      const far = spawnDummy(sim, CX + 480, CY + 200, 1);
      step(sim);
      step(sim, [{ slot: 0, cmd: { t: 'attackMove', x: CX + 500, y: CY + 220, ...(cursor ? { cursor: true } : {}) } }]);
      step(sim);
      const t = sim.c.Atk.target[m]!;
      expect([near, far]).toContain(t);
      return t === far ? 1 : 0;
    };
    expect(pick(false)).toBe(0);
    expect(pick(true)).toBe(1);
  });

  it('failed item actives emit castFail with item: true (cooldown / target)', () => {
    const sim = makeSim({ players: [player('mira')] });
    const m = sim.slots[0]!;
    place(sim, m, CX, CY);
    step(sim);
    inventory(sim, m)[0] = 'siegelward';
    inventory(sim, m)[1] = 'siegelward';
    addBuff(sim, m, { kind: 'stun', id: 'test', src: -1, ticks: 30 });
    step(sim, [{ slot: 0, cmd: { t: 'item', slot: 1, x: CX + 200, y: CY } }]);
    expect(sim.events.filter((e) => e.e === 'castFail')).toEqual([{ e: 'castFail', src: m, slot: 1, reason: 'cc', item: true }]);
    expect(inventory(sim, m)[1]).toBe('siegelward'); // not consumed
  });

  it('hit flash: champion hits always; DoT ticks and other sources at most every 8 ticks per target', () => {
    const sim = makeSim({ players: [player('mira')] });
    const m = sim.slots[0]!;
    const d = spawnDummy(sim, CX + 300, CY, 1);
    step(sim);
    let flashes = 0;
    let hits = 0;
    for (let i = 0; i < 30; i++) {
      dealDamage(sim, -1, d, 1, 'true', { dot: true });
      hits += sim.events.filter((e) => e.e === 'damage' && e.dst === d).length;
      flashes += sim.events.filter((e) => e.e === 'damage' && e.dst === d && e.flash).length;
      step(sim);
    }
    expect(hits).toBe(30);
    expect(flashes).toBeLessThanOrEqual(Math.ceil(30 / FLASH_MIN_TICKS));
    expect(flashes).toBeGreaterThanOrEqual(3);
    dealDamage(sim, m, d, 1, 'true');
    dealDamage(sim, m, d, 1, 'true');
    expect(sim.events.filter((e) => e.e === 'damage' && e.src === m && e.flash)).toHaveLength(2);
  });
});
