// Fog-filtered view of the sim for one team. This is the ONLY thing render/HUD (and later bots) may read.

import { query } from 'bitecs';
import type { Sim } from './sim';
import { pointVisible, sees } from './vision';
import { Kind, isStructure, type SimEvent } from './types';
import { abilityHud, type AbilityHud } from './systems/abilities';
import { inFountain, inventory, itemValue } from './items/inventory';
import { champions, kda } from './systems/economy';
import { buffs } from './buffs';
import { groundObjects } from './summons';

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
  moving: boolean;
  alive: boolean;
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
}

export interface PlayerHud {
  eid: number;
  champ: string;
  level: number;
  xp: number;
  gold: number;
  cs: number;
  dead: boolean;
  respawnIn: number;
  /** Agent H: 6 item slots + trinket (null = empty), shop access, active jungle/objective buffs (id, seconds left). */
  items: (string | null)[];
  inFountain: boolean;
  marks: { id: string; left: number }[];
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
  /** Scoreboard rows for all champions (Agent H). Fog-safe: enemies show item value, never gold or items. */
  players: ScoreRow[];
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

export function buildSnapshot(sim: Sim, team: number, slot: number): Snapshot {
  const { Unit, Pos, Face, Hp, Mana, Champ, Atk, Move, Proj } = sim.c;
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
      moving: Move.mode[e] !== 0,
      alive,
    });
  }
  const projectiles: SnapProjectile[] = [];
  for (const e of query(sim.world, [Proj])) {
    if (Proj.team[e] !== team && !pointVisible(sim, team, Pos.x[e]!, Pos.y[e]!)) continue;
    projectiles.push({ id: e, kind: Proj.kind[e]!, team: Proj.team[e]!, x: Pos.x[e]!, y: Pos.y[e]!, px: Pos.px[e]!, py: Pos.py[e]!, dx: Proj.dx[e]!, dy: Proj.dy[e]!, width: Proj.width[e]! });
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
      cs: Champ.cs[me]!,
      dead: Unit.alive[me] !== 1,
      respawnIn: Unit.alive[me] ? 0 : Math.max(0, (Champ.respawnAt[me]! - sim.tick) / 30),
      recallLeft: Champ.recallAt[me]! > sim.tick ? (Champ.recallAt[me]! - sim.tick) / 30 : 0,
      abilities: abilityHud(sim, me),
      items: [...inventory(sim, me)],
      inFountain: inFountain(sim, me),
      marks: buffs(sim, me).filter((b) => b.kind === 'mark' && b.until > sim.tick).map((b) => ({ id: b.id, left: (b.until - sim.tick) / 30 })),
      stats: { ad: Stats.ad[me]!, ap: Stats.ap[me]!, armor: Stats.armor[me]!, mr: Stats.mr[me]!, as: Stats.as[me]!, ms: Stats.ms[me]!, range: Stats.range[me]!, crit: Stats.crit[me]! },
    };
  }
  // events: drop those about entities the team cannot see
  // Events must not leak hidden enemies (strict fog of war).
  const seen = (eid: number): boolean => eid < 0 || Unit.team[eid] === team || sees(sim, team, eid);
  const events = sim.events.filter((ev) => {
    switch (ev.e) {
      case 'damage':
        return seen(ev.dst);
      case 'attack':
        return seen(ev.src) || seen(ev.dst);
      case 'cast':
        return seen(ev.src);
      case 'zone':
        return ev.team === team || pointVisible(sim, team, ev.x, ev.y);
      case 'gold':
      case 'level':
      case 'lastHitMiss':
        return Unit.team[ev.eid] === team;
      case 'death':
        // camp kills stay in the fog (no free jungle timers); epic objectives (r >= 130) are announced like LoL
        if (ev.kind !== Kind.Monster || Unit.radius[ev.eid]! >= 130) return true;
        return (ev.killer >= 0 && Unit.team[ev.killer] === team) || pointVisible(sim, team, ev.x, ev.y);
      default:
        return true;
    }
  });
  const objects: SnapObject[] = [];
  for (const o of groundObjects(sim)) {
    if (o.team !== team && (HIDDEN_OBJECT_TAGS.has(o.tag) || !pointVisible(sim, team, o.x, o.y))) continue;
    objects.push({ id: o.id, tag: o.tag, team: o.team, x: o.x, y: o.y, r: o.r });
  }
  return { tick: sim.tick, time: sim.tick / 30, team, entities, projectiles, objects, me: hud, events, players: scoreRows(sim, team) };
}
