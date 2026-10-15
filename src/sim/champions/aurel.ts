// Aurel Stundenwerk hooks: balance wheel (passive), two-champion bolt (Q), projectile drag (W), rewind (E),
// stasis-then-damage (R).

import { query } from 'bitecs';
import type { Sim } from '../sim';
import { sec } from '../types';
import { nearestWalkable, walkable } from '../map';
import { applyEffects, rv, teleport } from '../systems/abilities';
import { destroyProjectile } from '../systems/projectiles';
import { healUnit } from '../buffs';
import { dist2 } from '../vec';
import type { ChampionHooks, EffectCtx } from './hooks';
import { isChamp, stateMap, tickCtx } from './dagny';

// ------------------------------------------------------------------ passive: balance wheel

/** Tick from which the next ability casts 30 % faster. */
const wheel = (sim: Sim): Map<number, number> => stateMap<number>(sim, 'aurelWheel');
export const aurelWheelReady = (sim: Sim, eid: number): boolean => sim.tick >= (wheel(sim).get(eid) ?? 0);

// ------------------------------------------------------------------ E: rewind history

/** Ring buffer length: 3 s of history plus the 0.7 s wind-up + delay. */
const RING = sec(4);
const BACK = sec(3);
/** Per Aurel: position and damage taken per tick (ring buffers indexed by tick % RING); last E cast start. */
interface History {
  x: number[];
  y: number[];
  dmg: number[];
  eStart: number;
}
const histories = (sim: Sim): Map<number, History> => stateMap<History>(sim, 'aurelHistory');
function history(sim: Sim, eid: number): History {
  let h = histories(sim).get(eid);
  if (!h) {
    const { Pos } = sim.c;
    h = { x: new Array<number>(RING).fill(Pos.x[eid]!), y: new Array<number>(RING).fill(Pos.y[eid]!), dmg: new Array<number>(RING).fill(0), eStart: -1 };
    histories(sim).set(eid, h);
  }
  return h;
}

// ------------------------------------------------------------------ W: projectile drag

interface DragZone {
  x: number;
  y: number;
  r: number;
  until: number;
}
const dragZones = (sim: Sim): Map<number, DragZone> => stateMap<DragZone>(sim, 'aurelDrag');
/** Slowed projectiles: projectile eid -> [payload id, original speed]. */
const dragged = (sim: Sim): Map<number, [number, number]> => stateMap<[number, number]>(sim, 'aurelDragged');

function dragTick(sim: Sim, eid: number): void {
  const z = dragZones(sim).get(eid);
  if (z && sim.tick >= z.until) dragZones(sim).delete(eid);
  const { Proj, Pos, Unit } = sim.c;
  const slowed = dragged(sim);
  // restore projectiles that left the zone (or whose zone ended / entity was recycled)
  for (const [p, [id, speed]] of [...slowed]) {
    if (Proj.payload[p] !== id) {
      slowed.delete(p);
      continue;
    }
    const zz = dragZones(sim).get(eid);
    if (!zz || dist2(Pos.x[p]!, Pos.y[p]!, zz.x, zz.y) > zz.r * zz.r) {
      Proj.speed[p] = speed;
      slowed.delete(p);
    }
  }
  const zz = dragZones(sim).get(eid);
  if (!zz) return;
  const ents = query(sim.world, [Proj]);
  for (let i = 0; i < ents.length; i++) {
    const p = ents[i]!;
    if (Proj.team[p] === Unit.team[eid] || slowed.has(p)) continue;
    if (dist2(Pos.x[p]!, Pos.y[p]!, zz.x, zz.y) > zz.r * zz.r) continue;
    slowed.set(p, [Proj.payload[p]!, Proj.speed[p]!]);
    Proj.speed[p] = Proj.speed[p]! * 0.6;
  }
}

// ------------------------------------------------------------------ R: deferred damage

interface Pending {
  at: number;
  rank: number;
  hits: number[];
  serials: number[];
  x: number;
  y: number;
}
const pendings = (sim: Sim): Map<number, Pending> => stateMap<Pending>(sim, 'aurelR');

/** R with only the listed effect kinds (stasis now, damage after it). */
const rPart = (ctx: EffectCtx, kind: 'stasis' | 'damage'): EffectCtx => ({ ...ctx, ability: { ...ctx.ability, effects: ctx.ability.effects.filter((e) => e.kind === kind) } });

function aurelTick(sim: Sim, eid: number): void {
  const { Pos, Unit } = sim.c;
  const h = history(sim, eid);
  const i = sim.tick % RING;
  h.x[i] = Pos.x[eid]!;
  h.y[i] = Pos.y[eid]!;
  h.dmg[i] = 0; // onDamageTaken adds to this slot during the tick
  // E cast start (castAbility pushed the event earlier this tick, in the input system)
  for (const e of sim.events) if (e.e === 'cast' && e.src === eid && e.slot === 2) h.eStart = sim.tick;
  dragTick(sim, eid);
  const p = pendings(sim).get(eid);
  if (p && sim.tick >= p.at) {
    pendings(sim).delete(eid);
    const hits = p.hits.filter((t, k) => Unit.serial[t] === p.serials[k] && !!Unit.alive[t]);
    applyEffects(sim, rPart(tickCtx(sim, eid, 3, p.rank, hits, p.x, p.y), 'damage'), 'hit');
  }
}

export const hooks: ChampionHooks = {
  onTick: aurelTick,
  ownsHits: ['aurel_r'],
  passive: {
    aurel_balance_wheel: {
      modifyCast(sim, eid, _slot, m) {
        if (aurelWheelReady(sim, eid)) m.timeMult *= 0.7;
      },
      onCast(sim, eid) {
        if (aurelWheelReady(sim, eid)) wheel(sim).set(eid, sim.tick + sec(8));
      },
      onDamageTaken(sim, eid, _src, info) {
        const h = history(sim, eid);
        h.dmg[sim.tick % RING] = h.dmg[sim.tick % RING]! + info.amount;
      },
    },
  },
  effects: {
    // Pierce: minions take damage; the bolt is destroyed on its 2nd enemy champion.
    // ponytail: identifies its projectile through the projectile payload map (no projectile id in EffectCtx).
    aurel_q_two_champions(sim, ctx) {
      if (ctx.target < 0 || !isChamp(sim, ctx.target)) return;
      const ps = sim.state.projectiles as { payloads: Map<number, { t: string; caster?: number; slot?: number; hit?: number[] }> } | undefined;
      for (const [p, pl] of ps?.payloads ?? []) {
        if (pl.t !== 'ability' || pl.caster !== ctx.caster || pl.slot !== 0 || !pl.hit?.includes(ctx.target)) continue;
        if (pl.hit.filter((e) => isChamp(sim, e)).length >= 2) destroyProjectile(sim, p);
      }
    },
    // first zone resolution registers the drag area for the zone's duration; dragTick slows enemy projectiles by 40 %
    aurel_w_projectile_drag(sim, ctx) {
      const z = dragZones(sim).get(ctx.caster);
      if (z && sim.tick < z.until && z.x === ctx.x && z.y === ctx.y) return;
      dragZones(sim).set(ctx.caster, { x: ctx.x, y: ctx.y, r: ctx.ability.radius ?? 320, until: sim.tick + sec(rv(ctx.ability.duration, ctx.rank) || 3) });
    },
    // Blink resolves after the 0.5 s delay: back to the position from 3 s before the cast, heal 15 % of the damage
    // taken in those 3 s.
    aurel_e_rewind(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      const e = ctx.caster;
      const h = history(sim, e);
      const start = h.eStart >= 0 && sim.tick - h.eStart < RING - BACK ? h.eStart : sim.tick;
      const k = (((start - BACK) % RING) + RING) % RING;
      let taken = 0;
      for (let t = start - BACK + 1; t <= start; t++) taken += h.dmg[((t % RING) + RING) % RING]!;
      const [x, y] = [h.x[k]!, h.y[k]!];
      const p = walkable(sim.map.nav, x, y) ? { x, y } : nearestWalkable(sim.map.nav, x, y);
      teleport(sim, e, p.x, p.y);
      healUnit(sim, e, 0.15 * taken);
    },
    // Owned hits: stasis now, the damage when the 1.2 s stasis has ended (aurelTick).
    aurel_r_damage_after_stasis(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      applyEffects(sim, rPart(ctx, 'stasis'), 'hit');
      const st = ctx.ability.effects.find((e) => e.kind === 'stasis');
      const dur = st && st.kind === 'stasis' ? (typeof st.duration === 'number' ? st.duration : st.duration[ctx.rank - 1]!) : 1.2;
      pendings(sim).set(ctx.caster, { at: sim.tick + sec(dur), rank: ctx.rank, hits: [...ctx.hits], serials: ctx.hits.map((t) => sim.c.Unit.serial[t]!), x: ctx.x, y: ctx.y });
    },
  },
};
