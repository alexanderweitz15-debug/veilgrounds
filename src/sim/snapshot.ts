// Fog-filtered view of the sim for one team. This is the ONLY thing render/HUD (and later bots) may read.

import { query } from 'bitecs';
import type { Sim } from './sim';
import { pointVisible, sees } from './vision';
import { Kind, VARIANTS, enemyOf, isStructure, type SimEvent, type Variant } from './types';
import { abilityHud, armedSlot, type AbilityHud } from './systems/abilities';
import { CHAMPION_DATA, championHooks, champIdOf } from './champions';
import type { ChampionVisuals, HintMarker, VisualShape } from './champions/hooks';
import { inFountain, inventory, itemValue } from './items/inventory';
import { itemCooldownHud } from './items/itemHooks';
import { champions, kda } from './systems/economy';
import { buffs, isRevealed } from './buffs';
import { groundObjects } from './summons';
import { isStealthUnit, stealthPointSeen, trinketHud, trueSight, trueSightAreas, wardTypeOf, type TrinketId, type WardType } from './wards';
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
  /**
   * Current auto-attack / chase target (minion and tower target choice included); -1 = none or a unit this team cannot
   * see (masked: no eid leaks).
   */
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
  /**
   * Stealthed unit (Schleierward). Own team: hidden from the enemy unless revealed. Enemy team: it is in this view only
   * because it is revealed (Siegelward / Suchfeuer / Spaehfrucht / Nyx R): attackable, own minimap symbol.
   */
  stealth?: true;
  /** Own team only: vision radius of jungle vision points (river vision, Spähfrucht), for the fog overlay. */
  sight?: number;
  /** Outer towers: plates left (5 -> 0; all fall at 14:00). Public, both teams. */
  plates?: number;
  /** Enemy unit under a reveal of this team (Mira W, Nyx seed / R, Tobin E, Spaehfrucht, Siegelward / Suchfeuer). */
  revealed?: true;
  /** Own unit currently revealed to the enemy team (LoL "revealed" indicator; own wards under enemy true sight). */
  exposed?: true;
  /** Monster / plant type (types.ts VARIANTS): sprite and name. */
  variant?: Variant;
  /** Marks / stack counters on this unit (hook marks + 'mark' buffs): pips above the health bar. */
  marks?: SnapMark[];
  /** Next auto is empowered (armNextAuto or a hook state): weapon glow. */
  emp?: boolean;
  /** Ability self-buffs / shields / unstoppable from champion abilities (buff ids like 'vessa_e'): aura ring. */
  auras?: string[];
}

export interface SnapMark {
  id: string;
  n?: number;
  max?: number;
  /** Seconds left. */
  left?: number;
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
  /** World markers of the own champion's abilities (Renn E onto blades, Isolde E recast dash range). */
  hints?: HintMarker[];
  /** Passive badge state (stacks / cooldown seconds / ready). */
  passive?: { stacks?: number; max?: number; cdLeft?: number; cdTotal?: number; ready?: boolean };
  stats: { ad: number; ap: number; armor: number; mr: number; as: number; ms: number; range: number; crit: number };
}

/** Ground objects from hooks (Renn blades, Nyx seeds, Grimald traps). Hidden ones only for the owner's team. */
export interface SnapObject {
  /** Ground object id (summons.ts); -1 for hook visual objects (then `key` identifies them). */
  id: number;
  key?: string;
  tag: string;
  team: number;
  x: number;
  y: number;
  r: number;
  /** Hook visual objects: shape, line end (or a followed unit), timer (seconds), count, hue. */
  shape?: VisualShape;
  x2?: number;
  y2?: number;
  follow?: number;
  left?: number;
  total?: number;
  n?: number;
  hue?: number;
  /** Stealthed ground object (Nyx seed, Grimald trap). Own team: hidden from the enemy; enemy team: revealed. */
  stealth?: true;
}

/** Lifetime (seconds) of ground object tags with a fixed duration: timer arc in the render. */
const OBJECT_TOTAL: Record<string, number> = { renn_blade: 4 };

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
  /** Kesselbrut stacks of both teams [blue, red] (public like LoL void grubs); absent while both are 0. */
  kesselbrutTeams?: [number, number];
  /** Active true-sight areas of the viewing team (own Siegelward circles, running Suchfeuer sweeps); absent if none. */
  reveals?: SnapReveal[];
}

/** One own true-sight area (stealth rules, wards.ts). */
export interface SnapReveal {
  kind: 'seal' | 'sweep';
  x: number;
  y: number;
  r: number;
  /** Sweeps: tick the sweep ends. */
  until?: number;
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

/** Reveal state of a visible unit: enemy under this team's reveal, or own unit revealed to the enemy. */
function revealFields(sim: Sim, e: number, team: number, alive: boolean): { revealed?: true; exposed?: true } {
  if (!alive || (team !== 0 && team !== 1)) return {};
  const t = sim.c.Unit.team[e]!;
  if (t === team) return isRevealed(sim, enemyOf(team), e) ? { exposed: true } : {};
  return isRevealed(sim, team, e) ? { revealed: true } : {};
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
      ...(k === Kind.Ward && isStealthUnit(sim, e) ? { stealth: true as const } : {}),
      ...(k === Kind.Tower && sim.c.Tower.tier[e] === 0 ? { plates: sim.c.Tower.plates[e]! } : {}),
      ...revealFields(sim, e, team, alive),
      ...(Unit.variant[e] ? { variant: VARIANTS[Unit.variant[e]!] } : {}),
    });
  }
  // no eid leaks: an attack / chase target outside this view is masked
  const inView = new Set<number>();
  for (const s of entities) inView.add(s.id);
  for (const s of entities) if (s.atkTarget >= 0 && !inView.has(s.atkTarget)) s.atkTarget = -1;
  addVisuals(sim, team, me0(sim, slot), entities);
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
    // stealthed objects (seeds, traps): enemies only under true sight or a lingering reveal (wards.ts stealth rules)
    if (o.team !== team && (o.stealth ? (team === 0 || team === 1) && !stealthPointSeen(sim, team, o.x, o.y, o.r, o.revealUntil[team]) : !pointVisible(sim, team, o.x, o.y))) continue;
    objects.push({ id: o.id, tag: o.tag, team: o.team, x: o.x, y: o.y, r: o.r, ...(o.until < 1 << 29 ? { left: (o.until - sim.tick) / 30, ...(OBJECT_TOTAL[o.tag] ? { total: OBJECT_TOTAL[o.tag] } : {}) } : {}), ...(o.stealth ? { stealth: true as const } : {}) });
  }
  const vis = visualsCache;
  for (const [e, v] of vis) {
    const own = Unit.team[e] === team;
    for (const o of v.objects ?? []) {
      if (!own && (o.hidden || !pointVisible(sim, team, o.x, o.y))) continue;
      // no eid leaks: an enemy line following a unit in the fog keeps only its anchor
      const follow = o.follow !== undefined && (own || entities.some((s) => s.id === o.follow)) ? o.follow : undefined;
      objects.push({
        id: -1, key: `${o.tag}:${o.key}`, tag: o.tag, team: Unit.team[e]!, x: o.x, y: o.y, r: o.r, shape: o.shape,
        ...(o.x2 !== undefined ? { x2: o.x2, y2: o.y2 } : {}), ...(follow !== undefined ? { follow } : {}),
        ...(o.left !== undefined ? { left: o.left / 30, total: (o.total ?? o.left) / 30 } : {}), ...(o.n !== undefined ? { n: o.n } : {}), ...(o.hue !== undefined ? { hue: o.hue } : {}),
      });
    }
    if (hud && e === me) {
      if (v.hints?.length) hud.hints = v.hints;
      if (v.passive) {
        const p = v.passive;
        hud.passive = { ...(p.stacks !== undefined ? { stacks: p.stacks, max: p.max } : {}), ...(p.cdTotal ? { cdLeft: Math.max(0, p.cdLeft ?? 0) / 30, cdTotal: p.cdTotal / 30 } : {}), ...(p.ready !== undefined ? { ready: p.ready } : {}) };
      }
    }
  }
  vis.clear();
  const trainer = trainerHud(sim);
  const kessel = kesselbrutStacks(sim, team);
  const kt: [number, number] = [kesselbrutStacks(sim, 0), kesselbrutStacks(sim, 1)];
  const reveals = trueSightAreas(sim, team);
  return {
    tick: sim.tick, time: sim.tick / 30, team, entities, projectiles, objects, me: hud, events, audio, players: scoreRows(sim, team),
    ...(trainer ? { trainer } : {}), ...(kessel ? { kesselbrut: kessel } : {}), ...(kt[0] || kt[1] ? { kesselbrutTeams: kt } : {}),
    ...(reveals.length ? { reveals } : {}),
  };
}

/** Visuals of the snapshot being built (champion eid -> visuals); module scratch, cleared after each build. */
const visualsCache = new Map<number, ChampionVisuals>();
const me0 = (sim: Sim, slot: number): number => sim.slots[slot] ?? -1;
let champPrefixes: Set<string> | null = null;
const SLOT_KEY = ['q', 'w', 'e', 'r', 'p'];

/** Ability buffs worth an aura: positive stat buffs, shields, unstoppable, from a champion ability/passive id. */
function auraIds(sim: Sim, e: number): string[] {
  champPrefixes ??= new Set(Object.keys(CHAMPION_DATA));
  let out: string[] | null = null;
  for (const b of buffs(sim, e)) {
    if (b.until <= sim.tick) continue;
    const ok = b.kind === 'shield' ? b.amount > 0 : b.kind === 'unstoppable' || (b.kind === 'stat' && b.stat !== 'invisible' && b.stat !== 'untargetable' && (b.pct > 0 || b.flat > 0));
    if (!ok || !champPrefixes.has(b.id.split('_')[0]!)) continue;
    if (!(out ??= []).includes(b.id)) out.push(b.id);
  }
  return out ?? [];
}

/**
 * Hook visuals (ChampionHooks.visuals), marks, empowered autos and ability auras onto the visible entities. Read-only:
 * hooks must not create state. Marks/auras only reach units already in this team's view (fog-safe).
 */
function addVisuals(sim: Sim, team: number, me: number, entities: SnapEntity[]): void {
  const { Unit } = sim.c;
  const byId = new Map<number, SnapEntity>();
  for (const s of entities) byId.set(s.id, s);
  visualsCache.clear();
  for (const e of champions(sim)) {
    const v = championHooks(champIdOf(sim, e)).visuals?.(sim, e);
    if (!v) continue;
    visualsCache.set(e, v);
    for (const m of v.marks ?? []) {
      const s = byId.get(m.target);
      if (!s || !s.alive) continue;
      (s.marks ??= []).push({ id: m.id, ...(m.n !== undefined ? { n: m.n, max: m.max } : {}), ...(m.left !== undefined ? { left: m.left / 30 } : {}) });
    }
    const s = byId.get(e);
    if (s?.alive && v.empowered !== undefined) s.emp = true;
    if (s?.alive && v.aura !== undefined) (s.auras ??= []).push(`${champIdOf(sim, e)}_${SLOT_KEY[v.aura] ?? 'p'}`);
    if (e !== me || Unit.team[e] !== team) {
      delete v.hints;
      delete v.passive;
    }
  }
  champPrefixes ??= new Set(Object.keys(CHAMPION_DATA));
  for (const s of entities) {
    if (!s.alive || s.kind === Kind.Tower || s.kind === Kind.Ward || isStructure(s.kind)) continue;
    if (s.kind === Kind.Champion && armedSlot(sim, s.id) >= 0) s.emp = true;
    for (const b of buffs(sim, s.id)) {
      if (b.kind === 'mark' && b.until > sim.tick && champPrefixes!.has(b.id.split('_')[0]!)) (s.marks ??= []).push({ id: b.id, left: (b.until - sim.tick) / 30 });
    }
    const a = auraIds(sim, s.id);
    if (a.length) s.auras = s.auras ? [...new Set([...s.auras, ...a])] : a;
  }
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
        // stealthed zones (Lysa E wire): enemies only under true sight at the moment it is placed
        if (ev.team === team) return true;
        return ev.stealth && (team === 0 || team === 1) ? trueSight(sim, team, ev.x, ev.y, ev.r) : pointVisible(sim, team, ev.x, ev.y);
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
