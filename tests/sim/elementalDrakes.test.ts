// Elemental Leviathans: rotation (announced next, third = soul element), stacking team bonus, soul at 4 kills,
// Uralt-Leviathan and its execute buff (src/sim/drakes.ts, jungle.ts, damage.ts).
import { describe, expect, it } from 'vitest';
import { step, type Sim } from '../../src/sim/sim';
import { sec } from '../../src/sim/types';
import { dealDamage, kill } from '../../src/sim/damage';
import { ELDER, ELDER_ELEM, ELEMENTS, SOUL_AT, drakeBonus } from '../../src/sim/drakes';
import { drakeState, jungleState } from '../../src/sim/systems/jungle';
import { hasBuff } from '../../src/sim/buffs';
import { buildSnapshot } from '../../src/sim/snapshot';
import { makeSim, steps } from '../combat-helpers';

const duel = (seed = 1): Sim =>
  makeSim({
    seed,
    players: [
      { slot: 0, team: 0, champion: 'mira', role: 'adc', summoners: ['sprung', 'heilen'], isHuman: true },
      { slot: 1, team: 1, champion: 'mira', role: 'adc', summoners: ['sprung', 'heilen'], isHuman: false },
    ],
  });

/** Spawn the Leviathan now and let `team`'s champion kill it; returns the element that died. */
function slay(sim: Sim, team: 0 | 1): number {
  const camp = jungleState(sim).camps.find((c) => c.id === 'leviathan')!;
  camp.spawnAt = sim.tick + 1;
  steps(sim, 3);
  const d = drakeState(sim)!;
  const elem = d.cur;
  kill(sim, camp.members[0]!.eid, sim.slots[team]!);
  step(sim);
  return elem;
}

describe('elemental drakes', () => {
  it('rotation: next announced after the first kill, third spawn is the soul element, no repeats', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const sim = duel(seed);
      const d = drakeState(sim)!;
      const spawned: number[] = [];
      for (let i = 0; i < 6; i++) {
        spawned.push(slay(sim, i % 2 === 0 ? 0 : 1)); // alternate teams: nobody reaches the soul
        const pub = buildSnapshot(sim, 0, 0).objectives!.drake!;
        if (i === 0) expect(pub.next).toBeGreaterThanOrEqual(0);
        expect(pub.next).toBe(d.next);
        expect(pub.soulType).toBe(i >= 1 ? d.soulType : -1);
      }
      expect(d.elder).toBe(false);
      expect(spawned[1]).not.toBe(spawned[0]);
      expect(spawned[2]).toBe(d.soulType);
      expect([spawned[0], spawned[1]]).not.toContain(spawned[2]);
      for (let i = 1; i < spawned.length; i++) expect(spawned[i]).not.toBe(spawned[i - 1]);
    }
  });

  it('the announced next element is the one that spawns, and the monster carries it in the snapshot', () => {
    const sim = duel(7);
    slay(sim, 0);
    const d = drakeState(sim)!;
    const announced = d.next;
    const camp = jungleState(sim).camps.find((c) => c.id === 'leviathan')!;
    camp.spawnAt = sim.tick + 1;
    steps(sim, 3);
    expect(d.cur).toBe(announced);
    expect(buildSnapshot(sim, 2, -1).entities.find((e) => e.id === camp.members[0]!.eid)!.elem).toBe(announced);
  });

  it('every kill stacks the team bonus of its element', () => {
    const sim = duel(3);
    const got = [slay(sim, 0), slay(sim, 0)];
    const want: Record<string, number> = {};
    for (const e of got) for (const [k, v] of Object.entries(ELEMENTS[e]!.perKill)) want[k] = (want[k] ?? 0) + v!;
    expect(drakeBonus(drakeState(sim), 0)).toEqual(want);
    expect(drakeBonus(drakeState(sim), 1)).toEqual({});
    expect(jungleState(sim).leviathan).toEqual([2, 0]);
  });

  it('team bonus reaches the stats: Glut stacks raise AD', () => {
    const sim = duel();
    steps(sim, 2);
    const me = sim.slots[0]!;
    const base = sim.c.Stats.ad[me]!;
    drakeState(sim)!.kills[0].push(0, 0); // two Glut kills: +3 % AD each
    steps(sim, 2);
    expect(sim.c.Stats.ad[me]! / base).toBeCloseTo(1.06, 3);
    expect(sim.c.Stats.ad[sim.slots[1]!]!).toBeCloseTo(base, 3);
  });

  it('soul at 4 kills: soul element = map element, extra bonus, the pit turns into the Uralt-Leviathan', () => {
    const sim = duel(2);
    const d = drakeState(sim)!;
    for (let i = 0; i < SOUL_AT - 1; i++) slay(sim, 0);
    expect(d.soul).toEqual([-1, -1]);
    expect(d.elder).toBe(false);
    slay(sim, 0);
    expect(d.soul[0]).toBe(d.soulType);
    expect(d.soul[1]).toBe(-1);
    expect(d.elder).toBe(true);
    const sum: Record<string, number> = {};
    for (const e of d.kills[0]) for (const [k, v] of Object.entries(ELEMENTS[e]!.perKill)) sum[k] = (sum[k] ?? 0) + v!;
    for (const [k, v] of Object.entries(ELEMENTS[d.soulType]!.soul)) sum[k] = (sum[k] ?? 0) + v!;
    expect(drakeBonus(d, 0)).toEqual(sum);
    // the soul is public and the elder comes after its own respawn time
    const pub = buildSnapshot(sim, 0, 0).objectives!.drake!;
    expect(pub.soul).toEqual([d.soulType, -1]);
    expect(pub.next).toBe(ELDER_ELEM);
    const camp = jungleState(sim).camps.find((c) => c.id === 'leviathan')!;
    expect(camp.spawnAt).toBe(sim.tick - 1 + sec(ELDER.respawnS));
    camp.spawnAt = sim.tick + 1;
    steps(sim, 3);
    const elder = camp.members[0]!.eid;
    expect(d.cur).toBe(ELDER_ELEM);
    expect(sim.c.Unit.radius[elder]).toBe(ELDER.radius);
    expect(sim.c.Hp.max[elder]!).toBeGreaterThanOrEqual(ELDER.hp);
  });

  it('Uralt-Leviathan kill: execute buff for the killing team, enemies below the threshold die to its hits', () => {
    const sim = duel(2);
    for (let i = 0; i < SOUL_AT; i++) slay(sim, 0);
    const [a, b] = [sim.slots[0]!, sim.slots[1]!];
    expect(hasBuff(sim, a, 'mark', 'uralt')).toBe(false);
    slay(sim, 0); // the elder
    expect(hasBuff(sim, a, 'mark', 'uralt')).toBe(true);
    expect(hasBuff(sim, b, 'mark', 'uralt')).toBe(false);
    expect(buildSnapshot(sim, 0, 0).objectives!.drake!.elderLeft[0]).toBeGreaterThan(ELDER.buffS - 2);
    const { Hp } = sim.c;
    Hp.cur[b] = Hp.max[b]! * 0.3;
    dealDamage(sim, a, b, 1, 'true');
    expect(sim.c.Unit.alive[b]).toBe(1); // above the threshold: no execute
    Hp.cur[b] = Hp.max[b]! * (ELDER.executePct / 100 - 0.05);
    dealDamage(sim, a, b, 1, 'true');
    expect(sim.c.Unit.alive[b]).toBe(0);
    // without the buff the same hit does not execute
    Hp.cur[a] = Hp.max[a]! * 0.1;
    dealDamage(sim, b, a, 1, 'true');
    expect(sim.c.Unit.alive[a]).toBe(1);
  });
});
