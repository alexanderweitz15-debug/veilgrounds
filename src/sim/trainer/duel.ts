// Duels vs one bot (bots come from the normal BotRunner, configured by the lobby):
// - Lane duel: mid lane only, ends at the first `kills` champion kills, the first to `cs` CS, or the first tower.
// - Jungle duel: two junglers, no lane minions, race for camps and the river crab for `durationSec`;
//   points = monster kills + 2 per crab + 3 per champion kill.

import type { Sim } from '../sim';
import { Kind, sec } from '../types';
import { champions } from '../systems/economy';
import { campOf, jungleState } from '../systems/jungle';
import { scheduleNextWave } from '../systems/waves';
import { humanEid, runSeconds, type TrainerHud } from './common';

export interface DuelState {
  start: number;
  end: number;
  /** Jungle duel time limit (ticks). */
  duration: number;
  kills: [number, number];
  monsters: [number, number];
  crabs: [number, number];
  /** Team that destroyed a tower first (-1 none). */
  tower: number;
  winner: number;
}

export const JUNGLE_DUEL_DEFAULT_SEC = 300;

export function initDuel(sim: Sim): DuelState {
  const jungle = sim.config.mode === 'jungleDuel';
  if (!jungle) scheduleNextWave(sim, sec(5));
  // jungle duel: side camps (incl. crab) spawn after 3 s instead of their normal first spawn; epics keep their timer
  else for (const c of jungleState(sim).camps) if (c.side <= 1 && c.spawnAt > sec(3)) c.spawnAt = sec(3);
  return {
    start: sim.tick,
    end: -1,
    duration: jungle ? sec(sim.config.trainer?.durationSec ?? JUNGLE_DUEL_DEFAULT_SEC) : 0,
    kills: [0, 0],
    monsters: [0, 0],
    crabs: [0, 0],
    tower: -1,
    winner: -1,
  };
}

const teamOf = (sim: Sim, eid: number): number => (eid >= 0 ? sim.c.Unit.team[eid]! : -1);

/** Champion CS (lane: minions, jungle: monsters) per team. */
function csOf(sim: Sim): [number, number] {
  const out: [number, number] = [0, 0];
  for (const c of champions(sim)) {
    const t = sim.c.Unit.team[c]!;
    if (t === 0 || t === 1) out[t] += sim.c.Champ.cs[c]!;
  }
  return out;
}

export const junglePoints = (s: DuelState, team: 0 | 1): number => s.monsters[team] + 2 * s.crabs[team] + 3 * s.kills[team];

export function updateDuel(sim: Sim, s: DuelState): void {
  if (s.end >= 0) return;
  const jungle = sim.config.mode === 'jungleDuel';
  for (const ev of sim.events) {
    if (ev.e !== 'death') continue;
    if (ev.kind === Kind.Champion && (ev.team === 0 || ev.team === 1)) s.kills[ev.team === 0 ? 1 : 0]++;
    else if (ev.kind === Kind.Monster) {
      const kt = teamOf(sim, ev.killer);
      if (kt !== 0 && kt !== 1) continue;
      s.monsters[kt]++;
      if (campOf(sim, ev.eid)?.id === 'schattenkrabbe') s.crabs[kt]++;
    } else if (ev.kind === Kind.Tower && s.tower < 0 && (ev.team === 0 || ev.team === 1)) s.tower = ev.team === 0 ? 1 : 0;
  }
  if (jungle) {
    if (sim.tick - s.start >= s.duration) {
      s.end = sim.tick;
      const a = junglePoints(s, 0);
      const b = junglePoints(s, 1);
      s.winner = a > b ? 0 : b > a ? 1 : -1;
    }
    return;
  }
  const o = sim.config.trainer ?? {};
  const needKills = o.kills ?? 1;
  const needCs = o.cs ?? 100;
  const cs = csOf(sim);
  let w = s.tower;
  if (w < 0) for (const t of [0, 1] as const) if (s.kills[t] >= needKills || cs[t] >= needCs) w = t;
  if (w >= 0) {
    s.winner = w;
    s.end = sim.tick;
  }
}

export function duelHud(sim: Sim, s: DuelState): TrainerHud {
  const me = humanEid(sim);
  const mine = (me >= 0 ? sim.c.Unit.team[me]! : 0) === 1 ? 1 : 0;
  const theirs = mine === 0 ? 1 : 0;
  const jungle = sim.config.mode === 'jungleDuel';
  const cs = csOf(sim);
  const stats: TrainerHud['stats'] = jungle
    ? [
        { k: 'pointsMe', v: junglePoints(s, mine), fmt: 'int' },
        { k: 'pointsBot', v: junglePoints(s, theirs), fmt: 'int' },
        { k: 'monstersMe', v: s.monsters[mine], fmt: 'int' },
        { k: 'monstersBot', v: s.monsters[theirs], fmt: 'int' },
        { k: 'crabsMe', v: s.crabs[mine], fmt: 'int' },
        { k: 'crabsBot', v: s.crabs[theirs], fmt: 'int' },
        { k: 'killsMe', v: s.kills[mine], fmt: 'int' },
        { k: 'killsBot', v: s.kills[theirs], fmt: 'int' },
      ]
    : [
        { k: 'killsMe', v: s.kills[mine], fmt: 'int' },
        { k: 'killsBot', v: s.kills[theirs], fmt: 'int' },
        { k: 'csMe', v: cs[mine], fmt: 'int' },
        { k: 'csBot', v: cs[theirs], fmt: 'int' },
      ];
  return {
    kind: sim.config.mode,
    time: runSeconds(sim, s.start, s.end),
    duration: s.duration / 30,
    done: s.end >= 0,
    ...(s.end >= 0 ? { won: s.winner === mine } : {}),
    score: jungle ? junglePoints(s, mine) : s.winner === mine ? 100 : 0,
    grade: s.end < 0 ? '' : s.winner === mine ? 'S' : s.winner < 0 ? 'B' : 'D',
    stats,
  };
}
