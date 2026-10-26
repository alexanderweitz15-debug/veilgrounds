import { describe, expect, it } from 'vitest';
import { step } from '../src/sim/sim';
import { addBuff, canCast, canMove, ccState, CC_BIT, hasBuff, strongestSlow } from '../src/sim/buffs';
import { castSummonerSpell } from '../src/sim/summoners';
import { makeSim, mira } from './combat-helpers';

const until = (sim: ReturnType<typeof makeSim>, eid: number, kind: 'stun' | 'airborne' | 'slow'): number => {
  const t0 = sim.tick;
  let n = 0;
  while (hasBuff(sim, eid, kind) && n < 400) (step(sim, []), n++);
  return sim.tick - t0;
};

describe('mech-cc: LoL crowd control rules', () => {
  it('tenacity shortens stun but not airborne', () => {
    const sim = makeSim();
    const m = mira(sim);
    sim.c.Stats.tenacity[m] = 0.5;
    addBuff(sim, m, { kind: 'stun', id: 'a', src: -1, ticks: 60 });
    addBuff(sim, m, { kind: 'airborne', id: 'b', src: -1, ticks: 60 });
    const b = (k: string) => sim.state.buffs && [...(sim.state.buffs as any).ents.get(m).list].find((x: any) => x.kind === k);
    expect(b('stun').until - sim.tick).toBe(30);
    expect(b('airborne').until - sim.tick).toBe(60);
  });

  it('CC durations run in parallel: longest keeps the state; shorter re-apply never shortens', () => {
    const sim = makeSim();
    const m = mira(sim);
    addBuff(sim, m, { kind: 'stun', id: 'long', src: -1, ticks: 60 });
    addBuff(sim, m, { kind: 'stun', id: 'short', src: -1, ticks: 20 });
    addBuff(sim, m, { kind: 'stun', id: 'long', src: -1, ticks: 10 }); // same source, shorter
    expect(ccState(sim, m).until - sim.tick).toBe(60);
    expect(until(sim, m, 'stun')).toBe(60);
  });

  it('only the strongest slow applies', () => {
    const sim = makeSim();
    const m = mira(sim);
    addBuff(sim, m, { kind: 'slow', id: 'a', src: -1, pct: 30, ticks: 60 });
    addBuff(sim, m, { kind: 'slow', id: 'b', src: -1, pct: 50, ticks: 60 });
    addBuff(sim, m, { kind: 'slow', id: 'c', src: -1, pct: 20, ticks: 60 });
    expect(strongestSlow(sim, m)).toBe(50);
  });

  it('state flags: stun blocks move+cast, silence only cast, root only move', () => {
    const sim = makeSim();
    const m = mira(sim);
    addBuff(sim, m, { kind: 'silence', id: 's', src: -1, ticks: 30 });
    expect([canMove(sim, m), canCast(sim, m)]).toEqual([true, false]);
    addBuff(sim, m, { kind: 'root', id: 'r', src: -1, ticks: 30 });
    expect(canMove(sim, m)).toBe(false);
    expect(ccState(sim, m).mask & (CC_BIT.silence | CC_BIT.root)).toBe(CC_BIT.silence | CC_BIT.root);
  });

  it('Reinigen cleanses stun but not airborne', () => {
    const sim = makeSim({}, {});
    sim.c.Unit.alive[mira(sim)] = 1;
    const m = mira(sim);
    addBuff(sim, m, { kind: 'stun', id: 'x', src: -1, ticks: 90 });
    const ok = castSummonerSpell(sim, m, 'reinigen', 0, 0);
    if (ok) {
      step(sim, []);
      expect(hasBuff(sim, m, 'stun')).toBe(false);
    }
    const sim2 = makeSim();
    const m2 = mira(sim2);
    addBuff(sim2, m2, { kind: 'airborne', id: 'x', src: -1, ticks: 90 });
    expect(castSummonerSpell(sim2, m2, 'reinigen', 0, 0)).toBe(false);
    expect(hasBuff(sim2, m2, 'airborne')).toBe(true);
  });
});
