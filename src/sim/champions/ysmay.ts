// Ysmay Degenfeld hooks: Parry (W: 0.8 s window, all damage taken is given back, a champion attacker within 500 is stunned),
// Riposte passive (a successful parry = +30 % attack speed 3 s and half the parry cooldown back), Lunge (Q stops at the
// first enemy). State in sim.state keyed by champion eid; no Math.random/sin/cos.

import type { Sim } from '../sim';
import { Kind, sec } from '../types';
import { addBuff } from '../buffs';
import { dist2 } from '../vec';
import { cooldownLeft, reduceCooldown, rv } from '../systems/abilities';
import type { ChampionHooks, ChampionVisuals } from './hooks';
import { hookState, peekState } from './util';

const RANGE = 500;

interface Parry {
  until: number;
  rank: number;
  total: number;
}

export const ysmayParrying = (sim: Sim, eid: number): boolean => (peekState<Parry>(sim, 'ysmayParry')?.get(eid)?.until ?? -1) > sim.tick;

export const hooks: ChampionHooks = {
  visuals(sim, eid): ChampionVisuals {
    const p = peekState<Parry>(sim, 'ysmayParry')?.get(eid);
    const on = !!p && p.until > sim.tick;
    return { passive: { ready: on }, ...(on ? { aura: 1 } : {}) };
  },
  passive: {
    ysmay_riposte: {
      onDamageTaken(sim, eid, src, info) {
        const p = peekState<Parry>(sim, 'ysmayParry')?.get(eid);
        if (!p || p.until <= sim.tick || info.amount <= 0) return;
        const { Hp, Pos, Unit } = sim.c;
        Hp.cur[eid] = Math.min(Hp.max[eid]!, Hp.cur[eid]! + info.amount);
        p.until = -1;
        addBuff(sim, eid, { kind: 'stat', stat: 'as', id: 'ysmay_riposte', src: eid, pct: 30, ticks: sec(3) });
        reduceCooldown(sim, eid, 1, Math.round(cooldownLeft(sim, eid, 1) * 0.5));
        if (src >= 0 && Unit.kind[src] === Kind.Champion && dist2(Pos.x[eid]!, Pos.y[eid]!, Pos.x[src]!, Pos.y[src]!) <= RANGE * RANGE) {
          addBuff(sim, src, { kind: 'stun', id: 'ysmay_riposte', src: eid, ticks: sec(1 + 0.25 * (p.rank - 1)) });
        }
      },
    },
  },
  effects: {
    ysmay_w_parry(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      const total = sec(rv(ctx.ability.duration ?? 0.8, ctx.rank));
      hookState<Parry>(sim, 'ysmayParry').set(ctx.caster, { until: sim.tick + total, rank: ctx.rank, total });
    },
    ysmay_q_lunge(_sim, ctx) {
      if (ctx.phase === 'dashStart' && ctx.dash) ctx.dash.stopAtEnemy = (ctx.ability.width ?? 120) / 2;
    },
  },
};
