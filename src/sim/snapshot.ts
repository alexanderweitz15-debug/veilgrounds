// Fog-filtered view of the sim for one team. This is the ONLY thing render/HUD (and later bots) may read.

import { query } from 'bitecs';
import type { Sim } from './sim';
import { pointVisible, sees } from './vision';
import { Kind, VARIANTS, isStructure, type SimEvent, type Variant } from './types';
import { abilityHud, type AbilityHud } from './systems/abilities';
import { inFountain, inventory, itemValue } from './items/inventory';
import { itemCooldownHud } from './items/itemHooks';
import { champions, kda } from './systems/economy';
import { buffs } from './buffs';
import { groundObjects } from './summons';
import { trinketHud, wardTypeOf, type TrinketId, type WardType } from './wards';
import { ccLevel, ccState } from './buffs';
import { attackStartTick } from './systems/attack';
import { projectileSource } from './systems/projectiles';
import { walkedLastTick } from './systems/movement';
import { teleportLeft } from './summoners';
import { trainerHud, type TrainerHud } from './trainer';
import { sandboxFlags } from './trainer/sandbox';
import { kesselbrutStacks } from './systems/jungle';

export interface SnapEntity {
  id: number;
  serial: number;
  kind: number;
  team: number;
  x: number;
  y: number;
  /** Previous tick position for interpolation. */
  px: number;
  py: number;
  fx: number;
  fy: number;
  hp: number;
  maxHp: number;
  shield: number;
  mana: number;
  maxMana: number;
  radius: number;
  level: number;
  /** Champion id or null. */
  champ: string | null;
  slot: number;
  /** 0 idle, 1 windup, 2 backswing. */
  atkPhase: number;
  atkTarget: number;
  /**
   * Auto-attack timing (sim ticks, compare with Snapshot.tick; present while atkPhase !== 0). atkStart: tick the
   * wind-up started. atkEnd: phase 1 = wind-up end (hit point / projectile launch), phase 2 = attack timer ready
   * (end of the attack cycle). Both include item/buff attack speed: wind-up = atkEnd - atkStart in phase 1.
   */
  atkStart?: number;
  atkEnd?: number;
  /** Walked (path or chase step) during the last tick: run animation. Not set by dashes, Flash or collision pushes. */
  moving: boolean;
  /** Active crowd control as buffs.CC_BIT mask (stun 1, root 2, slow 4, silence 8, airborne 16, blind 32, suppress 64, stasis 128); absent = none. */
  cc?: number;
  /** Strongest slow in percent points (with cc & 4). */
  slow?: number;
  /** Last tick any of the active CC lasts (CC timer bar: (ccEnd - tick) / 30 s). */
  ccEnd?: number;
  alive: boolean;
  /** Player ward type (Agent J); absent for every other unit incl. jungle river vision. */
  ward?: WardType;
  /** Own team only: current vision radius of wards (0 = disabled by an enemy seal ward / sweep). */
  vision?: number;
  /** Own team only: vision radius of jungle vision points (river vision, Spähfrucht), for the fog overlay. */
  sight?: number;
  /** Monster / plant type (types.ts VARIANTS): sprite and name. */
  variant?: Variant;
}

export interface SnapProjectile {
  id: number;
  kind: number;
  team: number;
  x: number;
  y: number;
  px: number;
  py: number;
  dx: number;
  dy: number;
  width: number;
  /** Line skillshots (kind 1): distance left to max range (telegraph strip ahead of the projectile). */
  left?: number;
  // Source info (render: missile look per unit/champion/ability). Always set by the sim; optional for mocks/fixtures.
  /** Unit kind of the source at launch (types.ts Kind; 0 = no unit, e.g. trainer shots). Survives the source's death. */
  srcKind?: number;
  /** Champion id when a champion fired it, else null. */
  champ?: string | null;
  /** -1 = basic attack (or non-ability shot), 0..3 = ability Q/W/E/R. */
  slot?: number;
}

export interface PlayerHud {
  eid: number;
  champ: string;
  level: number;
  xp: number;
  gold: number;
  /** All gold earned incl. start and passive gold (post-game gold curve). */
  totalGold?: number;
  cs: number;
  dead: boolean;
  respawnIn: number;
  /** Lasting sandbox cheats of this champion (permanent cooldown reset, god mode). */
  sandbox?: { noCd: boolean; god: boolean };
  /** Agent H: 6 item slots + trinket (null = empty), shop access, active jungle/objective buffs (id, seconds left). */
  items: (string | null)[];
  /** Item active cooldown per slot (same indices as items; seconds, total 0 = no active). Agent I. */
  itemCds: { left: number; total: number }[];
  inFountain: boolean;
  marks: { id: string; left: number }[];
  /** Trinket (Agent J): charges / cooldown (seconds) and which trinket a swap would give right now (null = none). */
  trinket?: { id: TrinketId; charges: number; maxCharges: number; cdLeft: number; cdTotal: number; canSwap: TrinketId | null };
  /** Strongest own CC: 0 none, 1 slow, 2 blind/silence, 3 root, 4 stun/airborne, 5 suppression/stasis (bots: Cleanse). */
  cc?: number;
  /** Teleport channel seconds left (0 = none). */
  teleportLeft?: number;
  recallLeft: number;
  abilities: AbilityHud[];
  stats: { ad: number; ap: number; armor: number; mr: number; as: number; ms: number; range: number; crit: number };
}

/** Ground objects from hooks (Renn blades, Nyx seeds, Grimald traps). Hidden ones only for the owner's team. */
export interface SnapObject {
  id: number;
  tag: string;
  team: number;
  x: number;
  y: number;
  r: number;
}

/** Tags enemies never see (invisible traps/seeds); everything else follows normal vision. */
const HIDDEN_OBJECT_TAGS = new Set(['grimald_trap', 'nyx_seed']);

export interface Snapshot {
  tick: number;
  time: number;
  team: number;
  entities: SnapEntity[];
  projectiles: SnapProjectile[];
  objects: SnapObject[];
  me: PlayerHud | null;
  events: SimEvent[];
  /**
   * Audio cues (Agent L, spec-bots §3): enemy ability casts the team does NOT see, within AUDIO_RANGE of an alive
   * allied champion. Intended information like a player hearing a cast sound in the fog, not a vision leak: caster
   * position snapped to an AUDIO_BLUR grid, cast direction only, no HP/level/target. Optional for older fixtures.
   */
  audio?: SnapAudio[];
  /** Bots only (BotRunner buffers events between decisions): tick of each entry in `events` (same indices). */
  eventTicks?: number[];
  /** Scoreboard rows for all champions (Agent H). Fog-safe: enemies show item value, never gold or items. */
  players: ScoreRow[];
  /** Running trainer (Phase 5), absent outside trainers. */
  trainer?: TrainerHud;
  /** Kesselbrut stacks of the viewing team (0-6, HUD indicator); absent while 0 and for spectators. */
  kesselbrut?: number;
}

/** One heard (unseen) enemy cast; shape matches PerceptionView.audio in src/ai/contract.ts. */
export interface SnapAudio {
  slot: number;
  abilitySlot: number;
  /** Caster position snapped to AUDIO_BLUR. */
  x: number;
  y: number;
  /** Unit cast direction (2 decimals). */
  dx: number;
  dy: number;
  tick: number;
}

export interface ScoreRow {
  slot: number;
  team: number;
  champ: string;
  level: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  dead: boolean;
  /** Own team only. */
  gold?: number;
  items?: (string | null)[];
  /** Sum of item costs (both teams). */
  itemValue: number;
}

function scoreRows(sim: Sim, team: number): ScoreRow[] {
  const { Unit, Champ } = sim.c;
  return champions(sim).map((e) => {
    const [kills, deaths, assists] = kda(sim, e);
    const own = Unit.team[e] === team;
    return {
      slot: Unit.slot[e]!,
      team: Unit.team[e]!,
      champ: sim.championIds[Unit.champ[e]!] ?? '',
      level: Champ.level[e]!,
      kills,
      deaths,
      assists,
      cs: Champ.cs[e]!,
      dead: Unit.alive[e] !== 1,
      ...(own ? { gold: Math.floor(Champ.gold[e]!), items: [...inventory(sim, e)] } : {}),
      itemValue: itemValue(sim, e),
    };
  });
}

function wardFields(sim: Sim, e: number, team: number): { ward?: WardType; vision?: number; sight?: number } {
  const w = wardTypeOf(sim, e);
  // jungle vision points (river vision, Spähfrucht): own team gets the radius for the fog overlay
  if (!w) return sim.c.Unit.team[e] === team ? { sight: sim.c.Vision.r[e]! } : {};
  return sim.c.Unit.team[e] === team ? { ward: w, vision: sim.c.Vision.r[e]! } : { ward: w };
}

/** CC state of a visible unit (fog-safe: only called for entities already in the team's view). */
function ccFields(sim: Sim, e: number, alive: boolean): { cc?: number; slow?: number; ccEnd?: number } {
  if (!alive) return {};
  const s = ccState(sim, e);
  if (!s.mask) return {};
  return { cc: s.mask, ccEnd: s.until, ...(s.slow > 0 ? { slow: s.slow } : {}) };
}

export function buildSnapshot(sim: Sim, team: number, slot: number): Snapshot {
  const { Unit, Pos, Face, Hp, Mana, Champ, Atk, Proj } = sim.c;
  const entities: SnapEntity[] = [];
  for (const e of query(sim.world, [Unit])) {
    const k = Unit.kind[e]!;
    const alive = Unit.alive[e] === 1;
    const visible = Unit.team[e] === team || isStructure(k) || (alive && sees(sim, team, e));
    if (!visible) continue;
    const ci = Unit.champ[e]!;
    entities.push({
      id: e,
      serial: Unit.serial[e]!,
      kind: k,
      team: Unit.team[e]!,
      x: Pos.x[e]!,
      y: Pos.y[e]!,
      px: Pos.px[e]!,
      py: Pos.py[e]!,
      fx: Face.x[e]!,
      fy: Face.y[e]!,
      hp: Hp.cur[e]!,
      maxHp: Hp.max[e]!,
      shield: Hp.shield[e]!,
      mana: Mana.cur[e]!,
      maxMana: Mana.max[e]!,
      radius: Unit.radius[e]!,
      level: k === Kind.Champion ? Champ.level[e]! : 0,
      champ: ci >= 0 ? sim.championIds[ci]! : null,
      slot: Unit.slot[e]!,
      atkPhase: Atk.phase[e]!,
      atkTarget: Atk.target[e]!,
      ...(Atk.phase[e] ? { atkStart: attackStartTick(sim, e), atkEnd: Atk.phaseEnd[e]! } : {}),
      moving: alive && walkedLastTick(sim, e),
      ...ccFields(sim, e, alive),
      alive,
      ...(k === Kind.Ward ? wardFields(sim, e, team) : {}),
      ...(Unit.variant[e] ? { variant: VARIANTS[Unit.variant[e]!] } : {}),
    });
  }
  const projectiles: SnapProjectile[] = [];
  for (const e of query(sim.world, [Proj])) {
    if (Proj.team[e] !== team && !pointVisible(sim, team, Pos.x[e]!, Pos.y[e]!)) continue;
    projectiles.push({ id: e, kind: Proj.kind[e]!, team: Proj.team[e]!, x: Pos.x[e]!, y: Pos.y[e]!, px: Pos.px[e]!, py: Pos.py[e]!, dx: Proj.dx[e]!, dy: Proj.dy[e]!, width: Proj.width[e]!, ...projectileSource(sim, e), ...(Proj.kind[e] === 1 ? { left: Math.max(0, Proj.maxDist[e]! - Proj.travelled[e]!) } : {}) });
  }
  const me = sim.slots[slot];
  let hud: PlayerHud | null = null;
  if (me !== undefined && me >= 0) {
    const { Stats } = sim.c;
    hud = {
      eid: me,
      champ: sim.championIds[Unit.champ[me]!] ?? '',
      level: Champ.level[me]!,
      xp: Champ.xp[me]!,
      gold: Champ.gold[me]!,
      totalGold: Champ.totalGold[me]!,
      cs: Champ.cs[me]!,
      ...(sim.state.sandbox ? { sandbox: sandboxFlags(sim, me) } : {}),
      dead: Unit.alive[me] !== 1,
      respawnIn: Unit.alive[me] ? 0 : Math.max(0, (Champ.respawnAt[me]! - sim.tick) / 30),
      recallLeft: Champ.recallAt[me]! > sim.tick ? (Champ.recallAt[me]! - sim.tick) / 30 : 0,
      abilities: abilityHud(sim, me),
      items: [...inventory(sim, me)],
      itemCds: itemCooldownHud(sim, me),
      trinket: trinketHud(sim, me),
      cc: ccLevel(sim, me),
      teleportLeft: teleportLeft(sim, me) / 30,
      inFountain: inFountain(sim, me),
      marks: buffs(sim, me).filter((b) => b.kind === 'mark' && b.until > sim.tick).map((b) => ({ id: b.id, left: (b.until - sim.tick) / 30 })),
      stats: { ad: Stats.ad[me]!, ap: Stats.ap[me]!, armor: Stats.armor[me]!, mr: Stats.mr[me]!, as: Stats.as[me]!, ms: Stats.ms[me]!, range: Stats.range[me]!, crit: Stats.crit[me]! },
    };
  }
  const te = teamEvents(sim, team);
  const audio = te.audio;
  // failed casts only for the player who issued them (no messages for teammates' / bots' attempts)
  const events = te.events.some((ev) => ev.e === 'castFail') ? te.events.filter((ev) => ev.e !== 'castFail' || ev.src === me) : te.events;
  const objects: SnapObject[] = [];
  for (const o of groundObjects(sim)) {
    if (o.team !== team && (HIDDEN_OBJECT_TAGS.has(o.tag) || !pointVisible(sim, team, o.x, o.y))) continue;
    objects.push({ id: o.id, tag: o.tag, team: o.team, x: o.x, y: o.y, r: o.r });
  }
  const trainer = trainerHud(sim);
  const kessel = kesselbrutStacks(sim, team);
  return { tick: sim.tick, time: sim.tick / 30, team, entities, projectiles, objects, me: hud, events, audio, players: scoreRows(sim, team), ...(trainer ? { trainer } : {}), ...(kessel ? { kesselbrut: kessel } : {}) };
}

/** Grid the audio cue position snaps to (units). */
export const AUDIO_BLUR = 200;
/** Audio cue range around any alive allied champion (spec-bots §3). */
export const AUDIO_RANGE = 1800;

/**
 * The current tick's events as one team may know them, plus audio cues (Agent L). Exported so the bot runner can
 * collect them every tick (events only live for one tick; bots decide every few ticks).
 */
export function teamEvents(sim: Sim, team: number): { events: SimEvent[]; audio: SnapAudio[] } {
  const { Unit, Pos } = sim.c;
  // events: drop those about entities the team cannot see
  // Events must not leak hidden enemies (strict fog of war).
  const seen = (eid: number): boolean => eid < 0 || Unit.team[eid] === team || sees(sim, team, eid);
  const audio: SnapAudio[] = [];
  for (const ev of sim.events) {
    if (ev.e !== 'cast' || ev.recast || seen(ev.src) || Unit.kind[ev.src] !== Kind.Champion) continue;
    const cx = Pos.x[ev.src]!;
    const cy = Pos.y[ev.src]!;
    if (!champions(sim).some((a) => Unit.team[a] === team && Unit.alive[a] === 1 && (Pos.x[a]! - cx) ** 2 + (Pos.y[a]! - cy) ** 2 <= AUDIO_RANGE * AUDIO_RANGE)) continue;
    const l = Math.sqrt((ev.x - cx) ** 2 + (ev.y - cy) ** 2);
    const r2 = (v: number): number => Math.round(v * 100) / 100;
    audio.push({
      slot: Unit.slot[ev.src]!,
      abilitySlot: ev.slot,
      x: Math.round(cx / AUDIO_BLUR) * AUDIO_BLUR,
      y: Math.round(cy / AUDIO_BLUR) * AUDIO_BLUR,
      dx: l > 0 ? r2((ev.x - cx) / l) : 0,
      dy: l > 0 ? r2((ev.y - cy) / l) : 0,
      tick: sim.tick,
    });
  }
  // Units that died this tick where the team could see it (own units, or a visible death point): vision is computed
  // after the kill and no longer lists them, but their killing blow (damage number, kill credit) belongs to the view.
  const dying = new Set<number>();
  for (const ev of sim.events) if (ev.e === 'death' && (ev.team === team || pointVisible(sim, team, ev.x, ev.y))) dying.add(ev.eid);
  // structures are always in the snapshot, so they are always known too
  const known = (eid: number): boolean => seen(eid) || dying.has(eid) || isStructure(Unit.kind[eid]!);
  const mask = (eid: number): number => (known(eid) ? eid : -1);
  const filtered = sim.events.filter((ev) => {
    switch (ev.e) {
      case 'damage':
        return known(ev.dst);
      case 'attack':
        return known(ev.src) || known(ev.dst);
      case 'cast':
        return seen(ev.src);
      case 'ping':
        return ev.team === team; // pings are team-only
      case 'chat':
        return ev.team === team;
      case 'castFail':
        return Unit.team[ev.src] === team; // team-private (buildSnapshot narrows it to the own champion)
      case 'zone':
        return ev.team === team || pointVisible(sim, team, ev.x, ev.y);
      case 'gold':
      case 'level':
      case 'lastHitMiss':
        return Unit.team[ev.eid] === team;
      case 'death':
        // camp kills stay in the fog (no free jungle timers); epic objectives (r >= 130) are announced like LoL
        if ((ev.kind !== Kind.Monster && ev.kind !== Kind.Plant) || Unit.radius[ev.eid]! >= 130) return true;
        return (ev.killer >= 0 && Unit.team[ev.killer] === team) || pointVisible(sim, team, ev.x, ev.y);
      default:
        return true;
    }
  });
  // Unseen units inside kept events are masked to -1 (an attacker in a bush, a killer in the fog): no eid leaks.
  // Events are shared between both teams' views, so masked ones are copies.
  const events = filtered.map((ev): SimEvent => {
    switch (ev.e) {
      case 'damage':
        return known(ev.src) ? ev : { ...ev, src: -1 };
      case 'attack':
        return known(ev.src) && known(ev.dst) ? ev : { ...ev, src: mask(ev.src), dst: mask(ev.dst) };
      case 'death':
        return known(ev.killer) ? ev : { ...ev, killer: -1 };
      case 'zone':
        return known(ev.src) ? ev : { ...ev, src: -1 };
      default:
        return ev;
    }
  });
  return { events, audio };
}
