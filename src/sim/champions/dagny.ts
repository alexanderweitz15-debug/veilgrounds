// Dagny Kessel hooks. Also hosts a few tiny helpers shared by Agent F's hook files (state maps, level scaling,
// tick-driven effect contexts) because hook files may not add engine modules.

import { query } from 'bitecs';
import type { Sim } from '../sim';
import { Kind, sec } from '../types';
import { dealDamage } from '../damage';
import { addBuff, buffs } from '../buffs';
import { cosDeg, dist2 } from '../vec';
import { championData, champIdOf } from './index';
import { enemiesInRadius } from '../systems/abilities';
import { destroyProjectile } from '../systems/projectiles';
import type { AbilityData } from './schema';
import type { ChampionHooks, ChampionVisuals, EffectCtx, UnitMark } from './hooks';
import { peekState } from './util';

// ------------------------------------------------------------------ shared helpers (Agent F hook files)

export const abilityOf = (sim: Sim, eid: number, slot: number): AbilityData => championData(champIdOf(sim, eid)).abilities[slot]!;

/** Per-sim, per-key Map (hook state lives in sim.state, keyed by entity id). */
export function stateMap<T>(sim: Sim, key: string): Map<number, T> {
  let m = sim.state[key] as Map<number, T> | undefined;
  if (!m) sim.state[key] = m = new Map();
  return m;
}

export const byLevel = (sim: Sim, eid: number, lo: number, hi: number): number => lo + ((hi - lo) * (Math.max(1, sim.c.Champ.level[eid]!) - 1)) / 17;

/** Units matching pred, ascending eid (deterministic order). */
export function unitsWhere(sim: Sim, pred: (e: number) => boolean): number[] {
  const out: number[] = [];
  const ents = query(sim.world, [sim.c.Unit]);
  for (let i = 0; i < ents.length; i++) if (pred(ents[i]!)) out.push(ents[i]!);
  return out.sort((a, b) => a - b);
}

/** Champion or practice dummy (dummies stand in for champions in tests and the sandbox). */
export const isChamp = (sim: Sim, e: number): boolean => sim.c.Unit.kind[e] === Kind.Champion || sim.c.Unit.kind[e] === Kind.Dummy;

/** Allied champions of eid (alive, including eid). */
export const alliedChamps = (sim: Sim, eid: number): number[] =>
  unitsWhere(sim, (a) => !!sim.c.Unit.alive[a] && sim.c.Unit.kind[a] === Kind.Champion && sim.c.Unit.team[a] === sim.c.Unit.team[eid]);

/** Effect context for a tick-driven resolution (multi-strike abilities, delayed explosions). */
export function tickCtx(sim: Sim, caster: number, slot: number, rank: number, hits: number[], x: number, y: number): EffectCtx {
  return { caster, slot, rank, ability: abilityOf(sim, caster, slot), hits, x, y, target: -1, phase: 'cast', dx: 0, dy: 0, cursorX: x, cursorY: y };
}

/** Enemy projectiles (entity ids) within r of (x, y), ascending eid. */
export function enemyProjectilesNear(sim: Sim, team: number, x: number, y: number, r: number): number[] {
  const { Proj, Pos } = sim.c;
  const out: number[] = [];
  const ents = query(sim.world, [Proj]);
  for (let i = 0; i < ents.length; i++) {
    const p = ents[i]!;
    if (Proj.team[p] !== team && dist2(Pos.x[p]!, Pos.y[p]!, x, y) <= r * r) out.push(p);
  }
  return out.sort((a, b) => a - b);
}

// ------------------------------------------------------------------ Dagny

const autoCount = (sim: Sim): Map<number, number> => stateMap<number>(sim, 'dagnyAutos');

/** E shield wall: facing at cast, last position (movement direction) and end tick. */
interface Wall {
  fx: number;
  fy: number;
  lx: number;
  ly: number;
  until: number;
}
const walls = (sim: Sim): Map<number, Wall> => stateMap<Wall>(sim, 'dagnyWall');
const COS45 = cosDeg(45);

/** Per-tick E: destroy enemy projectiles about to hit Dagny from her front 180°; +30 % MS moving within 45°. */
function dagnyTick(sim: Sim, eid: number): void {
  const w = walls(sim).get(eid);
  if (!w) return;
  const { Pos, Proj, Unit } = sim.c;
  if (sim.tick >= w.until || !Unit.alive[eid]) return void walls(sim).delete(eid);
  const x = Pos.x[eid]!;
  const y = Pos.y[eid]!;
  // projectiles move after this tick's casts; anything that can reach her hitbox this tick is checked now
  for (const p of enemyProjectilesNear(sim, Unit.team[eid]!, x, y, 400)) {
    const reach = Proj.speed[p]! / 30 + Unit.radius[eid]! + Proj.width[p]! / 2 + 5;
    const vx = Pos.x[p]! - x;
    const vy = Pos.y[p]! - y;
    if (vx * vx + vy * vy <= reach * reach && vx * w.fx + vy * w.fy > 0) destroyProjectile(sim, p);
  }
  const mx = x - w.lx;
  const my = y - w.ly;
  w.lx = x;
  w.ly = y;
  const along = mx * w.fx + my * w.fy;
  if (along > 0 && along * along >= COS45 * COS45 * (mx * mx + my * my))
    addBuff(sim, eid, { kind: 'stat', stat: 'ms', id: 'dagny_e', src: eid, pct: 30, ticks: 2 });
}

/** Half length and distance (beyond her radius) of the drawn E shield wall. */
const WALL_HALF = 150;
const WALL_GAP = 30;

/**
 * Snapshot visuals (read-only): passive auto counter (3rd auto = burst, empowered glow), E shield wall in front of her
 * (oriented along the facing at cast, like the projectile block), W armor shred marks on enemies.
 */
function dagnyVisuals(sim: Sim, eid: number): ChampionVisuals {
  const { Pos, Unit } = sim.c;
  const v: ChampionVisuals = {};
  const n = peekState<number>(sim, 'dagnyAutos')?.get(eid) ?? 0;
  v.passive = { stacks: n, max: 3, ready: n >= 2 };
  if (n >= 2 && Unit.alive[eid]) v.empowered = 4;
  const w = peekState<Wall>(sim, 'dagnyWall')?.get(eid);
  if (w && sim.tick < w.until && Unit.alive[eid]) {
    const off = Unit.radius[eid]! + WALL_GAP;
    const cx = Pos.x[eid]! + w.fx * off;
    const cy = Pos.y[eid]! + w.fy * off;
    v.objects = [{
      key: `${eid}`, tag: 'dagny_e_wall', shape: 'wall', r: 18,
      x: cx - w.fy * WALL_HALF, y: cy + w.fx * WALL_HALF, x2: cx + w.fy * WALL_HALF, y2: cy - w.fx * WALL_HALF,
      left: w.until - sim.tick, total: sec(2),
    }];
    v.aura = 2;
  }
  const marks: UnitMark[] = [];
  for (const t of unitsWhere(sim, (e) => !!Unit.alive[e])) {
    for (const b of buffs(sim, t)) {
      if (b.id === 'dagny_w_shred' && b.src === eid && b.until > sim.tick) marks.push({ target: t, id: 'dagny_w_shred', left: b.until - sim.tick });
    }
  }
  if (marks.length) v.marks = marks;
  return v;
}

export const hooks: ChampionHooks = {
  visuals: dagnyVisuals,
  onTick: dagnyTick,
  passive: {
    dagny_glowing_shield: {
      onSpawn(sim, eid) {
        autoCount(sim).set(eid, 0);
      },
      // every 3rd auto: 4 % max HP magic damage to enemies within 200 of the target (target included)
      onAutoHit(sim, eid, target) {
        const n = (autoCount(sim).get(eid) ?? 0) + 1;
        if (n < 3) return void autoCount(sim).set(eid, n);
        autoCount(sim).set(eid, 0);
        const { Pos, Hp, Unit } = sim.c;
        const amount = 0.04 * Hp.max[eid]!;
        const around = enemiesInRadius(sim, eid, Pos.x[target]!, Pos.y[target]!, 200);
        if (!around.includes(target) && Unit.alive[target]) around.unshift(target);
        for (const e of around) dealDamage(sim, eid, e, amount, 'magic');
      },
    },
  },
  effects: {
    // engine arms the next auto (`*_next_auto`) and resolves the listed damage on it
    dagny_q_next_auto() {},
    dagny_w_armor_shred(sim, ctx) {
      for (const t of ctx.hits) addBuff(sim, t, { kind: 'stat', stat: 'armor', id: 'dagny_w_shred', src: ctx.caster, pct: -10, ticks: sec(4) });
    },
    dagny_e_shield_wall(sim, ctx) {
      const { Face, Pos } = sim.c;
      const e = ctx.caster;
      walls(sim).set(e, { fx: Face.x[e]!, fy: Face.y[e]!, lx: Pos.x[e]!, ly: Pos.y[e]!, until: sim.tick + sec(2) });
    },
    dagny_r_center_stun(sim, ctx) {
      if (ctx.phase !== 'cast') return; // dash end only
      const { Pos, Unit } = sim.c;
      for (const t of ctx.hits) {
        const r = 150 + Unit.radius[t]!;
        if (dist2(Pos.x[t]!, Pos.y[t]!, ctx.x, ctx.y) <= r * r) addBuff(sim, t, { kind: 'stun', id: 'dagny_r_center', src: ctx.caster, ticks: sec(1) });
      }
    },
  },
};
