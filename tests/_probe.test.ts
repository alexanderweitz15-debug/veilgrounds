import { it } from 'vitest';
import { Kind } from '../src/sim/types';
import { botGameConfig } from '../src/ai/runner';
import { runUtilityGame } from './utilityHarness';
it('probe', () => {
  const cfg = botGameConfig(2, 'diamond');
  runUtilityGame(cfg, 17740, (sim, inputs, bots) => {
    const { Unit, Pos } = sim.c;
    for (const i of inputs) {
      if (i.cmd.t !== 'recall' || sim.tick < 17600) continue;
      const eid = sim.slots[i.slot]!;
      const ds: number[] = [];
      for (let e = 0; e < Unit.kind.length; e++) {
        const k = Unit.kind[e];
        if (!Unit.alive[e] || Unit.team[e] === Unit.team[eid] || (k !== Kind.MinionMelee && k !== Kind.MinionCaster && k !== Kind.MinionSiege)) continue;
        ds.push(Math.round(Math.hypot(Pos.x[e]! - Pos.x[eid]!, Pos.y[e]! - Pos.y[eid]!)));
      }
      console.log('RECALL', sim.tick, i.slot, 'dists', ds.sort((a, b) => a - b).slice(0, 16).join(','));
      const es = bots.log.entries(i.slot).filter((x) => x.tick > sim.tick - 400);
      console.log(JSON.stringify(es.slice(-12)));
    }
  });
}, 600_000);
