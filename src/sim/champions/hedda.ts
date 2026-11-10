// Hedda Fellwechsel hooks: two forms. Human = 550 range, E heals; Panther = 175 range, +12 % MS, +15 % AD, E swipes and
// ability damage on hunted (marked) targets is 50 % higher. W toggles, R leaps and shifts into the panther. State in
// sim.state keyed by champion eid; no Math.random/sin/cos.

import type { Sim } from '../sim';
import { sec } from '../types';
import { addBuff, hasBuff, healUnit } from '../buffs';
import { dealDamage } from '../damage';
import { enemiesInRadius, rv } from '../systems/abilities';
import type { ChampionHooks, ChampionVisuals } from './hooks';
import { hookState, peekState } from './util';

const PANTHER_RANGE = 175;
const PANTHER_MS = 1.12;
const PANTHER_AD = 1.15;
const HUNT_MULT = 1.5;
const HEAL = [50, 80, 110, 140, 170];
const SWIPE = [50, 85, 120, 155, 190];

interface Form {
  panther: boolean;
}
const form = (sim: Sim, eid: number): Form => {
  const m = hookState<Form>(sim, 'heddaForm');
  let f = m.get(eid);
  if (!f) m.set(eid, (f = { panther: false }));
  return f;
};

export const heddaPanther = (sim: Sim, eid: number): boolean => peekState<Form>(sim, 'heddaForm')?.get(eid)?.panther ?? false;

function shift(sim: Sim, eid: number, panther: boolean): void {
  const f = form(sim, eid);
  if (f.panther === panther) return;
  f.panther = panther;
  if (panther) addBuff(sim, eid, { kind: 'stat', stat: 'ms', id: 'hedda_prowl', src: eid, pct: 25, ticks: sec(2) });
  else healUnit(sim, eid, Math.max(0, sim.c.Hp.max[eid]! - sim.c.Hp.cur[eid]!) * 0.08);
}

export const hooks: ChampionHooks = {
  visuals(sim, eid): ChampionVisuals {
    const p = heddaPanther(sim, eid);
    return { passive: { ready: p }, ...(p ? { aura: 4 } : {}) };
  },
  passive: {
    hedda_forms: {
      onSpawn(sim, eid) {
        form(sim, eid);
      },
      onComputeStats(sim, eid) {
        if (!heddaPanther(sim, eid)) return;
        const { Stats } = sim.c;
        Stats.range[eid] = PANTHER_RANGE;
        Stats.ms[eid] = Stats.ms[eid]! * PANTHER_MS;
        Stats.ad[eid] = Stats.ad[eid]! * PANTHER_AD;
      },
      modifyDamage(sim, eid, target, amount, _type, isAuto) {
        return !isAuto && heddaPanther(sim, eid) && hasBuff(sim, target, 'mark', 'hedda_hunt') ? amount * HUNT_MULT : amount;
      },
    },
  },
  effects: {
    hedda_w_shift(sim, ctx) {
      if (ctx.phase === 'cast') shift(sim, ctx.caster, !heddaPanther(sim, ctx.caster));
    },
    hedda_r_pounce(sim, ctx) {
      if (ctx.phase === 'cast') shift(sim, ctx.caster, true);
    },
    hedda_e_wild(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      const { Stats, Pos } = sim.c;
      const ap = Stats.ap[ctx.caster]!;
      if (!heddaPanther(sim, ctx.caster)) return void healUnit(sim, ctx.caster, rv(HEAL, ctx.rank) + 0.4 * ap);
      const dmg = rv(SWIPE, ctx.rank) + 0.6 * ap;
      for (const e of enemiesInRadius(sim, ctx.caster, Pos.x[ctx.caster]!, Pos.y[ctx.caster]!, ctx.ability.radius ?? 300)) dealDamage(sim, ctx.caster, e, dmg, 'magic');
    },
  },
};
