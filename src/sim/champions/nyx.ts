// Nyx Hohlschatten hooks. Contract: ./hooks.ts, behaviour list: docs/champion-hooks.md.
import { query } from 'bitecs';
import type { Sim } from '../sim';
import { Kind, isStructure, sec } from '../types';
import { addBuff, hasStat, reveal } from '../buffs';
import { dist2 } from '../vec';
import { seenByOthers } from '../vision';
import { fireAbilityProjectile } from '../systems/projectiles';
import { addGroundObject, groundObjects, removeGroundObject } from '../summons';
import type { ChampionHooks, ChampionVisuals } from './hooks';
import { hookState, peekState } from './util';

interface NyxState {
  /** W ambush window end (first auto from invisibility roots). */
  ambushUntil: number;
  /** Target of the ambush auto, -1 none. */
  ambush: number;
  /** R end. */
  rUntil: number;
}

const state = (sim: Sim, eid: number): NyxState => {
  const m = hookState<NyxState>(sim, 'nyx');
  let s = m.get(eid);
  if (!s) m.set(eid, (s = { ambushUntil: -1, ambush: -1, rUntil: -1 }));
  return s;
};

const SEED = 'nyx_seed';
const R_RANGE = 1200;

/**
 * Snapshot (read-only): P = number of own seeds on the HUD badge (the seeds are ground objects, hidden from enemies);
 * W = ambush auto armed (empowered glow while the first auto from invisibility will root); R = veil range ring
 * (1200, follows Nyx) with the 6 s timer + aura (R is a self cast without zone event).
 */
function nyxVisuals(sim: Sim, eid: number): ChampionVisuals {
  const { Pos, Unit } = sim.c;
  const s = peekState<NyxState>(sim, 'nyx')?.get(eid);
  const seeds = groundObjects(sim, SEED, eid).length;
  const out: ChampionVisuals = { passive: { stacks: seeds, ready: seeds > 0 } };
  if (!s || !Unit.alive[eid]) return out;
  if (sim.tick <= s.ambushUntil && hasStat(sim, eid, 'invisible')) out.empowered = 1;
  if (sim.tick < s.rUntil) {
    out.aura = 3;
    out.objects = [{ key: String(eid), tag: 'nyx_r_veil', x: Pos.x[eid]!, y: Pos.y[eid]!, r: R_RANGE, shape: 'dome', left: s.rUntil - sim.tick, total: sec(6) }];
  }
  return out;
}

export const hooks: ChampionHooks = {
  visuals: nyxVisuals,
  passive: {
    nyx_dark_seed: {
      // Killing the last monster of a camp leaves an invisible seed for 90 s.
      // ponytail: "last of the camp" = no other living monster within 600 (camps arrive with the Phase 3 jungle).
      onKill(sim, eid, victim) {
        const { Unit, Pos } = sim.c;
        if (Unit.kind[victim] !== Kind.Monster) return;
        const x = Pos.x[victim]!;
        const y = Pos.y[victim]!;
        for (const m of query(sim.world, [Unit])) {
          if (m !== victim && Unit.alive[m] && Unit.kind[m] === Kind.Monster && dist2(Pos.x[m]!, Pos.y[m]!, x, y) <= 600 * 600) return;
        }
        addGroundObject(sim, { owner: eid, tag: SEED, x, y, r: 100, ticks: sec(90) });
      },
      // R: +15 % damage to enemy champions no other ally currently sees.
      modifyDamage(sim, eid, target, amount) {
        const { Unit } = sim.c;
        if (sim.tick >= state(sim, eid).rUntil || Unit.kind[target] !== Kind.Champion) return amount;
        return seenByOthers(sim, Unit.team[eid]!, target, eid) ? amount : amount * 1.15;
      },
      // W: the first auto started while invisible roots its target for 0.75 s.
      onAutoFire(sim, eid, target) {
        const s = state(sim, eid);
        if (sim.tick <= s.ambushUntil && hasStat(sim, eid, 'invisible')) {
          s.ambush = target;
          s.ambushUntil = -1;
        }
      },
      onAutoHit(sim, eid, target) {
        const s = state(sim, eid);
        if (s.ambush !== target) return;
        s.ambush = -1;
        addBuff(sim, target, { kind: 'root', id: 'nyx_w', src: eid, ticks: sec(0.75) });
      },
    },
  },
  onTick(sim, eid) {
    const { Unit, Pos } = sim.c;
    const team = Unit.team[eid]!;
    // seeds: an enemy champion stepping on one is revealed for 3 s (seed consumed)
    for (const o of groundObjects(sim, SEED, eid)) {
      for (const c of query(sim.world, [Unit])) {
        if (!Unit.alive[c] || Unit.kind[c] !== Kind.Champion || Unit.team[c] === team) continue;
        const r = o.r + Unit.radius[c]!;
        if (dist2(Pos.x[c]!, Pos.y[c]!, o.x, o.y) > r * r) continue;
        reveal(sim, team, c, sec(3));
        removeGroundObject(sim, o.id);
        break;
      }
    }
    // R: enemies within 1200 of Nyx stay visible to her team for the whole duration
    if (sim.tick < state(sim, eid).rUntil && Unit.alive[eid]) {
      for (const e of query(sim.world, [Unit])) {
        const k = Unit.kind[e]!;
        if (!Unit.alive[e] || Unit.team[e] === team || Unit.team[e] > 1 || isStructure(k) || k === Kind.Projectile) continue;
        if (dist2(Pos.x[e]!, Pos.y[e]!, Pos.x[eid]!, Pos.y[eid]!) <= R_RANGE * R_RANGE) reveal(sim, team, e, 2);
      }
    }
  },
  effects: {
    // At max range the dagger flies back to Nyx; every unit can be hit once more on the way back (generic damage).
    nyx_q_return(sim, ctx) {
      if (ctx.phase === 'expire' && !ctx.tag) fireAbilityProjectile(sim, ctx, { x: ctx.x, y: ctx.y, returnNow: true });
    },
    nyx_w_ambush_root(sim, ctx) {
      if (ctx.phase === 'cast') state(sim, ctx.caster).ambushUntil = sim.tick + sec(2);
    },
    nyx_r_lonely_prey(sim, ctx) {
      if (ctx.phase === 'cast') state(sim, ctx.caster).rUntil = sim.tick + sec(6);
    },
  },
};
