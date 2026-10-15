// Ferris Lampenhand hooks. Contract: ./hooks.ts, behaviour list: docs/champion-hooks.md.
import { removeBuffs } from '../buffs';
import { alliedChampionsIn } from '../systems/abilities';
import type { ChampionHooks } from './hooks';

export const hooks: ChampionHooks = {
  passive: {
    // +10 % heals and shields while another allied champion is within 800.
    ferris_companion: {
      modifyHeal(sim, eid, _target, amount) {
        const { Pos } = sim.c;
        return alliedChampionsIn(sim, eid, Pos.x[eid]!, Pos.y[eid]!, 800).some((a) => a !== eid) ? amount * 1.1 : amount;
      },
    },
  },
  effects: {
    // E removes slows from the targeted ally and from Ferris.
    ferris_e_cleanse_slows(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      for (const t of [ctx.target, ctx.caster]) if (t >= 0) removeBuffs(sim, t, (b) => b.kind === 'slow');
    },
  },
};
