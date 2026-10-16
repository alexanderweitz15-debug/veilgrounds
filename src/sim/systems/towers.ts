// OWNER: agent A (structures: spawn, targeting, shot damage, plates, protection, inhibitor respawn, game end).
//
// Structure numbers (LoL-like):
//   tier            HP    armor/MR  damage 0:00 -> 20:00 (linear, then flat)
//   outer  (t0)   5000    40         170 -> 320   5 plates x 800 HP (break at 4200/3400/2600/1800/1000), 120 g each
//   inner  (t1)   3600    55         190 -> 360
//   inhib  (t2)   3300    55         210 -> 390
//   nexus  (t3)   2700    55         210 -> 390
//   inhibitor     4000    20         -            respawns after 5 min
//   nexus         5500     0         -
// Towers: range 750 (edge to edge, like attack ranges), 0.83 attacks/s, windup 0, radius 88, vision 1350.
// Warming vs champions: +40 % per consecutive shot on the same champion, max +120 %.
// vs minions: raw % of max HP (melee 45 %, caster 70 %, siege 15 %, super 7 %), so shot counts never drift: like LoL
// a caster dies to 2 shots (auto-shot-auto to last-hit it), a melee to 3 (shot-shot-auto). Was 50 % / 80 %: the 2nd
// shot killed a melee exactly, no last-hit window.
// Plates: plate gold goes to the champion landing the breaking hit; if a non-champion breaks it, it is split evenly
// between enemy champions within 1000. At 14:00 remaining plates fall (no gold) and outer towers lose 50 % armor.

import { query } from 'bitecs';
import type { Sim } from '../sim';
import { addComp, isRef, spawnUnit } from '../sim';
import type { System } from './index';
import { Kind, enemyOf, isMinion, sec, type DamageType, type LaneId } from '../types';
import { LANES } from '../map';
import { dist2, nearer } from '../vec';
import { sees } from '../vision';
import { MINION_STATS, recentVictim, targetLists, type TargetLists } from './minions';
import { champions, reward } from './economy';

export const TOWER_RANGE = 750;
export const TOWER_AS = 0.83;
export const TOWER_RADIUS = 88;
export const TOWER_VISION = 1350;
/** An enemy champion attacking an allied champion within this distance of the tower draws aggro. */
export const TOWER_DEFEND_RANGE = 1400;
export const PLATE_COUNT = 5;
export const PLATE_HP = 800;
export const PLATE_GOLD = 120;
export const PLATES_FALL_TICK = sec(14 * 60);
export const INHIB_RESPAWN = sec(5 * 60);
export const TOWER_KILL_TEAM_GOLD = 250;
export const TOWER_KILL_LAST_HIT_GOLD = 150;

export const TOWER_TIERS = [
  { hp: 5000, armor: 40, dmg0: 170, dmg20: 320 },
  { hp: 3600, armor: 55, dmg0: 190, dmg20: 360 },
  { hp: 3300, armor: 55, dmg0: 210, dmg20: 390 },
  { hp: 2700, armor: 55, dmg0: 210, dmg20: 390 },
] as const;
const INHIB = { hp: 4000, armor: 20, radius: 140 };
const NEXUS = { hp: 5500, armor: 0, radius: 220 };
const DMG_RAMP_TICKS = sec(20 * 60);

export interface StructureRec {
  team: number;
  kind: number;
  /** 0..2, 255 for nexus towers / nexus. */
  lane: number;
  /** Tower tier 0..3, -1 otherwise. */
  tier: number;
  x: number;
  y: number;
  eid: number;
  serial: number;
  alive: boolean;
  respawnAt: number;
}

interface TowerSt {
  list: StructureRec[];
  platesFallen: boolean;
  /** Target priority per tower eid: 1 = defending an allied champion, 2 = normal. */
  prio: Uint8Array;
}

export function towerState(sim: Sim): TowerSt {
  let s = sim.state.towers as TowerSt | undefined;
  if (!s) {
    s = { list: [], platesFallen: false, prio: new Uint8Array(sim.c.Unit.kind.length) };
    sim.state.towers = s;
  }
  return s;
}

function spawnStructure(sim: Sim, rec: StructureRec): void {
  const { Unit, Hp, Stats, Vision, Tower } = sim.c;
  const isTower = rec.kind === Kind.Tower;
  const radius = isTower ? TOWER_RADIUS : rec.kind === Kind.Inhibitor ? INHIB.radius : NEXUS.radius;
  const eid = spawnUnit(sim, rec.kind, rec.team, rec.x, rec.y, radius);
  const base = isTower ? TOWER_TIERS[rec.tier]! : rec.kind === Kind.Inhibitor ? INHIB : NEXUS;
  Unit.lane[eid] = rec.lane;
  Hp.max[eid] = Hp.cur[eid] = base.hp;
  Stats.armor[eid] = Stats.mr[eid] = base.armor;
  Vision.r[eid] = isTower ? TOWER_VISION : 0;
  if (isTower) {
    addComp(sim, Tower, eid);
    Tower.tier[eid] = rec.tier;
    Tower.plates[eid] = rec.tier === 0 && sim.tick < PLATES_FALL_TICK ? PLATE_COUNT : 0;
    Tower.lastTarget[eid] = -1;
    Tower.shotsOnSame[eid] = 0;
    Stats.as[eid] = TOWER_AS;
    Stats.range[eid] = TOWER_RANGE;
    Stats.windup[eid] = 0;
    Stats.ad[eid] = TOWER_TIERS[rec.tier]!.dmg0;
  }
  rec.eid = eid;
  rec.serial = Unit.serial[eid]!;
  rec.alive = true;
  rec.respawnAt = 0;
}

/** Base damage of a tower tier at `tick` (before warming/armor). */
export function towerBaseDamage(tier: number, tick: number): number {
  const t = TOWER_TIERS[tier]!;
  const f = tick >= DMG_RAMP_TICKS ? 1 : tick / DMG_RAMP_TICKS;
  return t.dmg0 + (t.dmg20 - t.dmg0) * f;
}

/**
 * Damage of one tower shot against target (handles %-max-HP vs minions, time scaling, warming).
 * Call exactly once per shot: it advances the warming counter.
 */
export function towerShotDamage(sim: Sim, tower: number, target: number): { amount: number; type: DamageType; raw: boolean } {
  const { Unit, Hp, Tower } = sim.c;
  const k = Unit.kind[target]!;
  if (isMinion(k)) {
    const pct = MINION_STATS[k]?.towerPct ?? 0.07;
    return { amount: Hp.max[target]! * pct, type: 'phys', raw: true };
  }
  let amount = towerBaseDamage(Tower.tier[tower]!, sim.tick);
  if (k === Kind.Champion) {
    if (Tower.lastTarget[tower] !== target) {
      Tower.lastTarget[tower] = target;
      Tower.shotsOnSame[tower] = 0;
    }
    amount *= 1 + 0.4 * Math.min(3, Tower.shotsOnSame[tower]!);
    Tower.shotsOnSame[tower] = Tower.shotsOnSame[tower]! + 1;
  }
  return { amount, type: 'phys', raw: false };
}

export function structureAt(sim: Sim, team: number, kind: number, lane: number, tier = -1): StructureRec | undefined {
  return towerState(sim).list.find((r) => r.team === team && r.kind === kind && r.lane === lane && r.tier === tier);
}

/** True if `team`'s inhibitor in `lane` is currently destroyed. */
export function inhibitorDown(sim: Sim, team: number, lane: LaneId): boolean {
  const r = structureAt(sim, team, Kind.Inhibitor, lane);
  return !!r && !r.alive;
}

/** Protection: a structure is untargetable + invulnerable until the previous one in its chain fell. */
function updateProtection(sim: Sim, s: TowerSt): void {
  const { Unit } = sim.c;
  for (const team of [0, 1]) {
    const dead = (kind: number, lane: number, tier = -1): boolean => !structureAt(sim, team, kind, lane, tier)?.alive;
    const anyInhibDown = [0, 1, 2].some((l) => dead(Kind.Inhibitor, l));
    for (const r of s.list) {
      if (r.team !== team || !r.alive) continue;
      let open: boolean;
      if (r.kind === Kind.Tower && r.tier <= 2) open = r.tier === 0 || dead(Kind.Tower, r.lane, r.tier - 1);
      else if (r.kind === Kind.Inhibitor) open = dead(Kind.Tower, r.lane, 2);
      else if (r.kind === Kind.Tower) open = anyInhibDown;
      else open = s.list.every((n) => n.team !== team || n.tier !== 3 || !n.alive);
      Unit.untargetable[r.eid] = Unit.invulnerable[r.eid] = open ? 0 : 1;
    }
  }
}

function updatePlates(sim: Sim, s: TowerSt): void {
  const { Tower, Hp, Stats, Unit, LastHit, Pos } = sim.c;
  if (!s.platesFallen && sim.tick >= PLATES_FALL_TICK) {
    s.platesFallen = true;
    for (const r of s.list) {
      if (r.kind !== Kind.Tower || r.tier !== 0 || !r.alive) continue;
      Tower.plates[r.eid] = 0;
      Stats.armor[r.eid] = TOWER_TIERS[0].armor * 0.5;
    }
    return;
  }
  for (const r of s.list) {
    if (r.kind !== Kind.Tower || r.tier !== 0 || !r.alive) continue;
    const e = r.eid;
    let broken = 0;
    for (let i = 1; i <= PLATE_COUNT; i++) if (Hp.cur[e]! <= Hp.max[e]! - i * PLATE_HP) broken++;
    while (Tower.plates[e]! > PLATE_COUNT - broken) {
      Tower.plates[e] = Tower.plates[e]! - 1;
      sim.events.push({ e: 'plate', tower: e, team: r.team });
      const src = LastHit.eid[e]!;
      const enemy = enemyOf(r.team);
      if (src >= 0 && Unit.serial[src] === LastHit.serial[e] && Unit.kind[src] === Kind.Champion && Unit.team[src] === enemy) {
        reward(sim, src, PLATE_GOLD);
      } else {
        const near = champions(sim).filter(
          (c) => Unit.alive[c] && Unit.team[c] === enemy && dist2(Pos.x[c]!, Pos.y[c]!, r.x, r.y) <= 1000 * 1000,
        );
        for (const c of near) reward(sim, c, PLATE_GOLD / near.length);
      }
    }
  }
}

/** Is t inside the tower's attack reach (edge to edge)? */
function inReach(sim: Sim, tower: number, t: number): boolean {
  const { Pos, Unit, Stats } = sim.c;
  const r = Stats.range[tower]! + Unit.radius[tower]! + Unit.radius[t]!;
  return dist2(Pos.x[tower]!, Pos.y[tower]!, Pos.x[t]!, Pos.y[t]!) <= r * r;
}

function canShoot(sim: Sim, tower: number, t: number): boolean {
  const { Unit } = sim.c;
  const team = Unit.team[tower]!;
  if (t < 0 || !Unit.alive[t] || Unit.untargetable[t] || Unit.team[t] === team) return false;
  const k = Unit.kind[t]!;
  if (!isMinion(k) && k !== Kind.Champion && k !== Kind.Dummy) return false;
  if ((k === Kind.Champion || k === Kind.Dummy) && !sees(sim, team, t)) return false;
  return inReach(sim, tower, t);
}

/** Enemy champion in reach that attacked an allied champion within TOWER_DEFEND_RANGE of the tower, nearest first. */
function defendTarget(sim: Sim, tower: number, champs: number[]): number {
  const { Pos, Unit } = sim.c;
  const team = Unit.team[tower]!;
  let best = -1;
  let bestD = Infinity;
  for (const c of champs) {
    if (Unit.team[c] === team || !canShoot(sim, tower, c)) continue;
    const v = recentVictim(sim, c);
    if (v < 0 || Unit.kind[v] !== Kind.Champion || Unit.team[v] !== team) continue;
    if (dist2(Pos.x[v]!, Pos.y[v]!, Pos.x[tower]!, Pos.y[tower]!) > TOWER_DEFEND_RANGE * TOWER_DEFEND_RANGE) continue;
    const d = dist2(Pos.x[c]!, Pos.y[c]!, Pos.x[tower]!, Pos.y[tower]!);
    if (best < 0 || nearer(d, Unit.serial[c]!, bestD, Unit.serial[best]!)) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

/** Nearest unit in reach; exact ties go to the older unit (spawn serial, not eid: eids are recycled, serials keep
 *  mirrored waves in mirrored order). */
function nearestShootable(sim: Sim, tower: number, list: number[]): number {
  const { Pos, Unit } = sim.c;
  let best = -1;
  let bestD = Infinity;
  for (const t of list) {
    if (!inReach(sim, tower, t)) continue;
    const d = dist2(Pos.x[t]!, Pos.y[t]!, Pos.x[tower]!, Pos.y[tower]!);
    if (best < 0 || nearer(d, Unit.serial[t]!, bestD, Unit.serial[best]!)) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

function setTowerTarget(sim: Sim, tower: number, t: number, prio: number): void {
  const { Atk, Unit, Tower } = sim.c;
  if (Atk.target[tower] !== t || Atk.targetSerial[tower] !== Unit.serial[t]) {
    Atk.target[tower] = t;
    Atk.targetSerial[tower] = t >= 0 ? Unit.serial[t]! : 0;
    Tower.shotsOnSame[tower] = 0;
    Tower.lastTarget[tower] = t;
  }
  towerState(sim).prio[tower] = prio;
}

/** Tower targeting: minions first, champions next; switch at once to an enemy champion attacking an allied champion. */
export function updateTowerTarget(sim: Sim, tower: number, lists: [TargetLists, TargetLists], champs: number[]): void {
  const { Atk } = sim.c;
  const s = towerState(sim);
  let cur = Atk.target[tower]!;
  if (cur >= 0 && !(isRef(sim, cur, Atk.targetSerial[tower]!) && canShoot(sim, tower, cur))) cur = -1;
  if (cur < 0 || s.prio[tower] !== 1) {
    const d = defendTarget(sim, tower, champs);
    if (d >= 0) return setTowerTarget(sim, tower, d, 1);
  }
  if (cur >= 0) return;
  const l = lists[sim.c.Unit.team[tower] as 0 | 1];
  let t = nearestShootable(sim, tower, l.minions);
  if (t < 0) t = nearestShootable(sim, tower, l.champs);
  if (t < 0) t = nearestShootable(sim, tower, l.dummies);
  setTowerTarget(sim, tower, t, 2);
}

/** The match is decided (a nexus fell): drivers stop stepping, the world freezes behind the result screen. */
export const matchOver = (sim: Sim): boolean => sim.state.winner !== undefined;

/** Called from economy.onDeath for structures: rewards, inhibitor respawn timer, game end. */
export function onStructureDeath(sim: Sim, victim: number, killer: number): void {
  const { Unit } = sim.c;
  const s = towerState(sim);
  const r = s.list.find((x) => x.eid === victim && x.serial === Unit.serial[victim] && x.alive);
  if (!r) return;
  r.alive = false;
  const winners = enemyOf(r.team);
  if (r.kind === Kind.Tower) {
    for (const c of champions(sim)) if (Unit.team[c] === winners) reward(sim, c, TOWER_KILL_TEAM_GOLD);
    if (killer >= 0 && Unit.kind[killer] === Kind.Champion && Unit.team[killer] === winners) reward(sim, killer, TOWER_KILL_LAST_HIT_GOLD);
  } else if (r.kind === Kind.Inhibitor) {
    r.respawnAt = sim.tick + INHIB_RESPAWN;
  } else if (r.kind === Kind.Nexus && sim.state.winner === undefined) {
    sim.state.winner = winners;
    sim.events.push({ e: 'gameOver', winner: winners });
  }
}

export const towersSystem: System = {
  name: 'towers',
  init(sim) {
    const s = towerState(sim);
    for (const team of [0, 1]) {
      const side = sim.map.sides[team]!;
      LANES.forEach((name, lane) => {
        side.towers[name].forEach((p, tier) => s.list.push(rec(team, Kind.Tower, lane, tier, p.x, p.y)));
        const ip = side.inhibitors[name];
        s.list.push(rec(team, Kind.Inhibitor, lane, -1, ip.x, ip.y));
      });
      for (const p of side.nexusTowers) s.list.push(rec(team, Kind.Tower, 255, 3, p.x, p.y));
      s.list.push(rec(team, Kind.Nexus, 255, -1, side.nexus.x, side.nexus.y));
    }
    for (const r of s.list) spawnStructure(sim, r);
    updateProtection(sim, s);
  },
  update(sim) {
    const s = towerState(sim);
    for (const r of s.list) {
      if (!r.alive && r.kind === Kind.Inhibitor && r.respawnAt > 0 && sim.tick >= r.respawnAt) spawnStructure(sim, r);
    }
    updateProtection(sim, s);
    updatePlates(sim, s);
    const { Unit, Stats } = sim.c;
    const lists = targetLists(sim, query(sim.world, [Unit]));
    const champs = champions(sim);
    for (const r of s.list) {
      if (!r.alive || r.kind !== Kind.Tower) continue;
      Stats.ad[r.eid] = towerBaseDamage(r.tier, sim.tick); // informational; real damage is towerShotDamage
      updateTowerTarget(sim, r.eid, lists, champs);
    }
  },
};

const rec = (team: number, kind: number, lane: number, tier: number, x: number, y: number): StructureRec => ({
  team,
  kind,
  lane,
  tier,
  x,
  y,
  eid: -1,
  serial: 0,
  alive: false,
  respawnAt: 0,
});
