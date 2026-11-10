// Brigga Bollwerk hooks: Shield Wall passive (+6 armor and magic resist per allied champion within 600, up to 3).
// Everything else is data. No state; no Math.random/sin/cos.

import type { Sim } from '../sim';
import { alliedChampionsIn } from '../systems/abilities';
import type { ChampionHooks, ChampionVisuals } from './hooks';

const RADIUS = 600;
const PER = 6;
const MAX = 3;

const nearAllies = (sim: Sim, eid: number): number => {
  const { Pos } = sim.c;
  return Math.min(MAX, alliedChampionsIn(sim, eid, Pos.x[eid]!, Pos.y[eid]!, RADIUS).filter((a) => a !== eid).length);
};

export const hooks: ChampionHooks = {
  visuals(sim, eid): ChampionVisuals {
    const n = sim.c.Unit.alive[eid] ? nearAllies(sim, eid) : 0;
    return { passive: { stacks: n, max: MAX, ready: n >= MAX } };
  },
  passive: {
    brigga_wall: {
      onComputeStats(sim, eid) {
        const n = nearAllies(sim, eid);
        if (!n) return;
        sim.c.Stats.armor[eid] = sim.c.Stats.armor[eid]! + PER * n;
        sim.c.Stats.mr[eid] = sim.c.Stats.mr[eid]! + PER * n;
      },
    },
  },
};
