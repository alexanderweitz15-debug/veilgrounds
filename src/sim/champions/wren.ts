// Wren Aschenflug hooks: embers (burn on ability hits), empowered auto (Q), ash carpet (W), smoke hop (E),
// firestorm (R).

import type { Sim } from '../sim';
import { Kind, isMinion, sec } from '../types';
import { addBuff, buffs, hasBuff } from '../buffs';
import { dir, dist2 } from '../vec';
import { applyEffects, enemiesInRadius, enemiesOnSegment } from '../systems/abilities';
import type { ChampionHooks, ChampionVisuals, VisualObject } from './hooks';
import { byLevel, stateMap, tickCtx, unitsWhere } from './dagny';
import { peekState } from './util';

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
const SMOKE_TICKS = sec(2);
const R_RADIUS = 450;

/** Per-tick: R strikes 2..5 (each applies the generic damage; onAbilityHit ignites); smoke expiry. */
function wrenTick(sim: Sim, eid: number): void {
  const sm = wrenSmokes(sim).get(eid);
  if (sm && sim.tick >= sm.until) wrenSmokes(sim).delete(eid);
  else if (sm) smokeTick(sim, sm);
  const s = storms(sim).get(eid);
  if (!s || sim.tick < s.next) return;
  const ctx = tickCtx(sim, eid, 3, s.rank, enemiesInRadius(sim, eid, s.x, s.y, R_RADIUS), s.x, s.y);
  applyEffects(sim, ctx, 'hit');
  if (--s.left <= 0) storms(sim).delete(eid);
  else s.next += STRIKE_GAP;
}

/**
 * Snapshot visuals (read-only): E smoke cloud (disc + timer), R firestorm area with the strikes still to come and the
 * time until the last one, and a burn mark (time left) on every unit this Wren's embers are burning.
 */
function wrenVisuals(sim: Sim, eid: number): ChampionVisuals {
  const v: ChampionVisuals = {};
  const objects: VisualObject[] = [];
  const sm = peekState<Smoke>(sim, 'wrenSmoke')?.get(eid);
  if (sm && sim.tick < sm.until) objects.push({ key: `${eid}`, tag: 'wren_e_smoke', x: sm.x, y: sm.y, r: sm.r, shape: 'disc', left: sm.until - sim.tick, total: SMOKE_TICKS });
  const st = peekState<Storm>(sim, 'wrenStorm')?.get(eid);
  if (st && st.left > 0) {
    const last = st.next + (st.left - 1) * STRIKE_GAP;
    objects.push({ key: `${eid}`, tag: 'wren_r_storm', x: st.x, y: st.y, r: R_RADIUS, shape: 'ring', n: st.left, left: Math.max(0, last - sim.tick), total: 4 * STRIKE_GAP });
  }
  if (objects.length) v.objects = objects;
  const { Unit } = sim.c;
  for (const t of unitsWhere(sim, (e) => !!Unit.alive[e] && Unit.team[e] !== Unit.team[eid])) {
    const b = buffs(sim, t).find((x) => x.kind === 'dot' && x.id === BURN && x.src === eid && x.until > sim.tick);
    if (b) (v.marks ??= []).push({ target: t, id: BURN, left: b.until - sim.tick });
  }
  // passive badge: number of enemies burning from Wren's embers (+10 % auto damage on them); glows while any burns
  const burning = v.marks?.length ?? 0;
  v.passive = { stacks: burning, max: 5, ready: burning > 0 };
  return v;
}

export const hooks: ChampionHooks = {
  visuals: wrenVisuals,
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
      wrenSmokes(sim).set(ctx.caster, { x: Pos.x[ctx.caster]!, y: Pos.y[ctx.caster]!, r: ctx.ability.radius ?? 250, until: sim.tick + SMOKE_TICKS });
    },
    // Strike 1 = the cast resolution; strikes 2..5 every 0.5 s via onTick.
    wren_r_firestorm(sim, ctx) {
      storms(sim).set(ctx.caster, { x: ctx.x, y: ctx.y, rank: ctx.rank, next: sim.tick + STRIKE_GAP, left: 4 });
    },
  },
};
