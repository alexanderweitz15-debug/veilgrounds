// A13 arena lab: 5v5 teamfight arena (trainer mode 'arena': level 11, rounds, bots engage on sight), one team with the
// combat micro layer, the other without; each seed is played twice with the roles of the teams swapped. Many casts per
// minute, so aim and dodge numbers are measured quickly. (The arena leaf of the brain throws abilities and autos at the
// weakest enemy in sight: trades, combos and spacing are not exercised here - see combatBench.ts for full games.)
//
//   npx tsx tools/botHints/arenaBench.ts --rank=gold --seeds=4 --rounds=4

import { RANKS, type Rank } from '../../src/ai/profiles/schema';
import { championsForRole, seedPersonalities } from '../../src/ai/runner';
import { Rng } from '../../src/sim/rng';
import type { PlayerSetup, SimConfig } from '../../src/sim/types';
import { CHAMPION_DATA } from '../../src/sim/champions';
import { newSide, playConfig, report, sum } from './metrics';

declare const process: { argv: string[]; stdout: { write(s: string): void } };

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k!, v ?? 'true'] as const;
  }),
);
const rank = (args.get('rank') ?? 'gold') as Rank;
if (!RANKS.includes(rank)) throw new Error(`unknown rank ${rank}`);
const seeds = Number(args.get('seeds') ?? 4);
const seed0 = Number(args.get('seed') ?? 301);
const rounds = Number(args.get('rounds') ?? 4);
const roundSec = Number(args.get('roundSec') ?? 40);
const size = Number(args.get('size') ?? 5);

void championsForRole;

function arena(seed: number): SimConfig {
  const rng = new Rng(seed ^ 0xa13a);
  const ids = Object.keys(CHAMPION_DATA).sort();
  const pick: string[] = [];
  while (pick.length < size * 2) {
    const c = ids[rng.int(ids.length)]!;
    if (!pick.includes(c)) pick.push(c);
  }
  const players: PlayerSetup[] = pick.map((champion, i) => ({
    slot: i < size ? i : 5 + (i - size),
    team: i < size ? 0 : 1,
    champion,
    role: 'mid',
    summoners: ['sprung', 'heilen'],
    isHuman: false,
    bot: { rank, variance: 'stable' },
  }));
  seedPersonalities(seed, players);
  return { seed, mode: 'arena', players, minionsEnabled: false, trainer: { level: 11, rounds, roundSec } };
}

let on = newSide();
let off = newSide();
let games = 0;
const t0 = Date.now();
for (let s = 0; s < seeds; s++) {
  for (const microTeam of [0, 1] as const) {
    const r = playConfig(arena(seed0 + s), microTeam, (rounds * 2 + 1) * ((roundSec + 4) / 60), true);
    on = sum(on, r.sides[microTeam]!);
    off = sum(off, r.sides[1 - microTeam]!);
    games++;
  }
}
process.stdout.write(`arena ${rank} ${size}v${size}, ${seeds} seeds x2 sides = ${games} games, wall ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
report('micro ON ', on, games);
report('micro OFF', off, games);
