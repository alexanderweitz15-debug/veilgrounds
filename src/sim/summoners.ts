// Summoner spells (data: src/data/summoners.json). Cooldowns are applied by abilities.castSummoner;
// a per-player override (PlayerSetup.summonerCd, seconds) serves sandbox/trainers (e.g. Flash 5 s).
// Teleport is a 4 s channel (state in sim.state.teleport, keyed by champion eid); summonersSystem resolves it.

import { query } from 'bitecs';
import type { Sim } from './sim';
import type { System } from './systems/index';
import { Kind, isMinion, sec } from './types';
import raw from '../data/summoners.json';
import { addBuff, canAttack, canMove, hasBuff, healUnit, removeBuffs, type BuffKind } from './buffs';
import { dir, dist2 } from './vec';
import { champAbil, landingPoint, nearestAlly, noteDashEnd, teleport } from './systems/abilities';
import { onMoveCommand } from './systems/attack';
import { dealDamage } from './damage';
import { nearestWalkable, walkable } from './map';
import { isPlayerWard } from './wards';
import { sees } from './vision';

export interface SummonerDef {
  id: string;
  name: { de: string; en: string };
  cooldown: number;
  /** Cooldown from 10:00 on (Teleport). */
  cooldownLate?: number;
  /** Teleport: lane-minion gold at which the top laner gets it as a third summoner (B4). */
  topUnlockGold?: number;
  range: number;
  /** Wind-up in seconds (all summoners are instant; Teleport is a channel, TELEPORT_CHANNEL_TICKS). */
  castTime: number;
  /** Keeps walking while it is cast (false: Teleport channel stands still). */
  movesWhileCasting: boolean;
  /** Not implemented yet (e.g. "Phase 2"). */
  todo?: string;
}

export const SUMMONERS: SummonerDef[] = raw as SummonerDef[];

export const summonerDef = (id: string): SummonerDef | undefined => SUMMONERS.find((s) => s.id === id);

/** 10:00: Teleport gets its late targets (minions, wards, champions) and the shorter cooldown. */
export const TELEPORT_LATE_TICK = sec(600);
export const TELEPORT_CHANNEL_TICKS = sec(4);
/** ponytail: cancelling (recast) or a CC interrupt puts Teleport on a flat 30 s cooldown (LoL varies by patch). */
export const TELEPORT_INTERRUPT_CD = sec(30);
export const EXHAUST_DMG_PCT = -40;
export const EXHAUST_SLOW_PCT = 30;
export const EXHAUST_TICKS = sec(2.5);
export const CLEANSE_TENACITY_PCT = 65;
export const CLEANSE_TICKS = sec(3);

/** Cooldown in seconds at the current game time (before the PlayerSetup override). */
export function summonerCooldown(sim: Sim, id: string): number {
  const def = summonerDef(id);
  if (!def) return 0;
  return def.cooldownLate !== undefined && sim.tick >= TELEPORT_LATE_TICK ? def.cooldownLate : def.cooldown;
}

/** Linear by champion level 1..18. */
const byLevel = (sim: Sim, eid: number, lo: number, hi: number): number => lo + ((hi - lo) * (Math.max(1, sim.c.Champ.level[eid]!) - 1)) / 17;

/** Cleanse removes these (not airborne / suppression / stasis) plus the summoner debuffs below. */
const CLEANSED: ReadonlySet<BuffKind> = new Set(['slow', 'blind', 'root', 'silence', 'stun']);
const SUMMONER_DEBUFFS: ReadonlySet<string> = new Set(['entflammen', 'erschoepfen']);

/** Executes the spell; returns false if it could not be cast (no cooldown then). */
export function castSummonerSpell(sim: Sim, eid: number, id: string, x: number, y: number, target?: number): boolean {
  if (teleporting(sim, eid)) return false; // a Teleport channel blocks the other summoner
  if (id === 'reinigen') {
    // usable while stunned/rooted/silenced; not while airborne, suppressed or in stasis
    if (hasBuff(sim, eid, 'airborne') || hasBuff(sim, eid, 'suppress') || hasBuff(sim, eid, 'stasis')) return false;
    removeBuffs(sim, eid, (b) => CLEANSED.has(b.kind) || (SUMMONER_DEBUFFS.has(b.id) && b.kind !== 'mark'));
    addBuff(sim, eid, { kind: 'stat', stat: 'tenacity', id: 'reinigen', src: eid, pct: CLEANSE_TENACITY_PCT, ticks: CLEANSE_TICKS });
    return true;
  }
  if (!canAttack(sim, eid)) return false; // stunned / airborne / suppressed
  const { Pos } = sim.c;
  switch (id) {
    case 'sprung': {
      if (!canMove(sim, eid)) return false; // rooted units cannot Flash
      const ox = Pos.x[eid]!;
      const oy = Pos.y[eid]!;
      const [dx, dy] = dir(ox, oy, x, y);
      const d = Math.min(400, Math.sqrt(dist2(x, y, ox, oy)));
      const p = landingPoint(sim, ox, oy, ox + dx * d, oy + dy * d);
      onMoveCommand(sim, eid); // Flash cancels an auto wind-up
      teleport(sim, eid, p.x, p.y);
      if (dx !== 0 || dy !== 0) {
        sim.c.Face.x[eid] = dx;
        sim.c.Face.y[eid] = dy;
      }
      noteDashEnd(sim, eid, -1);
      return true;
    }
    case 'heilen': {
      const amount = byLevel(sim, eid, 90, 345);
      const ally = nearestAlly(sim, eid, Pos.x[eid]!, Pos.y[eid]!, 850);
      for (const t of ally >= 0 ? [eid, ally] : [eid]) {
        healUnit(sim, t, amount);
        addBuff(sim, t, { kind: 'stat', stat: 'ms', id: 'heilen', src: eid, pct: 30, ticks: sec(1) });
      }
      return true;
    }
    case 'geist':
      addBuff(sim, eid, { kind: 'stat', stat: 'ms', id: 'geist', src: eid, pct: byLevel(sim, eid, 24, 48), ticks: sec(10) });
      return true;
    case 'entflammen': {
      const t = enemyChampionTarget(sim, eid, x, y, 600, target);
      if (t < 0) return false;
      const total = byLevel(sim, eid, 60, 410);
      addBuff(sim, t, { kind: 'dot', id: 'entflammen', src: eid, amount: total / 5, period: sec(1), dmgType: 'true', ticks: sec(5) });
      addBuff(sim, t, { kind: 'grievous', id: 'entflammen', src: eid, pct: 40, ticks: sec(5) });
      return true;
    }
    case 'erschoepfen': {
      const t = enemyChampionTarget(sim, eid, x, y, 650, target);
      if (t < 0) return false;
      addBuff(sim, t, { kind: 'stat', stat: 'dmgDealt', id: 'erschoepfen', src: eid, pct: EXHAUST_DMG_PCT, ticks: EXHAUST_TICKS });
      addBuff(sim, t, { kind: 'slow', id: 'erschoepfen', src: eid, pct: EXHAUST_SLOW_PCT, ticks: EXHAUST_TICKS });
      return true;
    }
    case 'teleport':
      return startTeleport(sim, eid, x, y, target);
    case 'bannen': {
      // Smite (Agent H): true damage to a monster or minion in range, nearest to the cursor if no target given.
      const t = smiteTarget(sim, eid, x, y, 500, target);
      if (t < 0) return false;
      dealDamage(sim, eid, t, byLevel(sim, eid, 450, 900), 'true');
      return true;
    }
    default:
      return false;
  }
}

/**
 * Targeted summoners (Ignite, Exhaust, Smite): the target they would pick ignoring the cast range (walk into range
 * first, like LoL), or -1 (no valid target, or not a targeted summoner).
 */
export function summonerWalkTarget(sim: Sim, eid: number, id: string, x: number, y: number, target?: number): number {
  if (id === 'entflammen' || id === 'erschoepfen') return enemyChampionTarget(sim, eid, x, y, Infinity, target);
  if (id === 'bannen') return smiteTarget(sim, eid, x, y, Infinity, target);
  return -1;
}

/** Smite target: a visible enemy monster or minion within `range` (+ hitboxes); explicit, else nearest the cursor (400). */
function smiteTarget(sim: Sim, eid: number, x: number, y: number, range: number, target?: number): number {
  const { Pos, Unit } = sim.c;
  const ok = (t: number): boolean => {
    if (t < 0 || !Unit.alive[t] || Unit.untargetable[t] || Unit.team[t] === Unit.team[eid]) return false;
    const k = Unit.kind[t]!;
    if (k !== Kind.Monster && !(k >= Kind.MinionMelee && k <= Kind.MinionSuper)) return false;
    if (!sees(sim, Unit.team[eid]!, t)) return false; // no smiting into fog / unseen bushes
    const r = range + Unit.radius[eid]! + Unit.radius[t]!;
    return range === Infinity || dist2(Pos.x[t]!, Pos.y[t]!, Pos.x[eid]!, Pos.y[eid]!) <= r * r;
  };
  let t = target !== undefined && ok(target) ? target : -1;
  if (t < 0) {
    let bestD = 400 * 400;
    for (const e of query(sim.world, [Unit])) {
      if (!ok(e)) continue;
      const d = dist2(Pos.x[e]!, Pos.y[e]!, x, y);
      if (d < bestD) (bestD = d), (t = e);
    }
  }
  return t;
}

/** Enemy champion (or practice dummy) within `range` (+ hitboxes): the explicit target, else nearest to the cursor (200). */
function enemyChampionTarget(sim: Sim, eid: number, x: number, y: number, range: number, target?: number): number {
  const { Pos, Unit } = sim.c;
  const ok = (t: number): boolean => {
    if (t < 0 || !Unit.alive[t] || Unit.untargetable[t] || Unit.team[t] === Unit.team[eid]) return false;
    if (Unit.kind[t] !== Kind.Champion && Unit.kind[t] !== Kind.Dummy) return false;
    if (!sees(sim, Unit.team[eid]!, t)) return false; // targets in fog, bushes or invisible are not castable
    if (range === Infinity) return true;
    const r = range + Unit.radius[eid]! + Unit.radius[t]!;
    return dist2(Pos.x[t]!, Pos.y[t]!, Pos.x[eid]!, Pos.y[eid]!) <= r * r;
  };
  if (target !== undefined) return ok(target) ? target : -1;
  let best = -1;
  let bestD = 200 * 200;
  for (const t of query(sim.world, [Unit])) {
    if (!ok(t)) continue;
    const d = dist2(Pos.x[t]!, Pos.y[t]!, x, y);
    if (d < bestD) (bestD = d), (best = t);
  }
  return best;
}

// ------------------------------------------------------------------ Teleport

interface Tp {
  serial: number;
  target: number;
  targetSerial: number;
  /** Destination (follows the target while it lives). */
  x: number;
  y: number;
  start: number;
  until: number;
}

function tpState(sim: Sim): Map<number, Tp> {
  let s = sim.state.teleport as Map<number, Tp> | undefined;
  if (!s) sim.state.teleport = s = new Map();
  return s;
}

/** Channelling Teleport right now (busy: no movement, autos or casts). */
export function teleporting(sim: Sim, eid: number): boolean {
  const t = (sim.state.teleport as Map<number, Tp> | undefined)?.get(eid);
  return !!t && t.serial === sim.c.Unit.serial[eid];
}

/** Teleport channel progress for HUD/tests: ticks left, or 0. */
export function teleportLeft(sim: Sim, eid: number): number {
  const t = (sim.state.teleport as Map<number, Tp> | undefined)?.get(eid);
  return t && t.serial === sim.c.Unit.serial[eid] ? Math.max(0, t.until - sim.tick) : 0;
}

/** Valid Teleport target: own tower; from 10:00 also own minions, own player wards and allied champions. */
export function teleportTargetOk(sim: Sim, eid: number, t: number): boolean {
  const { Unit } = sim.c;
  if (t < 0 || t === eid || !Unit.alive[t] || Unit.team[t] !== Unit.team[eid]) return false;
  const k = Unit.kind[t]!;
  if (k === Kind.Tower) return true;
  if (sim.tick < TELEPORT_LATE_TICK) return false;
  return isMinion(k) || k === Kind.Champion || (k === Kind.Ward && isPlayerWard(sim, t));
}

function startTeleport(sim: Sim, eid: number, x: number, y: number, target?: number): boolean {
  const { Pos, Unit } = sim.c;
  let t = target !== undefined && teleportTargetOk(sim, eid, target) ? target : -1;
  if (t < 0) {
    // nearest valid target to the cursor (towers are big: 600)
    let bestD = 600 * 600;
    for (const e of query(sim.world, [Unit])) {
      if (!teleportTargetOk(sim, eid, e)) continue;
      const d = dist2(Pos.x[e]!, Pos.y[e]!, x, y);
      if (d < bestD || (d === bestD && e < t)) (bestD = d), (t = e);
    }
  }
  if (t < 0) return false;
  onMoveCommand(sim, eid); // cancels an auto wind-up
  const tp: Tp = { serial: Unit.serial[eid]!, target: t, targetSerial: Unit.serial[t]!, x: Pos.x[t]!, y: Pos.y[t]!, start: sim.tick, until: sim.tick + TELEPORT_CHANNEL_TICKS };
  tpState(sim).set(eid, tp);
  // destination telegraph (radius + fill over the channel), like LoL's arrival marker
  sim.events.push({ e: 'zone', src: eid, team: Unit.team[eid]!, x: tp.x, y: tp.y, r: 150, start: sim.tick, at: tp.until });
  return true;
}

/** Ends a Teleport channel without arriving; the summoner gets the short interrupt cooldown. Returns false if none. */
export function cancelTeleport(sim: Sim, eid: number): boolean {
  const s = tpState(sim);
  const tp = s.get(eid);
  if (!tp) return false;
  s.delete(eid);
  if (tp.serial !== sim.c.Unit.serial[eid]) return false;
  const a = champAbil(sim, eid);
  const slot = a.sums.indexOf('teleport');
  if (slot >= 0) {
    a.sumCdTotal[slot] = TELEPORT_INTERRUPT_CD;
    a.sumCdUntil[slot] = sim.tick + TELEPORT_INTERRUPT_CD;
  }
  return true;
}

/** Arrival point: beside a tower (toward the own fountain, outside its hitbox), else on the target. */
function arrival(sim: Sim, eid: number, tp: Tp): { x: number; y: number } {
  const { Unit } = sim.c;
  let { x, y } = tp;
  if (Unit.kind[tp.target] === Kind.Tower && Unit.serial[tp.target] === tp.targetSerial) {
    const f = sim.map.sides[Unit.team[eid]!]!.fountain;
    const [dx, dy] = dir(x, y, f.x, f.y);
    const off = Unit.radius[tp.target]! + Unit.radius[eid]! + 40;
    x += dx * off;
    y += dy * off;
  }
  return walkable(sim.map.nav, x, y) ? { x, y } : nearestWalkable(sim.map.nav, x, y);
}

/** Hard CC interrupts Teleport (stun, airborne, suppression, stasis); damage, roots and silence do not. */
const tpBroken = (sim: Sim, eid: number): boolean =>
  hasBuff(sim, eid, 'stun') || hasBuff(sim, eid, 'airborne') || hasBuff(sim, eid, 'suppress') || hasBuff(sim, eid, 'stasis');

export const summonersSystem: System = {
  name: 'summoners',
  update(sim) {
    const s = tpState(sim);
    if (!s.size) return;
    const { Unit, Pos } = sim.c;
    for (const [eid, tp] of [...s]) {
      if (tp.serial !== Unit.serial[eid] || !Unit.alive[eid]) {
        s.delete(eid);
        continue;
      }
      if (tpBroken(sim, eid)) {
        cancelTeleport(sim, eid);
        continue;
      }
      // follow a moving target; a dead target leaves its last position as the destination
      if (Unit.serial[tp.target] === tp.targetSerial && Unit.alive[tp.target]) {
        tp.x = Pos.x[tp.target]!;
        tp.y = Pos.y[tp.target]!;
      }
      if (sim.tick < tp.until) continue;
      s.delete(eid);
      const p = arrival(sim, eid, tp);
      Pos.px[eid] = p.x;
      Pos.py[eid] = p.y;
      teleport(sim, eid, p.x, p.y);
    }
  },
};
