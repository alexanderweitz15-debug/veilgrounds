// Seraphyne Sturm hooks. Contract: ./hooks.ts, behaviour list: docs/champion-hooks.md.
// Passive: +15 % MS for 3 s after every ability (onCast, one refreshing buff); R: three strikes.
import type { Sim } from '../sim';
import { sec } from '../types';
import { addBuff, buffs } from '../buffs';
import { applyEffects, enemiesInRadius } from '../systems/abilities';
import type { ChampionHooks, ChampionVisuals, EffectCtx } from './hooks';
import { ctxFor, hookState, peekState } from './util';
import { abilityOf } from './dagny';

interface Strike {
  x: number;
  y: number;
  rank: number;
  at: number;
  /** 2 or 3 (strike number). */
  n: number;
}

const strikes = (sim: Sim, eid: number): Strike[] => {
  const m = hookState<Strike[]>(sim, 'seraphyneR');
  let l = m.get(eid);
  if (!l) m.set(eid, (l = []));
  return l;
};

const GAP = sec(0.8);
/** Passive move speed buff id (aura colour: passive). */
const PASSIVE_MS = 'seraphyne_p_electrified';

function strike(sim: Sim, ctx: EffectCtx, hits: number[], third: boolean): void {
  applyEffects(sim, { ...ctx, hits }, 'hit');
  if (third) for (const t of hits) addBuff(sim, t, { kind: 'stun', id: 'seraphyne_r', src: ctx.caster, ticks: sec(1) });
}

export const hooks: ChampionHooks = {
  ownsHits: ['seraphyne_r'],
  passive: {
    // Every ability: +15 % MS for 3 s; one buff id, so casts refresh it instead of stacking.
    seraphyne_electrified: {
      onCast(sim, eid) {
        addBuff(sim, eid, { kind: 'stat', stat: 'ms', id: PASSIVE_MS, src: eid, pct: 15, ticks: sec(3) });
      },
    },
  },
  // HUD: the passive badge glows while the move speed bonus runs (timer = longest remaining ability ms buff).
  // R: the strikes still to come (2 and 3, same circle) as a tightening ring with the strike count; visible to everyone
  // so the enemy can step out (the zone event only telegraphs the first strike).
  visuals(sim, eid) {
    let until = 0;
    let start = 0;
    for (const b of buffs(sim, eid)) if (b.kind === 'stat' && b.stat === 'ms' && b.id === PASSIVE_MS && b.until > until) (until = b.until), (start = b.start);
    const left = until - sim.tick;
    const v: ChampionVisuals = { passive: left > 0 ? { ready: true, cdLeft: left, cdTotal: until - start } : { ready: false } };
    const next = peekState<Strike[]>(sim, 'seraphyneR')?.get(eid)?.[0];
    if (next && sim.c.Unit.alive[eid])
      v.objects = [{ key: `${eid}`, tag: 'seraphyne_r_strike', x: next.x, y: next.y, r: abilityOf(sim, eid, 3).radius ?? 220, shape: 'ring', n: next.n === 2 ? 2 : 1, left: Math.max(0, next.at - sim.tick), total: GAP }];
    return v;
  },
  onTick(sim, eid) {
    const l = strikes(sim, eid);
    if (l.length === 0) return;
    const due = l.filter((s) => sim.tick >= s.at);
    if (due.length === 0) return;
    hookState<Strike[]>(sim, 'seraphyneR').set(eid, l.filter((s) => sim.tick < s.at));
    for (const s of due) {
      const ctx = ctxFor(sim, eid, 3, s.rank, s.x, s.y);
      strike(sim, ctx, enemiesInRadius(sim, eid, s.x, s.y, ctx.ability.radius ?? 220), s.n === 3);
    }
  },
  effects: {
    // Hit producer: strikes at 0, 0.8 and 1.6 s on the target circle; the third also stuns for 1 s.
    seraphyne_r_three_strikes(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      strike(sim, ctx, ctx.hits, false);
      const l = strikes(sim, ctx.caster);
      l.push({ x: ctx.x, y: ctx.y, rank: ctx.rank, at: sim.tick + GAP, n: 2 }, { x: ctx.x, y: ctx.y, rank: ctx.rank, at: sim.tick + 2 * GAP, n: 3 });
    },
  },
};
