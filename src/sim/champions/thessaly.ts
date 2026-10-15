// Thessaly Vorn hooks. Contract: ./hooks.ts, behaviour list: docs/champion-hooks.md.
import type { Sim } from '../sim';
import { sec } from '../types';
import { dealDamage } from '../damage';
import { hasBuff } from '../buffs';
import type { ChampionHooks } from './hooks';
import { hookState } from './util';

const FREE_CD = sec(12);
/** Tick from which the next ability is free, per eid. */
const freeAt = (sim: Sim): Map<number, number> => hookState<number>(sim, 'thessalyFree');

export const hooks: ChampionHooks = {
  passive: {
    // Every 12 s the next ability costs no mana; the timer restarts on that cast. W reflect lives here too
    // (onDamageTaken), active while the W shield holds.
    thessaly_free_cast: {
      onSpawn(sim, eid) {
        freeAt(sim).set(eid, 0);
      },
      modifyCast(sim, eid, _slot, m) {
        if (sim.tick >= (freeAt(sim).get(eid) ?? 0)) m.cost = 0;
      },
      onCast(sim, eid) {
        if (sim.tick >= (freeAt(sim).get(eid) ?? 0)) freeAt(sim).set(eid, sim.tick + FREE_CD);
      },
      onDamageTaken(sim, eid, src, info) {
        // 25 % of the absorbed amount back as magic damage (>= 1: no ping-pong between two shielded Thessalys)
        if (src < 0 || info.absorbed < 1 || !hasBuff(sim, eid, 'shield', 'thessaly_w')) return;
        dealDamage(sim, eid, src, 0.25 * info.absorbed, 'magic');
      },
    },
  },
  effects: {
    // ponytail: the reflect is the passive's onDamageTaken while the W shield buff exists; nothing to do on cast.
    thessaly_w_reflect() {},
    // Listed before the damage: +50 % R damage below 30 % HP.
    thessaly_r_execute_bonus(sim, ctx) {
      const t = ctx.hits[0];
      if (ctx.phase !== 'cast' || t === undefined) return;
      if (sim.c.Hp.cur[t]! < 0.3 * sim.c.Hp.max[t]!) ctx.dmgMult = 1.5;
    },
  },
};
