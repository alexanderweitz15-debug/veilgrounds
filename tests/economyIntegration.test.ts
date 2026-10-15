// End-to-end with the real step(): champion spawn (agent B) -> economy init, recall via command, tower + auto last hit.
import { createSim, step } from '../src/sim/sim';
import { describe, expect, it } from 'vitest';
import { Kind, Lane, sec, type PlayerSetup } from '../src/sim/types';
import { spawnMinion } from '../src/sim/systems/minions';
import { structureAt, towerShotDamage } from '../src/sim/systems/towers';
import { dealDamage } from '../src/sim/damage';

const player = (slot: number, team: 0 | 1): PlayerSetup => ({
  slot,
  team,
  champion: 'mira',
  role: 'mid',
  summoners: ['flash', 'ignite'],
  isHuman: slot === 0,
});

describe('economy with real champions', () => {
  it('start gold, passive gold, recall command, champion last hit', () => {
    const sim = createSim({ seed: 11, mode: 'sandbox', players: [player(0, 0), player(5, 1)], minionsEnabled: false });
    const me = sim.slots[0]!;
    const { Champ, Pos, Unit } = sim.c;
    expect(Champ.gold[me]).toBe(500);
    expect(Champ.level[me]).toBe(1);
    while (sim.tick < sec(120)) step(sim);
    expect(Champ.gold[me]).toBeGreaterThanOrEqual(500 + 108);
    expect(Champ.gold[me]).toBeLessThanOrEqual(500 + 112);

    // walk out, then recall
    step(sim, [{ slot: 0, cmd: { t: 'cheat', op: 'teleport', x: 5000, y: 5000 } }]);
    step(sim, [{ slot: 0, cmd: { t: 'recall' } }]);
    for (let i = 0; i < sec(8) + 1; i++) step(sim);
    const f = sim.map.sides[0].fountain;
    expect(Pos.x[me]).toBe(f.x);
    expect(Pos.y[me]).toBe(f.y);

    // caster hit by one tower shot (applied by hand, out of tower reach), then our auto finishes it -> gold + CS
    const tower = structureAt(sim, 0, Kind.Tower, Lane.Mid, 0)!.eid;
    step(sim, [{ slot: 0, cmd: { t: 'cheat', op: 'teleport', x: 7700, y: 7700 } }]);
    const caster = spawnMinion(sim, Kind.MinionCaster, 1, Lane.Mid, 8000, 8000);
    const s = towerShotDamage(sim, tower, caster);
    dealDamage(sim, tower, caster, s.amount, s.type, { raw: s.raw });
    const gold = Champ.gold[me]!;
    step(sim); // vision: commands may only target visible units
    step(sim, [{ slot: 0, cmd: { t: 'attack', target: caster } }]);
    for (let i = 0; i < sec(3) && Unit.alive[caster]; i++) step(sim);
    expect(Unit.alive[caster]).toBe(0);
    expect(Champ.cs[me]).toBe(1);
    expect(Champ.gold[me]).toBeGreaterThanOrEqual(gold + 14);
  });
});
