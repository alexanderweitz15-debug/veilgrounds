import { describe, expect, it } from 'vitest';
import { createSim, step, type Sim } from '../src/sim/sim';
import { sec } from '../src/sim/types';
import { dealDamage } from '../src/sim/damage';
import { addBuff } from '../src/sim/buffs';
import { abilityHud } from '../src/sim/systems/abilities';
import { spawnDummy } from '../src/sim/systems/champions';
import { BARRIER_SHIELD, summonerDef } from '../src/sim/summoners';
import { barrierStep, exhaustStep, ghostStep } from '../src/ai/bot/spells';
import { newMemory } from '../src/ai/bot/types';
import type { View } from '../src/ai/bot/perception';
import { Rng } from '../src/sim/rng';
import { CX, CY, place, steps } from './combat-helpers';
import { summonerName } from '../src/ui/names';
import { profileOf } from '../src/ai/profiles';

function sim1(sums: [string, string]): Sim {
  return createSim({ seed: 3, mode: 'sandbox', minionsEnabled: false, players: [{ slot: 0, team: 0, champion: 'mira', role: 'adc', summoners: sums, isHuman: true }] });
}

describe('summoner list', () => {
  it('Barriere is in the data (180 s, no todo) with German and English names', () => {
    const d = summonerDef('barriere')!;
    expect(d.cooldown).toBe(180);
    expect(d.todo).toBeUndefined();
    expect(summonerName('barriere')).toMatch(/Barriere|Barrier/);
    expect(d.name).toEqual({ de: 'Barriere', en: 'Barrier' });
  });
});

describe('Barriere', () => {
  it('shields 115 at level 1 for 2 s and absorbs damage first; 180 s cooldown', () => {
    const sim = sim1(['barriere', 'heilen']);
    const a = sim.slots[0]!;
    place(sim, a, CX, CY);
    step(sim);
    const d = spawnDummy(sim, CX + 3000, CY, 1);
    step(sim, [{ slot: 0, cmd: { t: 'spell', slot: 0, x: CX, y: CY } }]);
    expect(sim.c.Hp.shield[a]).toBeCloseTo(BARRIER_SHIELD[0], 6);
    expect(abilityHud(sim, a)[4]!.cdTotal).toBe(180);
    const hp0 = sim.c.Hp.cur[a]!;
    dealDamage(sim, d, a, 100, 'true');
    expect(sim.c.Hp.cur[a]).toBe(hp0);
    expect(sim.c.Hp.shield[a]).toBeCloseTo(BARRIER_SHIELD[0] - 100, 6);
    steps(sim, sec(2));
    expect(sim.c.Hp.shield[a]).toBe(0);
  });
  it('scales with level to 455 at level 18', () => {
    const sim = sim1(['barriere', 'heilen']);
    const a = sim.slots[0]!;
    sim.c.Champ.level[a] = 18;
    step(sim);
    step(sim, [{ slot: 0, cmd: { t: 'spell', slot: 0, x: CX, y: CY } }]);
    expect(sim.c.Hp.shield[a]).toBeCloseTo(BARRIER_SHIELD[1], 6);
  });
  it('cannot be cast while stunned and then costs no cooldown', () => {
    const sim = sim1(['barriere', 'heilen']);
    const a = sim.slots[0]!;
    step(sim);
    addBuff(sim, a, { kind: 'stun', id: 'x', ticks: sec(2) });
    step(sim, [{ slot: 0, cmd: { t: 'spell', slot: 0, x: CX, y: CY } }]);
    expect(sim.c.Hp.shield[a]).toBe(0);
    expect(abilityHud(sim, a)[4]!.cdLeft).toBe(0);
  });
});

// ------------------------------------------------------------------ bot rules (fake views: only the fields the steps read)

const ent = (o: Partial<Record<string, number>> & { id: number }) => ({ x: 0, y: 0, px: 0, py: 0, hp: 1000, maxHp: 1000, shield: 0, radius: 40, atkTarget: -1, ...o });
const sum = (id: string) => [undefined, undefined, undefined, undefined, { id, rank: 1, cdLeft: 0 }, { id: 'sprung', rank: 1, cdLeft: 5 }];

function view(o: { sums: string; hp: number; foes?: ReturnType<typeof ent>[]; towers?: ReturnType<typeof ent>[]; shield?: number }): View {
  const self = ent({ id: 1, hp: o.hp, shield: o.shield ?? 0 });
  return {
    tick: 100,
    me: { eid: 1, abilities: sum(o.sums) },
    self,
    hpPct: o.hp / 1000,
    reach: 540,
    enemies: o.foes ?? [],
    allies: [],
    enemyTowers: o.towers ?? [],
  } as unknown as View;
}
const ctx = (skill: number) => ({ params: { skill }, profile: profileOf('gold') }) as never;

describe('bot: Barriere', () => {
  const foe = [ent({ id: 9, x: 500 })];
  it('fires under the rank line with an enemy champion close, not above it or without a threat', () => {
    expect(barrierStep(view({ sums: 'barriere', hp: 150, foes: foe }), ctx(50), new Rng(1))?.cmd).toMatchObject({ t: 'spell', slot: 0 });
    expect(barrierStep(view({ sums: 'barriere', hp: 600, foes: foe }), ctx(50), new Rng(1))).toBeNull();
    expect(barrierStep(view({ sums: 'barriere', hp: 150 }), ctx(50), new Rng(1))).toBeNull();
    expect(barrierStep(view({ sums: 'barriere', hp: 150, foes: [ent({ id: 9, x: 2000 })] }), ctx(50), new Rng(1))).toBeNull();
  });
  it('the HP line grows with skill: 25 % HP fires for Challenger, not for Iron', () => {
    const v = view({ sums: 'barriere', hp: 250, foes: foe });
    expect(barrierStep(v, ctx(100), new Rng(1))).not.toBeNull();
    expect(barrierStep(v, ctx(0), new Rng(1))).toBeNull();
  });
  it('tower aggro counts as a threat; an existing shield or other summoner does not fire', () => {
    expect(barrierStep(view({ sums: 'barriere', hp: 150, towers: [ent({ id: 7, atkTarget: 1 })] }), ctx(50), new Rng(1))).not.toBeNull();
    expect(barrierStep(view({ sums: 'barriere', hp: 150, foes: foe, shield: 80 }), ctx(50), new Rng(1))).toBeNull();
    expect(barrierStep(view({ sums: 'heilen', hp: 150, foes: foe }), ctx(50), new Rng(1))).toBeNull();
  });
});

describe('bot: Geist', () => {
  const mem = (mode: string) => Object.assign(newMemory(), { mode });
  it('chases a fleeing low enemy in fight mode', () => {
    const fleeing = ent({ id: 9, x: 900, px: 880, hp: 200 });
    expect(ghostStep(view({ sums: 'geist', hp: 800, foes: [fleeing] }), ctx(60), mem('fight'))?.cmd).toMatchObject({ t: 'spell', slot: 0 });
    const approaching = ent({ id: 9, x: 900, px: 920, hp: 200 });
    expect(ghostStep(view({ sums: 'geist', hp: 800, foes: [approaching] }), ctx(60), mem('fight'))).toBeNull();
    const healthy = ent({ id: 9, x: 900, px: 880, hp: 800 });
    expect(ghostStep(view({ sums: 'geist', hp: 800, foes: [healthy] }), ctx(60), mem('fight'))).toBeNull();
    expect(ghostStep(view({ sums: 'geist', hp: 800, foes: [fleeing] }), ctx(20), mem('fight'))).toBeNull(); // low ranks do not
  });
  it('runs in retreat mode with a foe close and low HP', () => {
    const near = ent({ id: 9, x: 600, px: 600, hp: 900 });
    expect(ghostStep(view({ sums: 'geist', hp: 200, foes: [near] }), ctx(60), mem('retreat'))).not.toBeNull();
    expect(ghostStep(view({ sums: 'geist', hp: 600, foes: [near] }), ctx(60), mem('retreat'))).toBeNull();
  });
});

describe('bot: Erschöpfen prefers the diver', () => {
  it('the enemy hitting the low ally beats a closer one that is not', () => {
    const self = ent({ id: 1, hp: 300 });
    const diver = ent({ id: 9, x: 400, atkTarget: 1 });
    const closer = ent({ id: 8, x: 300, y: 100, atkTarget: -1 });
    const v = { ...view({ sums: 'erschoepfen', hp: 300, foes: [closer, diver] }), self, allies: [] } as unknown as View;
    expect(exhaustStep(v)?.cmd).toMatchObject({ t: 'spell', target: 9 });
  });
});
