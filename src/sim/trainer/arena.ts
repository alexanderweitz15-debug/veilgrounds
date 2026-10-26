// Teamfight arena: all champions (human + bots, any team size) start at a preset level with preset items
// (trainer.items, chosen by the client from the bot builds), are placed in the mid-lane centre and fight rounds.
// A round ends when one team is wiped (point for the other) or after `roundSec` (point for the team with more HP
// left in percent). Dead champions wait for the next round (no respawn, no recall). First to `rounds` wins.
// Both teams see every champion during a fight (the starting gap exceeds sight range, a bush must not hide anyone),
// and draws are capped: after `maxRounds` rounds the match ends on the score (a tie is no win).

import type { Sim } from '../sim';
import { sec } from '../types';
import { champions, grantGold } from '../systems/economy';
import { buyItem } from '../items/inventory';
import { refreshCooldowns } from '../systems/abilities';
import { autoLevel, humanEid, place, raiseLevel, runSeconds, type TrainerHud } from './common';
import { MAP_SIZE, nearestWalkable } from '../map';
import { reveal } from '../buffs';

export interface ArenaState {
  start: number;
  end: number;
  round: number;
  score: [number, number];
  /** 'fight' until a team is wiped or the time runs out, then 'pause' until `phaseEnd`. */
  phase: 'fight' | 'pause';
  phaseEnd: number;
  roundStart: number;
  rounds: number;
  roundTicks: number;
  /** Winner of the last round (-1 draw / none). */
  lastWinner: number;
  /** Hard cap on rounds played (draws give no point): the match ends on the score after this round. */
  maxRounds: number;
}

export const ARENA_CENTRE = { x: MAP_SIZE / 2, y: MAP_SIZE / 2 } as const;
/** Arena boundary: champions are held inside this circle (like a wall), so nobody walks back to a tower. */
export const ARENA_R = 700;
const PAUSE = sec(3);
/** Unit vector across the mid lane (champions of a team stand side by side along it). */
const ACROSS = { x: 0.7071, y: -0.7071 };

export function initArena(sim: Sim): ArenaState {
  const o = sim.config.trainer ?? {};
  for (const c of champions(sim)) {
    raiseLevel(sim, c, o.level ?? 11);
    autoLevel(sim, c);
    // champions spawn in their fountain, so the normal shop rules apply
    const slot = sim.c.Unit.slot[c]!;
    for (const id of o.items?.[String(slot)] ?? []) {
      grantGold(sim, c, 6000);
      buyItem(sim, c, id);
    }
    sim.c.Champ.gold[c] = 0;
  }
  const s: ArenaState = {
    start: sim.tick,
    end: -1,
    round: 0,
    score: [0, 0],
    phase: 'fight',
    phaseEnd: 0,
    roundStart: 0,
    rounds: Math.max(1, o.rounds ?? 3),
    roundTicks: sec(o.roundSec ?? 45),
    lastWinner: -1,
    maxRounds: 2 * Math.max(1, o.rounds ?? 3) + 1,
  };
  startRound(sim, s);
  return s;
}

function startRound(sim: Sim, s: ArenaState): void {
  const { Unit, Hp, Mana, Champ } = sim.c;
  const idx = [0, 0];
  for (const c of champions(sim)) {
    const team = Unit.team[c] === 1 ? 1 : 0;
    const i = idx[team]!++;
    const side = team === 0 ? -1 : 1;
    const off = (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * 170;
    if (!Unit.alive[c]) {
      Unit.alive[c] = 1;
      sim.events.push({ e: 'respawn', eid: c });
    }
    Champ.respawnAt[c] = 0;
    Champ.recallAt[c] = 0;
    Hp.cur[c] = Hp.max[c]!;
    Mana.cur[c] = Mana.max[c]!;
    refreshCooldowns(sim, c);
    place(sim, c, ARENA_CENTRE.x + side * 450 + ACROSS.x * off, ARENA_CENTRE.y + side * 450 + ACROSS.y * off);
  }
  s.round++;
  s.phase = 'fight';
  s.roundStart = sim.tick;
}

function hpShare(sim: Sim, team: number): number {
  const { Unit, Hp } = sim.c;
  let sum = 0;
  let n = 0;
  for (const c of champions(sim)) {
    if (Unit.team[c] !== team) continue;
    n++;
    if (Unit.alive[c]) sum += Hp.cur[c]! / Math.max(1, Hp.max[c]!);
  }
  return n > 0 ? sum / n : 0;
}

export function updateArena(sim: Sim, s: ArenaState): void {
  if (s.end >= 0) return;
  const { Unit, Champ } = sim.c;
  const alive = [0, 0];
  const { Pos } = sim.c;
  for (const c of champions(sim)) {
    Champ.recallAt[c] = 0; // no recall in the arena
    const dx = Pos.x[c]! - ARENA_CENTRE.x;
    const dy = Pos.y[c]! - ARENA_CENTRE.y;
    const d2 = dx * dx + dy * dy;
    if (Unit.alive[c] && d2 > ARENA_R * ARENA_R) {
      const k = ARENA_R / Math.sqrt(d2);
      const p = nearestWalkable(sim.map.nav, ARENA_CENTRE.x + dx * k, ARENA_CENTRE.y + dy * k); // never into a wall
      Pos.x[c] = p.x;
      Pos.y[c] = p.y;
    }
    // mutual vision: an idle player out of sight range must not stall the round (no fog duel in the arena)
    if (Unit.alive[c] && s.phase === 'fight') for (const team of [0, 1]) if (team !== Unit.team[c]) reveal(sim, team, c, 2);
    if (Unit.alive[c]) alive[Unit.team[c] === 1 ? 1 : 0]!++;
    else Champ.respawnAt[c] = 0; // wait for the next round instead of the fountain respawn
  }
  if (s.phase === 'pause') {
    if (sim.tick >= s.phaseEnd) startRound(sim, s);
    return;
  }
  let winner = -2; // -2 round continues
  if (alive[0] === 0 || alive[1] === 0) winner = alive[0]! > 0 ? 0 : alive[1]! > 0 ? 1 : -1;
  else if (sim.tick - s.roundStart >= s.roundTicks) {
    const a = hpShare(sim, 0);
    const b = hpShare(sim, 1);
    winner = a > b ? 0 : b > a ? 1 : -1;
  }
  if (winner === -2) return;
  s.lastWinner = winner;
  if (winner >= 0) s.score[winner as 0 | 1]++;
  if (s.score[0] >= s.rounds || s.score[1] >= s.rounds || s.round >= s.maxRounds) {
    s.end = sim.tick;
    return;
  }
  s.phase = 'pause';
  s.phaseEnd = sim.tick + PAUSE;
}

export function arenaHud(sim: Sim, s: ArenaState): TrainerHud {
  const me = humanEid(sim);
  const mine = me >= 0 && sim.c.Unit.team[me] === 1 ? 1 : 0;
  const theirs = mine === 0 ? 1 : 0;
  const won = s.score[mine] > s.score[theirs];
  return {
    kind: 'arena',
    time: runSeconds(sim, s.start, s.end),
    duration: 0,
    done: s.end >= 0,
    ...(s.end >= 0 ? { won } : {}),
    score: s.score[mine],
    grade: s.end < 0 ? '' : won ? 'S' : 'D',
    stats: [
      { k: 'round', v: s.round, fmt: 'int' },
      { k: 'roundsMe', v: s.score[mine], fmt: 'int' },
      { k: 'roundsBot', v: s.score[theirs], fmt: 'int' },
      { k: 'roundTime', v: s.phase === 'fight' ? Math.max(0, (s.roundTicks - (sim.tick - s.roundStart)) / 30) : 0, fmt: 'sec' },
      { k: 'firstTo', v: s.rounds, fmt: 'int' },
    ],
  };
}
