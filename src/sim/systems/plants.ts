// Jungle plants (LoL blast cone / honeyfruit / scryer's bloom stand-ins plus three own fruits). Values: data/plants.json.
// Positions from map data (sides[team].plants), first growth 1:30, regrowth 5:00 after being popped. A plant is a
// neutral Kind.Plant unit with 1 HP that only a champion basic attack can pop (damage.ts, attack.ts). Bots pop plants
// through the `plants` leaf (src/ai/bot/plants.ts). Every effect hits all living champions (both teams) near the plant:
//   Sprungfrucht: launched SPRUNG_DIST away from the plant over 0.5 s, over walls (landing: nearest walkable spot).
//   Honigfrucht:  drops HONIG.pieces honey pieces (Kind.Plant, variant honigstueck) around the plant; a champion that
//                 walks over one eats it: small heal + short slow. Pieces rot after HONIG.lifeS.
//   Spähfrucht:   the popping team sees a cone pointing away from the attacker for 10 s (three vision points);
//                 stealthed enemy wards/traps/seeds in it are revealed for 3 s (wards.ts stealth rules).
//   Manafrucht:   restores a share of max mana (min flat) - energy champions too.
//   Windfrucht:   +35 % move speed for 4 s.
//   Schildfrucht: shield (80 + 10 % max HP) for 5 s.
// Deterministic: only + - * / sqrt and the vec.ts trig tables, no rng.

import type { Sim } from '../sim';
import { isRef, spawnUnit, despawn } from '../sim';
import type { System } from './index';
import { Kind, Team, sec, variantIndex, type PlantType } from '../types';
import { walkable, nearestWalkable } from '../map';
import { dist2, rotate } from '../vec';
import { addBuff, addShield, healUnit } from '../buffs';
import { leapTo } from './abilities';
import { champions } from './economy';
import { STEALTH_LINGER, revealStealthArea } from '../wards';
import data from '../../data/plants.json';

export const PLANT_FIRST = data.firstS;
export const PLANT_RESPAWN = data.respawnS;
export const PLANT_RADIUS = data.radius;
export const PLANT_GROW_TICKS = sec(data.growS);
export const SPRUNG_R = data.sprung.r;
export const SPRUNG_DIST = data.sprung.dist;
export const SPRUNG_TICKS = sec(data.sprung.leapS);
/** A wall at the nominal landing spot extends the leap by up to this much (else it falls short). */
export const SPRUNG_EXTRA = data.sprung.extra;
export const HONIG = data.honig;
export const SPAEH_TICKS = sec(data.spaeh.s);
/** Vision points of the Spähfrucht cone: distance along the direction and radius. */
export const SPAEH_POINTS = data.spaeh.points as readonly [number, number][];
export const MANA = data.mana;
export const WIND = data.wind;
export const SCHILD = data.schild;

/** Map plants (placed from map.json); the honey piece is spawned by a pop. */
const MAP_TYPES: readonly string[] = ['sprungfrucht', 'honigfrucht', 'spaehfrucht', 'manafrucht', 'windfrucht', 'schildfrucht'];

export interface Plant {
  type: PlantType;
  x: number;
  y: number;
  eid: number;
  serial: number;
  /** Tick of the next growth, -1 while the plant stands. */
  spawnAt: number;
  /** Tick the standing plant grew (growth animation). */
  grownAt: number;
}

interface Piece {
  eid: number;
  serial: number;
  until: number;
  born: number;
}

interface PlantState {
  plants: Plant[];
  /** Honey pieces on the ground. */
  pieces: Piece[];
  /** Spähfrucht vision points: eid, serial, expiry tick. */
  wards: { eid: number; serial: number; until: number }[];
}

export function plantState(sim: Sim): PlantState {
  let s = sim.state.plants as PlantState | undefined;
  if (!s) {
    const plants: Plant[] = [];
    for (const side of [0, 1]) {
      for (const p of sim.map.sides[side]!.plants) {
        if (!MAP_TYPES.includes(p.type)) continue;
        const w = nearestWalkable(sim.map.nav, p.x, p.y);
        plants.push({ type: p.type as PlantType, x: w.x, y: w.y, eid: -1, serial: 0, spawnAt: sec(PLANT_FIRST), grownAt: 0 });
      }
    }
    s = { plants, pieces: [], wards: [] };
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
  p.grownAt = sim.tick;
}

/** Growth progress 0..1 of a plant or honey piece that appeared less than PLANT_GROW_TICKS ago; undefined once full-grown. */
export function plantGrowth(sim: Sim, eid: number): number | undefined {
  const s = sim.state.plants as PlantState | undefined; // read-only: snapshots call this
  if (!s) return undefined;
  const serial = sim.c.Unit.serial[eid];
  let born = -1;
  const p = s.plants.find((q) => q.eid === eid && q.serial === serial);
  if (p) born = p.grownAt;
  else {
    const h = s.pieces.find((q) => q.eid === eid && q.serial === serial);
    if (h) born = h.born;
  }
  if (born < 0) return undefined;
  const k = (sim.tick - born) / PLANT_GROW_TICKS;
  return k < 1 ? Math.max(0, k) : undefined;
}

function eatPiece(sim: Sim, piece: Piece, c: number): void {
  const { Hp } = sim.c;
  healUnit(sim, c, HONIG.heal + HONIG.healPct * Hp.max[c]!);
  addBuff(sim, c, { kind: 'slow', id: 'honigstueck', src: piece.eid, pct: HONIG.slow, ticks: sec(HONIG.slowS) });
  despawn(sim, piece.eid);
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
    if (s.pieces.length) {
      const { Pos, Unit } = sim.c;
      const champs = champions(sim).filter((c) => Unit.alive[c]);
      s.pieces = s.pieces.filter((h) => {
        if (!isRef(sim, h.eid, h.serial)) return false;
        if (sim.tick >= h.until) {
          despawn(sim, h.eid);
          return false;
        }
        // eaten by the first champion (lowest eid) standing on it; a piece that is still sprouting cannot be eaten
        if (sim.tick - h.born < sec(0.4)) return true;
        for (const c of champs) {
          const r = HONIG.pickupR + Unit.radius[c]!;
          if (dist2(Pos.x[c]!, Pos.y[c]!, Pos.x[h.eid]!, Pos.y[h.eid]!) <= r * r) {
            eatPiece(sim, h, c);
            return false;
          }
        }
        return true;
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
    // stealth rule (c): enemy wards / traps / seeds in the cone are revealed for STEALTH_LINGER (3 s) at the pop
    revealStealthArea(sim, team, x + dx * d, y + dy * d, r, STEALTH_LINGER);
  }
}

/** Honey pieces on a ring around the plant, evenly spread, the first one pointing away from the attacker. */
function dropHoney(sim: Sim, p: Plant, awayX: number, awayY: number): void {
  const { Unit, Hp, Vision } = sim.c;
  const s = plantState(sim);
  for (let i = 0; i < HONIG.pieces; i++) {
    const [dx, dy] = rotate(awayX, awayY, (i * 360) / HONIG.pieces);
    const r = i % 2 === 0 ? HONIG.ringMax : HONIG.ringMin;
    const w = nearestWalkable(sim.map.nav, p.x + dx * r, p.y + dy * r);
    const eid = spawnUnit(sim, Kind.Plant, Team.Neutral, w.x, w.y, 24);
    Unit.variant[eid] = variantIndex('honigstueck');
    Unit.untargetable[eid] = 1;
    Unit.invulnerable[eid] = 1;
    Hp.max[eid] = Hp.cur[eid] = 1;
    Vision.r[eid] = 0;
    s.pieces.push({ eid, serial: Unit.serial[eid]!, until: sim.tick + sec(HONIG.lifeS), born: sim.tick });
  }
}

/** Called by economy.onDeath for Kind.Plant: the plant's effect, regrowth timer. */
export function onPlantDeath(sim: Sim, victim: number, killer: number): void {
  const { Unit, Pos, Hp, Face, Mana } = sim.c;
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
    const [dx, dy] = killer >= 0 ? unitDir(Pos.x[killer]!, Pos.y[killer]!, p.x, p.y, 1, 0) : [1, 0];
    dropHoney(sim, p, dx, dy);
  } else if (p.type === 'manafrucht') {
    for (const c of near(MANA.r)) if (Mana.max[c]! > 0) Mana.cur[c] = Math.min(Mana.max[c]!, Mana.cur[c]! + Math.max(MANA.min, MANA.pct * Mana.max[c]!));
  } else if (p.type === 'windfrucht') {
    for (const c of near(WIND.r)) addBuff(sim, c, { kind: 'stat', stat: 'ms', id: 'windfrucht', src: victim, pct: WIND.ms, ticks: sec(WIND.s) });
  } else if (p.type === 'schildfrucht') {
    for (const c of near(SCHILD.r)) addShield(sim, c, SCHILD.amount + SCHILD.pctMaxHp * Hp.max[c]!, sec(SCHILD.s), 'schildfrucht', victim);
  } else if (killer >= 0) {
    const team = Unit.team[killer]!;
    if (team === 0 || team === 1) {
      const [dx, dy] = unitDir(Pos.x[killer]!, Pos.y[killer]!, p.x, p.y, Face.x[killer]!, Face.y[killer]!);
      spaehVision(sim, team, p.x, p.y, dx, dy);
    }
  }
}
