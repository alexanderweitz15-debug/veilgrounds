// Zinna Funkenlauf hooks: Arc Jump (every third auto on a target arcs to the nearest other enemy for 70 % as magic damage),
// Overcharge (W makes the next auto arc at once), Backfire (E hops away from the cursor). State in sim.state keyed by
// champion eid; no Math.random/sin/cos.

import type { Sim } from '../sim';
import { dealDamage } from '../damage';
import { dist2 } from '../vec';
import { enemiesInRadius } from '../systems/abilities';
import type { ChampionHooks, ChampionVisuals } from './hooks';
import { hookState, peekState } from './util';

const RADIUS = 450;
const MULT = 0.7;

interface Arc {
  target: number;
  n: number;
  charged: boolean;
}
const arcs = (sim: Sim): Map<number, Arc> => hookState<Arc>(sim, 'zinnaArc');

export const zinnaArcCount = (sim: Sim, eid: number): number => peekState<Arc>(sim, 'zinnaArc')?.get(eid)?.n ?? 0;

export const hooks: ChampionHooks = {
  visuals(sim, eid): ChampionVisuals {
    const n = zinnaArcCount(sim, eid);
    return { passive: { stacks: n, max: 3, ready: n >= 2 } };
  },
  passive: {
    zinna_arc: {
      onAutoHit(sim, eid, target, damage) {
        const m = arcs(sim);
        let a = m.get(eid);
        if (!a) m.set(eid, (a = { target: -1, n: 0, charged: false }));
        if (a.target !== target) (a.target = target), (a.n = 0);
        if (a.charged) (a.charged = false), (a.n = 2);
        a.n++;
        if (a.n < 3) return;
        a.n = 0;
        const { Pos } = sim.c;
        let best = -1;
        let bd = Infinity;
        for (const e of enemiesInRadius(sim, eid, Pos.x[target]!, Pos.y[target]!, RADIUS)) {
          if (e === target) continue;
          const d = dist2(Pos.x[e]!, Pos.y[e]!, Pos.x[target]!, Pos.y[target]!);
          if (d < bd) (bd = d), (best = e);
        }
        if (best >= 0) dealDamage(sim, eid, best, damage * MULT, 'magic');
      },
    },
  },
  effects: {
    zinna_w_charge(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      const m = arcs(sim);
      const a = m.get(ctx.caster) ?? { target: -1, n: 0, charged: false };
      a.charged = true; // the next auto counts as the third
      m.set(ctx.caster, a);
    },
    zinna_e_backfire(_sim, ctx) {
      if (ctx.phase === 'dashStart' && ctx.dash) {
        ctx.dash.dx = -ctx.dash.dx;
        ctx.dash.dy = -ctx.dash.dy;
      }
    },
  },
};
