// Renn Sieben hooks. Contract: ./hooks.ts, behaviour list: docs/champion-hooks.md.
// Blades are ground objects (src/sim/summons.ts, tag 'renn_blade', 4 s); touching one (or E onto it) picks it up.
import { query } from 'bitecs';
import type { Sim } from '../sim';
import { Kind, isStructure, sec } from '../types';
import { dealDamage } from '../damage';
import { addBuff, buffs } from '../buffs';
import { dir, dist2 } from '../vec';
import { nearestWalkable } from '../map';
import { applyEffects, channelOf, enemiesInRadius, landingPoint, reduceCooldown, setCooldown, teleport } from '../systems/abilities';
import { addGroundObject, groundObjects, removeGroundObject, type GroundObject } from '../summons';
import type { ChampionHooks, EffectCtx } from './hooks';
import { byLevel, ctxFor, hookState, isChampLike } from './util';

interface RennState {
  /** Position at the start of the tick (E origin). */
  px: number;
  py: number;
  /** Pending W blade drops. */
  drops: { at: number; x: number; y: number }[];
  /** Next R volley tick (fractional: every 4.5 ticks) and the R rank. */
  rNext: number;
  rRank: number;
}

const state = (sim: Sim, eid: number): RennState => {
  const m = hookState<RennState>(sim, 'renn');
  let s = m.get(eid);
  if (!s) m.set(eid, (s = { px: 0, py: 0, drops: [], rNext: -1, rRank: 0 }));
  return s;
};

const BLADE = 'renn_blade';
const BLADE_TICKS = sec(4);
const PICKUP_REACH = 50;
const VOLLEY_TICKS = 4.5; // 0.15 s

function dropBlade(sim: Sim, eid: number, x: number, y: number): void {
  const p = nearestWalkable(sim.map.nav, x, y);
  addGroundObject(sim, { owner: eid, tag: BLADE, x: p.x, y: p.y, r: 40, ticks: BLADE_TICKS });
}

/** Pick up a blade: spin slash (radius 320) and E cooldown set to 1.5 s. */
function pickUp(sim: Sim, eid: number, b: GroundObject): void {
  removeGroundObject(sim, b.id);
  const { Pos, Stats } = sim.c;
  const amount = byLevel(sim, eid, 50, 200) + 0.6 * Stats.bonusAd[eid]! + 0.4 * Stats.ap[eid]!;
  for (const t of enemiesInRadius(sim, eid, Pos.x[eid]!, Pos.y[eid]!, 320)) dealDamage(sim, eid, t, amount, 'magic');
  setCooldown(sim, eid, 2, sec(1.5));
}

/** One R volley: a blade at each of the up to 3 nearest enemy champions within 550 (+ grievous wounds). */
function volley(sim: Sim, eid: number, rank: number): void {
  const { Pos } = sim.c;
  const x = Pos.x[eid]!;
  const y = Pos.y[eid]!;
  const near = enemiesInRadius(sim, eid, x, y, 550)
    .filter((t) => isChampLike(sim, t))
    .sort((a, b) => dist2(Pos.x[a]!, Pos.y[a]!, x, y) - dist2(Pos.x[b]!, Pos.y[b]!, x, y) || a - b)
    .slice(0, 3);
  const ctx = ctxFor(sim, eid, 3, rank, x, y);
  for (const t of near) {
    applyEffects(sim, { ...ctx, hits: [t] }, 'hit');
    addBuff(sim, t, { kind: 'grievous', id: 'renn_r', src: eid, pct: 40, ticks: sec(3) });
  }
}

export const hooks: ChampionHooks = {
  ownsHits: ['renn_q', 'renn_r'],
  passive: {
    // Pickup itself runs in onTick (touch) and in the E hook.
    renn_blade_pickup: {},
    // Champion takedown: Q, W, E cooldowns -12 s.
    renn_takedown_reset: {
      onTakedown(sim, eid) {
        for (const slot of [0, 1, 2]) reduceCooldown(sim, eid, slot, sec(12));
      },
    },
  },
  onTick(sim, eid) {
    const { Unit, Pos } = sim.c;
    const s = state(sim, eid);
    s.px = Pos.x[eid]!;
    s.py = Pos.y[eid]!;
    if (s.drops.length && s.drops.some((d) => sim.tick >= d.at)) {
      for (const d of s.drops) if (sim.tick >= d.at) dropBlade(sim, eid, d.x, d.y);
      s.drops = s.drops.filter((d) => sim.tick < d.at);
    }
    if (!Unit.alive[eid]) return;
    // W: the +50 % MS decays linearly over its duration
    for (const b of buffs(sim, eid)) {
      if (b.kind === 'stat' && b.stat === 'ms' && b.id === 'renn_w' && b.until > sim.tick) b.pct = (50 * (b.until - sim.tick)) / (b.until - b.start);
    }
    // touch pickup
    for (const b of groundObjects(sim, BLADE, eid)) {
      const r = Unit.radius[eid]! + PICKUP_REACH;
      if (dist2(b.x, b.y, Pos.x[eid]!, Pos.y[eid]!) <= r * r) pickUp(sim, eid, b);
    }
    // R channel volleys
    const ch = channelOf(sim, eid);
    if (s.rNext >= 0 && (!ch || ch.slot !== 3)) s.rNext = -1;
    while (s.rNext >= 0 && sim.tick >= s.rNext) {
      volley(sim, eid, s.rRank);
      s.rNext += VOLLEY_TICKS;
    }
  },
  effects: {
    // Hit producer: target, then up to 2 bounces (nearest enemy not yet hit within 400); a blade lands 350 behind
    // the last target.
    renn_q_bounce(sim, ctx) {
      if (ctx.phase !== 'cast' || ctx.hits.length === 0) return;
      const { Pos } = sim.c;
      const hit: number[] = [];
      let prevX = Pos.x[ctx.caster]!;
      let prevY = Pos.y[ctx.caster]!;
      let cur = ctx.hits[0]!;
      for (;;) {
        hit.push(cur);
        const cx = Pos.x[cur]!;
        const cy = Pos.y[cur]!;
        applyEffects(sim, { ...ctx, hits: [cur], x: cx, y: cy }, 'hit');
        let next = -1;
        let bestD = Infinity;
        if (hit.length < 3) {
          for (const e of enemiesInRadius(sim, ctx.caster, cx, cy, 400)) {
            if (hit.includes(e)) continue;
            const d = dist2(Pos.x[e]!, Pos.y[e]!, cx, cy);
            if (d < bestD) (bestD = d), (next = e);
          }
        }
        if (next < 0) {
          let [dx, dy] = dir(prevX, prevY, cx, cy);
          if (dx === 0 && dy === 0) [dx, dy] = [ctx.dx, ctx.dy];
          dropBlade(sim, ctx.caster, cx + dx * 350, cy + dy * 350);
          return;
        }
        prevX = cx;
        prevY = cy;
        cur = next;
      }
    },
    // A blade lands at the cast position after 1.25 s.
    renn_w_blade_drop(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      const { Pos } = sim.c;
      state(sim, ctx.caster).drops.push({ at: sim.tick + sec(1.25), x: Pos.x[ctx.caster]!, y: Pos.y[ctx.caster]! });
    },
    // Blink onto a blade (picked up at once) or beside a unit near the cursor, within 725 of the start.
    // Without a valid target near the cursor it is a plain blink (ponytail: LoL would refuse the cast).
    renn_e_blade_jump(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      const e = ctx.caster;
      const s = state(sim, e);
      const range = 725;
      const ok = (x: number, y: number): boolean => dist2(x, y, s.px, s.py) <= (range + 60) * (range + 60) && dist2(x, y, ctx.cursorX, ctx.cursorY) <= 200 * 200;
      const blade = groundObjects(sim, BLADE, e).find((b) => ok(b.x, b.y));
      if (blade) {
        teleport(sim, e, blade.x, blade.y);
        pickUp(sim, e, blade);
        return;
      }
      const { Pos, Unit } = sim.c;
      let best = -1;
      let bestD = Infinity;
      for (const i of query(sim.world, [Unit])) {
        if (i === e || !Unit.alive[i] || Unit.untargetable[i] || isStructure(Unit.kind[i]!) || Unit.kind[i] === Kind.Projectile) continue;
        if (!ok(Pos.x[i]!, Pos.y[i]!)) continue;
        const d = dist2(Pos.x[i]!, Pos.y[i]!, ctx.cursorX, ctx.cursorY);
        if (d < bestD) (bestD = d), (best = i);
      }
      if (best < 0) return;
      const [dx, dy] = dir(Pos.x[best]!, Pos.y[best]!, s.px, s.py);
      const gap = Unit.radius[best]! + Unit.radius[e]!;
      const p = landingPoint(sim, s.px, s.py, Pos.x[best]! + dx * gap, Pos.y[best]! + dy * gap);
      teleport(sim, e, p.x, p.y);
    },
    // Channel 2.5 s: a volley every 0.15 s (first at once); broken by CC (engine channel).
    renn_r_blade_storm(sim, ctx: EffectCtx) {
      if (ctx.phase !== 'cast') return;
      const s = state(sim, ctx.caster);
      s.rRank = ctx.rank;
      volley(sim, ctx.caster, ctx.rank);
      s.rNext = sim.tick + VOLLEY_TICKS;
    },
  },
};
