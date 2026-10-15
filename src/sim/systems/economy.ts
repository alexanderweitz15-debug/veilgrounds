// OWNER: agent A (gold, XP, levels, passive gold, regen, recall, respawn, fountain, kill rewards).
//
// Gold: start 500; passive 20 per 10 s from 1:05 (1 gold every 15 ticks); minion gold only on champion last hits.
// Champion kill: bounty 300, kill streak +100 per kill beyond the first (max 1000), death streak -30 per
// consecutive death (min 150), first blood +100. Assists (enemy champions that damaged the victim in the last 10 s)
// share 50 % of the kill gold. A champion executed by a tower/minion credits the most recent champion damager.
// XP: minion XP to allied champions within 1500, each gets base x 100/65/43/33/26 % for 1..5 champions.
// Champion kill XP (table by victim level) is split evenly between killer and assisters, each share scaled by the
// catch-up factor 1 + 0.2 x (average champion level - own level), clamped to [0.4, 2].
// Levels: XP to next 280, 380, ... (+100); level 18 at 18360 total. Champ.xp is cumulative.
// Death timer: 10 s (lvl 1) .. 52.5 s (lvl 18), x (1 + up to 50 %) growing linearly from 15:00 to 55:00.

import { query } from 'bitecs';
import type { Sim } from '../sim';
import type { System } from './index';
import { DT, Kind, isMinion, isStructure, sec } from '../types';
import { dist2 } from '../vec';
import { heal } from '../damage';
import { clearAttackOrders, onMoveCommand } from './attack';
import { MINION_STATS, recordCombat } from './minions';
import { onStructureDeath } from './towers';
import { onMonsterDeath } from './jungle';
import { onPlantDeath } from './plants';
import { minionGoldMult } from '../items/itemHooks';

export const START_GOLD = 500;
export const PASSIVE_START_TICK = 1950;
const PASSIVE_EVERY = 15; // ticks per gold => 2 gold/s
export const MAX_LEVEL = 18;
export const XP_RANGE = 1500;
export const XP_SHARE = [1, 0.65, 0.43, 0.33, 0.26];
export const ASSIST_WINDOW = sec(10);
export const RECALL_TICKS = sec(8);
export const FOUNTAIN_HEAL = 0.1; // of max per second
export const BASE_BOUNTY = 300;
/** Kill XP by victim level (LoL-like). */
export const KILL_XP = [42, 114, 144, 174, 204, 234, 308, 392, 486, 590, 640, 690, 740, 790, 840, 890, 940, 990];
/** Base respawn seconds by level. */
export const DEATH_BASE = [10, 10, 12, 12, 14, 16, 20, 25, 28, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50, 52.5];

/** Total XP needed to reach level L (index L). CUM_XP[18] = 18360. */
export const CUM_XP: number[] = (() => {
  const a = [0, 0];
  for (let l = 2; l <= MAX_LEVEL; l++) a.push(a[l - 1]! + 280 + 100 * (l - 2));
  return a;
})();

interface EconSt {
  /** victim champion eid -> (source champion eid -> last damage tick). */
  dmg: Map<number, Map<number, number>>;
  killStreak: Map<number, number>;
  deathStreak: Map<number, number>;
  firstBlood: boolean;
  /** Scoreboard tallies per champion eid: [kills, deaths, assists] (Agent H). */
  kda: Map<number, [number, number, number]>;
}

function st(sim: Sim): EconSt {
  let s = sim.state.economy as EconSt | undefined;
  if (!s) {
    s = { dmg: new Map(), killStreak: new Map(), deathStreak: new Map(), firstBlood: false, kda: new Map() };
    sim.state.economy = s;
  }
  return s;
}

/**
 * [kills, deaths, assists] of a champion (a copy). Read-only: snapshots (and so bots) call this every tick, and a
 * read must never create sim state, or a replay (which builds no snapshots) ends with a different state hash.
 */
export function kda(sim: Sim, eid: number): [number, number, number] {
  const k = (sim.state.economy as EconSt | undefined)?.kda.get(eid);
  return k ? [k[0], k[1], k[2]] : [0, 0, 0];
}

/** Mutable tally (kill bookkeeping only). */
function kdaEntry(sim: Sim, eid: number): [number, number, number] {
  const s = st(sim);
  let k = s.kda.get(eid);
  if (!k) s.kda.set(eid, (k = [0, 0, 0]));
  return k;
}

/** All champion entities (alive or dead), ascending eid. */
export function champions(sim: Sim): number[] {
  const { Unit, Champ } = sim.c;
  const out: number[] = [];
  for (const e of query(sim.world, [Champ])) if (Unit.kind[e] === Kind.Champion) out.push(e);
  return out.sort((a, b) => a - b);
}

export function grantGold(sim: Sim, eid: number, amount: number): void {
  const { Champ } = sim.c;
  Champ.gold[eid] = Champ.gold[eid]! + amount;
  if (amount > 0) Champ.totalGold[eid] = Champ.totalGold[eid]! + amount;
}

/** grantGold + floating-text event. */
export function reward(sim: Sim, eid: number, amount: number): void {
  if (amount <= 0) return;
  grantGold(sim, eid, amount);
  sim.events.push({ e: 'gold', eid, amount, x: sim.c.Pos.x[eid]!, y: sim.c.Pos.y[eid]! });
}

export function grantXp(sim: Sim, eid: number, amount: number): void {
  const { Champ } = sim.c;
  if (amount <= 0 || Champ.level[eid]! >= MAX_LEVEL) return;
  Champ.xp[eid] = Champ.xp[eid]! + amount;
  while (Champ.level[eid]! < MAX_LEVEL && Champ.xp[eid]! >= CUM_XP[Champ.level[eid]! + 1]! - 1e-6) {
    Champ.level[eid] = Champ.level[eid]! + 1;
    Champ.skillPoints[eid] = Champ.skillPoints[eid]! + 1;
    sim.events.push({ e: 'level', eid, level: Champ.level[eid]! });
  }
  if (Champ.level[eid]! >= MAX_LEVEL) Champ.xp[eid] = CUM_XP[MAX_LEVEL]!;
}

/** XP still needed for the next level (0 at max level). */
export function xpToNext(sim: Sim, eid: number): number {
  const { Champ } = sim.c;
  const l = Champ.level[eid]!;
  if (l >= MAX_LEVEL) return 0;
  return Math.max(0, CUM_XP[Math.max(1, l) + 1]! - Champ.xp[eid]!);
}

export function startRecall(sim: Sim, eid: number): void {
  const { Unit, Champ, Move, Atk } = sim.c;
  if (!Unit.alive[eid] || Champ.recallAt[eid]! > sim.tick) return;
  onMoveCommand(sim, eid);
  Atk.target[eid] = -1;
  Atk.attackMove[eid] = 0;
  Move.mode[eid] = 0;
  sim.paths.delete(eid);
  Champ.recallAt[eid] = sim.tick + RECALL_TICKS;
}

/** Cancel recall (called on move command, damage, CC). */
export function cancelRecall(sim: Sim, eid: number): void {
  sim.c.Champ.recallAt[eid] = 0;
}

/** Respawn time in ticks for a champion of `level` dying at `tick`. */
export function deathTimerTicks(level: number, tick: number): number {
  const base = DEATH_BASE[Math.min(MAX_LEVEL, Math.max(1, level)) - 1]!;
  const t = tick / 30;
  const f = t <= 900 ? 0 : t >= 3300 ? 1 : (t - 900) / 2400;
  return Math.round(base * (1 + 0.5 * f) * 30);
}

/** Kill gold the victim is worth (without first blood). */
export function bounty(sim: Sim, victim: number): number {
  const s = st(sim);
  const ks = s.killStreak.get(victim) ?? 0;
  const ds = s.deathStreak.get(victim) ?? 0;
  if (ks >= 2) return Math.min(1000, BASE_BOUNTY + 100 * (ks - 1));
  return Math.max(150, BASE_BOUNTY - 30 * ds);
}

function noteChampDamage(sim: Sim, src: number, dst: number): void {
  const { Unit } = sim.c;
  if (src < 0 || Unit.kind[src] !== Kind.Champion || Unit.kind[dst] !== Kind.Champion || Unit.team[src] === Unit.team[dst]) return;
  const s = st(sim);
  let m = s.dmg.get(dst);
  if (!m) s.dmg.set(dst, (m = new Map()));
  m.set(src, sim.tick);
}

function absorbDamageEvents(sim: Sim): void {
  for (const ev of sim.events) if (ev.e === 'damage' && ev.amount > 0) noteChampDamage(sim, ev.src, ev.dst);
}

function minionDeath(sim: Sim, victim: number, killer: number): void {
  const { Unit, Champ, Pos } = sim.c;
  const s = MINION_STATS[Unit.kind[victim]!]!;
  const team = Unit.team[victim]!;
  if (killer >= 0 && Unit.kind[killer] === Kind.Champion && Unit.team[killer] !== team) {
    Champ.cs[killer] = Champ.cs[killer]! + 1;
    reward(sim, killer, s.gold * minionGoldMult(sim, killer)); // Jägerzahn malus (src/sim/items/itemHooks.ts)
  }
  const x = Pos.x[victim]!;
  const y = Pos.y[victim]!;
  const near = champions(sim).filter(
    (c) => Unit.alive[c] && Unit.team[c] !== team && Unit.team[c] <= 1 && dist2(x, y, Pos.x[c]!, Pos.y[c]!) <= XP_RANGE * XP_RANGE,
  );
  if (near.length === 0) return;
  const share = XP_SHARE[Math.min(near.length, XP_SHARE.length) - 1]!;
  for (const c of near) grantXp(sim, c, s.xp * share);
}

function championDeath(sim: Sim, victim: number, killer: number): void {
  const { Unit, Champ } = sim.c;
  const s = st(sim);
  absorbDamageEvents(sim); // onDeath runs inside dealDamage, before economy.update saw this tick's events
  const team = Unit.team[victim]!;
  const recent = s.dmg.get(victim) ?? new Map<number, number>();
  const cutoff = sim.tick - ASSIST_WINDOW;
  const enemies = champions(sim).filter((c) => Unit.team[c] !== team && Unit.team[c] <= 1);
  let credited = -1;
  if (killer >= 0 && Unit.kind[killer] === Kind.Champion && Unit.team[killer] !== team) credited = killer;
  else {
    let bestTick = cutoff - 1;
    for (const c of enemies) {
      const t = recent.get(c) ?? -1e9;
      if (t >= cutoff && t > bestTick) {
        credited = c;
        bestTick = t;
      }
    }
  }
  const assisters = enemies.filter((c) => c !== credited && (recent.get(c) ?? -1e9) >= cutoff);

  if (credited >= 0) {
    let gold = bounty(sim, victim);
    if (!s.firstBlood) {
      s.firstBlood = true;
      gold += 100;
    }
    reward(sim, credited, gold);
    for (const a of assisters) reward(sim, a, Math.floor((gold * 0.5) / assisters.length));
    s.killStreak.set(credited, (s.killStreak.get(credited) ?? 0) + 1);
    s.deathStreak.set(credited, 0);
    // XP
    const parts = [credited, ...assisters];
    const all = champions(sim);
    let sum = 0;
    for (const c of all) sum += Champ.level[c]!;
    const avg = all.length ? sum / all.length : 1;
    const total = KILL_XP[Math.max(1, Champ.level[victim]!) - 1]!;
    for (const p of parts) {
      const f = Math.min(2, Math.max(0.4, 1 + 0.2 * (avg - Champ.level[p]!)));
      grantXp(sim, p, (total / parts.length) * f);
    }
    kdaEntry(sim, credited)[0]++;
    for (const a of assisters) kdaEntry(sim, a)[2]++;
  }
  kdaEntry(sim, victim)[1]++;
  s.killStreak.set(victim, 0);
  s.deathStreak.set(victim, (s.deathStreak.get(victim) ?? 0) + 1);
  s.dmg.delete(victim);
  Champ.recallAt[victim] = 0;
  Champ.respawnAt[victim] = sim.tick + deathTimerTicks(Champ.level[victim]!, sim.tick);
}

/** Called by damage.kill before the victim is removed. Rewards, respawn timers, structure state. */
export function onDeath(sim: Sim, victim: number, killer: number): void {
  const k = sim.c.Unit.kind[victim]!;
  if (isMinion(k)) minionDeath(sim, victim, killer);
  else if (k === Kind.Champion) championDeath(sim, victim, killer);
  else if (isStructure(k)) onStructureDeath(sim, victim, killer);
  else if (k === Kind.Monster) onMonsterDeath(sim, victim, killer); // camp data in jungle.ts (Agent H)
  else if (k === Kind.Plant) onPlantDeath(sim, victim, killer); // jungle plants (plants.ts)
}

function respawn(sim: Sim, eid: number): void {
  const { Unit, Champ, Pos, Hp, Mana, Move } = sim.c;
  const f = sim.map.sides[Unit.team[eid]!]!.fountain;
  Pos.x[eid] = Pos.px[eid] = f.x;
  Pos.y[eid] = Pos.py[eid] = f.y;
  Hp.cur[eid] = Hp.max[eid]!;
  Mana.cur[eid] = Mana.max[eid]!;
  Unit.alive[eid] = 1;
  Move.mode[eid] = 0;
  clearAttackOrders(sim, eid); // no walking back to the attack-move point of the previous life
  sim.paths.delete(eid);
  Champ.respawnAt[eid] = 0;
  sim.events.push({ e: 'respawn', eid });
}

function completeRecall(sim: Sim, eid: number): void {
  const { Pos, Champ, Move, Unit } = sim.c;
  const f = sim.map.sides[Unit.team[eid]!]!.fountain;
  Pos.x[eid] = Pos.px[eid] = f.x;
  Pos.y[eid] = Pos.py[eid] = f.y;
  Move.mode[eid] = 0;
  sim.paths.delete(eid);
  Champ.recallAt[eid] = 0;
}

export const economySystem: System = {
  name: 'economy',
  init(sim) {
    const { Champ } = sim.c;
    for (const c of champions(sim)) {
      Champ.gold[c] = Champ.totalGold[c] = START_GOLD;
      if (Champ.level[c] === 0) {
        Champ.level[c] = 1;
        Champ.skillPoints[c] = 1;
      }
      Champ.xp[c] = CUM_XP[Champ.level[c]!]!;
      Champ.respawnAt[c] = 0;
      Champ.recallAt[c] = 0;
    }
  },
  update(sim) {
    recordCombat(sim);
    absorbDamageEvents(sim);
    const { Unit, Champ, Hp, Mana, Pos, Stats } = sim.c;
    const damaged = new Set<number>();
    for (const ev of sim.events) if (ev.e === 'damage' && ev.amount > 0) damaged.add(ev.dst);
    const passive = sim.tick > PASSIVE_START_TICK && (sim.tick - PASSIVE_START_TICK) % PASSIVE_EVERY === 0;

    for (const c of champions(sim)) {
      if (passive) grantGold(sim, c, 1);
      if (!Unit.alive[c]) {
        if (Champ.respawnAt[c]! > 0 && sim.tick >= Champ.respawnAt[c]!) respawn(sim, c);
        continue;
      }
      if (Champ.recallAt[c]! > 0) {
        // ponytail: CC detected as Stats.ms === 0 (movement's root/stun convention), so roots cancel too.
        // A buff system with explicit CC flags can tell stun from root.
        if (damaged.has(c) || Stats.ms[c] === 0) cancelRecall(sim, c);
        else if (sim.tick >= Champ.recallAt[c]!) completeRecall(sim, c);
      }
      const f = sim.map.sides[Unit.team[c]!]?.fountain;
      if (f && dist2(Pos.x[c]!, Pos.y[c]!, f.x, f.y) <= f.r * f.r) {
        heal(sim, c, Hp.max[c]! * FOUNTAIN_HEAL * DT);
        Mana.cur[c] = Math.min(Mana.max[c]!, Mana.cur[c]! + Mana.max[c]! * FOUNTAIN_HEAL * DT);
      }
    }
    // ponytail: fountain laser vs enemies and homeguard need the buff system; surrender is a UI vote (later phase).

    for (const e of query(sim.world, [Hp])) {
      if (!Unit.alive[e]) continue;
      if (Hp.regen[e]! > 0 && Hp.cur[e]! < Hp.max[e]!) heal(sim, e, Hp.regen[e]! * DT);
      if (Mana.regen[e]! > 0 && Mana.cur[e]! < Mana.max[e]!) Mana.cur[e] = Math.min(Mana.max[e]!, Mana.cur[e]! + Mana.regen[e]! * DT);
    }
  },
};
