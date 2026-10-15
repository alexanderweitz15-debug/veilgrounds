// Wren Aschenflug hooks: embers (burn on ability hits), empowered auto (Q), ash carpet (W), smoke hop (E),
// firestorm (R).

import type { Sim } from '../sim';
import { Kind, isMinion, sec } from '../types';
import { addBuff, hasBuff } from '../buffs';
import { dir, dist2 } from '../vec';
import { applyEffects, enemiesInRadius, enemiesOnSegment } from '../systems/abilities';
import type { ChampionHooks } from './hooks';
import { byLevel, stateMap, tickCtx, unitsWhere } from './dagny';

const BURN = 'wren_embers';

/** Ignite (refreshes): byLevel 8-40 (+0.15 AP) magic damage per second for 3 s. */
export function ignite(sim: Sim, wren: number, t: number): void {
  const amount = byLevel(sim, wren, 8, 40) + 0.15 * sim.c.Stats.ap[wren]!;
  addBuff(sim, t, { kind: 'dot', id: BURN, src: wren, amount, period: sec(1), dmgType: 'magic', ticks: sec(3) });
}

export const isBurning = (sim: Sim, t: number): boolean => hasBuff(sim, t, 'dot', BURN);

/** W strip origin per caster (position at cast). */
const strips = (sim: Sim): Map<number, { x: number; y: number }> => stateMap(sim, 'wrenStrip');
const STRIP_LEN = 900;
const STRIP_HALF_WIDTH = 100;

/** E smoke clouds per caster (render/vision read this). */
export interface Smoke {
  x: number;
  y: number;
  r: number;
  until: number;
}
export const wrenSmokes = (sim: Sim): Map<number, Smoke> => stateMap<Smoke>(sim, 'wrenSmoke');

/**
 * Smoke: units inside are hidden from the other team (both teams' units). ponytail: approximated with a 2-tick
 * 'invisible' buff, so it blocks vision *into* the cloud but not *through* it (vision.ts has no occluders).
 * Upgrade: a vision occluder API (circle blocks sight lines) in vision.ts.
 */
function smokeTick(sim: Sim, s: Smoke): void {
  const { Unit, Pos } = sim.c;
  for (const e of unitsWhere(sim, (u) => !!Unit.alive[u] && (Unit.kind[u] === Kind.Champion || isMinion(Unit.kind[u]!) || Unit.kind[u] === Kind.Pet))) {
    // centre inside the cloud (Wren's own 300 hop leaves her just outside)
    if (dist2(Pos.x[e]!, Pos.y[e]!, s.x, s.y) <= s.r * s.r) addBuff(sim, e, { kind: 'stat', stat: 'invisible', id: 'wren_smoke', src: -1, ticks: 2 });
  }
}

/** R: remaining strikes per caster. */
interface Storm {
  x: number;
  y: number;
  rank: number;
  next: number;
  left: number;
}
const storms = (sim: Sim): Map<number, Storm> => stateMap<Storm>(sim, 'wrenStorm');
const STRIKE_GAP = sec(0.5);

/** Per-tick: R strikes 2..5 (each applies the generic damage; onAbilityHit ignites); smoke expiry. */
function wrenTick(sim: Sim, eid: number): void {
  const sm = wrenSmokes(sim).get(eid);
  if (sm && sim.tick >= sm.until) wrenSmokes(sim).delete(eid);
  else if (sm) smokeTick(sim, sm);
  const s = storms(sim).get(eid);
  if (!s || sim.tick < s.next) return;
  const ctx = tickCtx(sim, eid, 3, s.rank, enemiesInRadius(sim, eid, s.x, s.y, 450), s.x, s.y);
  applyEffects(sim, ctx, 'hit');
  if (--s.left <= 0) storms(sim).delete(eid);
  else s.next += STRIKE_GAP;
}

export const hooks: ChampionHooks = {
  onTick: wrenTick,
  ownsHits: ['wren_w'],
  passive: {
    wren_embers: {
      // every ability hit (Q empowered auto, W strip, R strikes) ignites
      onAbilityHit(sim, eid, target) {
        ignite(sim, eid, target);
      },
      // +10 % auto damage on burning targets
      modifyDamage(sim, _eid, target, amount, _type, isAuto) {
        return isAuto && isBurning(sim, target) ? amount * 1.1 : amount;
      },
      onCast(sim, eid, slot) {
        if (slot === 1) strips(sim).set(eid, { x: sim.c.Pos.x[eid]!, y: sim.c.Pos.y[eid]! });
      },
    },
  },
  effects: {
    // engine arms the next auto (`*_next_auto`) and applies the listed damage on it; the ignite comes from onAbilityHit
    wren_q_next_auto() {},
    // Owned hits, once per zone second: enemies on the 900 x 200 strip from Wren's cast position.
    wren_w_ash_carpet(sim, ctx) {
      const { Pos } = sim.c;
      const o = strips(sim).get(ctx.caster) ?? { x: Pos.x[ctx.caster]!, y: Pos.y[ctx.caster]! };
      let [dx, dy] = [ctx.dx, ctx.dy];
      if (dx === 0 && dy === 0) [dx, dy] = dir(o.x, o.y, ctx.x, ctx.y);
      const hits = enemiesOnSegment(sim, ctx.caster, o.x, o.y, o.x + dx * STRIP_LEN, o.y + dy * STRIP_LEN, STRIP_HALF_WIDTH);
      applyEffects(sim, { ...ctx, hits }, 'hit');
    },
    // Backward hop; the smoke cloud stays at the start position for 2 s (smokeTick).
    wren_e_smoke_hop(sim, ctx) {
      if (ctx.phase !== 'dashStart' || !ctx.dash) return;
      ctx.dash.dx = -ctx.dash.dx;
      ctx.dash.dy = -ctx.dash.dy;
      const { Pos } = sim.c;
      wrenSmokes(sim).set(ctx.caster, { x: Pos.x[ctx.caster]!, y: Pos.y[ctx.caster]!, r: ctx.ability.radius ?? 250, until: sim.tick + sec(2) });
    },
    // Strike 1 = the cast resolution; strikes 2..5 every 0.5 s via onTick.
    wren_r_firestorm(sim, ctx) {
      storms(sim).set(ctx.caster, { x: ctx.x, y: ctx.y, rank: ctx.rank, next: sim.tick + STRIKE_GAP, left: 4 });
    },
  },
};
