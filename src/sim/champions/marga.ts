// Marga Kartaune hooks: Long Shot (ability damage grows with the distance to the target), Recoil (E hops away from the
// cursor and shoves enemies at the old spot back). All state-free; no Math.random/sin/cos.

import { sec } from '../types';
import { addBuff } from '../buffs';
import { dist2 } from '../vec';
import { displace, enemiesInRadius } from '../systems/abilities';
import type { ChampionHooks, ChampionVisuals } from './hooks';
import { peekState, hookState } from './util';

const FAR_START = 500;
const FAR_FULL = 1100;
const FAR_MAX_PCT = 24;
const RECOIL_RADIUS = 300;
const RECOIL_PUSH = 220;

/** Damage multiplier for a target `d` units away. */
export const longShotMult = (d: number): number => 1 + (Math.min(FAR_FULL, Math.max(FAR_START, d)) - FAR_START) * (FAR_MAX_PCT / (FAR_FULL - FAR_START) / 100);

/** Last Long Shot bonus (percent) and the tick it applied: the passive badge shows it for 3 s. */
interface Last { pct: number; tick: number }

export const hooks: ChampionHooks = {
  visuals(sim, eid): ChampionVisuals {
    const l = peekState<Last>(sim, 'margaLast')?.get(eid);
    const live = !!l && sim.tick - l.tick < sec(3);
    return { passive: { stacks: live ? Math.round(l.pct) : 0, max: FAR_MAX_PCT, ready: live && l.pct >= FAR_MAX_PCT } };
  },
  passive: {
    marga_range: {
      modifyDamage(sim, eid, target, amount, _type, isAuto) {
        if (isAuto) return amount;
        const { Pos } = sim.c;
        const mult = longShotMult(Math.sqrt(dist2(Pos.x[eid]!, Pos.y[eid]!, Pos.x[target]!, Pos.y[target]!)));
        hookState<Last>(sim, 'margaLast').set(eid, { pct: (mult - 1) * 100, tick: sim.tick });
        return amount * mult;
      },
    },
  },
  effects: {
    marga_e_recoil(sim, ctx) {
      if (ctx.phase !== 'dashStart' || !ctx.dash) return;
      ctx.dash.dx = -ctx.dash.dx;
      ctx.dash.dy = -ctx.dash.dy;
      const { Pos } = sim.c;
      for (const e of enemiesInRadius(sim, ctx.caster, Pos.x[ctx.caster]!, Pos.y[ctx.caster]!, RECOIL_RADIUS)) {
        displace(sim, ctx.caster, e, RECOIL_PUSH, sec(0.25));
        addBuff(sim, e, { kind: 'slow', id: 'marga_recoil', src: ctx.caster, pct: 20, ticks: sec(1.2) });
      }
    },
  },
};
