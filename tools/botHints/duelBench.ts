// A13 lane duels: 1v1 in the mid lane (laneOnly mode, minions of both teams), one champion with the combat micro layer,
// the other playing like before A13, sides and champions swapped. Cheap and low-variance compared with full games:
// it isolates aim, dodge, combos, spacing and trading.
//
//   npx tsx tools/botHints/duelBench.ts --rank=gold --minutes=6 --seeds=3 [--pairs=mira:tobin,ilvane:aurel]
//
// Output: the metrics of micro ON and micro OFF (definitions in combatBench.ts), the damage balance and the winner
// share of the micro side.

import { RANKS, type Rank } from '../../src/ai/profiles/schema';
import { seedPersonalities } from '../../src/ai/runner';
import { Lane, type PlayerSetup, type SimConfig } from '../../src/sim/types';
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
const minutes = Number(args.get('minutes') ?? 6);
const seeds = Number(args.get('seeds') ?? 3);
const seed0 = Number(args.get('seed') ?? 201);
const DEFAULT_PAIRS = 'mira:tobin,ilvane:aurel,seraphyne:thessaly,kiran:lio,corvin:wren,sev:nyx,kaelen:renn,brom:dagny';
const pairs = (args.get('pairs') ?? DEFAULT_PAIRS).split(',').map((p) => p.split(':') as [string, string]);

function duel(blue: string, red: string, seed: number): SimConfig {
  const mk = (slot: number, team: 0 | 1, champion: string): PlayerSetup => ({
    slot,
    team,
    champion,
    role: 'mid',
    summoners: ['sprung', 'entflammen'],
    isHuman: false,
    bot: { rank, variance: 'stable', playstyle: { vision: -5 } },
  });
  const players = [mk(0, 0, blue), mk(5, 1, red)];
  seedPersonalities(seed, players);
  return { seed, mode: 'laneOnly', minionLanes: [Lane.Mid], players };
}

let on = newSide();
let off = newSide();
let games = 0;
let microWins = 0;
let decided = 0;
const t0 = Date.now();
for (const [a, b] of pairs) {
  for (let s = 0; s < seeds; s++) {
    // A and B each play once as the micro side, on blue; and once on red
    for (const [blue, red, microTeam] of [
      [a, b, 0],
      [b, a, 1],
      [a, b, 1],
      [b, a, 0],
    ] as [string, string, 0 | 1][]) {
      const r = playConfig(duel(blue, red, seed0 + s), microTeam, minutes, true);
      on = sum(on, r.sides[microTeam]!);
      off = sum(off, r.sides[1 - microTeam]!);
      games++;
      // winner share: kills, then damage dealt
      const m = r.sides[microTeam]!;
      const o = r.sides[1 - microTeam]!;
      const score = m.kills - o.kills || m.dealt - o.dealt;
      if (score !== 0) {
        decided++;
        if (score > 0) microWins++;
      }
    }
  }
}
process.stdout.write(`duels ${rank} ${pairs.length} pairs x ${seeds} seeds x 4 = ${games} games of ${minutes} min, micro side ahead in ${microWins}/${decided}, wall ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
report('micro ON ', on, games);
report('micro OFF', off, games);
