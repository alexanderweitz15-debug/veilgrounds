// Rovena Aderlass hooks (blood mage, mid). Contract: ./hooks.ts, behaviour list: docs/champion-hooks.md.
// Passive Bloodtithe: abilities cost health (the HP cost itself is engine data, costType 'hp'); ability damage heals her;
// below 35 % HP "Bloodrush" boosts damage and healing. Q marks, E detonates the mark, R drains all enemies in range.
import type { Sim } from '../sim';
import { isStructure, sec } from '../types';
import { effectiveResist, mitigation } from '../damage';
import { addBuff, hasBuff, healUnit, removeBuffs } from '../buffs';
import type { ChampionHooks, ChampionVisuals } from './hooks';
import { hookState, isChampLike, peekState } from './util';
import V from '../../data/champions/rovena.values.json';

interface RState {
  /** Tick of the last Bloodtide resolution (its damage heals double). */
  drainTick: number;
}
const KEY = 'rovena';
const state = (sim: Sim, eid: number): RState => {
  const m = hookState<RState>(sim, KEY);
  let s = m.get(eid);
  if (!s) m.set(eid, (s = { drainTick: -1 }));
  return s;
};

/** Bloodrush: HP below the threshold (read-only, used by visuals, tests and the bot rule). */
export const rovenaRush = (sim: Sim, eid: number): boolean => sim.c.Hp.cur[eid]! < V.rush.hpFrac * sim.c.Hp.max[eid]!;

export const hooks: ChampionHooks = {
  visuals(sim: Sim, eid: number): ChampionVisuals {
    const rush = !!sim.c.Unit.alive[eid] && rovenaRush(sim, eid);
    return { passive: { ready: rush }, ...(rush ? { aura: 4 } : {}) };
  },
  passive: {
    rovena_bloodtithe: {
      onSpawn(sim, eid) {
        state(sim, eid);
      },
      // Q, W, E also cost a share of max HP (scales the price with her health pool)
      modifyCast(sim, eid, slot, m) {
        if (slot < 3) m.cost += V.cost.maxHpFrac * sim.c.Hp.max[eid]!;
      },
      // ponytail: no engine hook reports damage dealt to the source; the heal-back estimates it as pre-mitigation amount x
      // mitigation (shields not counted). Upgrade path: an onDamageDealt hook with the real number.
      modifyDamage(sim, eid, t, amount, type, isAuto) {
        const { Unit } = sim.c;
        if (isAuto || Unit.team[t] === Unit.team[eid] || isStructure(Unit.kind[t]!)) return amount;
        const rush = rovenaRush(sim, eid);
        const out = rush ? amount * V.rush.dmgMult : amount;
        const dealt = out * mitigation(effectiveResist(sim, eid, t, type));
        const drain = state(sim, eid).drainTick === sim.tick ? V.drainMult : 1;
        healUnit(sim, eid, dealt * (isChampLike(sim, t) ? V.healChamp : V.healOther) * (rush ? V.rush.healMult : 1) * drain);
        return out;
      },
    },
  },
  effects: {
    // E (before the damage): a Vein Cut mark is consumed for +40 % damage and a short root.
    rovena_e_detonate(sim, ctx) {
      const t = ctx.hits[0] ?? ctx.target;
      if (ctx.phase !== 'cast' || t < 0 || !hasBuff(sim, t, 'mark', 'rovena_blood')) return;
      removeBuffs(sim, t, (b) => b.kind === 'mark' && b.id === 'rovena_blood');
      ctx.dmgMult = (ctx.dmgMult ?? 1) * V.detonate.dmgMult;
      addBuff(sim, t, { kind: 'root', id: 'rovena_e', src: ctx.caster, ticks: sec(V.detonate.rootSec) });
    },
    // R (before the damage): this resolution's heal-back is doubled.
    rovena_r_drain(sim, ctx) {
      if (ctx.phase === 'cast') state(sim, ctx.caster).drainTick = sim.tick;
    },
  },
};

export const rovenaDraining = (sim: Sim, eid: number): boolean => peekState<RState>(sim, KEY)?.get(eid)?.drainTick === sim.tick;
