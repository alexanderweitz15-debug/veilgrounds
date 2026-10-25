// A13 combat micro measurement (docs/agents/wave1-a13.md). Plays headless beta-brain games (reflex + utility) and
// measures, from the sim's ground truth (harness side, never the brain): skillshot hit rate, dodge rate, trade
// balance, deaths in teamfights, kills per game, CS@10 of the laners, idle share and game length.
//
//   npx tsx tools/botHints/combatBench.ts --rank=gold --games=4 --minutes=20 --seed=101            (self play)
//   npx tsx tools/botHints/combatBench.ts --rank=gold --pairs=4 --minutes=20 --seed=101 --ab        (micro vs no micro)
//
// --ab plays every seed twice with the sides swapped: team A has the combat micro layer on, team B plays like before
// A13 (BOT_MICRO=0 behaviour, src/ai/combat/flag.ts). Self play (default) has it on for both teams; run it with
// BOT_MICRO=0 for the "before" numbers of the same code.
// Definitions (all ground truth, per team of the caster / victim):
//   skillshot hit rate  = aimed skillshot casts (cursor within AIMED_R of an enemy champion) that damaged an enemy
//                         champion within HIT_WINDOW ticks / aimed casts
//   dodge rate          = threats (an enemy line projectile on a path through the champion, or a ground telegraph over
//                         it, the first time that holds) that did not damage it / threats
//   trade balance       = champion damage dealt / (dealt + taken) of the team, laning phase (before 14:00)
//   teamfight deaths    = champion deaths with >= 2 other allies and >= 2 enemies within TF_R

import { RANKS, type Rank } from '../../src/ai/profiles/schema';
import { botGameConfig } from '../../src/ai/runner';
import { newSide, playConfig, report, sum } from './metrics';
declare const process: { argv: string[]; stdout: { write(s: string): void } };

const playGame = (seed: number, microTeam: number | undefined) => playConfig(botGameConfig(seed, rank), microTeam, minutes, noVariance);

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k!, v ?? 'true'] as const;
  }),
);
const rank = (args.get('rank') ?? 'gold') as Rank;
if (!RANKS.includes(rank)) throw new Error(`unknown rank ${rank}`);
const ab = args.get('ab') === 'true';
const games = Number(args.get('pairs') ?? args.get('games') ?? 4);
const minutes = Number(args.get('minutes') ?? 20);
const seed0 = Number(args.get('seed') ?? 101);
const noVariance = args.get('variance') === '0';
const json = args.get('json') === 'true';

const t0 = Date.now();
if (ab) {
  let on = newSide();
  let off = newSide();
  let ticks = 0;
  let wins = 0;
  for (let g = 0; g < games; g++) {
    for (const microTeam of [0, 1]) {
      const r = playGame(seed0 + g, microTeam);
      on = sum(on, r.sides[microTeam]!);
      off = sum(off, r.sides[1 - microTeam]!);
      ticks += r.ticks;
      if (r.winner === microTeam) wins++;
    }
  }
  const n = games * 2;
  process.stdout.write(`A/B ${rank} seeds ${seed0}..${seed0 + games - 1} x2 sides, ${minutes} min, avg length ${(ticks / n / 1800).toFixed(1)} min, micro wins ${wins}/${n}, wall ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
  report('micro ON ', on, n);
  report('micro OFF', off, n);
  if (json) process.stdout.write(JSON.stringify({ on, off, n }) + '\n');
} else {
  let all = newSide();
  let ticks = 0;
  for (let g = 0; g < games; g++) {
    const r = playGame(seed0 + g, undefined);
    all = sum(all, sum(r.sides[0], r.sides[1]));
    ticks += r.ticks;
  }
  process.stdout.write(`self ${rank} seeds ${seed0}..${seed0 + games - 1}, ${minutes} min, avg length ${(ticks / games / 1800).toFixed(1)} min, wall ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
  // kills/game counts both teams in self play
  report('all teams', all, games);
  if (json) process.stdout.write(JSON.stringify({ all, n: games }) + '\n');
}
