// OWNER: agent H (jungle camps, river scuttler, big objectives, jungle buffs).
//
// Camps per side from map data (sides[team].camps), first spawn 1:30, Nebelschleicher (river, flees) 3:15.
// Respawn timers start when the last monster of a camp dies: buffs 5:00, small camps 2:15, Nebelschleicher 2:30.
// Flussleviathan 5:00 (respawn 5:00, permanent team stack), Schleierwächter 20:00 (respawn 6:00, 300 gold to the
// team + 180 s buff). Monsters attack whoever hit them, chase within a leash, then walk home and heal to full.
// Gold/XP/CS go to the killing champion (monster XP is not shared).
// Numbers are scaled for a level-1 clear without a jungle item: buff + two small camps = 680 XP >= level 3 (660),
// measured (tests/jungle.test.ts): Mira with autos only, buff -> Moosrudel -> Schattenkrabbe, level 3 at 2:55.
// ponytail: Kesselbrut (herald) is not spawned yet; monster HP/AD grow +2 % per minute of spawn time instead of
// LoL's level-based scaling; Glutwächter burn/slow procs on any damage the buffed champion deals to its current
// attack target (detected through LastHit, so this needs no change in attack.ts).

import { query } from 'bitecs';
import type { Sim } from '../sim';
import { isRef, spawnUnit, despawn } from '../sim';
import type { System } from './index';
import { Kind, Team, isStructure, sec } from '../types';
import { nearestWalkable } from '../map';
import { dist2, clamp } from '../vec';
import { addBuff, hasBuff } from '../buffs';
import { heal } from '../damage';
import { moveTo } from './input';
import { champions, grantXp, reward } from './economy';

export interface MonsterDef {
  hp: number;
  ad: number;
  as: number;
  armor: number;
  mr: number;
  range: number;
  radius: number;
  gold: number;
  xp: number;
  /** Offset from the camp centre. */
  dx: number;
  dy: number;
}

export type CampId =
  | 'dornenbock'
  | 'glutwaechter'
  | 'moosrudel'
  | 'hohlkaefer'
  | 'schattenkrabbe'
  | 'nebelschleicher'
  | 'leviathan'
  | 'schleierwaechter';

export interface CampDef {
  /** First spawn and respawn in seconds. */
  first: number;
  respawn: number;
  monsters: MonsterDef[];
  /** Jungle buff granted to the killer of the first (big) monster. */
  buff?: 'dornenbock' | 'glutwaechter';
  flees?: boolean;
}

const m = (hp: number, ad: number, as: number, armor: number, mr: number, radius: number, gold: number, xp: number, dx = 0, dy = 0): MonsterDef => ({
  hp, ad, as, armor, mr, range: 125 + radius / 2, radius, gold, xp, dx, dy,
});

export const CAMPS: Record<CampId, CampDef> = {
  dornenbock: { first: 90, respawn: 300, buff: 'dornenbock', monsters: [m(1000, 18, 0.6, 10, 10, 100, 100, 240)] },
  glutwaechter: { first: 90, respawn: 300, buff: 'glutwaechter', monsters: [m(1000, 18, 0.6, 10, 10, 100, 100, 240)] },
  moosrudel: {
    first: 90,
    respawn: 135,
    monsters: [m(500, 14, 0.6, 5, 0, 80, 40, 100), m(140, 5, 0.7, 0, 0, 45, 10, 40, 170, 0), m(140, 5, 0.7, 0, 0, 45, 10, 40, -120, 120), m(140, 5, 0.7, 0, 0, 45, 10, 40, -120, -120)],
  },
  hohlkaefer: { first: 90, respawn: 135, monsters: [m(600, 14, 0.6, 5, 0, 80, 40, 120), m(180, 6, 0.7, 0, 0, 50, 15, 50, 160, 60), m(180, 6, 0.7, 0, 0, 50, 15, 50, -60, -160)] },
  schattenkrabbe: { first: 90, respawn: 135, monsters: [m(650, 15, 0.6, 5, 0, 80, 45, 120), m(200, 6, 0.7, 0, 0, 50, 20, 60, 160, -60), m(200, 6, 0.7, 0, 0, 50, 20, 60, -60, 160)] },
  nebelschleicher: { first: 195, respawn: 150, flees: true, monsters: [m(900, 0, 0, 20, 20, 70, 70, 200)] },
  leviathan: { first: 300, respawn: 300, monsters: [m(3500, 70, 0.5, 30, 30, 130, 25, 150)] },
  schleierwaechter: { first: 1200, respawn: 360, monsters: [m(8000, 120, 0.6, 60, 50, 160, 0, 300)] },
};

export const MONSTER_MS = 330;
export const NEBEL_MS = 300;
/** Monster may stray this far from its spawn spot; a target this far from the camp centre is dropped. */
export const LEASH = 900;
export const TARGET_LEASH = 1100;
/** HP fraction per second regenerated while walking home. */
export const RESET_REGEN = 0.3;
export const BUFF_TICKS = sec(120);
export const SCHLEIER_BUFF_TICKS = sec(180);
export const SCHLEIER_TEAM_GOLD = 300;
export const LEVIATHAN_MAX_STACKS = 4;
export const RIVER_VISION_TICKS = sec(75);
export const RIVER_VISION_R = 1000;

export interface Camp {
  id: CampId;
  /** Map side the camp belongs to (0/1), 2 = river/objective. */
  side: number;
  x: number;
  y: number;
  /** Tick of the next spawn, -1 while monsters are up. */
  spawnAt: number;
  members: { eid: number; serial: number; hx: number; hy: number; def: MonsterDef }[];
  target: number;
  targetSerial: number;
  resetting: boolean;
  /** Highest LastHit tick already processed for aggro. */
  seen: number;
}

interface JungleState {
  camps: Camp[];
  /** Flussleviathan stacks per team. */
  leviathan: [number, number];
  /** River-vision wards: eid, serial, expiry tick. */
  wards: { eid: number; serial: number; until: number }[];
}

export function jungleState(sim: Sim): JungleState {
  let s = sim.state.jungle as JungleState | undefined;
  if (!s) {
    const camps: Camp[] = [];
    const add = (id: CampId, side: number, x: number, y: number): void => {
      camps.push({ id, side, x, y, spawnAt: sec(CAMPS[id].first), members: [], target: -1, targetSerial: 0, resetting: false, seen: -1 });
    };
    for (const side of [0, 1]) for (const c of sim.map.sides[side]!.camps) if (c.id in CAMPS) add(c.id as CampId, side, c.x, c.y);
    for (const p of sim.map.objectives.nebelschleicher) add('nebelschleicher', 2, p.x, p.y);
    add('leviathan', 2, sim.map.objectives.leviathan.x, sim.map.objectives.leviathan.y);
    add('schleierwaechter', 2, sim.map.objectives.schleierwaechter.x, sim.map.objectives.schleierwaechter.y);
    s = { camps, leviathan: [0, 0], wards: [] };
    sim.state.jungle = s;
  }
  return s;
}

export const leviathanStacks = (sim: Sim, team: number): number =>
  team === 0 || team === 1 ? ((sim.state.jungle as JungleState | undefined)?.leviathan[team] ?? 0) : 0;

/** HP/AD multiplier for monsters spawned at `tick` (+2 % per minute). */
export const monsterScale = (tick: number): number => 1 + 0.02 * Math.floor(tick / sec(60));

/** Nebelschleicher gold: 70 at 3:15 rising linearly to 120 at 20:00. */
export const nebelGold = (tick: number): number => Math.round(70 + 50 * clamp((tick - sec(195)) / (sec(1200) - sec(195)), 0, 1));

function spawnCamp(sim: Sim, camp: Camp): void {
  const def = CAMPS[camp.id];
  const { Unit, Hp, Stats, Vision } = sim.c;
  const k = monsterScale(sim.tick);
  camp.members = [];
  for (const md of def.monsters) {
    const p = nearestWalkable(sim.map.nav, camp.x + md.dx, camp.y + md.dy);
    const eid = spawnUnit(sim, Kind.Monster, Team.Neutral, p.x, p.y, md.radius);
    Hp.max[eid] = Hp.cur[eid] = md.hp * k;
    Stats.ad[eid] = md.ad * k;
    Stats.as[eid] = md.as;
    Stats.range[eid] = md.range;
    Stats.armor[eid] = md.armor;
    Stats.mr[eid] = md.mr;
    Stats.ms[eid] = def.flees ? NEBEL_MS : MONSTER_MS;
    Vision.r[eid] = 0;
    camp.members.push({ eid, serial: Unit.serial[eid]!, hx: p.x, hy: p.y, def: md });
  }
  camp.spawnAt = -1;
  camp.target = -1;
  camp.resetting = false;
  camp.seen = sim.tick;
}

const alive = (sim: Sim, c: Camp): Camp['members'] => c.members.filter((x) => isRef(sim, x.eid, x.serial));

/** Camp that owns monster `eid`, if any. */
export function campOf(sim: Sim, eid: number): Camp | undefined {
  const serial = sim.c.Unit.serial[eid];
  return jungleState(sim).camps.find((c) => c.members.some((x) => x.eid === eid && x.serial === serial));
}

function validTarget(sim: Sim, c: Camp): boolean {
  const { Unit, Pos } = sim.c;
  const t = c.target;
  if (!isRef(sim, t, c.targetSerial) || Unit.untargetable[t]) return false;
  return dist2(Pos.x[t]!, Pos.y[t]!, c.x, c.y) <= TARGET_LEASH * TARGET_LEASH;
}

function startReset(sim: Sim, c: Camp, living: Camp['members']): void {
  const { Atk } = sim.c;
  c.target = -1;
  c.resetting = true;
  for (const x of living) {
    Atk.target[x.eid] = -1;
    moveTo(sim, x.eid, x.hx, x.hy);
  }
}

function updateCamp(sim: Sim, c: Camp): void {
  const { Unit, Pos, LastHit, Atk, Move, Hp } = sim.c;
  const living = alive(sim, c);
  if (living.length === 0) return;
  const def = CAMPS[c.id];

  // aggro: whoever damaged a member since the last check (champions only; monsters ignore minions)
  let attacker = -1;
  let newest = c.seen;
  for (const x of living) {
    const t = LastHit.tick[x.eid]!;
    if (t <= c.seen) continue;
    const src = LastHit.eid[x.eid]!;
    if (t > newest) newest = t;
    if (isRef(sim, src, LastHit.serial[x.eid]!) && Unit.kind[src] === Kind.Champion) attacker = src;
  }
  c.seen = newest;

  if (def.flees) {
    // Nebelschleicher: never fights; when hit it runs away from the attacker
    if (attacker >= 0) {
      for (const x of living) {
        if (Move.mode[x.eid] !== 0) continue;
        const dx = Pos.x[x.eid]! - Pos.x[attacker]!;
        const dy = Pos.y[x.eid]! - Pos.y[attacker]!;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const p = nearestWalkable(sim.map.nav, Pos.x[x.eid]! + (dx / d) * 600, Pos.y[x.eid]! + (dy / d) * 600);
        moveTo(sim, x.eid, p.x, p.y);
      }
    }
    return;
  }

  if (c.resetting) {
    let home = true;
    for (const x of living) {
      heal(sim, x.eid, Hp.max[x.eid]! * RESET_REGEN / 30);
      if (Move.mode[x.eid] !== 0) home = false;
    }
    if (!home) return;
    for (const x of living) Hp.cur[x.eid] = Hp.max[x.eid]!;
    c.resetting = false;
    return;
  }

  if (attacker >= 0 && !validTarget(sim, c)) {
    c.target = attacker;
    c.targetSerial = Unit.serial[attacker]!;
  }
  if (c.target < 0) return;
  const strayed = living.some((x) => dist2(Pos.x[x.eid]!, Pos.y[x.eid]!, x.hx, x.hy) > LEASH * LEASH);
  if (!validTarget(sim, c) || strayed) return startReset(sim, c, living);
  for (const x of living) {
    if (Atk.target[x.eid] === c.target) continue;
    Atk.target[x.eid] = c.target;
    Atk.targetSerial[x.eid] = c.targetSerial;
    Move.mode[x.eid] = 2;
  }
}

/** Glutwächter: burn (true damage over 3 s) + 10 % slow on the attack target of a buffed champion. */
function glutProcs(sim: Sim): void {
  const { Unit, LastHit, Atk, Champ } = sim.c;
  const ents = query(sim.world, [Unit]);
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i]!;
    if (!Unit.alive[e] || LastHit.tick[e] !== sim.tick - 1 || isStructure(Unit.kind[e]!)) continue;
    const src = LastHit.eid[e]!;
    if (!isRef(sim, src, LastHit.serial[e]!) || Unit.kind[src] !== Kind.Champion || Atk.target[src] !== e) continue;
    if (!hasBuff(sim, src, 'mark', 'glutwaechter')) continue;
    const perSec = 4 + 2 * Champ.level[src]!;
    addBuff(sim, e, { kind: 'dot', id: 'glutwaechter', src, amount: perSec, period: sec(1), dmgType: 'true', ticks: sec(3) });
    addBuff(sim, e, { kind: 'slow', id: 'glutwaechter', src, pct: 10, ticks: sec(1.5) });
  }
}

export const jungleSystem: System = {
  name: 'jungle',
  init(sim) {
    jungleState(sim);
  },
  update(sim) {
    const s = jungleState(sim);
    for (const c of s.camps) {
      if (c.spawnAt >= 0 && sim.tick >= c.spawnAt) spawnCamp(sim, c);
      else if (c.spawnAt < 0) updateCamp(sim, c);
    }
    glutProcs(sim);
    if (s.wards.length) {
      s.wards = s.wards.filter((w) => {
        if (sim.tick < w.until) return true;
        if (isRef(sim, w.eid, w.serial)) despawn(sim, w.eid);
        return false;
      });
    }
  },
};

function riverVision(sim: Sim, team: number, x: number, y: number): void {
  const { Unit, Vision, Hp } = sim.c;
  const eid = spawnUnit(sim, Kind.Ward, team, x, y, 1);
  Hp.max[eid] = Hp.cur[eid] = 0;
  Unit.untargetable[eid] = 1;
  Unit.invulnerable[eid] = 1;
  Vision.r[eid] = RIVER_VISION_R;
  jungleState(sim).wards.push({ eid, serial: Unit.serial[eid]!, until: sim.tick + RIVER_VISION_TICKS });
}

/** Called by economy.onDeath for Kind.Monster: rewards, buffs, respawn timer. */
export function onMonsterDeath(sim: Sim, victim: number, killer: number): void {
  const { Unit, Champ, Pos } = sim.c;
  const c = campOf(sim, victim);
  if (!c) return;
  const idx = c.members.findIndex((x) => x.eid === victim && x.serial === Unit.serial[victim]);
  const md = c.members[idx]!.def;
  const champ = killer >= 0 && Unit.kind[killer] === Kind.Champion ? killer : -1;
  if (champ >= 0) {
    const team = Unit.team[champ]!;
    Champ.cs[champ] = Champ.cs[champ]! + 1;
    reward(sim, champ, c.id === 'nebelschleicher' ? nebelGold(sim.tick) : md.gold);
    grantXp(sim, champ, md.xp);
    const def = CAMPS[c.id];
    if (def.buff && idx === 0) addBuff(sim, champ, { kind: 'mark', id: def.buff, src: champ, ticks: BUFF_TICKS });
    if (c.id === 'nebelschleicher') riverVision(sim, team, Pos.x[victim]!, Pos.y[victim]!);
    if (c.id === 'leviathan') {
      const s = jungleState(sim);
      s.leviathan[team as 0 | 1] = Math.min(LEVIATHAN_MAX_STACKS, s.leviathan[team as 0 | 1] + 1);
    }
    if (c.id === 'schleierwaechter') {
      for (const p of champions(sim)) {
        if (Unit.team[p] !== team) continue;
        reward(sim, p, SCHLEIER_TEAM_GOLD);
        if (!Unit.alive[p]) continue;
        addBuff(sim, p, { kind: 'mark', id: 'schleierwaechter', src: p, ticks: SCHLEIER_BUFF_TICKS });
        addBuff(sim, p, { kind: 'stat', stat: 'ad', id: 'schleierwaechter', src: p, flat: 40, ticks: SCHLEIER_BUFF_TICKS });
        addBuff(sim, p, { kind: 'stat', stat: 'ap', id: 'schleierwaechter', src: p, flat: 60, ticks: SCHLEIER_BUFF_TICKS });
      }
    }
  }
  // last one down: start the respawn timer (victim is still "alive" until kill() despawns it)
  if (alive(sim, c).every((x) => x.eid === victim)) {
    c.spawnAt = sim.tick + sec(CAMPS[c.id].respawn);
    c.target = -1;
  }
}
