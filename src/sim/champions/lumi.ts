// Lumi Sternenwiege hooks: Wish Dust (heals and shields on allies below 40 % HP are 30 % stronger) and Last Wish (the
// targeted ally is also freed from crowd control; untargetable + projectile immunity + shield come from the data).
// No state; no Math.random/sin/cos.

import { removeBuffs } from '../buffs';
import type { Buff } from '../buffs';
import { alliedChampionsIn } from '../systems/abilities';
import type { ChampionHooks } from './hooks';

const LOW_HP = 0.4;
const BONUS = 1.3;
const CC = new Set(['slow', 'root', 'stun', 'silence', 'blind', 'fear', 'airborne', 'suppress', 'taunt']);

export const hooks: ChampionHooks = {
  // Passive badge glows while an ally within 1000 is below 40 % HP (the bonus applies to them).
  visuals(sim, eid) {
    const { Pos, Hp } = sim.c;
    const low = alliedChampionsIn(sim, eid, Pos.x[eid]!, Pos.y[eid]!, 1000).some((a) => Hp.cur[a]! < Hp.max[a]! * LOW_HP);
    return { passive: { ready: !!sim.c.Unit.alive[eid] && low } };
  },
  passive: {
    lumi_wishdust: {
      modifyHeal(sim, _eid, target, amount) {
        const { Hp } = sim.c;
        return Hp.cur[target]! < Hp.max[target]! * LOW_HP ? amount * BONUS : amount;
      },
    },
  },
  effects: {
    lumi_r_wish(sim, ctx) {
      if (ctx.phase !== 'cast' || ctx.target < 0) return;
      removeBuffs(sim, ctx.target, (b: Buff) => CC.has(b.kind));
    },
  },
};
