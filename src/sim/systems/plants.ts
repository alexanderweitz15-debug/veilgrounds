// Jungle plants (LoL blast cone / honeyfruit / scryer's bloom stand-ins). Positions from map data
// (sides[team].plants), first growth 1:30, regrowth 5:00 after being popped. A plant is a neutral Kind.Plant unit with
// 1 HP that only a champion basic attack can pop (damage.ts, attack.ts); bots ignore plants (no perception branch).
//   Sprungfrucht: every champion within SPRUNG_R is launched SPRUNG_DIST away from the plant over 0.5 s, over walls
//                 (landing point: the nearest walkable spot at or beyond the nominal distance along the line).
//   Honigfrucht:  champions within HONIG_R heal 60 + 6 % max HP and are slowed 25 % for 1.5 s (the eaten fruit).
//   Spähfrucht:   the popping team sees a cone pointing away from the attacker for 10 s (three vision points).
// Deterministic: only + - * / sqrt, no rng.

import type { Sim } from '../sim';
import { isRef, spawnUnit, despawn } from '../sim';
import type { System } from './index';
import { Kind, Team, sec, variantIndex, type PlantType } from '../types';
import { walkable, nearestWalkable } from '../map';
import { dist2 } from '../vec';
import { addBuff, healUnit } from '../buffs';
import { leapTo } from './abilities';
import { champions } from './economy';

export const PLANT_FIRST = 90;
export const PLANT_RESPAWN = 300;
export const PLANT_RADIUS = 45;
export const SPRUNG_R = 380;
export const SPRUNG_DIST = 650;
export const SPRUNG_TICKS = sec(0.5);
/** A wall at the nominal landing spot extends the leap by up to this much (else it falls short). */
export const SPRUNG_EXTRA = 500;
export const HONIG_R = 320;
export const HONIG_HEAL = 60;
export const HONIG_HEAL_PCT = 0.06;
export const HONIG_SLOW = 25;
export const SPAEH_TICKS = sec(10);
/** Vision points of the Spähfrucht cone: distance along the direction and radius. */
export const SPAEH_POINTS: readonly [number, number][] = [
  [450, 380],
  [900, 480],
  [1350, 560],
];

export interface Plant {
  type: PlantType;
  x: number;
  y: number;
  eid: number;
  serial: number;
  /** Tick of the next growth, -1 while the plant stands. */
  spawnAt: number;
}

interface PlantState {
  plants: Plant[];
  /** Spähfrucht vision points: eid, serial, expiry tick. */
  wards: { eid: number; serial: number; until: number }[];
}

export function plantState(sim: Sim): PlantState {
  let s = sim.state.plants as PlantState | undefined;
  if (!s) {
    const plants: Plant[] = [];
    for (const side of [0, 1]) {
      for (const p of sim.map.sides[side]!.plants) {
        if (p.type !== 'sprungfrucht' && p.type !== 'honigfrucht' && p.type !== 'spaehfrucht') continue;
        const w = nearestWalkable(sim.map.nav, p.x, p.y);
        plants.push({ type: p.type, x: w.x, y: w.y, eid: -1, serial: 0, spawnAt: sec(PLANT_FIRST) });
      }
    }
    s = { plants, wards: [] };
    sim.state.plants = s;
  }
  return s;
}

function grow(sim: Sim, p: Plant): void {
  const { Unit, Hp, Vision } = sim.c;
  const eid = spawnUnit(sim, Kind.Plant, Team.Neutral, p.x, p.y, PLANT_RADIUS);
  Unit.variant[eid] = variantIndex(p.type);
  Hp.max[eid] = Hp.cur[eid] = 1;
  Vision.r[eid] = 0;
  p.eid = eid;
  p.serial = Unit.serial[eid]!;
  p.spawnAt = -1;
}

export const plantsSystem: System = {
  name: 'plants',
  init(sim) {
    plantState(sim);
  },
  update(sim) {
    const s = plantState(sim);
    for (const p of s.plants) if (p.spawnAt >= 0 && sim.tick >= p.spawnAt) grow(sim, p);
    if (s.wards.length) {
      s.wards = s.wards.filter((w) => {
        if (sim.tick < w.until) return true;
        if (isRef(sim, w.eid, w.serial)) despawn(sim, w.eid);
        return false;
      });
    }
  },
};

/** Unit direction from (ax, ay) to (bx, by); (fx, fy) when the points coincide. */
function unitDir(ax: number, ay: number, bx: number, by: number, fx: number, fy: number): [number, number] {
  const dx = bx - ax;
  const dy = by - ay;
  const l = Math.sqrt(dx * dx + dy * dy);
  return l > 1e-6 ? [dx / l, dy / l] : [fx, fy];
}

/** Landing spot of a leap from (x, y) along (dx, dy): the nominal distance if walkable, else a bit further, else back. */
export function leapLanding(sim: Sim, x: number, y: number, dx: number, dy: number, dist: number): { x: number; y: number } {
  const nav = sim.map.nav;
  for (let d = dist; d <= dist + SPRUNG_EXTRA; d += 25) {
    const px = x + dx * d;
    const py = y + dy * d;
    if (walkable(nav, px, py)) return { x: px, y: py };
  }
  for (let d = dist - 25; d > 0; d -= 25) {
    const px = x + dx * d;
    const py = y + dy * d;
    if (walkable(nav, px, py)) return { x: px, y: py };
  }
  return { x, y };
}

function spaehVision(sim: Sim, team: number, x: number, y: number, dx: number, dy: number): void {
  const { Unit, Vision, Hp } = sim.c;
  for (const [d, r] of SPAEH_POINTS) {
    const eid = spawnUnit(sim, Kind.Ward, team, x + dx * d, y + dy * d, 1);
    Hp.max[eid] = Hp.cur[eid] = 0;
    Unit.untargetable[eid] = 1;
    Unit.invulnerable[eid] = 1;
    Vision.r[eid] = r;
    plantState(sim).wards.push({ eid, serial: Unit.serial[eid]!, until: sim.tick + SPAEH_TICKS });
  }
}

/** Called by economy.onDeath for Kind.Plant: the plant's effect, regrowth timer. */
export function onPlantDeath(sim: Sim, victim: number, killer: number): void {
  const { Unit, Pos, Hp, Face } = sim.c;
  const p = plantState(sim).plants.find((q) => q.eid === victim && q.serial === Unit.serial[victim]);
  if (!p) return;
  p.eid = -1;
  p.spawnAt = sim.tick + sec(PLANT_RESPAWN);
  const near = (r: number): number[] => champions(sim).filter((c) => Unit.alive[c] && dist2(Pos.x[c]!, Pos.y[c]!, p.x, p.y) <= r * r);
  if (p.type === 'sprungfrucht') {
    for (const c of near(SPRUNG_R)) {
      const [dx, dy] = unitDir(p.x, p.y, Pos.x[c]!, Pos.y[c]!, Face.x[c]!, Face.y[c]!);
      const land = leapLanding(sim, Pos.x[c]!, Pos.y[c]!, dx, dy, SPRUNG_DIST);
      leapTo(sim, victim, c, land.x, land.y, SPRUNG_TICKS);
    }
  } else if (p.type === 'honigfrucht') {
    for (const c of near(HONIG_R)) {
      healUnit(sim, c, HONIG_HEAL + HONIG_HEAL_PCT * Hp.max[c]!);
      addBuff(sim, c, { kind: 'slow', id: 'honigfrucht', src: victim, pct: HONIG_SLOW, ticks: sec(1.5) });
    }
  } else if (killer >= 0) {
    const team = Unit.team[killer]!;
    if (team === 0 || team === 1) {
      const [dx, dy] = unitDir(Pos.x[killer]!, Pos.y[killer]!, p.x, p.y, Face.x[killer]!, Face.y[killer]!);
      spaehVision(sim, team, p.x, p.y, dx, dy);
    }
  }
}
