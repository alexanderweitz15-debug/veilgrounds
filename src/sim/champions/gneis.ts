// Gneis Mauerherz hooks (stone golem tank). Passive Bedrock (armor/MR near own walls), Q boulder (knock-back, wall slam
// = stun), W earth wall (blockTerrain), E shoulder charge (shove into walls), R landslide (crater rim that catches
// thrown enemies). Behaviour list: docs/champion-hooks.md; tunables: gneis.values.json. State only in sim.state.
import type { Sim } from '../sim';
import { Kind, isStructure, sec } from '../types';
import { addBuff } from '../buffs';
import { dealDamage } from '../damage';
import { CELL, walkable } from '../map';
import { segDist2 } from '../vec';
import { displaceTo, effectAmount, rv } from '../systems/abilities';
import { blockTerrain, ringCells, wallCells } from '../summons';
import type { ChampionHooks, ChampionVisuals } from './hooks';
import { hookState, peekState } from './util';
import V from '../../data/champions/gneis.values.json';

/** An earth wall or crater rim kept for the passive and the visuals (the blocking itself is blockTerrain). */
interface Wall {
  kind: 'wall' | 'rim';
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Wall thickness / rim radius. */
  w: number;
  start: number;
  until: number;
}
const KEY = 'gneisWalls';
const walls = (sim: Sim, eid: number): Wall[] => {
  const m = hookState<Wall[]>(sim, KEY);
  const list = (m.get(eid) ?? []).filter((w) => w.until > sim.tick);
  m.set(eid, list);
  return list;
};

/** Own walls within foundation range of the champion, capped at the passive maximum. Read-only. */
export function gneisWallCount(sim: Sim, eid: number): number {
  const list = peekState<Wall[]>(sim, KEY)?.get(eid);
  if (!list) return 0;
  const x = sim.c.Pos.x[eid]!;
  const y = sim.c.Pos.y[eid]!;
  let n = 0;
  for (const w of list) {
    if (w.until <= sim.tick) continue;
    const d = w.kind === 'rim' ? Math.sqrt((x - w.ax) ** 2 + (y - w.ay) ** 2) - w.w : Math.sqrt(segDist2(x, y, w.ax, w.ay, w.bx, w.by));
    if (d <= V.foundation.range) n++;
  }
  return Math.min(V.foundation.maxWalls, n);
}

/**
 * Push t `dist` along (dx, dy) (unit vector), stopping at non-walkable ground. If it stops short it slams: `bonus`
 * damage (physical, pre-mitigation) and a stun that starts when it lands. Returns true on a slam.
 */
function slamPush(sim: Sim, src: number, t: number, dx: number, dy: number, dist: number, stunSecs: number, bonus: number): boolean {
  const { Pos, Unit } = sim.c;
  if (t === src || isStructure(Unit.kind[t]!) || !Unit.alive[t]) return false;
  const x0 = Pos.x[t]!;
  const y0 = Pos.y[t]!;
  let free = 0;
  while (free < dist) {
    const next = Math.min(dist, free + 10);
    if (!walkable(sim.map.nav, x0 + dx * next, y0 + dy * next)) break;
    free = next;
  }
  const slam = free < dist;
  const travel = Math.ceil((free / 1200) * 30);
  if (free > 0) displaceTo(sim, src, t, x0 + dx * free, y0 + dy * free, travel);
  if (slam) {
    addBuff(sim, t, { kind: 'stun', id: 'gneis_slam', src, ticks: travel + sec(stunSecs) });
    if (bonus > 0) dealDamage(sim, src, t, bonus, 'phys');
  }
  return slam;
}

function placeWall(sim: Sim, eid: number, w: Wall, cells: number[]): void {
  blockTerrain(sim, cells, w.until - sim.tick);
  walls(sim, eid).push(w);
}

function gneisVisuals(sim: Sim, eid: number): ChampionVisuals {
  const list = (peekState<Wall[]>(sim, KEY)?.get(eid) ?? []).filter((w) => w.until > sim.tick);
  const passive = { stacks: gneisWallCount(sim, eid), max: V.foundation.maxWalls, ready: gneisWallCount(sim, eid) > 0 };
  if (!list.length) return { passive };
  return {
    passive,
    objects: list.map((w) => ({
      key: `${eid}:${w.start}`,
      tag: w.kind === 'wall' ? 'gneis_w_wall' : 'gneis_r_rim',
      x: w.ax,
      y: w.ay,
      x2: w.bx,
      y2: w.by,
      r: w.w,
      shape: w.kind === 'wall' ? ('wall' as const) : ('dome' as const),
      left: w.until - sim.tick,
      total: w.until - w.start,
    })),
  };
}

export const hooks: ChampionHooks = {
  visuals: gneisVisuals,
  passive: {
    gneis_foundation: {
      // Stats are rebuilt every tick before this runs: no compounding.
      onComputeStats(sim, eid) {
        const n = gneisWallCount(sim, eid);
        if (!n) return;
        sim.c.Stats.armor[eid] = sim.c.Stats.armor[eid]! + V.foundation.armorPerWall * n;
        sim.c.Stats.mr[eid] = sim.c.Stats.mr[eid]! + V.foundation.mrPerWall * n;
      },
    },
  },
  effects: {
    // Q: knock back along the throw; wall / terrain edge = slam (bonus damage + stun).
    gneis_q_boulder(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      for (const t of ctx.hits) {
        const mult = sim.c.Unit.kind[t] === Kind.Champion ? 1.4 : 1;
        const bonus = V.boulder.slamBonus * effectAmount(sim, ctx, t, 0).amount * mult;
        slamPush(sim, ctx.caster, t, ctx.dx, ctx.dy, V.boulder.knock, rv(V.boulder.stunSec, ctx.rank), bonus);
      }
    },
    // W: wall line geometry comes from data (perpendicular, radius = half length); blocks for rank-scaled seconds.
    gneis_w_wall(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      const r = ctx.ability.radius ?? 190;
      const [px, py] = [-ctx.dy * r, ctx.dx * r];
      const width = ctx.ability.width ?? 100;
      const w: Wall = { kind: 'wall', ax: ctx.x - px, ay: ctx.y - py, bx: ctx.x + px, by: ctx.y + py, w: width, start: sim.tick, until: sim.tick + sec(rv(V.wall.sec, ctx.rank)) };
      placeWall(sim, ctx.caster, w, wallCells(sim, w.ax, w.ay, w.bx, w.by, width));
    },
    // E: the dash stops at the first enemy; the hit enemy is shoved on along the dash (wall = stun).
    gneis_e_shove(sim, ctx) {
      if (ctx.phase === 'dashStart' && ctx.dash) return void (ctx.dash.stopAtEnemy = (ctx.ability.width ?? 130) / 2);
      if (ctx.phase !== 'cast') return;
      for (const t of ctx.hits) {
        const mult = sim.c.Unit.kind[t] === Kind.Champion ? 1.4 : 1;
        const bonus = V.shove.slamBonus * effectAmount(sim, ctx, t, 0).amount * mult;
        slamPush(sim, ctx.caster, t, ctx.dx, ctx.dy, V.shove.dist, rv(V.shove.stunSec, ctx.rank), bonus);
      }
    },
    // R: crater rim around the impact (opening toward the caster); enemies are thrown outward into it.
    gneis_r_rim(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      const { Pos } = sim.c;
      const nav = sim.map.nav;
      const [cx, cy] = [ctx.x, ctx.y];
      let [ox, oy] = [Pos.x[ctx.caster]! - cx, Pos.y[ctx.caster]! - cy];
      const ol = Math.sqrt(ox * ox + oy * oy) || 1;
      [ox, oy] = [ox / ol, oy / ol];
      const R = V.rim.radius;
      const cells = ringCells(sim, cx, cy, R, V.rim.thickness).filter((c) => {
        const x = ((c % nav.w) + 0.5) * CELL - cx;
        const y = (Math.floor(c / nav.w) + 0.5) * CELL - cy;
        const l = Math.sqrt(x * x + y * y) || 1;
        return (x * ox + y * oy) / l < V.rim.openingCos;
      });
      const w: Wall = { kind: 'rim', ax: cx, ay: cy, bx: cx + ox * R, by: cy + oy * R, w: R, start: sim.tick, until: sim.tick + sec(V.rim.sec) };
      placeWall(sim, ctx.caster, w, cells);
      for (const t of ctx.hits) {
        let [dx, dy] = [Pos.x[t]! - cx, Pos.y[t]! - cy];
        const l = Math.sqrt(dx * dx + dy * dy);
        [dx, dy] = l > 1 ? [dx / l, dy / l] : [ctx.dx, ctx.dy];
        slamPush(sim, ctx.caster, t, dx, dy, V.rim.knock, rv(V.rim.stunSec, ctx.rank), 0);
      }
    },
  },
};
