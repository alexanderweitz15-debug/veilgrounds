// Svea Böenhall hooks: Gust Run (walking builds a gust, the next auto is empowered), Wind Wall (enemy line skillshots
// inside the zone are bent aside once and fly at half speed), Updraft (E charges the gust at once).
// All state in sim.state, keyed by champion eid; no Math.random/sin/cos.

import { query } from 'bitecs';
import type { Sim } from '../sim';
import { sec } from '../types';
import { addBuff } from '../buffs';
import { dealDamage } from '../damage';
import { dist2, rotate } from '../vec';
import { rv } from '../systems/abilities';
import type { ChampionHooks, ChampionVisuals } from './hooks';
import { byLevel, stateMap } from './dagny';
import { peekState } from './util';

const GUST_DIST = 500;
const GUST_SLOW_PCT = 20;
const TELEPORT_JUMP = 120; // a single-tick move this long is a recall / respawn / flash, not walking
const WALL_SPEED = 0.5;
const WALL_BEND_DEG = 22;

interface Gust {
  lx: number;
  ly: number;
  dist: number;
  /** Gust autos fired and not yet landed. */
  pending: number;
}
const gusts = (sim: Sim): Map<number, Gust> => stateMap<Gust>(sim, 'sveaGust');

export const sveaGustReady = (sim: Sim, eid: number): boolean => (gusts(sim).get(eid)?.dist ?? 0) >= GUST_DIST;

/** E: the gust is charged at once. */
export function chargeGust(sim: Sim, eid: number): void {
  const g = gusts(sim).get(eid);
  if (g) g.dist = GUST_DIST;
}

interface Zone {
  x: number;
  y: number;
  r: number;
  until: number;
  total: number;
  /** projectile eid -> [original speed, payload id] (restored when it leaves the zone); bent = already pushed aside. */
  slowed: Map<number, [number, number]>;
}
const zones = (sim: Sim): Map<number, Zone> => stateMap<Zone>(sim, 'sveaWall');

/** Enemy line skillshots in the zone: bent once to the side (away from the zone centre line), then half speed while inside. */
function wallTick(sim: Sim, eid: number, z: Zone): void {
  const { Proj, Pos, Unit } = sim.c;
  const team = Unit.team[eid]!;
  const live = new Set<number>();
  for (const p of query(sim.world, [Proj])) {
    if (Proj.team[p] === team || Proj.kind[p] !== 1) continue;
    const px = Pos.x[p]!;
    const py = Pos.y[p]!;
    if (dist2(px, py, z.x, z.y) > z.r * z.r) continue;
    live.add(p);
    if (z.slowed.has(p)) continue;
    z.slowed.set(p, [Proj.speed[p]!, Proj.payload[p]!]);
    Proj.speed[p] = Proj.speed[p]! * WALL_SPEED;
    const side = Proj.dx[p]! * (py - z.y) - Proj.dy[p]! * (px - z.x) >= 0 ? 1 : -1;
    const [dx, dy] = rotate(Proj.dx[p]!, Proj.dy[p]!, side * WALL_BEND_DEG);
    Proj.dx[p] = dx;
    Proj.dy[p] = dy;
  }
  releaseOutside(sim, z, live);
}

/** Restore the speed of every slowed projectile not in `keep` (still the same projectile, not yet recycled). */
function releaseOutside(sim: Sim, z: Zone, keep: Set<number>): void {
  const { Proj } = sim.c;
  for (const [p, [speed, pid]] of z.slowed) {
    if (keep.has(p)) continue;
    z.slowed.delete(p);
    if (Proj.payload[p] === pid && Proj.speed[p] === speed * WALL_SPEED) Proj.speed[p] = speed;
  }
}

function sveaTick(sim: Sim, eid: number): void {
  const { Pos, Unit } = sim.c;
  const g = gusts(sim).get(eid);
  if (g) {
    const moved = Math.sqrt(dist2(Pos.x[eid]!, Pos.y[eid]!, g.lx, g.ly));
    if (!Unit.alive[eid]) g.dist = 0;
    else if (moved < TELEPORT_JUMP) g.dist = Math.min(GUST_DIST, g.dist + moved);
    g.lx = Pos.x[eid]!;
    g.ly = Pos.y[eid]!;
  }
  const z = zones(sim).get(eid);
  if (!z) return;
  if (sim.tick >= z.until || !Unit.alive[eid]) {
    releaseOutside(sim, z, new Set());
    zones(sim).delete(eid);
  } else wallTick(sim, eid, z);
}

function sveaVisuals(sim: Sim, eid: number): ChampionVisuals {
  const v: ChampionVisuals = {};
  const g = peekState<Gust>(sim, 'sveaGust')?.get(eid);
  const ready = (g?.dist ?? 0) >= GUST_DIST;
  v.passive = { stacks: Math.floor(((g?.dist ?? 0) / GUST_DIST) * 5), max: 5, ready };
  if (ready) v.empowered = 4;
  const z = peekState<Zone>(sim, 'sveaWall')?.get(eid);
  if (z && sim.tick < z.until) v.objects = [{ key: `${eid}`, tag: 'svea_w_zone', x: z.x, y: z.y, r: z.r, shape: 'disc', left: z.until - sim.tick, total: z.total }];
  return v;
}

export const hooks: ChampionHooks = {
  visuals: sveaVisuals,
  onTick: sveaTick,
  passive: {
    svea_gust: {
      onSpawn(sim, eid) {
        gusts(sim).set(eid, { lx: sim.c.Pos.x[eid]!, ly: sim.c.Pos.y[eid]!, dist: 0, pending: 0 });
      },
      onAutoFire(sim, eid) {
        const g = gusts(sim).get(eid);
        if (!g || g.dist < GUST_DIST) return;
        g.dist = 0;
        g.pending++;
      },
      onAutoHit(sim, eid, target) {
        const g = gusts(sim).get(eid);
        if (!g || g.pending <= 0) return;
        g.pending--;
        dealDamage(sim, eid, target, byLevel(sim, eid, 25, 70), 'magic');
        addBuff(sim, target, { kind: 'slow', id: 'svea_gust', src: eid, pct: GUST_SLOW_PCT, ticks: sec(1) });
      },
    },
  },
  effects: {
    svea_w_zone(sim, ctx) {
      const secs = rv(ctx.ability.duration ?? 4, ctx.rank);
      const total = sec(secs);
      const old = zones(sim).get(ctx.caster);
      if (old) releaseOutside(sim, old, new Set());
      zones(sim).set(ctx.caster, { x: ctx.x, y: ctx.y, r: ctx.ability.radius ?? 280, until: sim.tick + total, total, slowed: new Map() });
    },
    svea_e_gust(sim, ctx) {
      if (ctx.phase === 'cast') chargeGust(sim, ctx.caster);
    },
  },
};
