// Gorvam Kettenmund hooks. Contract: ./hooks.ts, behaviour list: docs/champion-hooks.md.
import { sec } from '../types';
import { addBuff } from '../buffs';
import { cancelCast, displace } from '../systems/abilities';
import type { ChampionHooks } from './hooks';
import { hookState, peekState } from './util';

const PULL_TICKS = sec(1.5);

export const hooks: ChampionHooks = {
  // Passive badge counts autos 0..3; the 4th (slowing) auto glows as an empowered auto.
  visuals(sim, eid) {
    const n = peekState<number>(sim, 'gorvamChains')?.get(eid) ?? 0;
    const next = n === 3;
    return { passive: { stacks: n, max: 4, ready: next }, ...(next && sim.c.Unit.alive[eid] ? { empowered: 4 } : {}) };
  },
  passive: {
    // Every 4th auto slows its target by 40 % for 1 s.
    gorvam_heavy_chains: {
      onAutoHit(sim, eid, target) {
        const m = hookState<number>(sim, 'gorvamChains');
        const n = (m.get(eid) ?? 0) + 1;
        m.set(eid, n % 4);
        if (n >= 4) addBuff(sim, target, { kind: 'slow', id: 'gorvam_chains', src: eid, pct: 40, ticks: sec(1) });
      },
    },
  },
  effects: {
    // The first unit hit is dragged to Gorvam over 1.5 s (airborne while dragged).
    gorvam_q_drag(sim, ctx) {
      const t = ctx.hits[0];
      if (ctx.phase === 'cast' && t !== undefined && sim.c.Unit.alive[t]) displace(sim, ctx.caster, t, -1e6, PULL_TICKS);
    },
    // Recast during the wind-up: cancel, refund the mana, 2 s cooldown.
    gorvam_q_fake_cancel(sim, ctx) {
      if (ctx.phase === 'recast') cancelCast(sim, ctx.caster, { refund: true, cooldownTicks: sec(2) });
    },
    // ponytail: arming and the airborne on the empowered auto are generic (engine next-auto handling).
    gorvam_w_next_auto() {},
    // All enemies within 500 are reeled in over 1.5 s (end just outside his hitbox).
    gorvam_r_reel_in(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      for (const t of ctx.hits) if (sim.c.Unit.alive[t]) displace(sim, ctx.caster, t, -1e6, PULL_TICKS);
    },
  },
};
