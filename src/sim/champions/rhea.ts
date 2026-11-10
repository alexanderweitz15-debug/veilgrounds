// Rhea Doppelbolzen hooks: Double Bolt (after any ability cast the next auto fires an extra bolt for 60 % damage),
// Fall Back (E hops away from the cursor). State in sim.state keyed by champion eid; no Math.random/sin/cos.

import type { Sim } from '../sim';
import type { ChampionHooks, ChampionVisuals } from './hooks';
import { hookState, peekState } from './util';

const EXTRA = 0.6;

const armed = (sim: Sim): Map<number, boolean> => hookState<boolean>(sim, 'rheaArmed');

export const rheaArmed = (sim: Sim, eid: number): boolean => peekState<boolean>(sim, 'rheaArmed')?.get(eid) ?? false;

export const hooks: ChampionHooks = {
  visuals(sim, eid): ChampionVisuals {
    return { passive: { ready: rheaArmed(sim, eid) }, ...(rheaArmed(sim, eid) ? { empowered: 4 } : {}) };
  },
  passive: {
    rhea_double: {
      onCast(sim, eid) {
        armed(sim).set(eid, true);
      },
      onAutoFire(sim, eid) {
        const m = armed(sim);
        if (!m.get(eid)) return;
        m.set(eid, false);
        return [EXTRA];
      },
    },
  },
  effects: {
    rhea_e_back(_sim, ctx) {
      if (ctx.phase === 'dashStart' && ctx.dash) {
        ctx.dash.dx = -ctx.dash.dx;
        ctx.dash.dy = -ctx.dash.dy;
      }
    },
  },
};
