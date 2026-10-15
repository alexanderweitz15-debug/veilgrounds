// Data-driven ability engine (schema: src/sim/champions/schema.ts) + summoner spells.
// Abilities execute generically from data; champion specifics via { kind: 'hook' } + passive hooks.
// Cast flow: castAbility (input system) checks rank/cooldown/cost/CC, pays, starts the wind-up (champion stands
// still: stats sets ms 0 while busy) -> abilities.update resolves at wind-up end. castTime 0 resolves at once.
// Conventions: data seconds -> ticks via sec(); pct = percent points; Scaling ratios are fractions (1.0 = 100 %).
// Effects apply in data order (e.g. stasis before damage makes the target invulnerable to that damage).
// ponytail: flags recast/channel and type summon have no generic behaviour yet (summon resolves effects at the
// target point, so hooks can spawn units); 'invisible' buffs are stored but vision.ts ignores them. Phase 2.

import { query } from 'bitecs';
import type { Sim } from '../sim';
import type { System } from './index';
import { DT, Kind, isStructure, sec } from '../types';
import { dealDamage } from '../damage';
import { dir, dist2, inCone, cosDeg } from '../vec';
import { findPath, nearestWalkable, walkable } from '../map';
import { addBuff, addShield, canCast, canMove, healUnit, reveal, type StatKey } from '../buffs';
import { championData, championHooks, champIdOf, passiveHooksOf } from '../champions';
import type { AbilityData, Effect, EffectTarget, Ranked, Scaling } from '../champions/schema';
import type { EffectCtx } from '../champions/hooks';
import { onMoveCommand } from './attack';
import { spawnProjectile } from './projectiles';
import { baseMaxHp } from './stats';
import { cancelRecall } from './economy';
import { castSummonerSpell, summonerDef } from '../summoners';

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
}

interface CastState {
  slot: number;
  rank: number;
  x: number;
  y: number;
  target: number;
  end: number;
  cost: number;
  prevCdUntil: number;
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
}

interface Zone {
  caster: number;
  casterSerial: number;
  slot: number;
  rank: number;
  x: number;
  y: number;
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

/** Casting (wind-up), dashing or being displaced: no movement, no autos. */
export function isBusy(sim: Sim, eid: number): boolean {
  const s = sim.state.abilities as AbilState | undefined;
  if (!s) return false;
  const m = s.moves.get(eid);
  if (m && m.serial === sim.c.Unit.serial[eid]) return true;
  const a = s.champs.get(eid);
  return !!a && a.serial === sim.c.Unit.serial[eid] && a.cast !== null;
}

const abilityOf = (sim: Sim, eid: number, slot: number): AbilityData => championData(champIdOf(sim, eid)).abilities[slot]!;

// ------------------------------------------------------------------ casting

export function castAbility(sim: Sim, eid: number, slot: number, x: number, y: number, target?: number): void {
  const { Unit, Mana, Hp, Stats } = sim.c;
  if (!Unit.alive[eid] || Unit.kind[eid] !== Kind.Champion || slot < 0 || slot > 3) return;
  const a = champAbil(sim, eid);
  const ab = abilityOf(sim, eid, slot);
  const rank = a.ranks[slot]!;
  if (rank === 0 || a.cast || isBusy(sim, eid) || sim.tick < a.cdUntil[slot]! || !canCast(sim, eid)) return;
  if ((ab.type === 'dash' || ab.type === 'blink') && !canMove(sim, eid)) return;
  const cost = rv(ab.cost, rank);
  if (ab.costType === 'mana' || ab.costType === 'energy') {
    if (Mana.cur[eid]! < cost) return;
  } else if (ab.costType === 'hp' && Hp.cur[eid]! <= cost) return;
  let tgt = -1;
  if (ab.type === 'targeted') {
    tgt = pickTarget(sim, eid, ab, rank, x, y, target);
    if (tgt < 0) return; // ponytail: LoL walks into range first; here an out-of-range cast is rejected
  }
  // pay + cooldown at cast start (refunded if interrupted during the wind-up)
  if (ab.costType === 'mana' || ab.costType === 'energy') Mana.cur[eid] = Mana.cur[eid]! - cost;
  else if (ab.costType === 'hp') Hp.cur[eid] = Hp.cur[eid]! - cost;
  const prevCdUntil = a.cdUntil[slot]!;
  a.cdTotal[slot] = Math.round((sec(rv(ab.cooldown, rank)) * 100) / (100 + Stats.haste[eid]!));
  a.cdUntil[slot] = sim.tick + a.cdTotal[slot]!;
  cancelRecall(sim, eid);
  sim.events.push({ e: 'cast', src: eid, slot, x, y });
  face(sim, eid, x, y);
  // instant self-casts (e.g. AS steroids) do not interrupt an auto; everything else does
  if (ab.castTime > 0 || ab.type !== 'self') onMoveCommand(sim, eid);
  if (ab.flags?.includes('unstoppable')) addBuff(sim, eid, { kind: 'unstoppable', id: ab.id, src: eid, ticks: sec(ab.castTime) + 1 });
  if (ab.castTime > 0) {
    a.cast = { slot, rank, x, y, target: tgt, end: sim.tick + sec(ab.castTime), cost, prevCdUntil };
  } else {
    execute(sim, eid, slot, rank, x, y, tgt);
  }
}

function pickTarget(sim: Sim, eid: number, ab: AbilityData, rank: number, x: number, y: number, target?: number): number {
  const { Unit, Pos } = sim.c;
  const ally = ab.flags?.includes('ally_target') ?? false;
  const ok = (t: number): boolean =>
    t >= 0 &&
    !!Unit.alive[t] &&
    !Unit.untargetable[t] &&
    Unit.kind[t] !== Kind.Projectile &&
    !isStructure(Unit.kind[t]!) &&
    (ally ? Unit.team[t] === Unit.team[eid] && t !== eid : Unit.team[t] !== Unit.team[eid]) &&
    within(sim, eid, t, rv(ab.range, rank));
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

/** Cast resolution (wind-up over). */
function execute(sim: Sim, eid: number, slot: number, rank: number, x: number, y: number, target: number): void {
  const { Pos, Face, Unit, Atk } = sim.c;
  const ab = abilityOf(sim, eid, slot);
  const ox = Pos.x[eid]!;
  const oy = Pos.y[eid]!;
  let [dx, dy] = dir(ox, oy, x, y);
  if (dx === 0 && dy === 0) [dx, dy] = [Face.x[eid]!, Face.y[eid]!];
  const range = rv(ab.range, rank);
  const cursorDist = Math.sqrt(dist2(x, y, ox, oy));
  const ctx = (hits: number[], cx: number, cy: number, t = target): EffectCtx => ({ caster: eid, slot, rank, ability: ab, hits, x: cx, y: cy, target: t });
  const payload = (): AbilityPayload => ({ t: 'ability', caster: eid, casterSerial: Unit.serial[eid]!, slot, rank, flags: ab.flags ?? [], hit: [] });

  if (ab.flags?.includes('auto_reset')) Atk.nextReady[eid] = sim.tick;
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
      const delay = sec(ab.delay ?? 0);
      const dur = ab.type === 'zone' ? sec(rv(ab.duration, rank)) : 0;
      if (delay > 0 || dur > 0) {
        // ponytail: persistent zones re-apply their effects once per second (damage values are per tick)
        abilState(sim).zones.push({ caster: eid, casterSerial: Unit.serial[eid]!, slot, rank, x: cx, y: cy, next: sim.tick + delay, until: sim.tick + delay + dur, period: sec(1) });
        sim.events.push({ e: 'zone', src: eid, team: Unit.team[eid]!, x: cx, y: cy, r: ab.radius ?? 0, start: sim.tick, at: sim.tick + delay });
      } else {
        resolve(sim, ctx(enemiesIn(sim, eid, cx, cy, ab.radius ?? 0), cx, cy));
      }
      break;
    }
    case 'cone': {
      const cosHalf = cosDeg((ab.angle ?? 60) / 2);
      const hits = unitsWhere(sim, (e) => isEnemyUnit(sim, eid, e) && inCone(Pos.x[e]!, Pos.y[e]!, ox, oy, dx, dy, cosHalf, range + Unit.radius[e]!));
      resolve(sim, ctx(hits, ox, oy));
      break;
    }
    case 'targeted':
      if (!Unit.alive[target]) break;
      if (ab.speed) spawnProjectile(sim, { kind: 2, src: eid, team: Unit.team[eid]!, x: ox, y: oy, target, speed: ab.speed, width: ab.width ?? 0, payload: payload() });
      else resolve(sim, ctx([target], Pos.x[target]!, Pos.y[target]!));
      break;
    case 'self':
      resolve(sim, ctx(ab.radius ? enemiesIn(sim, eid, ox, oy, ab.radius) : [], ox, oy));
      break;
    case 'dash': {
      const dist = ab.flags?.includes('ground_target') ? Math.min(ab.distance ?? range, cursorDist) : (ab.distance ?? range);
      const speed = ab.speed ?? 1200;
      if (ab.flags?.includes('unstoppable')) addBuff(sim, eid, { kind: 'unstoppable', id: ab.id, src: eid, ticks: Math.ceil((dist / speed) * 30) + 1 });
      abilState(sim).moves.set(eid, { serial: Unit.serial[eid]!, dx, dy, speed, left: dist, slot, rank });
      break;
    }
    case 'blink': {
      const p = landingPoint(sim, ox, oy, ox + dx * Math.min(range, cursorDist), oy + dy * Math.min(range, cursorDist));
      teleport(sim, eid, p.x, p.y);
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
  resolve(sim, { caster: p.caster, slot: p.slot, rank: p.rank, ability: ab, hits: [t], x, y, target: t });
}

function resolve(sim: Sim, ctx: EffectCtx): void {
  for (const eff of ctx.ability.effects) applyEffect(sim, ctx, eff);
}

function isEnemyUnit(sim: Sim, eid: number, e: number): boolean {
  const { Unit } = sim.c;
  const k = Unit.kind[e]!;
  return !!Unit.alive[e] && !Unit.untargetable[e] && Unit.team[e] !== Unit.team[eid] && k !== Kind.Projectile && k !== Kind.Ward && !isStructure(k);
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

function alliedChampsIn(sim: Sim, eid: number, x: number, y: number, r: number): number[] {
  const { Pos, Unit } = sim.c;
  return unitsWhere(sim, (e) => !!Unit.alive[e] && Unit.kind[e] === Kind.Champion && Unit.team[e] === Unit.team[eid] && dist2(Pos.x[e]!, Pos.y[e]!, x, y) <= r * r);
}

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

function applyEffect(sim: Sim, ctx: EffectCtx, eff: Effect): void {
  const { caster, rank, ability: ab } = ctx;
  if (eff.kind === 'hook') {
    const h = championHooks(champIdOf(sim, caster)).effects?.[eff.id];
    h?.(sim, ctx);
    return;
  }
  const targets = targetsOf(sim, ctx, eff.target ?? 'hit');
  for (const t of targets) {
    if (!sim.c.Unit.alive[t]) continue;
    switch (eff.kind) {
      case 'damage':
        dealDamage(sim, caster, t, scaleAmount(sim, eff.amount, caster, t, rank), eff.type);
        break;
      case 'heal':
        healUnit(sim, t, scaleAmount(sim, eff.amount, caster, t, rank));
        break;
      case 'shield':
        addShield(sim, t, scaleAmount(sim, eff.amount, caster, t, rank), sec(eff.duration), ab.id, caster);
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

/** Knockback (distance > 0, away from caster) or pull (< 0, toward caster). Airborne while displaced. */
const DISPLACE_SPEED = 1200;
function displace(sim: Sim, caster: number, t: number, distance: number): void {
  if (t === caster || isStructure(sim.c.Unit.kind[t]!)) return;
  const { Pos, Unit } = sim.c;
  let [dx, dy] = dir(Pos.x[caster]!, Pos.y[caster]!, Pos.x[t]!, Pos.y[t]!);
  if (dx === 0 && dy === 0) [dx, dy] = [sim.c.Face.x[caster]!, sim.c.Face.y[caster]!];
  let d = Math.abs(distance);
  if (distance < 0) {
    [dx, dy] = [-dx, -dy];
    const gap = Math.sqrt(dist2(Pos.x[t]!, Pos.y[t]!, Pos.x[caster]!, Pos.y[caster]!)) - Unit.radius[t]! - Unit.radius[caster]!;
    d = Math.max(0, Math.min(d, gap));
  }
  if (d <= 0) return;
  if (!addBuff(sim, t, { kind: 'airborne', id: 'displace', src: caster, ticks: Math.ceil((d / DISPLACE_SPEED) * 30) + 1 })) return;
  abilState(sim).moves.set(t, { serial: Unit.serial[t]!, dx, dy, speed: DISPLACE_SPEED, left: d, slot: -1, rank: 0 });
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
    const step = Math.min(m.speed * DT, m.left);
    const nx = Pos.x[eid]! + m.dx * step;
    const ny = Pos.y[eid]! + m.dy * step;
    const blocked = !walkable(sim.map.nav, nx, ny);
    if (!blocked) {
      Pos.x[eid] = nx;
      Pos.y[eid] = ny;
      m.left -= step;
    }
    if (blocked || m.left <= 1e-9) {
      s.moves.delete(eid);
      teleport(sim, eid, Pos.x[eid]!, Pos.y[eid]!); // repath any pending move from the new spot
      if (m.slot >= 0) {
        const ab = abilityOf(sim, eid, m.slot);
        resolve(sim, { caster: eid, slot: m.slot, rank: m.rank, ability: ab, hits: ab.radius ? enemiesIn(sim, eid, Pos.x[eid]!, Pos.y[eid]!, ab.radius) : [], x: Pos.x[eid]!, y: Pos.y[eid]!, target: -1 });
      }
    }
  }
}

// ------------------------------------------------------------------ system

export const abilitiesSystem: System = {
  name: 'abilities',
  update(sim) {
    const s = abilState(sim);
    const { Unit, Mana, Hp } = sim.c;
    for (const [eid, a] of s.champs) {
      const c = a.cast;
      if (!c) continue;
      if (a.serial !== Unit.serial[eid] || !Unit.alive[eid] || !canCast(sim, eid)) {
        // interrupted during wind-up: refund cost and cooldown
        a.cast = null;
        const ab = abilityOf(sim, eid, c.slot);
        if (ab.costType === 'mana' || ab.costType === 'energy') Mana.cur[eid] = Mana.cur[eid]! + c.cost;
        else if (ab.costType === 'hp') Hp.cur[eid] = Hp.cur[eid]! + c.cost;
        a.cdUntil[c.slot] = c.prevCdUntil;
        continue;
      }
      if (sim.tick >= c.end) {
        a.cast = null;
        execute(sim, eid, c.slot, c.rank, c.x, c.y, c.target);
      }
    }
    stepMoves(sim);
    // delayed / persistent ground effects
    const keep: Zone[] = [];
    for (const z of s.zones) {
      if (sim.tick >= z.next) {
        if (Unit.serial[z.caster] === z.casterSerial) {
          const ab = abilityOf(sim, z.caster, z.slot);
          resolve(sim, { caster: z.caster, slot: z.slot, rank: z.rank, ability: ab, hits: enemiesIn(sim, z.caster, z.x, z.y, ab.radius ?? 0), x: z.x, y: z.y, target: -1 });
        }
        z.next += z.period;
      }
      if (z.next <= z.until && Unit.serial[z.caster] === z.casterSerial) keep.push(z);
    }
    s.zones = keep;
  },
};

// ------------------------------------------------------------------ summoners

export function castSummoner(sim: Sim, eid: number, slot: number, x: number, y: number, target?: number): void {
  const { Unit } = sim.c;
  if (!Unit.alive[eid] || Unit.kind[eid] !== Kind.Champion || (slot !== 0 && slot !== 1)) return;
  const a = champAbil(sim, eid);
  const id = a.sums[slot]!;
  const def = summonerDef(id);
  if (!def || def.todo || sim.tick < a.sumCdUntil[slot]!) return;
  if (!castSummonerSpell(sim, eid, id, x, y, target)) return;
  cancelRecall(sim, eid);
  const setup = sim.config.players.find((p) => p.slot === Unit.slot[eid]);
  a.sumCdTotal[slot] = sec(setup?.summonerCd?.[id] ?? def.cooldown);
  a.sumCdUntil[slot] = sim.tick + a.sumCdTotal[slot]!;
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
      cdTotal: (a.sumCdTotal[i] || sec(def?.cooldown ?? 0)) / 30,
      cost: 0,
      canLevel: false,
    });
  }
  return out;
}

