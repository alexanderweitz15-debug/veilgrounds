// Kaelen Rasch hooks. Contract: ./hooks.ts, behaviour list: docs/champion-hooks.md.
import type { Sim } from '../sim';
import { Kind, sec } from '../types';
import { dealDamage, lastCombatTick } from '../damage';
import { addBuff, hasBuff, removeBuffs } from '../buffs';
import { dist2 } from '../vec';
import { enemiesInRadius, reduceCooldown } from '../systems/abilities';
import type { ChampionHooks } from './hooks';
import { byLevel, hookState } from './util';

interface KaelenState {
  /** Follow-through armed until this tick. */
  follow: number;
  /** R kill: vanish as soon as out of combat, until this tick. */
  vanish: number;
}

const state = (sim: Sim, eid: number): KaelenState => {
  const m = hookState<KaelenState>(sim, 'kaelen');
  let s = m.get(eid);
  if (!s) m.set(eid, (s = { follow: -1, vanish: -1 }));
  return s;
};

const MARK = 'kaelen_mark';
const OUT_OF_COMBAT = sec(1);

export const hooks: ChampionHooks = {
  passive: {
    // After any own dash: next auto within 2 s deals bonus physical damage.
    kaelen_follow_through: {
      onDashEnd(sim, eid) {
        state(sim, eid).follow = sim.tick + sec(2);
      },
      onAutoHit(sim, eid, target) {
        const s = state(sim, eid);
        if (sim.tick > s.follow) return;
        s.follow = -1;
        dealDamage(sim, eid, target, byLevel(sim, eid, 30, 120) + 0.4 * sim.c.Stats.bonusAd[eid]!, 'phys');
      },
    },
  },
  onTick(sim, eid) {
    const s = state(sim, eid);
    if (s.vanish < 0) return;
    if (sim.tick > s.vanish || !sim.c.Unit.alive[eid]) return void (s.vanish = -1);
    if (sim.tick - lastCombatTick(sim, eid) >= OUT_OF_COMBAT) {
      s.vanish = -1;
      addBuff(sim, eid, { kind: 'stat', stat: 'invisible', id: 'kaelen_r', src: eid, ticks: sec(10) });
    }
  },
  effects: {
    // W toward a kaelen_mark target near the cursor dashes onto it (range 900) and consumes the mark.
    kaelen_w_dash_to_mark(sim, ctx) {
      if (ctx.phase !== 'dashStart' || !ctx.dash) return;
      const { Pos } = sim.c;
      const e = ctx.caster;
      let best = -1;
      let bestD = Infinity;
      for (const t of enemiesInRadius(sim, e, ctx.cursorX, ctx.cursorY, 250)) {
        if (!hasBuff(sim, t, 'mark', MARK) || dist2(Pos.x[t]!, Pos.y[t]!, Pos.x[e]!, Pos.y[e]!) > 900 * 900) continue;
        const d = dist2(Pos.x[t]!, Pos.y[t]!, ctx.cursorX, ctx.cursorY);
        if (d < bestD) (bestD = d), (best = t);
      }
      if (best < 0) return;
      removeBuffs(sim, best, (b) => b.kind === 'mark' && b.id === MARK);
      ctx.dash.target = best;
      ctx.dash.distance = 900;
    },
    // E hitting an enemy champion: W cooldown -2 s (once per cast).
    kaelen_e_w_refund(sim, ctx) {
      if (ctx.phase === 'cast' && ctx.hits.some((t) => sim.c.Unit.kind[t] === Kind.Champion)) reduceCooldown(sim, ctx.caster, 1, sec(2));
    },
    // R kill: invisible for 10 s once out of combat (window 5 s).
    kaelen_r_vanish(sim, ctx) {
      const t = ctx.hits[0];
      if (ctx.phase === 'cast' && t !== undefined && sim.c.Unit.kind[t] === Kind.Champion && !sim.c.Unit.alive[t]) state(sim, ctx.caster).vanish = sim.tick + sec(5);
    },
  },
};
