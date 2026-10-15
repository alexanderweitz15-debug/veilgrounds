// Vessa Wildherz hooks. Contract: ./hooks.ts, behaviour list: docs/champion-hooks.md.
import type { Sim } from '../sim';
import { Kind, enemyOf, sec } from '../types';
import { dealDamage } from '../damage';
import { addBuff, hasBuff, healUnit } from '../buffs';
import { dist2, segDist2 } from '../vec';
import { inBush, LANES } from '../map';
import { sees } from '../vision';
import { alliedChampionsIn, effectAmount, rv } from '../systems/abilities';
import type { ChampionHooks } from './hooks';
import { hookState, isChampLike } from './util';
import { query } from 'bitecs';

interface VessaState {
  stacks: number;
  /** E window end. */
  stalk: number;
  /** Target of an auto fired from brush/fog during E (slowed on hit), -1 none. */
  ambush: number;
}

const state = (sim: Sim, eid: number): VessaState => {
  const m = hookState<VessaState>(sim, 'vessa');
  let s = m.get(eid);
  if (!s) m.set(eid, (s = { stacks: 0, stalk: -1, ambush: -1 }));
  return s;
};

/**
 * Jungle = off the lanes (> 500 from every lane path), outside the river band and the bases.
 * ponytail: geometric approximation until the map carries region polygons.
 */
export function inJungle(sim: Sim, x: number, y: number): boolean {
  const S = sim.map.size;
  if (Math.abs(x + y - S) <= 700 || x + y < 0.3 * S || x + y > 1.7 * S) return false;
  for (const name of LANES) {
    const pts = sim.map.sides[0].lanes[name];
    for (let i = 1; i < pts.length; i++) if (segDist2(x, y, pts[i - 1]!.x, pts[i - 1]!.y, pts[i]!.x, pts[i]!.y) <= 500 * 500) return false;
  }
  return true;
}

function applyTrail(sim: Sim, eid: number): void {
  const n = state(sim, eid).stacks;
  if (n <= 0 || !sim.c.Unit.alive[eid]) return;
  addBuff(sim, eid, { kind: 'stat', stat: 'as', id: 'vessa_trail', src: eid, pct: n, ticks: 1 << 30 });
  addBuff(sim, eid, { kind: 'stat', stat: 'ms', id: 'vessa_trail', src: eid, flat: n, ticks: 1 << 30 });
}

export const hooks: ChampionHooks = {
  passive: {
    vessa_trail: {
      // Monster kills: permanent stack (max 10), +1 % AS and +1 MS each.
      onKill(sim, eid, victim) {
        if (sim.c.Unit.kind[victim] !== Kind.Monster) return;
        const s = state(sim, eid);
        s.stacks = Math.min(10, s.stacks + 1);
        applyTrail(sim, eid);
      },
      // E: an auto started from brush or unseen by the target's team slows 50 % for 2 s.
      onAutoFire(sim, eid, target) {
        const s = state(sim, eid);
        if (sim.tick > s.stalk) return;
        const { Pos, Unit } = sim.c;
        if (inBush(sim.map, Pos.x[eid]!, Pos.y[eid]!) >= 0 || !sees(sim, Unit.team[target]!, eid)) {
          s.ambush = target;
          s.stalk = -1;
        }
      },
      onAutoHit(sim, eid, target) {
        const s = state(sim, eid);
        if (s.ambush !== target) return;
        s.ambush = -1;
        addBuff(sim, target, { kind: 'slow', id: 'vessa_e', src: eid, pct: 50, ticks: sec(2) });
      },
    },
  },
  onTick(sim, eid) {
    if (!sim.c.Unit.alive[eid]) return;
    const s = state(sim, eid);
    if (s.stacks > 0 && !hasBuff(sim, eid, 'stat', 'vessa_trail')) applyTrail(sim, eid); // lost on death
    if (sim.tick <= s.stalk) {
      const { Pos } = sim.c;
      const x = Pos.x[eid]!;
      const y = Pos.y[eid]!;
      if (inBush(sim.map, x, y) >= 0 || inJungle(sim, x, y)) addBuff(sim, eid, { kind: 'stat', stat: 'ms', id: 'vessa_e', src: eid, pct: 30, ticks: 2 });
    }
  },
  effects: {
    // +30 % Q damage against monsters.
    vessa_q_monster_bonus(sim, ctx) {
      const t = ctx.hits[0];
      if (ctx.phase !== 'cast' || t === undefined || sim.c.Unit.kind[t] !== Kind.Monster || !sim.c.Unit.alive[t]) return;
      const d = effectAmount(sim, ctx, t);
      dealDamage(sim, ctx.caster, t, 0.3 * d.amount, d.type);
    },
    // Empowered auto heals 30-90 + 10 % missing HP (at hit time).
    vessa_w_next_auto(sim, ctx) {
      if (ctx.phase !== 'empowered') return;
      const { Hp } = sim.c;
      const e = ctx.caster;
      healUnit(sim, e, rv([30, 45, 60, 75, 90], ctx.rank) + 0.1 * (Hp.max[e]! - Hp.cur[e]!));
    },
    vessa_e_stalk(sim, ctx) {
      if (ctx.phase === 'cast') state(sim, ctx.caster).stalk = sim.tick + sec(rv(ctx.ability.duration, ctx.rank) || 3);
    },
    // R leaps onto the enemy champion nearest the cursor (it takes the damage/airborne); on landing allies in 500
    // (incl. Vessa) get +20 % AS for 4 s.
    vessa_r_ally_frenzy(sim, ctx) {
      const { Pos, Unit } = sim.c;
      const e = ctx.caster;
      if (ctx.phase === 'dashStart' && ctx.dash) {
        let best = -1;
        let bestD = 300 * 300;
        const reach = (ctx.ability.distance ?? 700) + 100;
        // champions and practice dummies (combo trainer); Agent J fix
        for (const t of query(sim.world, [Unit])) {
          if (!isChampLike(sim, t) || !Unit.alive[t] || Unit.team[t] !== enemyOf(Unit.team[e]!) || Unit.untargetable[t]) continue;
          if (!sees(sim, Unit.team[e]!, t) || dist2(Pos.x[t]!, Pos.y[t]!, Pos.x[e]!, Pos.y[e]!) > reach * reach) continue;
          const d = dist2(Pos.x[t]!, Pos.y[t]!, ctx.cursorX, ctx.cursorY);
          if (d < bestD) (bestD = d), (best = t);
        }
        if (best >= 0) (ctx.dash.target = best), (ctx.dash.distance = reach);
        return;
      }
      if (ctx.phase !== 'cast') return;
      for (const a of alliedChampionsIn(sim, e, Pos.x[e]!, Pos.y[e]!, 500))
        addBuff(sim, a, { kind: 'stat', stat: 'as', id: 'vessa_r', src: e, pct: 20, ticks: sec(4) });
    },
  },
};
