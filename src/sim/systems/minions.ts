// OWNER: agent A (minion stats, spawn helpers, aggro, lane following, aggression ledger, waveState).
//
// Minion stats (LoL-like):
//   melee  460 HP, 12 AD, 1.25 AS, range 110, r 48, 21 g, 59.4 XP
//   caster 290 HP, 23 AD, 0.667 AS, range 550, r 48, 14 g, 29.4 XP
//   siege  900 HP, 40 AD, 1.0 AS, range 300, r 65, 60 g, 93 XP
//   super 1600 HP, 190 AD, 0.85 AS, range 170, 30 armor/MR, r 65, 60 g, 97 XP
// HP and AD +3 % (additive) per 90 s of game time, fixed at spawn. All minions: MINION_MS, vision 1100.
// Stats are written once at spawn; the stats system snapshots them per serial as the buff base.

import { query } from 'bitecs';
import type { Sim } from '../sim';
import { isRef, spawnUnit } from '../sim';
import type { System } from './index';
import { Kind, isMinion, isStructure, type LaneId } from '../types';
import { LANES, findPath, lineWalkable, type Pt } from '../map';
import { dist2, nearer } from '../vec';
import { sees } from '../vision';
import { nextWaveInfo } from './waves';

/** Minions deal 60 % damage to champions and structures (spec §2). */
export const MINION_DMG_VS_CHAMP_STRUCT = 0.6;

export interface MinionStats {
  hp: number;
  ad: number;
  as: number;
  range: number;
  armor: number;
  mr: number;
  radius: number;
  gold: number;
  xp: number;
  /** Fraction of max HP one tower shot removes (raw, unaffected by HP scaling). */
  towerPct: number;
}

export const MINION_STATS: Record<number, MinionStats> = {
  [Kind.MinionMelee]: { hp: 460, ad: 12, as: 1.25, range: 110, armor: 0, mr: 0, radius: 48, gold: 21, xp: 59.4, towerPct: 0.45 },
  [Kind.MinionCaster]: { hp: 290, ad: 23, as: 0.667, range: 550, armor: 0, mr: 0, radius: 48, gold: 14, xp: 29.4, towerPct: 0.7 },
  [Kind.MinionSiege]: { hp: 900, ad: 40, as: 1.0, range: 300, armor: 0, mr: 0, radius: 65, gold: 60, xp: 93, towerPct: 0.15 },
  [Kind.MinionSuper]: { hp: 1600, ad: 190, as: 0.85, range: 170, armor: 30, mr: 30, radius: 65, gold: 60, xp: 97, towerPct: 0.07 },
};

/** LoL value (325). With the spawn offsets in waves.ts the waves meet at ~1:28 mid / ~1:38 side (was 300, 1:35 / 1:45). */
export const MINION_MS = 325;
export const MINION_VISION = 1100;
export const AGGRO_RANGE = 500;
export const CALL_RANGE = 1000;
/** A target further than this (centre distance) is dropped. */
export const LEASH_RANGE = 1000;
/**
 * Chase leash for champion targets (LoL: a minion gives up a champion soon after leaving its lane and walks back):
 * measured from the minion's last position on its lane while it was not targeting a champion. Beyond it the minion
 * drops the champion and takes no champion target until it is back (minions, structures still).
 */
export const CHASE_LEASH = 650;
/** How long an attack counts as an active call for help (ticks). */
export const CALL_WINDOW = 30;
const SCALE_STEP_TICKS = 2700; // 90 s

/** HP/AD multiplier for minions spawned at `tick` (+3 % per 90 s, additive). */
export const minionScale = (tick: number): number => 1 + 0.03 * Math.floor(tick / SCALE_STEP_TICKS);

export function spawnMinion(sim: Sim, kind: number, team: number, lane: LaneId, x: number, y: number): number {
  const s = MINION_STATS[kind]!;
  const { Unit, Hp, Stats, Vision } = sim.c;
  const eid = spawnUnit(sim, kind, team, x, y, s.radius);
  const m = minionScale(sim.tick);
  Unit.lane[eid] = lane;
  Hp.max[eid] = Hp.cur[eid] = s.hp * m;
  Stats.ad[eid] = s.ad * m;
  Stats.as[eid] = s.as;
  Stats.range[eid] = s.range;
  Stats.armor[eid] = s.armor;
  Stats.mr[eid] = s.mr;
  Stats.ms[eid] = MINION_MS;
  Vision.r[eid] = MINION_VISION;
  const st = aggroState(sim);
  st.prio[eid] = NO_TARGET;
  st.anchored[eid] = 0;
  return eid;
}

// ---------------------------------------------------------------- lane geometry

export interface LaneGeo {
  pts: Pt[];
  /** Cumulative distance at each waypoint. */
  cum: number[];
  len: number;
}

export function laneGeo(sim: Sim, team: number, lane: LaneId): LaneGeo {
  let cache = sim.state.laneGeo as LaneGeo[] | undefined;
  if (!cache) {
    cache = [];
    for (const t of [0, 1]) {
      for (const name of LANES) {
        const pts = sim.map.sides[t]!.lanes[name];
        const cum = [0];
        for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.sqrt(dist2(pts[i - 1]!.x, pts[i - 1]!.y, pts[i]!.x, pts[i]!.y)));
        cache.push({ pts, cum, len: cum[cum.length - 1]! });
      }
    }
    sim.state.laneGeo = cache;
  }
  return cache[team * 3 + lane]!;
}

/** Point at distance d along the lane. d < 0 extrapolates backwards along the first segment. */
export function lanePoint(g: LaneGeo, d: number): Pt {
  const { pts, cum } = g;
  let i = 1;
  if (d > 0) while (i < pts.length - 1 && cum[i]! < d) i++;
  if (d >= g.len) return { ...pts[pts.length - 1]! };
  const a = pts[i - 1]!;
  const b = pts[i]!;
  const t = (d - cum[i - 1]!) / (cum[i]! - cum[i - 1]!);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Unit direction of the lane at distance d. */
export function laneDir(g: LaneGeo, d: number): Pt {
  const { pts, cum } = g;
  let i = 1;
  while (i < pts.length - 1 && cum[i]! < d) i++;
  const a = pts[i - 1]!;
  const b = pts[i]!;
  const l = cum[i]! - cum[i - 1]!;
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
}

/** Distance along the lane of the closest lane point to (x, y). */
export function laneProgress(g: LaneGeo, x: number, y: number): number {
  const { pts, cum } = g;
  let best = Infinity;
  let bestD = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const l2 = abx * abx + aby * aby;
    let t = ((x - a.x) * abx + (y - a.y) * aby) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d2 = dist2(x, y, a.x + abx * t, a.y + aby * t);
    if (d2 < best) {
      best = d2;
      bestD = cum[i - 1]! + t * (cum[i]! - cum[i - 1]!);
    }
  }
  return bestD;
}

/** Waypoints from distance d to the lane end. */
export function laneRest(g: LaneGeo, d: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i < g.pts.length; i++) if (g.cum[i]! > d) out.push({ ...g.pts[i]! });
  return out;
}

const OFF_LANE = 300;

/** Path back along the lane: straight to the next lane waypoints, or via a join point when pulled off the lane. */
export function setLanePath(sim: Sim, eid: number): void {
  const { Pos, Unit, Move } = sim.c;
  const lane = Unit.lane[eid]!;
  if (lane > 2) return;
  const g = laneGeo(sim, Unit.team[eid]!, lane as LaneId);
  const x = Pos.x[eid]!;
  const y = Pos.y[eid]!;
  const d = laneProgress(g, x, y);
  const p = lanePoint(g, d);
  let path: Pt[];
  if (dist2(x, y, p.x, p.y) <= OFF_LANE * OFF_LANE) {
    // Keep the lateral offset: no shared join point that neighbours (with separation) could orbit forever.
    path = laneRest(g, d);
  } else {
    const jd = Math.min(g.len, d + 150);
    const join = lanePoint(g, jd);
    const head = lineWalkable(sim.map.nav, x, y, join.x, join.y) ? [join] : findPath(sim.map.nav, x, y, join.x, join.y);
    path = [...head, ...laneRest(g, jd)];
  }
  if (path.length === 0) path = [{ ...g.pts[g.pts.length - 1]! }];
  sim.paths.set(eid, path);
  Move.mode[eid] = 1;
}

/** Lane walking: (re)path when idle; skip a join point that separation pushed the minion past. */
function walkLane(sim: Sim, m: number): void {
  const path = sim.paths.get(m);
  if (sim.c.Move.mode[m] !== 1 || !path || path.length === 0) return setLanePath(sim, m);
  if (path.length > 1) {
    const { Pos, Unit } = sim.c;
    const g = laneGeo(sim, Unit.team[m]!, Unit.lane[m]! as LaneId);
    if (laneProgress(g, path[0]!.x, path[0]!.y) < laneProgress(g, Pos.x[m]!, Pos.y[m]!)) path.shift();
  }
}

// ---------------------------------------------------------------- aggression ledger
// The attack/damage events of a tick are produced after the towers/minions systems ran and are cleared at the
// next step, so economy.update (late in the tick) records them here; towers and minions read them a tick later.

interface Ledger {
  dst: Int32Array;
  dstSerial: Int32Array;
  srcSerial: Int32Array;
  tick: Int32Array;
}

function ledger(sim: Sim): Ledger {
  let l = sim.state.aggroLedger as Ledger | undefined;
  if (!l) {
    const n = sim.c.Unit.kind.length;
    l = { dst: new Int32Array(n).fill(-1), dstSerial: new Int32Array(n), srcSerial: new Int32Array(n), tick: new Int32Array(n).fill(-1e6) };
    sim.state.aggroLedger = l;
  }
  return l;
}

/** Record that src attacked/damaged dst on the current tick. */
export function noteAggression(sim: Sim, src: number, dst: number): void {
  if (src < 0 || dst < 0 || src === dst) return;
  const { Unit } = sim.c;
  if (Unit.team[src] === Unit.team[dst]) return;
  const l = ledger(sim);
  l.dst[src] = dst;
  l.dstSerial[src] = Unit.serial[dst]!;
  l.srcSerial[src] = Unit.serial[src]!;
  l.tick[src] = sim.tick;
}

/** Scan this tick's events (called from economy.update, after attack/projectiles ran). */
export function recordCombat(sim: Sim): void {
  for (const ev of sim.events) {
    if (ev.e === 'attack') noteAggression(sim, ev.src, ev.dst);
    else if (ev.e === 'damage' && ev.amount > 0) noteAggression(sim, ev.src, ev.dst);
  }
}

/** Living unit that src attacked within `window` ticks, or -1. */
export function recentVictim(sim: Sim, src: number, window = CALL_WINDOW): number {
  const l = ledger(sim);
  if (sim.c.Unit.serial[src] !== l.srcSerial[src] || sim.c.Unit.alive[src] !== 1) return -1;
  if (l.tick[src]! < sim.tick - window) return -1;
  const d = l.dst[src]!;
  return isRef(sim, d, l.dstSerial[src]!) ? d : -1;
}

// ---------------------------------------------------------------- aggro

const NO_TARGET = 255;

interface AggroState {
  /** Priority of the current target (1 = champion attacking allied champion ... 6 = nearest champion). */
  prio: Uint8Array;
  /** Chase anchor (CHASE_LEASH): last position on its lane while not targeting a champion. */
  anchored: Uint8Array;
  ax: Float64Array;
  ay: Float64Array;
}

function aggroState(sim: Sim): AggroState {
  let s = sim.state.minionAggro as AggroState | undefined;
  if (!s) {
    const n = sim.c.Unit.kind.length;
    s = { prio: new Uint8Array(n).fill(NO_TARGET), anchored: new Uint8Array(n), ax: new Float64Array(n), ay: new Float64Array(n) };
    sim.state.minionAggro = s;
  }
  return s;
}

/** Minion is further than CHASE_LEASH from where it left its lane: no champion targets until it is back. */
function pastLeash(sim: Sim, m: number): boolean {
  const st = aggroState(sim);
  if (!st.anchored[m]) return false;
  return dist2(sim.c.Pos.x[m]!, sim.c.Pos.y[m]!, st.ax[m]!, st.ay[m]!) > CHASE_LEASH * CHASE_LEASH;
}

/** Can `team` attack `t` (alive, targetable, visible if a champion)? */
export function attackable(sim: Sim, team: number, t: number): boolean {
  const { Unit } = sim.c;
  if (t < 0 || !Unit.alive[t] || Unit.untargetable[t] || Unit.team[t] === team) return false;
  const k = Unit.kind[t]!;
  if (k === Kind.Champion || k === Kind.Dummy) return sees(sim, team, t);
  return isMinion(k) || isStructure(k);
}

interface Call {
  src: number;
  dst: number;
  /** 1 champ->champ, 2 minion->champ, 3 minion->minion. */
  prio: number;
}

function gatherCalls(sim: Sim, units: ArrayLike<number>): Call[] {
  const { Unit } = sim.c;
  const calls: Call[] = [];
  for (let i = 0; i < units.length; i++) {
    const src = units[i]!;
    const sk = Unit.kind[src]!;
    if (sk !== Kind.Champion && !isMinion(sk)) continue;
    const dst = recentVictim(sim, src);
    if (dst < 0) continue;
    const dk = Unit.kind[dst]!;
    let prio = 0;
    if (sk === Kind.Champion && dk === Kind.Champion) prio = 1;
    else if (isMinion(sk) && dk === Kind.Champion) prio = 2;
    else if (isMinion(sk) && isMinion(dk)) prio = 3;
    if (prio) calls.push({ src, dst, prio });
  }
  return calls;
}

function setTarget(sim: Sim, eid: number, t: number, prio: number): void {
  const { Atk, Move, Unit } = sim.c;
  if (Atk.target[eid] !== t || Atk.targetSerial[eid] !== Unit.serial[t]) {
    Atk.target[eid] = t;
    Atk.targetSerial[eid] = Unit.serial[t]!;
    sim.paths.delete(eid);
  }
  Move.mode[eid] = 2;
  aggroState(sim).prio[eid] = prio;
}

/** Best call for help (lowest prio, then nearest attacker) that minion `m` answers, with prio <= maxPrio. */
function bestCall(sim: Sim, m: number, calls: Call[], maxPrio: number): Call | null {
  const { Pos, Unit } = sim.c;
  const team = Unit.team[m]!;
  const mx = Pos.x[m]!;
  const my = Pos.y[m]!;
  let best: Call | null = null;
  let bestD = Infinity;
  for (const c of calls) {
    if (c.prio > maxPrio || Unit.team[c.dst] !== team) continue;
    if (!attackable(sim, team, c.src)) continue;
    if (Unit.kind[c.src] === Kind.Champion && pastLeash(sim, m)) continue;
    if (dist2(mx, my, Pos.x[c.dst]!, Pos.y[c.dst]!) > CALL_RANGE * CALL_RANGE) continue;
    const d = dist2(mx, my, Pos.x[c.src]!, Pos.y[c.src]!);
    if (d > CALL_RANGE * CALL_RANGE) continue;
    if (!best || c.prio < best.prio || (c.prio === best.prio && nearer(d, Unit.serial[c.src]!, bestD, Unit.serial[best.src]!))) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

/** Units attackable by each team this tick, split by category (built once per tick per system). */
export interface TargetLists {
  minions: number[];
  structures: number[];
  champs: number[];
  dummies: number[];
}

export function targetLists(sim: Sim, units: ArrayLike<number>): [TargetLists, TargetLists] {
  const { Unit } = sim.c;
  const mk = (): TargetLists => ({ minions: [], structures: [], champs: [], dummies: [] });
  const out: [TargetLists, TargetLists] = [mk(), mk()];
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    if (!Unit.alive[u] || Unit.untargetable[u]) continue;
    const k = Unit.kind[u]!;
    for (const team of [0, 1] as const) {
      if (Unit.team[u] === team) continue;
      if (isMinion(k)) out[team].minions.push(u);
      else if (isStructure(k)) out[team].structures.push(u);
      else if ((k === Kind.Champion || k === Kind.Dummy) && sees(sim, team, u)) (k === Kind.Champion ? out[team].champs : out[team].dummies).push(u);
    }
  }
  return out;
}

/** Nearest unit of `list` within AGGRO_RANGE (+ target radius) of minion m; exact ties -> older unit (spawn serial:
 *  eids are recycled, so query order differed between mirrored waves and broke blue/red symmetry). */
function nearest(sim: Sim, m: number, list: number[], range = AGGRO_RANGE): number {
  const { Pos, Unit } = sim.c;
  let best = -1;
  let bestD = Infinity;
  for (const t of list) {
    const r = range + Unit.radius[t]!;
    const d = dist2(Pos.x[m]!, Pos.y[m]!, Pos.x[t]!, Pos.y[t]!);
    if (d <= r * r && (best < 0 || nearer(d, Unit.serial[t]!, bestD, Unit.serial[best]!))) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

/**
 * LoL minion priorities: 1 enemy champ attacking allied champ, 2 enemy minion attacking allied champ, 3 enemy minion
 * attacking allied minion, 4 nearest enemy minion, 5 nearest enemy structure, 6 nearest enemy champion.
 * Structures sit before champions so a wave pushes a tower instead of chasing a champion standing next to it
 * (LoL also ranks turrets above uninvolved champions).
 */
export function updateMinionAggro(sim: Sim, m: number, lists: [TargetLists, TargetLists], calls: Call[]): void {
  const { Atk, Pos, Unit, Move } = sim.c;
  const st = aggroState(sim);
  const team = Unit.team[m]!;
  let cur = Atk.target[m]!;
  if ((cur < 0 || Unit.kind[cur] !== Kind.Champion) && Unit.lane[m]! <= 2) {
    const g = laneGeo(sim, team, Unit.lane[m]! as LaneId);
    const p = lanePoint(g, laneProgress(g, Pos.x[m]!, Pos.y[m]!));
    if (dist2(Pos.x[m]!, Pos.y[m]!, p.x, p.y) <= OFF_LANE * OFF_LANE) {
      st.anchored[m] = 1;
      st.ax[m] = Pos.x[m]!;
      st.ay[m] = Pos.y[m]!;
    }
  }
  if (cur >= 0) {
    const leash = LEASH_RANGE + Unit.radius[cur]!;
    const ok =
      isRef(sim, cur, Atk.targetSerial[m]!) &&
      attackable(sim, team, cur) &&
      dist2(Pos.x[m]!, Pos.y[m]!, Pos.x[cur]!, Pos.y[cur]!) <= leash * leash &&
      !(Unit.kind[cur] === Kind.Champion && pastLeash(sim, m));
    if (!ok) {
      cur = -1;
      Atk.target[m] = -1;
      st.prio[m] = NO_TARGET;
    }
  }
  // Champion-attacks-champion calls interrupt anything but another such target.
  if (st.prio[m]! > 1) {
    const c = bestCall(sim, m, calls, 1);
    if (c) return setTarget(sim, m, c.src, 1);
  }
  // Low-priority targets (structure, idle champion) are not sticky: a minion in aggro range or a call for help
  // takes over, and an idle champion is dropped once it leaves aggro range (no chasing a champion across the lane).
  if (cur >= 0 && st.prio[m]! >= 5) {
    const c = bestCall(sim, m, calls, 3);
    if (c) return setTarget(sim, m, c.src, c.prio);
    const mt = nearest(sim, m, lists[team as 0 | 1].minions);
    if (mt >= 0) return setTarget(sim, m, mt, 4);
    if (st.prio[m] === 6) {
      const r = sim.c.Stats.range[m]! + Unit.radius[m]! + 150 + Unit.radius[cur]!;
      if (dist2(Pos.x[m]!, Pos.y[m]!, Pos.x[cur]!, Pos.y[cur]!) > r * r) {
        Atk.target[m] = -1;
        st.prio[m] = NO_TARGET;
        cur = -1;
      }
    }
  }
  if (cur >= 0) {
    Move.mode[m] = 2;
    return;
  }
  const c = bestCall(sim, m, calls, 3);
  if (c) return setTarget(sim, m, c.src, c.prio);
  const l = lists[team as 0 | 1];
  let t = nearest(sim, m, l.minions);
  if (t >= 0) return setTarget(sim, m, t, 4);
  t = nearest(sim, m, l.structures);
  if (t >= 0) return setTarget(sim, m, t, 5);
  // idle champions only when (almost) in the minion's own attack range: no chasing champions across the lane
  t = pastLeash(sim, m) ? -1 : nearest(sim, m, l.champs, sim.c.Stats.range[m]! + sim.c.Unit.radius[m]! + 100);
  if (t < 0) t = nearest(sim, m, l.dummies);
  if (t >= 0) return setTarget(sim, m, t, 6);
  walkLane(sim, m);
}

export const minionsSystem: System = {
  name: 'minions',
  update(sim) {
    const { Unit } = sim.c;
    const units = query(sim.world, [Unit]);
    const calls = gatherCalls(sim, units);
    const lists = targetLists(sim, units);
    for (let i = 0; i < units.length; i++) {
      const m = units[i]!;
      if (Unit.alive[m] && isMinion(Unit.kind[m]!)) updateMinionAggro(sim, m, lists, calls);
    }
  },
};

// ---------------------------------------------------------------- wave state (for bots)

export interface WaveState {
  frontX: number;
  frontY: number;
  /** 0..1 along own lane (own nexus -> enemy nexus). */
  frontProgress: number;
  /** Own minus enemy minions within 1200 of the front. */
  minionDiff: number;
  /** Seconds until the next wave spawns. */
  nextWaveIn: number;
  /** An own siege (or super) minion is alive near the front. */
  siegeInWave: boolean;
  /** The next wave of this team contains a siege minion. */
  nextWaveSiege: boolean;
}

const FRONT_GROUP = 1200;

/**
 * Front = own lane minion furthest along the lane. Without own minions the enemy front is used, without any
 * minions the lane midpoint (where waves meet).
 */
export function waveState(sim: Sim, team: number, lane: LaneId): WaveState {
  const { Unit, Pos } = sim.c;
  const g = laneGeo(sim, team, lane);
  const own: number[] = [];
  const enemy: number[] = [];
  for (const e of query(sim.world, [Unit])) {
    if (!Unit.alive[e] || !isMinion(Unit.kind[e]!) || Unit.lane[e] !== lane) continue;
    (Unit.team[e] === team ? own : enemy).push(e);
  }
  let front = -1;
  let frontD = -Infinity;
  const pick = (list: number[], better: (a: number, b: number) => boolean): void => {
    for (const e of list) {
      const d = laneProgress(g, Pos.x[e]!, Pos.y[e]!);
      if (front < 0 || better(d, frontD)) {
        front = e;
        frontD = d;
      }
    }
  };
  pick(own, (a, b) => a > b);
  if (front < 0) pick(enemy, (a, b) => a < b);
  const p = front >= 0 ? { x: Pos.x[front]!, y: Pos.y[front]! } : lanePoint(g, g.len / 2);
  if (front < 0) frontD = g.len / 2;
  let diff = 0;
  let siege = false;
  const near = (e: number): boolean => dist2(p.x, p.y, Pos.x[e]!, Pos.y[e]!) <= FRONT_GROUP * FRONT_GROUP;
  for (const e of own) {
    if (!near(e)) continue;
    diff++;
    if (Unit.kind[e] === Kind.MinionSiege || Unit.kind[e] === Kind.MinionSuper) siege = true;
  }
  for (const e of enemy) if (near(e)) diff--;
  const nw = nextWaveInfo(sim);
  return {
    frontX: p.x,
    frontY: p.y,
    frontProgress: frontD / g.len,
    minionDiff: diff,
    nextWaveIn: nw.inSeconds,
    siegeInWave: siege,
    nextWaveSiege: nw.siege,
  };
}
