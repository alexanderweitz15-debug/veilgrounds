// Isolde Glasmacherin hooks: tempered glass (passive), cut/break (Q), outer-half cone (W), wire (E), glass dome (R).

import { query } from 'bitecs';
import type { Sim } from '../sim';
import { sec } from '../types';
import { addBuff, addShield, healUnit, removeBuffs } from '../buffs';
import { dealDamage } from '../damage';
import { dist2 } from '../vec';
import { walkable } from '../map';
import { applyEffects, armNextAuto, cooldownLeft, displaceTo, landingPoint, openRecast, rv, setCooldown } from '../systems/abilities';
import { destroyProjectile } from '../systems/projectiles';
import { blockTerrain, ringCells } from '../summons';
import type { ChampionHooks } from './hooks';
import { isChamp, stateMap, tickCtx, unitsWhere } from './dagny';
import { peekState } from './util';
import type { ChampionVisuals, VisualObject } from './hooks';

const E_RECAST_DASH = 400;

/** Snapshot visuals: wire while pulling, recast dash range, glass dome, passive cooldown (read-only). */
function isoldeVisuals(sim: Sim, eid: number): ChampionVisuals {
  const { Pos, Champ } = sim.c;
  const v: ChampionVisuals = {};
  const objects: VisualObject[] = [];
  const w = peekState<Wire>(sim, 'isoldeE')?.get(eid);
  if (w && w.pulled && sim.tick <= w.pullUntil) objects.push({ key: `${eid}`, tag: 'isolde_wire', x: w.ax, y: w.ay, r: 14, shape: 'line', follow: eid, hue: 185 });
  if (w && w.recastUntil >= sim.tick && sim.c.Unit.alive[eid]) {
    v.hints = [{ slot: 2, x: Pos.x[eid]!, y: Pos.y[eid]!, r: E_RECAST_DASH + sim.c.Unit.radius[eid]! }];
    objects.push({ key: `${eid}`, tag: 'isolde_anchor', x: w.ax, y: w.ay, r: 40, shape: 'pin', left: w.recastUntil - sim.tick, total: sec(1), hue: 185 });
  }
  const d = peekState<Dome>(sim, 'isoldeDome')?.get(eid);
  if (d && sim.tick < d.until) objects.push({ key: `${eid}`, tag: 'isolde_dome', x: d.x, y: d.y, r: DOME_R, shape: 'dome', left: d.until - sim.tick, total: d.until - d.start, hue: 185 });
  if (objects.length) v.objects = objects;
  const g = peekState<Glass>(sim, 'isoldeGlass')?.get(eid);
  const lvl = Math.max(1, Champ.level[eid]!);
  const cdTotal = sec(16 - (8 * (lvl - 1)) / 17);
  const left = g ? g.ready - sim.tick : 0;
  const quiet = !g || sim.tick - g.lastHit >= sec(2);
  v.passive = { cdLeft: Math.max(0, left), cdTotal, ready: left <= 0 && quiet };
  return v;
}

// ------------------------------------------------------------------ passive: tempered glass

interface Glass {
  lastHit: number;
  ready: number;
}
const glass = (sim: Sim): Map<number, Glass> => stateMap<Glass>(sim, 'isoldeGlass');

/**
 * After 2 s without taking damage, the next enemy hit grants a shield of 20 % max HP for 2 s.
 * ponytail: the shield absorbs every damage type (no typed shields in the engine). Upgrade: typed shield buffs.
 */
function temperedGlass(sim: Sim, eid: number, src: number): void {
  let g = glass(sim).get(eid);
  if (!g) glass(sim).set(eid, (g = { lastHit: -1e9, ready: 0 }));
  const quiet = sim.tick - g.lastHit >= sec(2);
  g.lastHit = sim.tick;
  if (!quiet || sim.tick < g.ready || src < 0 || sim.c.Unit.team[src] === sim.c.Unit.team[eid] || !sim.c.Unit.alive[eid]) return;
  const lvl = Math.max(1, sim.c.Champ.level[eid]!);
  g.ready = sim.tick + sec(16 - (8 * (lvl - 1)) / 17);
  addShield(sim, eid, 0.2 * sim.c.Hp.max[eid]!, sec(2), 'isolde_glass', eid);
}

// ------------------------------------------------------------------ Q: cut (cast) / break (recast)

const Q_BONUS = [0.2, 0.4, 0.6, 0.8, 1.0];
const cuts = (sim: Sim): Map<number, { rank: number; broken: boolean }> => stateMap(sim, 'isoldeQ');

// ------------------------------------------------------------------ E: wire

interface Wire {
  /** First cast pulled her to a wall (recast allowed after arrival). */
  pulled: boolean;
  /** Strip the generic AS buff of the first cast's resolution on the next tick. */
  strip: boolean;
  /** Recast allowed until this tick (only after a pull). */
  recastUntil: number;
  /** Recast dash in flight until this tick; stuns the first enemy champion touched. */
  dashUntil: number;
  rank: number;
  /** Wall anchor of the wire and the tick the pull ends (snapshot: wire line while pulling). */
  ax: number;
  ay: number;
  pullUntil: number;
}
const wires = (sim: Sim): Map<number, Wire> => stateMap<Wire>(sim, 'isoldeE');

/** Distance to the first non-walkable point along (dx, dy) within `range`, or -1. */
function wallDistance(sim: Sim, x: number, y: number, dx: number, dy: number, range: number): number {
  for (let d = 25; d <= range; d += 25) if (!walkable(sim.map.nav, x + dx * d, y + dy * d)) return d - 25;
  return -1;
}

// ------------------------------------------------------------------ R: glass dome

const DOME_R = 450;
interface Dome {
  x: number;
  y: number;
  /** Tick the dome goes up (after the leap) and comes down. */
  start: number;
  until: number;
  rank: number;
  up: boolean;
}
const domes = (sim: Sim): Map<number, Dome> => stateMap<Dome>(sim, 'isoldeDome');
const insideDome = (sim: Sim, d: Dome, e: number): boolean => dist2(sim.c.Pos.x[e]!, sim.c.Pos.y[e]!, d.x, d.y) <= DOME_R * DOME_R;

function domeTick(sim: Sim, eid: number): void {
  const d = domes(sim).get(eid);
  if (!d) return;
  if (sim.tick >= d.until) return void domes(sim).delete(eid);
  if (sim.tick < d.start) return;
  if (!d.up) {
    d.up = true;
    blockTerrain(sim, ringCells(sim, d.x, d.y, DOME_R, 50), d.until - sim.tick);
  }
  // enemy projectiles crossing the dome edge from outside are destroyed
  const { Proj, Pos, Unit } = sim.c;
  const ents = query(sim.world, [Proj]);
  for (let i = 0; i < ents.length; i++) {
    const p = ents[i]!;
    if (Proj.team[p] === Unit.team[eid]) continue;
    const r2 = dist2(Pos.x[p]!, Pos.y[p]!, d.x, d.y);
    if (r2 <= DOME_R * DOME_R) continue;
    const step = Proj.speed[p]! / 30;
    const nx = Pos.x[p]! + Proj.dx[p]! * step;
    const ny = Pos.y[p]! + Proj.dy[p]! * step;
    // homing projectiles hit when within the target radius, so test the target's side as well
    const t = Proj.kind[p] !== 1 ? Proj.target[p]! : -1;
    const intoDome = dist2(nx, ny, d.x, d.y) <= DOME_R * DOME_R || (t >= 0 && insideDome(sim, d, t) && r2 <= (DOME_R + step + 100) * (DOME_R + step + 100));
    if (intoDome) destroyProjectile(sim, p);
  }
}

function isoldeTick(sim: Sim, eid: number): void {
  const w = wires(sim).get(eid);
  if (w?.strip) {
    w.strip = false;
    removeBuffs(sim, eid, (b) => b.kind === 'stat' && b.stat === 'as' && b.id === 'isolde_e');
  }
  if (w && w.dashUntil > sim.tick) {
    const { Pos, Unit } = sim.c;
    const t = unitsWhere(sim, (e) => {
      if (!Unit.alive[e] || Unit.untargetable[e] || Unit.team[e] === Unit.team[eid] || !isChamp(sim, e)) return false;
      const r = Unit.radius[e]! + Unit.radius[eid]! + 10;
      return dist2(Pos.x[e]!, Pos.y[e]!, Pos.x[eid]!, Pos.y[eid]!) <= r * r;
    })[0];
    if (t !== undefined) {
      w.dashUntil = 0;
      applyEffects(sim, tickCtx(sim, eid, 2, w.rank, [t], Pos.x[t]!, Pos.y[t]!), 'all'); // stun on t, AS buff on Isolde
    }
  }
  domeTick(sim, eid);
}

export const hooks: ChampionHooks = {
  onTick: isoldeTick,
  visuals: isoldeVisuals,
  ownsHits: ['isolde_e'],
  passive: {
    isolde_tempered_glass: {
      onDamageTaken(sim, eid, src) {
        temperedGlass(sim, eid, src);
      },
      // autos inside her dome deal +4 % of the target's current HP (before the auto) as true damage
      onAutoHit(sim, eid, target, damage) {
        const d = domes(sim).get(eid);
        if (d?.up && insideDome(sim, d, eid) && insideDome(sim, d, target) && sim.c.Unit.alive[target])
          dealDamage(sim, eid, target, 0.04 * (sim.c.Hp.cur[target]! + damage), 'true');
      },
    },
  },
  effects: {
    // Cast: the next auto (3.5 s) deals +20-100 % AD. Recast 1.5-3.5 s after the cast: x1.4 instead, a level-scaled
    // share (40 % -> 100 %) as true damage, plus a 25 % slow for 1 s.
    isolde_q_cut_break(sim, ctx) {
      const e = ctx.caster;
      if (ctx.phase === 'cast') {
        cuts(sim).set(e, { rank: ctx.rank, broken: false });
        armNextAuto(sim, ctx, sec(3.5));
        openRecast(sim, e, 0, sim.tick + sec(1.5), sim.tick + sec(3.5));
      } else if (ctx.phase === 'recast') {
        // a press during the wind-up also lands here; harmless: the 'cast' phase that follows resets the cut
        const c = cuts(sim).get(e);
        if (c) c.broken = true;
      } else if (ctx.phase === 'empowered') {
        const c = cuts(sim).get(e);
        cuts(sim).delete(e);
        if (!c || ctx.target < 0 || !sim.c.Unit.alive[ctx.target]) return;
        const bonus = rv(Q_BONUS, c.rank) * sim.c.Stats.ad[e]!;
        if (!c.broken) return void dealDamage(sim, e, ctx.target, bonus, 'phys');
        const total = bonus * 1.4;
        const trueShare = 0.4 + (0.6 * (Math.max(1, sim.c.Champ.level[e]!) - 1)) / 17;
        dealDamage(sim, e, ctx.target, total * (1 - trueShare), 'phys');
        dealDamage(sim, e, ctx.target, total * trueShare, 'true');
        addBuff(sim, ctx.target, { kind: 'slow', id: 'isolde_q', src: e, pct: 25, ticks: sec(1) });
      }
    },
    // Cone resolution: ctx.x/y is Isolde's position. Outer half (325-650): 80 % slow 1 s, heal 50 % of the W
    // damage dealt to champions there (read from this tick's damage events; the generic damage ran just before).
    isolde_w_outer_half(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      const { Pos } = sim.c;
      for (const t of ctx.hits) {
        if (dist2(Pos.x[t]!, Pos.y[t]!, ctx.x, ctx.y) < 325 * 325) continue;
        addBuff(sim, t, { kind: 'slow', id: 'isolde_w_outer', src: ctx.caster, pct: 80, ticks: sec(1) });
        if (!isChamp(sim, t)) continue;
        for (let i = sim.events.length - 1; i >= 0; i--) {
          const e = sim.events[i]!;
          if (e.e === 'damage' && e.src === ctx.caster && e.dst === t) {
            healUnit(sim, ctx.caster, 0.5 * e.amount);
            break;
          }
        }
      }
    },
    // First cast: a wire up to 800 toward the cursor; terrain hit -> pulled there, recast window 1 s after arrival;
    // no terrain -> no movement, half cooldown. Recast: dash 400 toward the cursor; the first enemy champion touched
    // takes the generic stun and Isolde gets the AS buff (owned hits; isoldeTick).
    isolde_e_wire(sim, ctx) {
      const e = ctx.caster;
      const { Pos } = sim.c;
      if (ctx.phase === 'dashStart' && ctx.dash) {
        const d = wallDistance(sim, Pos.x[e]!, Pos.y[e]!, ctx.dash.dx, ctx.dash.dy, rv(ctx.ability.range, ctx.rank));
        const ax = Pos.x[e]! + ctx.dash.dx * (d + 25);
        const ay = Pos.y[e]! + ctx.dash.dy * (d + 25);
        const pullUntil = d > 0 ? sim.tick + Math.ceil((d / ctx.dash.speed) * 30) + 1 : 0;
        wires(sim).set(e, { pulled: d > 0, strip: false, recastUntil: 0, dashUntil: 0, rank: ctx.rank, ax, ay, pullUntil });
        if (d > 0) ctx.dash.distance = d;
        else {
          ctx.dash.distance = 0;
          setCooldown(sim, e, 2, Math.round(cooldownLeft(sim, e, 2) / 2));
        }
      } else if (ctx.phase === 'cast') {
        const w = wires(sim).get(e);
        if (!w) return;
        w.strip = true; // the generic self AS buff belongs to the recast hit
        if (w.pulled) {
          w.recastUntil = sim.tick + sec(1);
          openRecast(sim, e, 2, sim.tick, w.recastUntil);
        }
      } else if (ctx.phase === 'recast') {
        // a second press during the wind-up also arrives as 'recast': only a pull's window counts
        const w = wires(sim).get(e);
        if (!w || sim.tick > w.recastUntil) return;
        w.recastUntil = 0;
        const dist = ctx.ability.distance ?? 400;
        const p = landingPoint(sim, Pos.x[e]!, Pos.y[e]!, Pos.x[e]! + ctx.dx * dist, Pos.y[e]! + ctx.dy * dist);
        const ticks = Math.max(1, Math.round((Math.sqrt(dist2(p.x, p.y, Pos.x[e]!, Pos.y[e]!)) * 30) / (ctx.ability.speed ?? 1600)));
        // ponytail: the recast dash uses the displacement API (airborne on herself while moving)
        displaceTo(sim, e, e, p.x, p.y, ticks);
        w.dashUntil = sim.tick + ticks + 1;
      }
    },
    // Leap onto the target champion (untargetable mid-leap), then a 3.5 s dome (radius 450) centred there.
    isolde_r_glass_dome(sim, ctx) {
      if (ctx.phase !== 'cast' || ctx.target < 0) return;
      const e = ctx.caster;
      const { Pos, Unit } = sim.c;
      const t = ctx.target;
      const [x, y] = [Pos.x[t]!, Pos.y[t]!];
      const gap = Math.max(0, Math.sqrt(dist2(x, y, Pos.x[e]!, Pos.y[e]!)) - Unit.radius[t]! - Unit.radius[e]!);
      const ticks = Math.max(1, Math.round((gap * 30) / 1200));
      addBuff(sim, e, { kind: 'stat', stat: 'untargetable', id: 'isolde_r_leap', src: e, ticks: ticks + 1 });
      if (gap > 0) {
        const k = gap / Math.max(1e-9, Math.sqrt(dist2(x, y, Pos.x[e]!, Pos.y[e]!)));
        displaceTo(sim, e, e, Pos.x[e]! + (x - Pos.x[e]!) * k, Pos.y[e]! + (y - Pos.y[e]!) * k, ticks);
      }
      const dur = sec(rv(ctx.ability.duration, ctx.rank) || 3.5);
      domes(sim).set(e, { x, y, start: sim.tick + ticks + 1, until: sim.tick + ticks + 1 + dur, rank: ctx.rank, up: false });
    },
  },
};

