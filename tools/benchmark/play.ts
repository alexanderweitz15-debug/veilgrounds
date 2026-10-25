// One benchmark game: build the config exactly like tools/botSim.ts (--rank / --vs / --mirror / --brain), run the
// harness with the observer attached and return the per-team accumulators plus the game-level numbers.

import { botGameConfig } from '../../src/ai/runner';
import { runBotGame } from '../../src/ai/harness';
import { BUILDS } from '../../src/ai/bot/builds';
import sevBuild from '../../src/data/builds/sev.json';
import type { Rank } from '../../src/ai/profiles/schema';
import { createObserver, type TeamRaw } from './observer';
import { isLanerRole, ROLES } from './metrics';

// same runtime registration as tools/botSim.ts (Sev has no line in builds.ts yet)
BUILDS.sev ??= sevBuild as (typeof BUILDS)[string];

export type Brain = 'old' | 'new';
export interface GameSpec {
  /** Pair label "x:ref" (same rank for both teams: "gold:gold"). */
  pair: string;
  x: Rank;
  ref: Rank;
  seed: number;
  /** Rank X plays the red team (mirrored game of a pair). */
  flip: boolean;
  brain: Brain;
  minutes: number;
  /** 'L' lane set (short games), 'F' full set (until the nexus or the limit). */
  set: 'L' | 'F';
  /** Per-game rank variance (botSim --variance=0 is the default here). */
  variance: boolean;
}
export interface GameRaw {
  spec: GameSpec;
  hash: string;
  minutes: number;
  winner: number | null;
  wallS: number;
  /** Teams that count as rank X (both for same-rank pairs). */
  xTeams: number[];
  teams: [TeamRaw, TeamRaw];
}

/** Ticks -> sim minutes as the harness defines them. */
export function playGame(spec: GameSpec, clock?: () => number): GameRaw {
  const t0 = clock?.() ?? 0;
  const config = botGameConfig(spec.seed, spec.x);
  if (spec.x !== spec.ref) for (const p of config.players) if (p.team === (spec.flip ? 0 : 1)) p.bot!.rank = spec.ref;
  if (spec.brain === 'new') config.botUtility = true;
  const obs = createObserver(config);
  const res = runBotGame(config, Math.round(spec.minutes * 60 * 30), (sim, inputs) => obs.onTick(sim, inputs), { noVariance: !spec.variance, reflex: spec.brain === 'new' });
  const o = obs.finish(res.sim);
  const teams = o.teams;
  const add = (t: number, id: string, n: number, d = 0): void => {
    const c = (teams[t]!.ratio[id] ??= [0, 0]);
    c[0] += n;
    c[1] += d;
  };
  const minutes = res.minutes;
  const decided = res.winner !== undefined;
  const gold = [0, 1].map((t) => res.stats.filter((s) => s.team === t).reduce((a, s) => a + s.goldEarned, 0));
  const killsTotal = res.stats.reduce((a, s) => a + s.kills, 0);
  for (const t of [0, 1]) {
    add(t, 'killsGame', killsTotal, 1);
    add(t, 'gameLen', decided ? minutes : 0, decided ? 1 : 0);
    add(t, 'decided', decided ? 1 : 0, 1);
    add(t, 'firstTowerMin', o.firstTower ? o.firstTower.min : 0, o.firstTower ? 1 : 0);
    add(t, 'firstTower', o.firstTower && o.firstTower.team === t ? 1 : 0, o.firstTower ? 1 : 0);
    add(t, 'winNexus', res.winner === t ? 1 : 0, decided ? 1 : 0);
    add(t, 'winLead', res.winner === t || (!decided && gold[t]! > gold[1 - t]!) ? 1 : 0, 1);
    add(t, 'goldPerMin', gold[t]!, 5 * minutes);
    add(t, 'plates', o.plates[t]!, o.plates[0] + o.plates[1]);
    add(t, 'deathsPer10', 0, (5 * minutes) / 10);
    add(t, 'recallPer10', 0, (5 * minutes) / 10);
    for (const role of ROLES) {
      add(t, `deathsPer10.${role}`, 0, minutes / 10);
      add(t, `recallPer10.${role}`, 0, minutes / 10);
    }
    for (const s of res.stats) if (s.team === t && isLanerRole(s.role)) add(t, 'csEnd', s.cs, minutes);
  }
  const xTeams = spec.x === spec.ref ? [0, 1] : [spec.flip ? 1 : 0];
  return { spec, hash: res.hash, minutes, winner: res.winner ?? null, wallS: clock ? (clock() - t0) / 1000 : 0, xTeams, teams };
}
