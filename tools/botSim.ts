// npm run bot-sim -- --rank=gold --games=5 --minutes=20 [--seed=1] [--out=file.csv]
// Runs headless bot-vs-bot games and prints one CSV line per champion per game (base for Phase 3/4 calibration
// against Table A in the rank profiles).

import { RANKS, type Rank } from '../src/ai/profiles/schema';
import { botGameConfig } from '../src/ai/runner';
import { runBotGame } from '../src/ai/harness';

// No @types/node in this repo: declare the bits of the Node API this tool uses.
declare const process: { argv: string[]; stdout: { write(s: string): void }; stderr: { write(s: string): void } };

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k!, v ?? 'true'] as const;
  }),
);
const rank = (args.get('rank') ?? 'gold') as Rank;
if (!RANKS.includes(rank)) throw new Error(`unknown rank ${rank}; one of ${RANKS.join(', ')}`);
const games = Number(args.get('games') ?? 5);
const minutes = Number(args.get('minutes') ?? 20);
const seed0 = Number(args.get('seed') ?? 1);
const outFile = args.get('out');

const lines = ['game,seed,rank,team,role,champion,cs,csPerMin,kills,deaths,goldPerMin,dmgToChamps,maxIdleS,gameMin,winner'];
const r1 = (n: number): string => n.toFixed(1);
for (let g = 0; g < games; g++) {
  const seed = seed0 + g;
  const t0 = Date.now();
  const res = runBotGame(botGameConfig(seed, rank), Math.round(minutes * 60 * 30));
  for (const s of res.stats) {
    lines.push(
      [g, seed, s.rank, s.team, s.role, s.champion, s.cs, r1(s.cs / res.minutes), s.kills, s.deaths, r1(s.goldEarned / res.minutes), Math.round(s.damageToChampions), r1(s.maxIdleS), r1(res.minutes), res.winner ?? ''].join(','),
    );
  }
  process.stderr.write(`game ${g + 1}/${games} seed ${seed}: ${r1(res.minutes)} min in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);
}
const csv = lines.join('\n') + '\n';
if (outFile) {
  const fs = (await import('node:' + 'fs')) as { writeFileSync(path: string, data: string): void };
  fs.writeFileSync(outFile, csv);
} else process.stdout.write(csv);
