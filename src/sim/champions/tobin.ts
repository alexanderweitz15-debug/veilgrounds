// Tobin Sturmkiel hooks: sea legs (AS after dashes/blinks), tether (Q), empowered auto (W).

import type { Sim } from '../sim';
import { isRef } from '../sim';
import { sec } from '../types';
import { addBuff } from '../buffs';
import { dist2 } from '../vec';
import type { ChampionHooks } from './hooks';
import { stateMap } from './dagny';

interface Tether {
  target: number;
  serial: number;
  end: number;
}
const tethers = (sim: Sim): Map<number, Tether> => stateMap<Tether>(sim, 'tobinTether');
const TETHER_RANGE = 650;

export const tobinTetherTarget = (sim: Sim, eid: number): number => tethers(sim).get(eid)?.target ?? -1;

/** Per-tick: resolve the tether at its end (root 1 s if farther than 650); it breaks if Tobin dies. */
function tobinTick(sim: Sim, eid: number): void {
  const t = tethers(sim).get(eid);
  if (!t) return;
  if (!sim.c.Unit.alive[eid] || !isRef(sim, t.target, t.serial)) return void tethers(sim).delete(eid);
  if (sim.tick < t.end) return;
  tethers(sim).delete(eid);
  const { Pos } = sim.c;
  if (dist2(Pos.x[eid]!, Pos.y[eid]!, Pos.x[t.target]!, Pos.y[t.target]!) > TETHER_RANGE * TETHER_RANGE)
    addBuff(sim, t.target, { kind: 'root', id: 'tobin_q', src: eid, ticks: sec(1) });
}

export const hooks: ChampionHooks = {
  onTick: tobinTick,
  passive: {
    tobin_sea_legs: {
      // W dash end and Flash (slot -1) alike
      onDashEnd(sim, eid) {
        addBuff(sim, eid, { kind: 'stat', stat: 'as', id: 'tobin_sea_legs', src: eid, pct: 20, ticks: sec(3) });
      },
    },
  },
  effects: {
    tobin_q_tether(sim, ctx) {
      const t = ctx.hits[0];
      if (t === undefined) return;
      tethers(sim).set(ctx.caster, { target: t, serial: sim.c.Unit.serial[t]!, end: sim.tick + sec(2.5) });
    },
    // engine arms the next auto (`*_next_auto`) and applies the listed slow on it
    tobin_w_next_auto() {},
  },
};
