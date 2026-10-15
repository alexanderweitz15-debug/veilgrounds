// Lio Funkenkind hooks: spark load (passive), end burst (Q), empowered auto + reset (W), spark rain (R).

import type { Sim } from '../sim';
import { Kind, sec } from '../types';
import { addBuff } from '../buffs';
import { dealDamage } from '../damage';
import { applyEffects, enemiesInRadius, setCooldown } from '../systems/abilities';
import type { ChampionHooks, EffectCtx } from './hooks';
import { abilityOf, byLevel, stateMap, tickCtx } from './dagny';

// ------------------------------------------------------------------ sparks

interface Spark {
  serial: number;
  count: number;
  until: number;
}
const sparkMap = (sim: Sim, lio: number): Map<number, Spark> => {
  const all = stateMap<Map<number, Spark>>(sim, 'lioSparks');
  let m = all.get(lio);
  if (!m) all.set(lio, (m = new Map()));
  return m;
};

export function lioSparks(sim: Sim, lio: number, t: number): number {
  const s = sparkMap(sim, lio).get(t);
  return s && s.serial === sim.c.Unit.serial[t] && s.until > sim.tick ? s.count : 0;
}

/** An ability hit: add a spark (4 s); the 3rd explodes for byLevel 40-180 (+0.3 AP) magic, +50 % vs monsters. */
function addSpark(sim: Sim, lio: number, t: number): void {
  if (!sim.c.Unit.alive[t]) return;
  const n = lioSparks(sim, lio, t) + 1;
  if (n < 3) return void sparkMap(sim, lio).set(t, { serial: sim.c.Unit.serial[t]!, count: n, until: sim.tick + sec(4) });
  sparkMap(sim, lio).delete(t);
  const mult = sim.c.Unit.kind[t] === Kind.Monster ? 1.5 : 1;
  dealDamage(sim, lio, t, (byLevel(sim, lio, 40, 180) + 0.3 * sim.c.Stats.ap[lio]!) * mult, 'magic');
}

// ------------------------------------------------------------------ R rain

interface Rain {
  x: number;
  y: number;
  rank: number;
  next: number;
  left: number;
  /** Hits per target during this cast (the 3rd hit stuns, once). */
  count: Map<number, number>;
}
const rains = (sim: Sim): Map<number, Rain> => stateMap<Rain>(sim, 'lioRain');

function countRainHits(sim: Sim, lio: number, r: Rain, hits: number[]): void {
  for (const t of hits) {
    const n = (r.count.get(t) ?? 0) + 1;
    r.count.set(t, n);
    if (n === 3) addBuff(sim, t, { kind: 'stun', id: 'lio_r', src: lio, ticks: sec(1) });
  }
}

/** Per-tick: R strikes 2..5. */
function lioTick(sim: Sim, eid: number): void {
  const r = rains(sim).get(eid);
  if (!r || sim.tick < r.next) return;
  const hits = enemiesInRadius(sim, eid, r.x, r.y, abilityOf(sim, eid, 3).radius ?? 400);
  applyEffects(sim, tickCtx(sim, eid, 3, r.rank, hits, r.x, r.y), 'hit');
  countRainHits(sim, eid, r, hits);
  if (--r.left <= 0) rains(sim).delete(eid);
  else r.next += sec(0.25);
}

/** Q stone explodes at (ctx.x, ctx.y): every other enemy within the ability radius takes the Q effects. */
function burst(sim: Sim, ctx: EffectCtx): void {
  const others = enemiesInRadius(sim, ctx.caster, ctx.x, ctx.y, ctx.ability.radius ?? 200).filter((e) => !ctx.hits.includes(e));
  if (others.length) applyEffects(sim, { ...ctx, hits: others }, 'hit');
}

export const hooks: ChampionHooks = {
  onTick: lioTick,
  passive: {
    lio_spark_load: {
      onAbilityHit(sim, eid, target) {
        addSpark(sim, eid, target);
      },
      // W reset: an enemy champion Lio damaged within 3 s died
      onTakedown(sim, eid) {
        setCooldown(sim, eid, 1, 0);
      },
    },
  },
  effects: {
    // Hit: the stone explodes on the first enemy (generic damage already on it). Max range: phase 'expire'.
    lio_q_end_burst(sim, ctx) {
      burst(sim, ctx);
    },
    // engine arms the next auto (`*_next_auto`) and applies the listed damage on it
    lio_w_next_auto() {},
    // the reset itself is the passive's onTakedown
    lio_w_reset() {},
    // Strike 1 = the cast resolution; strikes 2..5 every 0.25 s via onTick.
    lio_r_spark_rain(sim, ctx) {
      const r: Rain = { x: ctx.x, y: ctx.y, rank: ctx.rank, next: sim.tick + sec(0.25), left: 4, count: new Map() };
      rains(sim).set(ctx.caster, r);
      countRainHits(sim, ctx.caster, r, ctx.hits);
    },
  },
};
