// Data-driven ability engine (schema: src/sim/champions/schema.ts) + summoner spells.
// Abilities execute generically from data; champion specifics via { kind: 'hook' } + passive hooks. The hook-facing
// API (applyEffects, cooldowns, recast, next-auto, channel, displacement) is listed in src/sim/champions/hooks.ts.
// Cast flow: castAbility (input system) checks rank/cooldown/cost/CC, pays, starts the wind-up (champion stands
// still: stats sets ms 0 while busy) -> abilities.update resolves at wind-up end. castTime 0 resolves at once.
// Conventions: data seconds -> ticks via sec(); pct = percent points; Scaling ratios are fractions (1.0 = 100 %).
// Effects apply in data order (e.g. stasis before damage makes the target invulnerable to that damage).
// Flags: recast (second cast in the wind-up or a hook-opened window -> hooks with phase 'recast'), channel (busy for
// `duration`, broken by hard CC/silence/move/death). Type summon resolves like a ground circle (hooks spawn units).

import { query } from 'bitecs';
import type { Sim } from '../sim';
import type { System } from './index';
import { isRef } from '../sim';
import { CHAMP_ABILITY_DMG_MULT, DT, Kind, isMinion, isStructure, sec, type CastFailReason } from '../types';
import { dealDamage } from '../damage';
import { dir, dist2, circleInCone, cosDeg, segDist2 } from '../vec';
import { findPath, lineWalkable, nearestWalkable, walkable } from '../map';
import { addBuff, addShield, canAttack, canCast, canMove, channelBroken, healUnit, removeBuffs, reveal, type StatKey } from '../buffs';
import { championData, championHooks, champIdOf, passiveHooksOf } from '../champions';
import type { AbilityData, Effect, EffectTarget, Ranked, Scaling } from '../champions/schema';
import type { CastMods, DashPlan, EffectCtx, EffectPhase } from '../champions/hooks';
import { onMoveCommand } from './attack';
import { spawnProjectile } from './projectiles';
import { baseMaxHp } from './stats';
import { cancelRecall, champions } from './economy';
import { cancelTeleport, castSummonerSpell, summonerCooldown, summonerDef, summonerWalkTarget, teleporting } from '../summoners';
import { sees } from '../vision';
import { updateSummons } from '../summons';
import { tickItemsAndRunes } from '../items/itemHooks';

export interface AbilityHud {
  id: string;
  rank: number;
  maxRank: number;
  cdLeft: number; // seconds
  cdTotal: number;
  cost: number;
  canLevel: boolean;
}

/** Payload of an ability projectile (line skillshot or homing targeted ability). */
export interface AbilityPayload {
  t: 'ability';
  caster: number;
  casterSerial: number;
  slot: number;
  rank: number;
  flags: string[];
  /** Units already hit (pierce). */
  hit: number[];
  /** Cast direction and cursor (for the hook context). */
  dx: number;
  dy: number;
  cx: number;
  cy: number;
  /** fireAbilityProjectile tag ('' for the ability's own projectile). */
  tag: string;
  /** Returning projectile: 0 no, 1 outbound, 2 on the way back. */
  ret: number;
}

interface CastState {
  slot: number;
  rank: number;
  x: number;
  y: number;
  target: number;
  /** Serial of `target` at cast start: eids are recycled, a dead target's eid may be a new unit at resolution. */
  targetSerial: number;
  end: number;
  cost: number;
  prevCdUntil: number;
  timeMult: number;
}

interface Displace {
  serial: number;
  dx: number;
  dy: number;
  speed: number;
  left: number;
  /** Dash of the caster's own ability (resolve at end), -1 for knockback/pull. */
  slot: number;
  rank: number;
  /** Dash plan extras (own dashes). */
  target: number;
  targetSerial: number;
  stopAtEnemy: number;
  cx: number;
  cy: number;
  /** Leap (Sprungfrucht): ignores walls on the way; the caller picks a walkable landing point. */
  through?: 1;
}

interface ChampAbil {
  serial: number;
  ranks: number[];
  cdUntil: number[];
  cdTotal: number[];
  sums: [string, string];
  sumCdUntil: number[];
  sumCdTotal: number[];
  cast: CastState | null;
  /** Open recast windows per slot ([from, until] ticks; until -1 = closed). */
  recast: { from: number; until: number }[];
  channel: { slot: number; rank: number; start: number; until: number } | null;
  armed: { slot: number; rank: number; until: number } | null;
  lastDashEnd: number;
  /** Targeted cast (ability or summoner) walking into range (LoL): cast once in range, cancelled by orders. */
  walk: CastIntent | null;
  /** One input pressed while busy (own wind-up, dash, channel), retried each tick until `until` (input buffer). */
  queued: (CastIntent & { until: number }) | null;
}

/** A cast command kept for later: summoner (slot = D/F) or ability (slot = Q..R). */
interface CastIntent {
  sum: boolean;
  slot: number;
  x: number;
  y: number;
  /** -1 = none (cursor pick). */
  target: number;
  targetSerial: number;
}

interface Zone {
  caster: number;
  casterSerial: number;
  slot: number;
  rank: number;
  x: number;
  y: number;
  /** Caster position at cast (origin of 'forward' line zones). */
  ox: number;
  oy: number;
  dx: number;
  dy: number;
  cx: number;
  cy: number;
  /** Centre follows the caster (self AoEs with a delay). */
  follow: boolean;
  next: number;
  until: number;
  period: number;
}

interface AbilState {
  champs: Map<number, ChampAbil>;
  zones: Zone[];
  moves: Map<number, Displace>;
}

function abilState(sim: Sim): AbilState {
  let s = sim.state.abilities as AbilState | undefined;
  if (!s) sim.state.abilities = s = { champs: new Map(), zones: [], moves: new Map() };
  return s;
}

/** Ability state of a champion; created on demand (champions.ts calls this at spawn). */
export function champAbil(sim: Sim, eid: number): ChampAbil {
  const s = abilState(sim);
  let a = s.champs.get(eid);
  if (!a || a.serial !== sim.c.Unit.serial[eid]) {
    const setup = sim.config.players.find((p) => p.slot === sim.c.Unit.slot[eid]);
    a = {
      serial: sim.c.Unit.serial[eid]!,
      ranks: [0, 0, 0, 0],
      cdUntil: [0, 0, 0, 0],
      cdTotal: [0, 0, 0, 0],
      sums: setup ? [setup.summoners[0], setup.summoners[1]] : ['', ''],
      sumCdUntil: [0, 0],
      sumCdTotal: [0, 0],
      cast: null,
      recast: [0, 1, 2, 3].map(() => ({ from: 0, until: -1 })),
      channel: null,
      armed: null,
      lastDashEnd: -1e9,
      walk: null,
      queued: null,
    };
    s.champs.set(eid, a);
  }
  return a;
}

/** Ranked value for rank (1-based); single numbers apply to every rank. */
export const rv = (v: Ranked | undefined, rank: number): number =>
  v === undefined ? 0 : typeof v === 'number' ? v : v[Math.max(0, Math.min(v.length - 1, rank - 1))] ?? 0;

export const maxRank = (slot: number): number => (slot === 3 ? 3 : 5);

/** Minimum champion level for rank n: Q/W/E 2n-1, R 6/11/16. */
export const levelForRank = (slot: number, n: number): number => (slot === 3 ? 1 + 5 * n : 2 * n - 1);

export function canLevelSlot(sim: Sim, eid: number, slot: number): boolean {
  if (sim.c.Unit.kind[eid] !== Kind.Champion || slot < 0 || slot > 3) return false;
  const a = champAbil(sim, eid);
  const next = a.ranks[slot]! + 1;
  return sim.c.Champ.skillPoints[eid]! > 0 && next <= maxRank(slot) && sim.c.Champ.level[eid]! >= levelForRank(slot, next);
}

export function levelAbility(sim: Sim, eid: number, slot: number): void {
  if (!canLevelSlot(sim, eid, slot)) return;
  champAbil(sim, eid).ranks[slot]!++;
  sim.c.Champ.skillPoints[eid] = sim.c.Champ.skillPoints[eid]! - 1;
}

export function refreshCooldowns(sim: Sim, eid: number): void {
  if (sim.c.Unit.kind[eid] !== Kind.Champion) return;
  const a = champAbil(sim, eid);
  a.cdUntil.fill(0);
  a.sumCdUntil.fill(0);
}

// ------------------------------------------------------------------ hook API: cooldowns, recast, channel, next auto

/** Remaining cooldown of an ability slot in ticks. */
export const cooldownLeft = (sim: Sim, eid: number, slot: number): number => Math.max(0, champAbil(sim, eid).cdUntil[slot]! - sim.tick);

/** Set the remaining cooldown (ticks; 0 = ready). */
export function setCooldown(sim: Sim, eid: number, slot: number, ticks: number): void {
  const a = champAbil(sim, eid);
  a.cdUntil[slot] = sim.tick + Math.max(0, ticks);
  if (a.cdTotal[slot]! < ticks) a.cdTotal[slot] = ticks;
}

/** Reduce the remaining cooldown by `ticks`. */
export function reduceCooldown(sim: Sim, eid: number, slot: number, ticks: number): void {
  const a = champAbil(sim, eid);
  a.cdUntil[slot] = Math.max(sim.tick, a.cdUntil[slot]! - ticks);
}

/** Abort the current wind-up. refund: cost back and previous cooldown; cooldownTicks overrides the cooldown. */
export function cancelCast(sim: Sim, eid: number, opts: { refund: boolean; cooldownTicks?: number }): void {
  const a = champAbil(sim, eid);
  const c = a.cast;
  if (!c) return;
  a.cast = null;
  if (opts.refund) refund(sim, eid, c);
  if (opts.cooldownTicks !== undefined) setCooldown(sim, eid, c.slot, opts.cooldownTicks);
}

function refund(sim: Sim, eid: number, c: CastState): void {
  const { Mana, Hp } = sim.c;
  const ab = abilityOf(sim, eid, c.slot);
  // regen kept running during the wind-up: the refund never fills past the maximum
  if (ab.costType === 'mana' || ab.costType === 'energy') Mana.cur[eid] = Math.min(Mana.max[eid]!, Mana.cur[eid]! + c.cost);
  else if (ab.costType === 'hp') Hp.cur[eid] = Math.min(Hp.max[eid]!, Hp.cur[eid]! + c.cost);
  champAbil(sim, eid).cdUntil[c.slot] = c.prevCdUntil;
}

/** Casting `slot` in [fromTick, untilTick] becomes a recast (ability needs flag 'recast'). */
export function openRecast(sim: Sim, eid: number, slot: number, fromTick: number, untilTick: number): void {
  champAbil(sim, eid).recast[slot] = { from: fromTick, until: untilTick };
}

export function closeRecast(sim: Sim, eid: number, slot: number): void {
  champAbil(sim, eid).recast[slot]!.until = -1;
}

/** Active channel or null. */
export function channelOf(sim: Sim, eid: number): { slot: number; rank: number; start: number; until: number } | null {
  const s = sim.state.abilities as AbilState | undefined;
  const a = s?.champs.get(eid);
  return a && a.serial === sim.c.Unit.serial[eid] && a.channel && a.channel.until > sim.tick ? a.channel : null;
}

/** Ends a channel (move command, CC, death). */
export function breakChannel(sim: Sim, eid: number): void {
  const a = (sim.state.abilities as AbilState | undefined)?.champs.get(eid);
  if (a) a.channel = null;
}

/** The caster's next basic attack within `ticks` becomes the empowered auto of ctx's ability (phase 'empowered'). */
export function armNextAuto(sim: Sim, ctx: EffectCtx, ticks: number): void {
  champAbil(sim, ctx.caster).armed = { slot: ctx.slot, rank: ctx.rank, until: sim.tick + ticks };
}

/** Attack system: consume the armed empowerment when an auto fires. */
export function takeEmpowered(sim: Sim, eid: number): { slot: number; rank: number } | null {
  const a = (sim.state.abilities as AbilState | undefined)?.champs.get(eid);
  if (!a?.armed) return null;
  const arm = a.armed;
  a.armed = null;
  return sim.tick <= arm.until ? { slot: arm.slot, rank: arm.rank } : null;
}

/** Attack system: the empowered auto landed on `target`. */
export function resolveEmpowered(sim: Sim, eid: number, emp: { slot: number; rank: number }, target: number, damage: number): void {
  const { Pos } = sim.c;
  const ab = abilityOf(sim, eid, emp.slot);
  const [dx, dy] = dir(Pos.x[eid]!, Pos.y[eid]!, Pos.x[target]!, Pos.y[target]!);
  resolve(sim, {
    caster: eid, slot: emp.slot, rank: emp.rank, ability: ab, hits: sim.c.Unit.alive[target] ? [target] : [],
    x: Pos.x[target]!, y: Pos.y[target]!, target, phase: 'empowered', dx, dy, cursorX: Pos.x[target]!, cursorY: Pos.y[target]!,
    empowered: { damage },
  });
}

/** Tick the champion's last own dash/blink/Flash ended. */
export const lastDashEnd = (sim: Sim, eid: number): number => champAbil(sim, eid).lastDashEnd;

/** Record a dash/blink/Flash end and fire onDashEnd (slot -1 = Flash). */
export function noteDashEnd(sim: Sim, eid: number, slot: number): void {
  champAbil(sim, eid).lastDashEnd = sim.tick;
  for (const h of passiveHooksOf(sim, eid)) h.onDashEnd?.(sim, eid, slot);
}

/** Dashing, leaping or knocked back / pulled right now (abilState.moves). */
export function isDisplacing(sim: Sim, eid: number): boolean {
  const m = (sim.state.abilities as AbilState | undefined)?.moves.get(eid);
  return !!m && m.serial === sim.c.Unit.serial[eid];
}

/** Casting (wind-up), channelling, dashing or being displaced: no movement, no autos. */
export function isBusy(sim: Sim, eid: number): boolean {
  if (teleporting(sim, eid)) return true;
  const s = sim.state.abilities as AbilState | undefined;
  if (!s) return false;
  const m = s.moves.get(eid);
  if (m && m.serial === sim.c.Unit.serial[eid]) return true;
  const a = s.champs.get(eid);
  return !!a && a.serial === sim.c.Unit.serial[eid] && (a.cast !== null || (a.channel !== null && a.channel.until > sim.tick));
}

export const abilityOf = (sim: Sim, eid: number, slot: number): AbilityData => championData(champIdOf(sim, eid)).abilities[slot]!;

// ------------------------------------------------------------------ casting

function makeCtx(sim: Sim, eid: number, slot: number, rank: number, phase: EffectPhase, x: number, y: number, target: number): EffectCtx {
  const { Pos, Face } = sim.c;
  let [dx, dy] = dir(Pos.x[eid]!, Pos.y[eid]!, x, y);
  if (dx === 0 && dy === 0) [dx, dy] = [Face.x[eid]!, Face.y[eid]!];
  return { caster: eid, slot, rank, ability: abilityOf(sim, eid, slot), hits: [], x, y, target, phase, dx, dy, cursorX: x, cursorY: y };
}

/**
 * Cast an ability now. Returns null on success (wind-up started, resolved, or recast), else why it failed. 'range':
 * a valid target is out of range; the cast is then stored as a walk-into-range intent (champAbil().walk, see
 * updateCastIntents) and the attack order dropped. Commands go through commandCast (buffer + castFail events).
 */
export function castAbility(sim: Sim, eid: number, slot: number, x: number, y: number, target?: number): CastFailReason | null {
  const { Unit, Mana, Hp, Stats } = sim.c;
  if (!Unit.alive[eid] || Unit.kind[eid] !== Kind.Champion || slot < 0 || slot > 3) return 'unlearned';
  const a = champAbil(sim, eid);
  const ab = abilityOf(sim, eid, slot);
  const rank = a.ranks[slot]!;
  if (rank === 0) return 'unlearned';
  if (ab.flags?.includes('recast')) {
    const w = a.recast[slot]!;
    const win = sim.tick >= w.from && sim.tick <= w.until;
    // a press during the own wind-up is a cancel/feint (Gorvam Q) and always allowed; a hook-opened window is a real
    // cast: blocked by stun/silence/airborne (and roots for dash/blink/mobility recasts), the window stays open
    const windup = a.cast?.slot === slot;
    if (win && !windup && (!canCast(sim, eid) || (movesCaster(ab) && !canMove(sim, eid)))) return 'cc';
    if (windup || win) {
      if (win) w.until = -1;
      sim.events.push({ e: 'cast', src: eid, slot, x, y, rank, recast: true });
      runHooks(sim, makeCtx(sim, eid, slot, rank, 'recast', x, y, target ?? -1));
      return null;
    }
  }
  if (sim.tick < a.cdUntil[slot]!) return 'cooldown';
  if (!canCast(sim, eid) || (movesCaster(ab) && !canMove(sim, eid))) return 'cc';
  const mods: CastMods = { cost: rv(ab.cost, rank), timeMult: 1 };
  for (const h of passiveHooksOf(sim, eid)) h.modifyCast?.(sim, eid, slot, mods);
  const cost = Math.max(0, mods.cost);
  if (ab.costType === 'mana' || ab.costType === 'energy') {
    if (Mana.cur[eid]! < cost) return 'mana';
  } else if (ab.costType === 'hp' && cost > 0 && Hp.cur[eid]! <= cost) return 'mana';
  if (a.cast || isBusy(sim, eid)) return 'busy';
  let tgt = -1;
  if (ab.type === 'targeted') {
    tgt = pickTarget(sim, eid, ab, rank, x, y, target, false);
    if (tgt < 0) {
      // LoL: a valid target out of range -> walk into range, then cast
      const far = pickTarget(sim, eid, ab, rank, x, y, target, true);
      if (far < 0) return 'target';
      startWalk(sim, eid, { sum: false, slot, x, y, target: far, targetSerial: Unit.serial[far]! });
      return 'range';
    }
  }
  // pay + cooldown at cast start (refunded if interrupted during the wind-up)
  if (ab.costType === 'mana' || ab.costType === 'energy') Mana.cur[eid] = Mana.cur[eid]! - cost;
  else if (ab.costType === 'hp') Hp.cur[eid] = Hp.cur[eid]! - cost;
  const prevCdUntil = a.cdUntil[slot]!;
  a.cdTotal[slot] = Math.round((sec(rv(ab.cooldown, rank)) * 100) / (100 + Stats.haste[eid]!));
  a.cdUntil[slot] = sim.tick + a.cdTotal[slot]!;
  cancelRecall(sim, eid);
  removeBuffs(sim, eid, (b) => b.kind === 'stat' && b.stat === 'invisible'); // casting breaks invisibility
  // blinks, cones and line skillshots with a delay (Seraphyne E, Isolde W, Lysa R): the delay is part of the wind-up
  const delayed = ab.type === 'blink' || ab.type === 'cone' || ab.type === 'skillshot_line';
  const castTime = (ab.castTime + (delayed ? (ab.delay ?? 0) : 0)) * mods.timeMult;
  sim.events.push({ e: 'cast', src: eid, slot, x, y, rank, at: sim.tick + sec(castTime) });
  face(sim, eid, x, y);
  // instant self-casts (e.g. AS steroids) do not interrupt an auto; everything else does
  if (ab.castTime > 0 || ab.type !== 'self') onMoveCommand(sim, eid);
  if (ab.flags?.includes('unstoppable')) addBuff(sim, eid, { kind: 'unstoppable', id: ab.id, src: eid, ticks: sec(castTime) + 1 });
  if (sec(castTime) > 0) {
    a.cast = { slot, rank, x, y, target: tgt, targetSerial: tgt >= 0 ? Unit.serial[tgt]! : 0, end: sim.tick + sec(castTime), cost, prevCdUntil, timeMult: mods.timeMult };
  } else {
    execute(sim, eid, slot, rank, x, y, tgt, mods.timeMult);
  }
  return null;
}

// ------------------------------------------------------------------ cast commands: walk into range, input buffer

/** Input buffer: a cast pressed during an own wind-up / dash / channel is retried for this long (~0.25 s). */
export const CAST_BUFFER_TICKS = 8;

function castFail(sim: Sim, eid: number, i: { sum: boolean; slot: number }, reason: CastFailReason): void {
  sim.events.push({ e: 'castFail', src: eid, slot: i.slot, reason, ...(i.sum ? { summoner: true as const } : {}) });
}

const tryCast = (sim: Sim, eid: number, i: CastIntent): CastFailReason | null =>
  i.sum ? castSummoner(sim, eid, i.slot, i.x, i.y, i.target >= 0 ? i.target : undefined) : castAbility(sim, eid, i.slot, i.x, i.y, i.target >= 0 ? i.target : undefined);

/** Walk toward a targeted cast's target (stored intent; the attack order and an auto wind-up are dropped). */
function startWalk(sim: Sim, eid: number, i: CastIntent): void {
  const { Atk } = sim.c;
  champAbil(sim, eid).walk = i;
  Atk.target[eid] = -1;
  Atk.attackMove[eid] = 0;
  onMoveCommand(sim, eid);
  walkStep(sim, eid, i.target);
}

/** Path toward the walk target (straight if clear, else pathfinding refreshed every 15 ticks), like a chase. */
function walkStep(sim: Sim, eid: number, t: number): void {
  const { Pos, Move } = sim.c;
  if (lineWalkable(sim.map.nav, Pos.x[eid]!, Pos.y[eid]!, Pos.x[t]!, Pos.y[t]!)) sim.paths.set(eid, [{ x: Pos.x[t]!, y: Pos.y[t]! }]);
  else if (Move.mode[eid] !== 1 || !sim.paths.has(eid) || (sim.tick + eid) % 15 === 0) sim.paths.set(eid, findPath(sim.map.nav, Pos.x[eid]!, Pos.y[eid]!, Pos.x[t]!, Pos.y[t]!));
  Move.mode[eid] = 1;
  Move.tx[eid] = Pos.x[t]!;
  Move.ty[eid] = Pos.y[t]!;
  Move.pathIdx[eid] = 0;
}

/**
 * Cast / summoner command (input system, humans and bots alike): cast now; pressed while busy -> buffered for
 * CAST_BUFFER_TICKS (at least until the current wind-up ends); out of range -> walk into range; otherwise a
 * castFail event with the reason. A new command replaces a pending walk.
 */
export function commandCast(sim: Sim, eid: number, sum: boolean, slot: number, x: number, y: number, target?: number): void {
  if (sim.c.Unit.kind[eid] !== Kind.Champion) return;
  const a = champAbil(sim, eid);
  a.walk = null;
  const t = target !== undefined && target >= 0 ? target : -1;
  const i: CastIntent = { sum, slot, x, y, target: t, targetSerial: t >= 0 ? sim.c.Unit.serial[t]! : 0 };
  const r = tryCast(sim, eid, i);
  if (r === null || (r === 'range' && a.walk)) return;
  if (r === 'busy') {
    a.queued = { ...i, until: Math.max(sim.tick + CAST_BUFFER_TICKS, a.cast ? a.cast.end + 1 : 0) };
    return;
  }
  castFail(sim, eid, i, r);
}

/** Orders cancel a pending walk-into-range cast; a Stop also clears the input buffer. */
export function cancelCastIntents(sim: Sim, eid: number, stop: boolean): void {
  const a = (sim.state.abilities as AbilState | undefined)?.champs.get(eid);
  if (!a) return;
  a.walk = null;
  if (stop) a.queued = null;
}

/** Input system, after this tick's commands: retry buffered casts, advance / fire walk-into-range casts. */
export function updateCastIntents(sim: Sim): void {
  const s = sim.state.abilities as AbilState | undefined;
  if (!s) return;
  const { Unit, Move } = sim.c;
  for (const [eid, a] of s.champs) {
    if (!a.queued && !a.walk) continue;
    if (a.serial !== Unit.serial[eid] || !Unit.alive[eid]) {
      a.queued = a.walk = null;
      continue;
    }
    const q = a.queued;
    if (q) {
      if (q.target >= 0 && Unit.serial[q.target] !== q.targetSerial) q.target = -1; // target eid recycled
      const r = tryCast(sim, eid, q);
      if (r === 'busy' && sim.tick < q.until) continue; // still busy: keep it (a walk waits too)
      a.queued = null;
      if (r !== null && !(r === 'range' && a.walk)) castFail(sim, eid, q, r);
      continue;
    }
    const w = a.walk!;
    if (!isRef(sim, w.target, w.targetSerial) || !sees(sim, Unit.team[eid]!, w.target) || (Unit.untargetable[w.target] && Unit.team[w.target] !== Unit.team[eid])) {
      // target died / vanished into fog: stop where we are (LoL)
      a.walk = null;
      if (Move.mode[eid] === 1) (Move.mode[eid] = 0), sim.paths.delete(eid);
      continue;
    }
    if (isBusy(sim, eid)) continue;
    if (!within(sim, eid, w.target, intentRange(sim, eid, w))) {
      walkStep(sim, eid, w.target);
      continue;
    }
    // in range: stop and cast standing (a failure here, e.g. mana spent meanwhile, reports castFail)
    a.walk = null;
    Move.mode[eid] = 0;
    sim.paths.delete(eid);
    const r = tryCast(sim, eid, w);
    if (r !== null && !(r === 'range' && a.walk)) castFail(sim, eid, w, r);
  }
}

/** Cast range of a stored targeted intent (ability rank range or summoner range). */
function intentRange(sim: Sim, eid: number, i: CastIntent): number {
  const a = champAbil(sim, eid);
  if (i.sum) return summonerDef(a.sums[i.slot]!)?.range ?? 0;
  return rv(abilityOf(sim, eid, i.slot).range, Math.max(1, a.ranks[i.slot]!));
}

/** Dashes, blinks and abilities flagged 'mobility' (e.g. Isolde R's leap) relocate the caster: roots block them. */
const movesCaster = (ab: AbilityData): boolean => ab.type === 'dash' || ab.type === 'blink' || (ab.flags?.includes('mobility') ?? false);

/** Target of a targeted ability: explicit, else the valid unit nearest the cursor (150). anyRange: ignore cast range. */
function pickTarget(sim: Sim, eid: number, ab: AbilityData, rank: number, x: number, y: number, target: number | undefined, anyRange: boolean): number {
  const { Unit, Pos } = sim.c;
  const ally = ab.flags?.includes('ally_target') ?? false;
  const team = Unit.team[eid]!;
  // enemy casts: fighting units only (no wards, plants, structures, projectiles); ally casts: allied champions only
  const kindOk = (k: number): boolean => (ally ? k === Kind.Champion : k === Kind.Champion || k === Kind.Dummy || isMinion(k) || k === Kind.Monster || k === Kind.Pet);
  const ok = (t: number): boolean =>
    t >= 0 &&
    !!Unit.alive[t] &&
    !Unit.untargetable[t] &&
    kindOk(Unit.kind[t]!) &&
    (ally ? Unit.team[t] === team && t !== eid : Unit.team[t] !== team && sees(sim, team, t)) &&
    (anyRange || within(sim, eid, t, rv(ab.range, rank)));
  if (target !== undefined) return ok(target) ? target : -1;
  // no explicit target: the valid unit closest to the cursor (within 150)
  let best = -1;
  let bestD = 150 * 150;
  const ents = query(sim.world, [Unit]);
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i]!;
    if (!ok(e)) continue;
    const d = dist2(Pos.x[e]!, Pos.y[e]!, x, y);
    if (d <= bestD) {
      if (d === bestD && best >= 0 && e > best) continue;
      bestD = d;
      best = e;
    }
  }
  return best;
}

function within(sim: Sim, a: number, b: number, range: number): boolean {
  const { Pos, Unit } = sim.c;
  const r = range + Unit.radius[a]! + Unit.radius[b]!;
  return dist2(Pos.x[b]!, Pos.y[b]!, Pos.x[a]!, Pos.y[a]!) <= r * r;
}

function face(sim: Sim, eid: number, x: number, y: number): void {
  const [dx, dy] = dir(sim.c.Pos.x[eid]!, sim.c.Pos.y[eid]!, x, y);
  if (dx !== 0 || dy !== 0) {
    sim.c.Face.x[eid] = dx;
    sim.c.Face.y[eid] = dy;
  }
}

/** Line zone segment (ability.line) for a zone centred at (cx, cy) cast from (ox, oy) in direction (dx, dy). */
export function lineSegment(ab: AbilityData, ox: number, oy: number, cx: number, cy: number, dx: number, dy: number): [number, number, number, number] {
  const r = ab.radius ?? 0;
  if (ab.line === 'forward') return [ox, oy, ox + dx * 2 * r, oy + dy * 2 * r];
  return [cx + dy * r, cy - dx * r, cx - dy * r, cy + dx * r];
}

/** Line geometry for 'zone' events of line zones (render draws the exact strip). */
function zoneLine(ab: AbilityData, ox: number, oy: number, cx: number, cy: number, dx: number, dy: number): { line?: { ax: number; ay: number; bx: number; by: number; width: number } } {
  if (!ab.line) return {};
  const [ax, ay, bx, by] = lineSegment(ab, ox, oy, cx, cy, dx, dy);
  return { line: { ax, ay, bx, by, width: ab.width ?? 0 } };
}

/** Units in a ground effect: circle of ability.radius, or the line segment for ability.line. */
function areaHits(sim: Sim, eid: number, ab: AbilityData, ox: number, oy: number, cx: number, cy: number, dx: number, dy: number): number[] {
  if (!ab.line) return enemiesIn(sim, eid, cx, cy, ab.radius ?? 0);
  const [ax, ay, bx, by] = lineSegment(ab, ox, oy, cx, cy, dx, dy);
  return enemiesOnSegment(sim, eid, ax, ay, bx, by, (ab.width ?? 0) / 2);
}

/** Cast resolution (wind-up over). */
function execute(sim: Sim, eid: number, slot: number, rank: number, x: number, y: number, target: number, timeMult: number): void {
  const { Pos, Unit, Atk } = sim.c;
  const a = champAbil(sim, eid);
  const ab = abilityOf(sim, eid, slot);
  const ox = Pos.x[eid]!;
  const oy = Pos.y[eid]!;
  const base = makeCtx(sim, eid, slot, rank, 'cast', x, y, target);
  const { dx, dy } = base;
  const range = rv(ab.range, rank);
  const cursorDist = Math.sqrt(dist2(x, y, ox, oy));
  const ctx = (hits: number[], cx: number, cy: number): EffectCtx => ({ ...base, hits, x: cx, y: cy });
  const payload = (): AbilityPayload => ({ t: 'ability', caster: eid, casterSerial: Unit.serial[eid]!, slot, rank, flags: ab.flags ?? [], hit: [], dx, dy, cx: x, cy: y, tag: '', ret: 0 });

  if (ab.flags?.includes('auto_reset')) Atk.nextReady[eid] = sim.tick;
  if (ab.flags?.includes('channel')) a.channel = { slot, rank, start: sim.tick, until: sim.tick + sec(rv(ab.duration, rank)) };
  switch (ab.type) {
    case 'skillshot_line':
      spawnProjectile(sim, { kind: 1, src: eid, team: Unit.team[eid]!, x: ox, y: oy, dx, dy, speed: ab.speed ?? 1500, width: ab.width ?? 60, maxDist: range, payload: payload() });
      break;
    case 'skillshot_circle':
    case 'zone':
    case 'summon': {
      const d = Math.min(range, cursorDist);
      const cx = ox + dx * d;
      const cy = oy + dy * d;
      const delay = sec((ab.delay ?? 0) * timeMult);
      const dur = ab.type === 'zone' ? sec(rv(ab.duration, rank)) : 0;
      if (delay > 0 || dur > 0) {
        // ponytail: persistent zones re-apply their effects once per second (damage values are per tick)
        abilState(sim).zones.push({ caster: eid, casterSerial: Unit.serial[eid]!, slot, rank, x: cx, y: cy, ox, oy, dx, dy, cx: x, cy: y, follow: false, next: sim.tick + delay, until: sim.tick + delay + dur, period: sec(1) });
        sim.events.push({ e: 'zone', src: eid, team: Unit.team[eid]!, x: cx, y: cy, r: ab.radius ?? 0, start: sim.tick, at: sim.tick + delay, ...(dur > 0 ? { until: sim.tick + delay + dur } : {}), ...zoneLine(ab, ox, oy, cx, cy, dx, dy) });
      } else {
        resolve(sim, ctx(areaHits(sim, eid, ab, ox, oy, cx, cy, dx, dy), cx, cy));
      }
      break;
    }
    case 'cone': {
      const cosHalf = cosDeg((ab.angle ?? 60) / 2);
      const hits = unitsWhere(sim, (e) => isEnemyUnit(sim, eid, e) && circleInCone(Pos.x[e]!, Pos.y[e]!, Unit.radius[e]!, ox, oy, dx, dy, cosHalf, range));
      resolve(sim, ctx(hits, ox, oy));
      break;
    }
    case 'targeted':
      if (target < 0 || !Unit.alive[target]) break;
      if (ab.speed) spawnProjectile(sim, { kind: 2, src: eid, team: Unit.team[eid]!, x: ox, y: oy, target, speed: ab.speed, width: ab.width ?? 0, payload: payload() });
      else resolve(sim, ctx([target], Pos.x[target]!, Pos.y[target]!));
      break;
    case 'self': {
      const delay = sec((ab.delay ?? 0) * timeMult);
      if (delay > 0) {
        // self AoE after a delay (Brom Q): centred on the caster when it resolves
        abilState(sim).zones.push({ caster: eid, casterSerial: Unit.serial[eid]!, slot, rank, x: ox, y: oy, ox, oy, dx, dy, cx: x, cy: y, follow: true, next: sim.tick + delay, until: sim.tick + delay, period: sec(1) });
        sim.events.push({ e: 'zone', src: eid, team: Unit.team[eid]!, x: ox, y: oy, r: ab.radius ?? 0, start: sim.tick, at: sim.tick + delay, follow: true });
      } else resolve(sim, ctx(ab.radius ? enemiesIn(sim, eid, ox, oy, ab.radius) : [], ox, oy));
      break;
    }
    case 'dash': {
      const plan: DashPlan = {
        dx,
        dy,
        distance: ab.flags?.includes('ground_target') ? Math.min(ab.distance ?? range, cursorDist) : (ab.distance ?? range),
        speed: ab.speed ?? 1200,
        target: -1,
        stopAtEnemy: 0,
      };
      runHooks(sim, { ...base, phase: 'dashStart', dash: plan });
      if (ab.flags?.includes('unstoppable')) addBuff(sim, eid, { kind: 'unstoppable', id: ab.id, src: eid, ticks: Math.ceil((plan.distance / plan.speed) * 30) + 1 });
      const t = plan.target;
      abilState(sim).moves.set(eid, {
        serial: Unit.serial[eid]!, dx: plan.dx, dy: plan.dy, speed: plan.speed, left: plan.distance, slot, rank,
        target: t, targetSerial: t >= 0 ? Unit.serial[t]! : 0, stopAtEnemy: plan.stopAtEnemy, cx: x, cy: y,
      });
      break;
    }
    case 'blink': {
      const p = landingPoint(sim, ox, oy, ox + dx * Math.min(range, cursorDist), oy + dy * Math.min(range, cursorDist));
      teleport(sim, eid, p.x, p.y);
      noteDashEnd(sim, eid, slot);
      resolve(sim, ctx(ab.radius ? enemiesIn(sim, eid, p.x, p.y, ab.radius) : [], p.x, p.y));
      break;
    }
  }
  for (const h of passiveHooksOf(sim, eid)) h.onCast?.(sim, eid, slot);
}

// ------------------------------------------------------------------ effects

/** Projectile (line or homing ability) hit a unit. */
export function resolveAbilityHit(sim: Sim, p: AbilityPayload, t: number, x: number, y: number): void {
  if (sim.c.Unit.serial[p.caster] !== p.casterSerial) return; // caster entity gone (champions persist)
  const ab = abilityOf(sim, p.caster, p.slot);
  resolve(sim, { caster: p.caster, slot: p.slot, rank: p.rank, ability: ab, hits: [t], x, y, target: t, phase: 'cast', dx: p.dx, dy: p.dy, cursorX: p.cx, cursorY: p.cy, tag: p.tag });
}

/** Line projectile reached max range: hooks with phase 'expire'. */
export function resolveAbilityExpire(sim: Sim, p: AbilityPayload, x: number, y: number): void {
  if (sim.c.Unit.serial[p.caster] !== p.casterSerial) return;
  const ab = abilityOf(sim, p.caster, p.slot);
  runHooks(sim, { caster: p.caster, slot: p.slot, rank: p.rank, ability: ab, hits: [], x, y, target: -1, phase: 'expire', dx: p.dx, dy: p.dy, cursorX: p.cx, cursorY: p.cy, tag: p.tag });
}

const isHitEffect = (e: Effect): boolean => e.kind !== 'hook' && (e.target ?? 'hit') === 'hit';
const isNextAuto = (ab: AbilityData): boolean => ab.effects.some((e) => e.kind === 'hook' && e.id.endsWith('_next_auto'));

/** Hooks own the 'hit' effects of this ability (ChampionHooks.ownsHits or a *_next_auto hook). */
function ownsHits(sim: Sim, caster: number, ab: AbilityData): boolean {
  return isNextAuto(ab) || (championHooks(champIdOf(sim, caster)).ownsHits?.includes(ab.id) ?? false);
}

function runHooks(sim: Sim, ctx: EffectCtx): void {
  const effects = championHooks(champIdOf(sim, ctx.caster)).effects;
  for (const eff of ctx.ability.effects) if (eff.kind === 'hook') effects?.[eff.id]?.(sim, ctx);
}

/** Resolution: generic effects + hooks in data order (see EffectCtx.phase for what runs when). */
function resolve(sim: Sim, ctx: EffectCtx): void {
  const ab = ctx.ability;
  const generic = ctx.phase === 'cast' || ctx.phase === 'empowered';
  const skipHit = ctx.phase === 'cast' && ownsHits(sim, ctx.caster, ab);
  const hooks = championHooks(champIdOf(sim, ctx.caster)).effects;
  for (const eff of ab.effects) {
    if (eff.kind === 'hook') hooks?.[eff.id]?.(sim, ctx);
    else if (!generic) continue;
    else if (ctx.phase === 'empowered' ? isHitEffect(eff) : !(skipHit && isHitEffect(eff))) applyEffect(sim, ctx, eff);
  }
  if (generic && !skipHit) abilityHitEvents(sim, ctx);
  if (ctx.phase === 'cast' && isNextAuto(ab)) armNextAuto(sim, ctx, sec(rv(ab.duration, ctx.rank) || 4));
}

function abilityHitEvents(sim: Sim, ctx: EffectCtx): void {
  const hs = passiveHooksOf(sim, ctx.caster);
  if (!hs.some((h) => h.onAbilityHit)) return;
  for (const t of ctx.hits) if (sim.c.Unit.team[t] !== sim.c.Unit.team[ctx.caster]) for (const h of hs) h.onAbilityHit?.(sim, ctx.caster, t, ctx);
}

/**
 * Generic (non-hook) effects of ctx.ability on ctx.hits. which: 'hit' = hit-target effects only (one hit instance of
 * a hit producer), 'self' = self/ally/allies/enemies effects only, 'all' = both. Fires onAbilityHit unless 'self'.
 */
export function applyEffects(sim: Sim, ctx: EffectCtx, which: 'all' | 'hit' | 'self' = 'all'): void {
  for (const eff of ctx.ability.effects) {
    if (eff.kind === 'hook') continue;
    const hit = isHitEffect(eff);
    if ((which === 'hit' && !hit) || (which === 'self' && hit)) continue;
    applyEffect(sim, ctx, eff);
  }
  if (which !== 'self') abilityHitEvents(sim, ctx);
}

function isEnemyUnit(sim: Sim, eid: number, e: number): boolean {
  const { Unit } = sim.c;
  const k = Unit.kind[e]!;
  return !!Unit.alive[e] && !Unit.untargetable[e] && Unit.team[e] !== Unit.team[eid] && k !== Kind.Projectile && k !== Kind.Ward && k !== Kind.Plant && !isStructure(k);
}

function unitsWhere(sim: Sim, pred: (e: number) => boolean): number[] {
  const out: number[] = [];
  const ents = query(sim.world, [sim.c.Unit]);
  for (let i = 0; i < ents.length; i++) if (pred(ents[i]!)) out.push(ents[i]!);
  return out.sort((a, b) => a - b);
}

/** Enemy (non-structure) units whose hitbox touches the circle. */
function enemiesIn(sim: Sim, eid: number, x: number, y: number, r: number): number[] {
  const { Pos, Unit } = sim.c;
  return unitsWhere(sim, (e) => isEnemyUnit(sim, eid, e) && dist2(Pos.x[e]!, Pos.y[e]!, x, y) <= (r + Unit.radius[e]!) * (r + Unit.radius[e]!));
}

/** Enemy (non-structure, targetable) units of `eid` whose hitbox touches the circle, ascending eid. */
export const enemiesInRadius = enemiesIn;

/** Enemy units whose hitbox touches the segment A-B widened by halfWidth, ascending eid. */
export function enemiesOnSegment(sim: Sim, eid: number, ax: number, ay: number, bx: number, by: number, halfWidth: number): number[] {
  const { Pos, Unit } = sim.c;
  return unitsWhere(sim, (e) => {
    const r = halfWidth + Unit.radius[e]!;
    return isEnemyUnit(sim, eid, e) && segDist2(Pos.x[e]!, Pos.y[e]!, ax, ay, bx, by) <= r * r;
  });
}

function alliedChampsIn(sim: Sim, eid: number, x: number, y: number, r: number): number[] {
  const { Pos, Unit } = sim.c;
  return unitsWhere(sim, (e) => !!Unit.alive[e] && Unit.kind[e] === Kind.Champion && Unit.team[e] === Unit.team[eid] && dist2(Pos.x[e]!, Pos.y[e]!, x, y) <= r * r);
}

/** Allied champions (caster included) within r of (x, y). */
export const alliedChampionsIn = alliedChampsIn;

/** Nearest allied champion (not self) to (x,y) within range r of the caster, or -1. */
export function nearestAlly(sim: Sim, eid: number, x: number, y: number, r: number): number {
  const { Pos } = sim.c;
  let best = -1;
  let bestD = Infinity;
  for (const e of alliedChampsIn(sim, eid, Pos.x[eid]!, Pos.y[eid]!, r)) {
    if (e === eid) continue;
    const d = dist2(Pos.x[e]!, Pos.y[e]!, x, y);
    if (d < bestD) (bestD = d), (best = e);
  }
  return best;
}

function targetsOf(sim: Sim, ctx: EffectCtx, t: EffectTarget): number[] {
  const area = ctx.ability.radius ?? rv(ctx.ability.range, ctx.rank);
  switch (t) {
    case 'hit':
      return ctx.hits;
    case 'self':
      return sim.c.Unit.alive[ctx.caster] ? [ctx.caster] : [];
    case 'ally': {
      const { Unit } = sim.c;
      if (ctx.target >= 0 && Unit.alive[ctx.target] && Unit.team[ctx.target] === Unit.team[ctx.caster]) return [ctx.target];
      const a = nearestAlly(sim, ctx.caster, ctx.x, ctx.y, rv(ctx.ability.range, ctx.rank));
      return a >= 0 ? [a] : [];
    }
    case 'allies':
      return alliedChampsIn(sim, ctx.caster, ctx.x, ctx.y, area);
    case 'enemies':
      return enemiesIn(sim, ctx.caster, ctx.x, ctx.y, area);
  }
}

export function scaleAmount(sim: Sim, s: Scaling, caster: number, target: number, rank: number): number {
  const { Stats, Hp, Champ } = sim.c;
  let v = s.byLevel ? s.byLevel[0] + ((s.byLevel[1] - s.byLevel[0]) * (Math.max(1, Champ.level[caster]!) - 1)) / 17 : rv(s.base, rank);
  v += (s.ad ?? 0) * Stats.ad[caster]! + (s.bonusAd ?? 0) * Stats.bonusAd[caster]! + (s.ap ?? 0) * Stats.ap[caster]!;
  v += (s.maxHp ?? 0) * Hp.max[caster]! + (s.bonusHp ?? 0) * (Hp.max[caster]! - baseMaxHp(sim, caster));
  if (target >= 0) v += (s.targetMaxHp ?? 0) * Hp.max[target]! + (s.targetMissingHp ?? 0) * (Hp.max[target]! - Hp.cur[target]!);
  return v;
}

/** Pre-mitigation amount of the i-th damage effect of ctx.ability on target (0 if absent), with its type. */
export function effectAmount(sim: Sim, ctx: EffectCtx, target: number, i = 0): { amount: number; type: 'phys' | 'magic' | 'true' } {
  const dmg = ctx.ability.effects.filter((e) => e.kind === 'damage');
  const e = dmg[i];
  if (!e || e.kind !== 'damage') return { amount: 0, type: 'true' };
  return { amount: scaleAmount(sim, e.amount, ctx.caster, target, ctx.rank), type: e.type };
}

/** Heal/shield amount after the caster's modifyHeal passives (Ferris). */
function healAmount(sim: Sim, caster: number, t: number, amount: number): number {
  for (const h of passiveHooksOf(sim, caster)) if (h.modifyHeal) amount = h.modifyHeal(sim, caster, t, amount);
  return amount;
}

function applyEffect(sim: Sim, ctx: EffectCtx, eff: Effect): void {
  const { caster, rank, ability: ab } = ctx;
  if (eff.kind === 'hook') return;
  const targets = targetsOf(sim, ctx, eff.target ?? 'hit');
  for (const t of targets) {
    if (!sim.c.Unit.alive[t]) continue;
    switch (eff.kind) {
      case 'damage':
        dealDamage(sim, caster, t, scaleAmount(sim, eff.amount, caster, t, rank) * (ctx.dmgMult ?? 1) * (sim.c.Unit.kind[t] === Kind.Champion ? CHAMP_ABILITY_DMG_MULT : 1), eff.type);
        break;
      case 'heal':
        healUnit(sim, t, healAmount(sim, caster, t, scaleAmount(sim, eff.amount, caster, t, rank)));
        break;
      case 'shield':
        addShield(sim, t, healAmount(sim, caster, t, scaleAmount(sim, eff.amount, caster, t, rank)), sec(eff.duration), ab.id, caster);
        break;
      case 'slow':
        addBuff(sim, t, { kind: 'slow', id: ab.id, src: caster, pct: rv(eff.pct, rank), ticks: sec(rv(eff.duration, rank)) });
        break;
      case 'root':
      case 'stun':
      case 'airborne':
      case 'blind':
      case 'silence':
      case 'stasis':
        addBuff(sim, t, { kind: eff.kind, id: ab.id, src: caster, ticks: sec(rv(eff.duration, rank)) });
        break;
      case 'buff':
        addBuff(sim, t, { kind: 'stat', stat: eff.stat as StatKey, id: ab.id, src: caster, pct: rv(eff.pct, rank), flat: rv(eff.flat, rank), ticks: sec(rv(eff.duration, rank)) });
        break;
      case 'reveal':
        reveal(sim, sim.c.Unit.team[caster]!, t, sec(eff.duration));
        break;
      case 'mark':
        addBuff(sim, t, { kind: 'mark', id: eff.id, src: caster, ticks: sec(eff.duration) });
        break;
      case 'knockback':
      case 'pull':
        displace(sim, caster, t, eff.kind === 'pull' ? -eff.distance : eff.distance);
        break;
    }
  }
}

/** Knockback (distance > 0, away from src) or pull (< 0, toward src, stops at the hitboxes). Airborne while moving. */
const DISPLACE_SPEED = 1200;
export function displace(sim: Sim, src: number, t: number, distance: number, overTicks?: number): void {
  if (t === src || isStructure(sim.c.Unit.kind[t]!)) return;
  const { Pos, Unit } = sim.c;
  let [dx, dy] = dir(Pos.x[src]!, Pos.y[src]!, Pos.x[t]!, Pos.y[t]!);
  if (dx === 0 && dy === 0) [dx, dy] = [sim.c.Face.x[src]!, sim.c.Face.y[src]!];
  let d = Math.abs(distance);
  if (distance < 0) {
    [dx, dy] = [-dx, -dy];
    const gap = Math.sqrt(dist2(Pos.x[t]!, Pos.y[t]!, Pos.x[src]!, Pos.y[src]!)) - Unit.radius[t]! - Unit.radius[src]!;
    d = Math.max(0, Math.min(d, gap));
  }
  moveUnit(sim, src, t, dx, dy, d, overTicks);
}

/** Leap t to (x, y) over `ticks`, passing over walls (Sprungfrucht); (x, y) must be walkable. Airborne meanwhile. */
export function leapTo(sim: Sim, src: number, t: number, x: number, y: number, ticks: number): void {
  const { Pos } = sim.c;
  const d = Math.sqrt(dist2(Pos.x[t]!, Pos.y[t]!, x, y));
  if (d <= 0) return;
  const [dx, dy] = dir(Pos.x[t]!, Pos.y[t]!, x, y);
  const speed = (d * 30) / Math.max(1, ticks);
  if (!addBuff(sim, t, { kind: 'airborne', id: 'leap', src, ticks: Math.ceil((d / speed) * 30) + 1 })) return;
  onMoveCommand(sim, t);
  abilState(sim).moves.set(t, { serial: sim.c.Unit.serial[t]!, dx, dy, speed, left: d, slot: -1, rank: 0, target: -1, targetSerial: 0, stopAtEnemy: 0, cx: 0, cy: 0, through: 1 });
}

/** Move t to (x, y) over `overTicks` (airborne while moving). */
export function displaceTo(sim: Sim, src: number, t: number, x: number, y: number, overTicks?: number): void {
  const { Pos } = sim.c;
  const [dx, dy] = dir(Pos.x[t]!, Pos.y[t]!, x, y);
  moveUnit(sim, src, t, dx, dy, Math.sqrt(dist2(Pos.x[t]!, Pos.y[t]!, x, y)), overTicks);
}

function moveUnit(sim: Sim, src: number, t: number, dx: number, dy: number, d: number, overTicks?: number): void {
  if (d <= 0) return;
  const speed = overTicks && overTicks > 0 ? (d * 30) / overTicks : DISPLACE_SPEED;
  if (!addBuff(sim, t, { kind: 'airborne', id: 'displace', src, ticks: Math.ceil((d / speed) * 30) + 1 })) return;
  onMoveCommand(sim, t);
  abilState(sim).moves.set(t, { serial: sim.c.Unit.serial[t]!, dx, dy, speed, left: d, slot: -1, rank: 0, target: -1, targetSerial: 0, stopAtEnemy: 0, cx: 0, cy: 0 });
}

// ------------------------------------------------------------------ movement helpers (dash, blink, Flash)

/** Landing point for blinks: the target if walkable, else the farthest walkable point on the line, else nearest walkable. */
export function landingPoint(sim: Sim, ox: number, oy: number, tx: number, ty: number): { x: number; y: number } {
  const nav = sim.map.nav;
  if (walkable(nav, tx, ty)) return { x: tx, y: ty };
  const len = Math.sqrt(dist2(tx, ty, ox, oy));
  const n = Math.ceil(len / 10);
  for (let i = n - 1; i >= 1; i--) {
    const x = ox + ((tx - ox) * i) / n;
    const y = oy + ((ty - oy) * i) / n;
    if (walkable(nav, x, y)) return { x, y };
  }
  return walkable(nav, ox, oy) ? { x: ox, y: oy } : nearestWalkable(nav, tx, ty);
}

/** Instant reposition; keeps walking to the previous move target from the new spot. */
export function teleport(sim: Sim, eid: number, x: number, y: number): void {
  const { Pos, Move } = sim.c;
  Pos.x[eid] = x;
  Pos.y[eid] = y;
  if (Move.mode[eid] === 1) sim.paths.set(eid, findPath(sim.map.nav, x, y, Move.tx[eid]!, Move.ty[eid]!));
}

function stepMoves(sim: Sim): void {
  const { Pos, Unit } = sim.c;
  const s = abilState(sim);
  for (const [eid, m] of [...s.moves]) {
    if (m.serial !== Unit.serial[eid] || !Unit.alive[eid]) {
      s.moves.delete(eid);
      continue;
    }
    // dash to a unit: re-aim each tick, stop beside it
    let arrived = -1;
    const tgt = m.target >= 0 && Unit.serial[m.target] === m.targetSerial && Unit.alive[m.target] ? m.target : -1;
    let step = Math.min(m.speed * DT, m.left);
    if (tgt >= 0) {
      const gap = Math.sqrt(dist2(Pos.x[eid]!, Pos.y[eid]!, Pos.x[tgt]!, Pos.y[tgt]!)) - Unit.radius[eid]! - Unit.radius[tgt]!;
      [m.dx, m.dy] = dir(Pos.x[eid]!, Pos.y[eid]!, Pos.x[tgt]!, Pos.y[tgt]!);
      if (gap <= step) (step = Math.max(0, gap)), (arrived = tgt);
    }
    const ox = Pos.x[eid]!;
    const oy = Pos.y[eid]!;
    let nx = ox + m.dx * step;
    let ny = oy + m.dy * step;
    if (m.stopAtEnemy > 0 && arrived < 0) {
      // stop at the first enemy the path touches (earliest along the step)
      let best = -1;
      let bestT = Infinity;
      for (const e of enemiesOnSegment(sim, eid, ox, oy, nx, ny, m.stopAtEnemy)) {
        const t = (Pos.x[e]! - ox) * m.dx + (Pos.y[e]! - oy) * m.dy;
        if (t < bestT) (bestT = t), (best = e);
      }
      if (best >= 0) {
        arrived = best;
        const back = Math.max(0, Math.min(step, bestT - Unit.radius[best]!));
        nx = ox + m.dx * back;
        ny = oy + m.dy * back;
      }
    }
    const blocked = !m.through && !walkable(sim.map.nav, nx, ny);
    if (!blocked) {
      Pos.x[eid] = nx;
      Pos.y[eid] = ny;
      m.left -= step;
    }
    if (blocked || arrived >= 0 || m.left <= 1e-9 || (m.target >= 0 && tgt < 0)) {
      s.moves.delete(eid);
      teleport(sim, eid, Pos.x[eid]!, Pos.y[eid]!); // repath any pending move from the new spot
      if (m.slot >= 0) {
        noteDashEnd(sim, eid, m.slot);
        const ab = abilityOf(sim, eid, m.slot);
        let hits = ab.radius ? enemiesIn(sim, eid, Pos.x[eid]!, Pos.y[eid]!, ab.radius) : [];
        if (arrived >= 0 && Unit.team[arrived] !== Unit.team[eid] && !hits.includes(arrived)) hits = [arrived, ...hits];
        if (m.stopAtEnemy > 0) hits = arrived >= 0 ? [arrived] : [];
        const c = makeCtx(sim, eid, m.slot, m.rank, 'cast', m.cx, m.cy, arrived);
        resolve(sim, { ...c, hits, x: Pos.x[eid]!, y: Pos.y[eid]! });
      }
    }
  }
}

// ------------------------------------------------------------------ system

export const abilitiesSystem: System = {
  name: 'abilities',
  update(sim) {
    const s = abilState(sim);
    const { Unit } = sim.c;
    // per-tick champion hooks (before casts resolve and before attacks/projectiles move)
    for (const eid of champions(sim)) {
      championHooks(champIdOf(sim, eid)).onTick?.(sim, eid);
      tickItemsAndRunes(sim, eid); // item/rune upkeep: potions, auras, recharges (src/sim/items/itemHooks.ts)
    }
    updateSummons(sim);
    for (const [eid, a] of s.champs) {
      if (a.channel && (a.serial !== Unit.serial[eid] || !Unit.alive[eid] || channelBroken(sim, eid) || sim.tick >= a.channel.until)) a.channel = null;
      const c = a.cast;
      if (!c) continue;
      if (a.serial !== Unit.serial[eid] || !Unit.alive[eid] || !canCast(sim, eid)) {
        // interrupted during wind-up: refund cost and cooldown
        a.cast = null;
        refund(sim, eid, c);
        continue;
      }
      if (sim.tick >= c.end) {
        a.cast = null;
        // a targeted cast whose target died during the wind-up (eid possibly recycled) fizzles
        const target = c.target >= 0 && !isRef(sim, c.target, c.targetSerial) ? -1 : c.target;
        execute(sim, eid, c.slot, c.rank, c.x, c.y, target, c.timeMult);
      }
    }
    stepMoves(sim);
    // delayed / persistent ground effects
    const keep: Zone[] = [];
    for (const z of s.zones) {
      if (sim.tick >= z.next) {
        if (Unit.serial[z.caster] === z.casterSerial) {
          const ab = abilityOf(sim, z.caster, z.slot);
          const { Pos } = sim.c;
          const [x, y] = z.follow ? [Pos.x[z.caster]!, Pos.y[z.caster]!] : [z.x, z.y];
          const c = makeCtx(sim, z.caster, z.slot, z.rank, 'cast', z.cx, z.cy, -1);
          const [ox, oy] = z.follow ? [x, y] : [z.ox, z.oy];
          resolve(sim, { ...c, dx: z.dx, dy: z.dy, hits: areaHits(sim, z.caster, ab, ox, oy, x, y, z.dx, z.dy), x, y });
        }
        z.next += z.period;
      }
      if (z.next <= z.until && Unit.serial[z.caster] === z.casterSerial) keep.push(z);
    }
    s.zones = keep;
  },
};

// ------------------------------------------------------------------ summoners

/**
 * Cast a summoner spell now; null on success, else why not. Flash works during an own ability wind-up (R-Flash:
 * the ability then resolves from the new position) except a targeted one, and not out of a dash / displacement /
 * channel / Teleport ('busy': commandCast buffers it until that ends). Teleport never starts mid-cast ('busy' too). Targeted summoners
 * (Ignite, Exhaust, Smite) out of range return 'range' and walk into range like targeted abilities.
 */
export function castSummoner(sim: Sim, eid: number, slot: number, x: number, y: number, target?: number): CastFailReason | null {
  const { Unit } = sim.c;
  if (!Unit.alive[eid] || Unit.kind[eid] !== Kind.Champion || (slot !== 0 && slot !== 1)) return 'unlearned';
  const a = champAbil(sim, eid);
  const id = a.sums[slot]!;
  const def = summonerDef(id);
  if (!def || def.todo) return 'unlearned';
  if (id === 'teleport' && cancelTeleport(sim, eid)) return null; // recast during the channel cancels it
  if (sim.tick < a.sumCdUntil[slot]!) return 'cooldown';
  if (id !== 'reinigen' && (!canAttack(sim, eid) || (id === 'sprung' && !canMove(sim, eid)))) return 'cc';
  const channel = a.channel !== null && a.channel.until > sim.tick;
  // a targeted wind-up resolves without a new range check: Flash waits for it (buffered) instead of moving the caster
  const targetedWindup = a.cast !== null && abilityOf(sim, eid, a.cast.slot).type === 'targeted';
  if (id === 'sprung' && (isDisplacing(sim, eid) || channel || teleporting(sim, eid) || targetedWindup)) return 'busy';
  if (id === 'teleport' && isBusy(sim, eid)) return 'busy';
  if (!castSummonerSpell(sim, eid, id, x, y, target)) {
    if (teleporting(sim, eid)) return 'busy'; // a Teleport channel blocks the other summoner
    if (id === 'reinigen') return 'cc'; // airborne / suppressed / stasis
    const far = summonerWalkTarget(sim, eid, id, x, y, target);
    if (far < 0) return 'target';
    startWalk(sim, eid, { sum: true, slot, x, y, target: far, targetSerial: Unit.serial[far]! });
    return 'range';
  }
  cancelRecall(sim, eid);
  const setup = sim.config.players.find((p) => p.slot === Unit.slot[eid]);
  a.sumCdTotal[slot] = sec(setup?.summonerCd?.[id] ?? summonerCooldown(sim, id));
  a.sumCdUntil[slot] = sim.tick + a.sumCdTotal[slot]!;
  return null;
}

// ------------------------------------------------------------------ HUD

/** Q W E R then D F. */
export function abilityHud(sim: Sim, eid: number): AbilityHud[] {
  if (eid < 0 || sim.c.Unit.kind[eid] !== Kind.Champion) return [];
  const a = champAbil(sim, eid);
  const d = championData(champIdOf(sim, eid));
  const out: AbilityHud[] = d.abilities.map((ab, slot) => {
    const rank = a.ranks[slot]!;
    return {
      id: ab.id,
      rank,
      maxRank: maxRank(slot),
      cdLeft: Math.max(0, a.cdUntil[slot]! - sim.tick) / 30,
      cdTotal: (a.cdTotal[slot] || sec(rv(ab.cooldown, Math.max(1, rank)))) / 30,
      cost: rv(ab.cost, Math.max(1, rank)),
      canLevel: canLevelSlot(sim, eid, slot),
    };
  });
  for (let i = 0; i < 2; i++) {
    const def = summonerDef(a.sums[i]!);
    out.push({
      id: a.sums[i]!,
      rank: def && !def.todo ? 1 : 0,
      maxRank: 1,
      cdLeft: Math.max(0, a.sumCdUntil[i]! - sim.tick) / 30,
      cdTotal: (a.sumCdTotal[i] || sec(summonerCooldown(sim, a.sums[i]!))) / 30,
      cost: 0,
      canLevel: false,
    });
  }
  return out;
}
