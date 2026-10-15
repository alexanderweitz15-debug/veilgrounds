// Auto-attack state machine for every unit with Atk.target (champions, minions, towers, monsters).
// phase 0 idle -> 1 windup ((1/AS) * Stats.windup s) -> hit point: melee damages instantly, ranged launches a
// homing projectile -> 2 backswing until nextReady = start + 1/AS. Move during windup cancels the attack
// (attack timer not consumed); move during backswing only cancels the animation (orbwalking).

import { query } from 'bitecs';
import type { Sim } from '../sim';
import type { System } from './index';
import { isRef } from '../sim';
import { MAX_ENT } from '../ecs';
import { Kind, TICK_HZ, Team, isStructure, type DamageType } from '../types';
import { dealDamage } from '../damage';
import { canAttack, healMult, healUnit, isBlind, removeBuffs } from '../buffs';
import { sees } from '../vision';
import { findPath } from '../map';
import { championData, passiveHooksOf } from '../champions';
import { towerShotDamage } from './towers';
import { MINION_DMG_VS_CHAMP_STRUCT } from './minions';
import { spawnProjectile } from './projectiles';
import { breakChannel, isBusy, resolveEmpowered, takeEmpowered } from './abilities';
import { ownerOnlyTarget } from '../summons';

export const CRIT_MULT = 1.75;
/** Attack-move acquisition reach beyond attack range. */
export const ACQUIRE_EXTRA = 200;

/** Default auto projectile speeds by unit kind (0 = melee, instant). Champions use data base.projectileSpeed. */
const DEFAULT_PROJ_SPEED: Partial<Record<number, number>> = {
  [Kind.MinionCaster]: 650,
  [Kind.MinionSiege]: 1200,
  [Kind.Tower]: 1200,
  [Kind.Nexus]: 1200,
};

interface AttackState {
  /** Tick the current/last windup started. */
  start: Int32Array;
  /** Fractional tick remainder of the attack period, so average AS is exact despite 30 Hz. */
  carry: Float64Array;
  projSpeed: Float64Array;
  projSerial: Int32Array;
  /** Attack-move: 1 while chasing an acquired target (resume walking to amx/amy when it dies). */
  amChasing: Uint8Array;
}

function attackState(sim: Sim): AttackState {
  let s = sim.state.attack as AttackState | undefined;
  if (!s) {
    s = {
      start: new Int32Array(MAX_ENT),
      carry: new Float64Array(MAX_ENT),
      projSpeed: new Float64Array(MAX_ENT),
      projSerial: new Int32Array(MAX_ENT).fill(-1),
      amChasing: new Uint8Array(MAX_ENT),
    };
    sim.state.attack = s;
  }
  return s;
}

/** Override the auto-attack projectile speed of one unit (0 = melee). Agent A: call after spawning. */
export function setAttackProjectileSpeed(sim: Sim, eid: number, speed: number): void {
  const s = attackState(sim);
  s.projSpeed[eid] = speed;
  s.projSerial[eid] = sim.c.Unit.serial[eid]!;
}

export function attackProjectileSpeed(sim: Sim, eid: number): number {
  const s = attackState(sim);
  if (s.projSerial[eid] === sim.c.Unit.serial[eid]) return s.projSpeed[eid]!;
  const k = sim.c.Unit.kind[eid]!;
  if (k === Kind.Champion) return championData(sim.championIds[sim.c.Unit.champ[eid]!] ?? '').base.projectileSpeed ?? 0;
  return DEFAULT_PROJ_SPEED[k] ?? 0;
}

/** Windup ticks for the unit's current AS (0 for towers). */
export function windupTicks(sim: Sim, eid: number): number {
  const w = sim.c.Stats.windup[eid]!;
  const as = sim.c.Stats.as[eid]!;
  if (w <= 0) return 0;
  return Math.max(1, Math.round((TICK_HZ * w) / as));
}

/** Forget every attack order (target, attack-move incl. its chase memory, wind-up): respawn starts idle. */
export function clearAttackOrders(sim: Sim, eid: number): void {
  const { Atk } = sim.c;
  Atk.target[eid] = -1;
  Atk.attackMove[eid] = 0;
  Atk.phase[eid] = 0;
  attackState(sim).amChasing[eid] = 0;
}

/** Movement/stop command arrived: cancel windup (attack lost, timer kept) or backswing (orbwalk); ends channels. */
export function onMoveCommand(sim: Sim, eid: number): void {
  sim.c.Atk.phase[eid] = 0;
  breakChannel(sim, eid);
}

/** True if `t` is a valid auto-attack target for `eid` right now (ignores range). */
export function canTarget(sim: Sim, eid: number, t: number): boolean {
  const { Unit } = sim.c;
  if (t < 0 || !Unit.alive[t] || Unit.kind[t] === Kind.Projectile) return false;
  // jungle plants: only champions pop them (deliberate right-click; attack-move skips them in acquire)
  if (Unit.kind[t] === Kind.Plant && Unit.kind[eid] !== Kind.Champion) return false;
  const owner = ownerOnlyTarget(sim, t); // summons targetable only by their owner (e.g. a powder keg)
  if (owner >= 0) return owner === eid;
  if (Unit.untargetable[t]) return false;
  const team = Unit.team[eid]!;
  if (Unit.team[t] === team) return false;
  return team === Team.Neutral || isStructure(Unit.kind[t]!) || sees(sim, team, t);
}

export function inAttackRange(sim: Sim, eid: number, t: number, extra = 0): boolean {
  const { Pos, Unit, Stats } = sim.c;
  const reach = Stats.range[eid]! + Unit.radius[eid]! + Unit.radius[t]! + extra;
  const dx = Pos.x[t]! - Pos.x[eid]!;
  const dy = Pos.y[t]! - Pos.y[eid]!;
  return dx * dx + dy * dy <= reach * reach;
}

export const attackSystem: System = {
  name: 'attack',
  update(sim) {
    const { Atk, Unit } = sim.c;
    const ents = [...query(sim.world, [Atk])];
    for (const eid of ents) {
      if (!Unit.alive[eid]) {
        Atk.phase[eid] = 0;
        continue;
      }
      updateUnit(sim, eid);
    }
  },
};

function updateUnit(sim: Sim, eid: number): void {
  const { Atk, Move, Pos, Unit } = sim.c;
  const st = attackState(sim);
  let t = Atk.target[eid]!;
  let valid = isRef(sim, t, Atk.targetSerial[eid]!);
  const able = canAttack(sim, eid) && !isBusy(sim, eid);

  if (Atk.phase[eid] === 1) {
    if (!valid || !able) {
      Atk.phase[eid] = 0; // interrupted: attack lost, timer not consumed
    } else {
      face(sim, eid, t);
      if (sim.tick >= Atk.phaseEnd[eid]!) fire(sim, eid, t);
    }
  }
  if (Atk.phase[eid] === 2 && sim.tick >= Atk.phaseEnd[eid]!) Atk.phase[eid] = 0;

  if (!valid && t >= 0) {
    Atk.target[eid] = -1;
    t = -1;
  }

  // attack-move: acquire the nearest enemy, otherwise (re)walk to the attack-move point
  if (Atk.attackMove[eid] && t < 0 && Atk.phase[eid] !== 1) {
    const found = acquire(sim, eid);
    if (found >= 0) {
      Atk.target[eid] = t = found;
      Atk.targetSerial[eid] = Unit.serial[found]!;
      Move.mode[eid] = 2;
      st.amChasing[eid] = 1;
      valid = true;
    } else if (Move.mode[eid] !== 1) {
      if (st.amChasing[eid]) {
        st.amChasing[eid] = 0;
        sim.paths.set(eid, findPath(sim.map.nav, Pos.x[eid]!, Pos.y[eid]!, Atk.amx[eid]!, Atk.amy[eid]!));
        Move.mode[eid] = 1;
        Move.tx[eid] = Atk.amx[eid]!;
        Move.ty[eid] = Atk.amy[eid]!;
        Move.pathIdx[eid] = 0;
      } else {
        Atk.attackMove[eid] = 0; // arrived
      }
    }
  } else if (!Atk.attackMove[eid]) {
    st.amChasing[eid] = 0;
  }

  // start a new attack
  if (Atk.phase[eid] === 0 && valid && able && sim.tick >= Atk.nextReady[eid]! && canTarget(sim, eid, t) && inAttackRange(sim, eid, t)) {
    Atk.phase[eid] = 1;
    Atk.phaseEnd[eid] = sim.tick + windupTicks(sim, eid);
    st.start[eid] = sim.tick;
    face(sim, eid, t);
    sim.events.push({ e: 'attack', src: eid, dst: t });
    if (sim.tick >= Atk.phaseEnd[eid]!) fire(sim, eid, t); // windup 0 (towers)
  }
}

function face(sim: Sim, eid: number, t: number): void {
  const { Pos, Face } = sim.c;
  const dx = Pos.x[t]! - Pos.x[eid]!;
  const dy = Pos.y[t]! - Pos.y[eid]!;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > 0) {
    Face.x[eid] = dx / d;
    Face.y[eid] = dy / d;
  }
}

function acquire(sim: Sim, eid: number): number {
  const { Unit, Pos } = sim.c;
  let best = -1;
  let bestD = Infinity;
  const ents = query(sim.world, [Unit]);
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i]!;
    if (Unit.kind[e] === Kind.Plant || !canTarget(sim, eid, e) || !inAttackRange(sim, eid, e, ACQUIRE_EXTRA)) continue;
    const dx = Pos.x[e]! - Pos.x[eid]!;
    const dy = Pos.y[e]! - Pos.y[eid]!;
    const d = dx * dx + dy * dy;
    if (d < bestD || (d === bestD && e < best)) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

export interface AutoPayload {
  t: 'auto';
  src: number;
  srcSerial: number;
  amount: number;
  type: DamageType;
  raw: boolean;
  crit: boolean;
  miss: boolean;
  /** Empowered auto of a next-auto ability (abilities.armNextAuto). */
  emp?: { slot: number; rank: number };
}

/** Hit point: compute damage now (crit roll, tower warming), then hit instantly (melee) or launch projectiles. */
function fire(sim: Sim, eid: number, t: number): void {
  const { Atk, Unit, Stats, Pos } = sim.c;
  const st = attackState(sim);
  // attack timer: start + 1/AS, carrying the fractional tick so long-run AS is exact
  const period = TICK_HZ / Stats.as[eid]! + st.carry[eid]!;
  const whole = Math.max(1, Math.floor(period));
  st.carry[eid] = period - whole;
  Atk.nextReady[eid] = st.start[eid]! + whole;
  Atk.phase[eid] = 2;
  Atk.phaseEnd[eid] = Atk.nextReady[eid]!;

  const kind = Unit.kind[eid]!;
  const tk = Unit.kind[t]!;
  let amount = Stats.ad[eid]!;
  let type: DamageType = 'phys';
  let raw = false;
  let crit = false;
  let extra: number[] = [];
  if (kind === Kind.Tower || kind === Kind.Nexus) {
    const s = towerShotDamage(sim, eid, t);
    amount = s.amount;
    type = s.type;
    raw = s.raw;
  } else if (kind === Kind.Champion) {
    if (Stats.crit[eid]! > 0 && sim.rng.chance(Math.min(1, Stats.crit[eid]!))) {
      crit = true;
      amount *= CRIT_MULT;
    }
    for (const h of passiveHooksOf(sim, eid)) {
      const r = h.onAutoFire?.(sim, eid, t);
      if (r) extra = extra.concat(r);
    }
    removeBuffs(sim, eid, (b) => b.kind === 'stat' && b.stat === 'invisible'); // attacking breaks invisibility
  } else if (kind >= Kind.MinionMelee && kind <= Kind.MinionSuper) {
    if (tk === Kind.Champion || isStructure(tk)) amount *= MINION_DMG_VS_CHAMP_STRUCT;
  }
  const base: AutoPayload = { t: 'auto', src: eid, srcSerial: Unit.serial[eid]!, amount, type, raw, crit, miss: isBlind(sim, eid) };
  const emp = kind === Kind.Champion ? takeEmpowered(sim, eid) : null;
  const shots = [1, ...extra];
  const speed = attackProjectileSpeed(sim, eid);
  for (let i = 0; i < shots.length; i++) {
    const p: AutoPayload = { ...base, amount: amount * shots[i]! };
    if (i === 0 && emp) p.emp = emp;
    if (speed > 0) {
      // twin arrows: offset sideways so render shows two
      const off = i === 0 ? 0 : 20 * i;
      spawnProjectile(sim, { kind: 0, src: eid, team: Unit.team[eid]!, x: Pos.x[eid]! - sim.c.Face.y[eid]! * off, y: Pos.y[eid]! + sim.c.Face.x[eid]! * off, target: t, speed, payload: p });
    } else {
      resolveAutoHit(sim, p, t);
    }
  }
}

/** Auto damage lands (melee hit point or projectile impact). */
export function resolveAutoHit(sim: Sim, p: AutoPayload, dst: number): void {
  const { Unit, Stats } = sim.c;
  if (p.miss || !Unit.alive[dst]) return;
  const src = Unit.serial[p.src] === p.srcSerial ? p.src : -1;
  const dmg = dealDamage(sim, src, dst, p.amount, p.type, { isAuto: true, crit: p.crit, raw: p.raw });
  if (src < 0 || Unit.kind[src] !== Kind.Champion) return;
  let overheal = 0;
  if (Stats.lifesteal[src]! > 0 && Unit.alive[src]) {
    const want = dmg * Stats.lifesteal[src]!;
    overheal = Math.max(0, want * healMult(sim, src) - healUnit(sim, src, want));
  }
  const info = { crit: p.crit, overheal };
  for (const h of passiveHooksOf(sim, src)) h.onAutoHit?.(sim, src, dst, dmg, info);
  if (p.emp) resolveEmpowered(sim, src, p.emp, dst, p.amount);
}
