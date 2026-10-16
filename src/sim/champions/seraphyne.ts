// Seraphyne Sturm hooks. Contract: ./hooks.ts, behaviour list: docs/champion-hooks.md.
// Her passive (+15 % MS after abilities) is plain data (self ms buffs), so this file only owns R.
import type { Sim } from '../sim';
import { sec } from '../types';
import { addBuff, buffs } from '../buffs';
import { applyEffects, enemiesInRadius } from '../systems/abilities';
import type { ChampionHooks, EffectCtx } from './hooks';
import { ctxFor, hookState } from './util';

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

function strike(sim: Sim, ctx: EffectCtx, hits: number[], third: boolean): void {
  applyEffects(sim, { ...ctx, hits }, 'hit');
  if (third) for (const t of hits) addBuff(sim, t, { kind: 'stun', id: 'seraphyne_r', src: ctx.caster, ticks: sec(1) });
}

export const hooks: ChampionHooks = {
  ownsHits: ['seraphyne_r'],
  passive: {
    // The +15 % MS itself is data (self ms buff on every ability); this id makes the passive explicit (HUD badge).
    seraphyne_electrified: {},
  },
  // HUD: the passive badge glows while the move speed bonus runs (timer = longest remaining ability ms buff).
  visuals(sim, eid) {
    let until = 0;
    let start = 0;
    for (const b of buffs(sim, eid)) if (b.kind === 'stat' && b.stat === 'ms' && b.id.startsWith('seraphyne_') && b.until > until) (until = b.until), (start = b.start);
    const left = until - sim.tick;
    return { passive: left > 0 ? { ready: true, cdLeft: left, cdTotal: until - start } : { ready: false } };
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
