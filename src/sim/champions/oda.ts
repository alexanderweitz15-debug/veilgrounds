// Oda Brunnen hooks: spring water regen aura (passive), ally-colliding stone (Q), slow cleanse (E).

import type { Sim } from '../sim';
import { Kind } from '../types';
import { healUnit, removeBuffs } from '../buffs';
import { dist2 } from '../vec';
import { applyEffects } from '../systems/abilities';
import { destroyProjectile, sweepHit } from '../systems/projectiles';
import type { AbilityPayload } from '../systems/abilities';
import type { ChampionHooks, EffectCtx } from './hooks';
import { abilityOf, alliedChamps, unitsWhere } from './dagny';

const AURA = 800;
/** 1 % max HP per 5 s, per tick at 30 Hz. */
const REGEN_PER_TICK = 0.01 / 5 / 30;

function springWater(sim: Sim, eid: number): void {
  const { Pos, Hp } = sim.c;
  if (!sim.c.Unit.alive[eid]) return;
  for (const a of alliedChamps(sim, eid)) {
    if (dist2(Pos.x[a]!, Pos.y[a]!, Pos.x[eid]!, Pos.y[eid]!) <= AURA * AURA && Hp.cur[a]! < Hp.max[a]!) healUnit(sim, a, Hp.max[a]! * REGEN_PER_TICK);
  }
}

/**
 * Q collisions are resolved here, one tick ahead of the projectile system: the stone's next swept segment is tested
 * against enemy units and allied champions (not Oda); the earliest unit wins. Enemy: damage + slow only. Ally: the
 * heal only. The engine projectile is then destroyed, so the generic resolution (which would heal the ally nearest
 * to an enemy impact) never runs.
 * ponytail: on the cast tick the projectile system sweeps the first 50 units before this check; a unit hugging
 * Oda is resolved by the engine. Upgrade: an engine pre-hit hook / ally-colliding projectile flag.
 */
function stoneTick(sim: Sim, eid: number): void {
  const ps = sim.state.projectiles as { payloads: Map<number, AbilityPayload | { t: 'auto' }> } | undefined;
  if (!ps) return;
  const { Pos, Proj, Unit } = sim.c;
  for (const [p, pl] of [...ps.payloads]) {
    if (pl.t !== 'ability' || pl.caster !== eid || pl.slot !== 0 || Proj.kind[p] !== 1) continue;
    const ax = Pos.x[p]!;
    const ay = Pos.y[p]!;
    const step = Math.min(Proj.speed[p]! / 30, Proj.maxDist[p]! - Proj.travelled[p]!);
    const bx = ax + Proj.dx[p]! * step;
    const by = ay + Proj.dy[p]! * step;
    const half = Proj.width[p]! / 2;
    let best = -1;
    let bestT = Infinity;
    const cands = unitsWhere(sim, (e) => {
      if (!Unit.alive[e] || Unit.untargetable[e] || e === eid || pl.hit.includes(e)) return false;
      const k = Unit.kind[e]!;
      if (Unit.team[e] === Unit.team[eid]) return k === Kind.Champion;
      return k !== Kind.Projectile && k !== Kind.Ward && k !== Kind.Tower && k !== Kind.Inhibitor && k !== Kind.Nexus;
    });
    for (const e of cands) {
      const t = sweepHit(ax, ay, bx, by, Pos.x[e]!, Pos.y[e]!, Unit.radius[e]! + half);
      if (t >= 0 && t < bestT) (bestT = t), (best = e);
    }
    if (best < 0) continue;
    destroyProjectile(sim, p);
    const x = ax + (bx - ax) * bestT;
    const y = ay + (by - ay) * bestT;
    const ctx: EffectCtx = {
      caster: eid, slot: 0, rank: pl.rank, ability: abilityOf(sim, eid, 0), hits: [best], x, y, target: best, phase: 'cast',
      dx: pl.dx, dy: pl.dy, cursorX: pl.cx, cursorY: pl.cy,
    };
    if (Unit.team[best] === Unit.team[eid]) applyEffects(sim, ctx, 'self'); // 'ally' heal on ctx.target
    else applyEffects(sim, ctx, 'hit');
  }
}

export const hooks: ChampionHooks = {
  onTick(sim, eid) {
    springWater(sim, eid);
    stoneTick(sim, eid);
  },
  ownsHits: ['oda_q'],
  passive: {
    oda_spring_water: {},
  },
  effects: {
    // Collisions are resolved by stoneTick; an engine resolution only happens on the cast tick (see ponytail there):
    // then it is an enemy hit, so apply damage + slow (the generic ally heal of that resolution cannot be suppressed).
    oda_q_ally_collision(sim, ctx) {
      if (ctx.phase === 'cast' && ctx.hits.length) applyEffects(sim, ctx, 'hit');
    },
    oda_e_cleanse_slows(sim, ctx) {
      if (ctx.target >= 0) removeBuffs(sim, ctx.target, (b) => b.kind === 'slow');
    },
  },
};
