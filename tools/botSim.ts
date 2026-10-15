// npm run bot-sim -- --rank=gold --games=5 --minutes=20 [--seed=1] [--archetype=farmer] [--vs=silver] [--out=file.csv]
// Runs headless bot-vs-bot games and prints one CSV line per champion per game (calibration against Table A in the
// rank profiles) plus style metrics (spec-bots §10 acceptance): trade duration, orbwalk ratio, roams/min,
// wards/min, recalls/min. --archetype gives all ten bots that lobby preset (data/bots/archetypes.json); a summary
// per run goes to stderr. --vs gives the red team (slots 5-9) another rank: the summary then reports blue's win
// rate (nexus, or ahead in team gold earned when the time runs out).

import { RANKS, type Rank } from '../src/ai/profiles/schema';
import { ARCHETYPES, type Archetype } from '../src/ai/contract';
import { botGameConfig } from '../src/ai/runner';
import { runBotGame, type ChampStats } from '../src/ai/harness';

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
const archetype = args.get('archetype') as Archetype | undefined;
if (archetype && !ARCHETYPES.includes(archetype)) throw new Error(`unknown archetype ${archetype}; one of ${ARCHETYPES.join(', ')}`);
const games = Number(args.get('games') ?? 5);
const minutes = Number(args.get('minutes') ?? 20);
const seed0 = Number(args.get('seed') ?? 1);
const outFile = args.get('out');
const vs = args.get('vs') as Rank | undefined;
if (vs && !RANKS.includes(vs)) throw new Error(`unknown rank ${vs}`);
let blueWins = 0;
let decided = 0;

const lines = ['game,seed,rank,archetype,team,role,champion,cs,csPerMin,kills,deaths,goldPerMin,dmgToChamps,maxIdleS,gameMin,winner,trades,tradeS,orbwalk,roamsPerMin,wardsPerMin,recallsPerMin'];
const r1 = (n: number): string => n.toFixed(1);
const r2 = (n: number): string => n.toFixed(2);
const all: { s: ChampStats; min: number }[] = [];
const lengths: number[] = [];
for (let g = 0; g < games; g++) {
  const seed = seed0 + g;
  const t0 = Date.now();
  const config = botGameConfig(seed, rank);
  if (archetype) for (const p of config.players) p.bot!.archetype = archetype;
  if (vs) for (const p of config.players) if (p.team === 1) p.bot!.rank = vs;
  const res = runBotGame(config, Math.round(minutes * 60 * 30));
  lengths.push(res.minutes);
  if (res.winner !== undefined) decided++;
  const teamGold = (t: number): number => res.stats.filter((x) => x.team === t).reduce((a, x) => a + x.goldEarned, 0);
  if (res.winner === 0 || (res.winner === undefined && teamGold(0) > teamGold(1))) blueWins++;
  for (const s of res.stats) {
    all.push({ s, min: res.minutes });
    lines.push(
      [
        g, seed, s.rank, archetype ?? '', s.team, s.role, s.champion, s.cs, r1(s.cs / res.minutes), s.kills, s.deaths, r1(s.goldEarned / res.minutes), Math.round(s.damageToChampions), r1(s.maxIdleS), r1(res.minutes), res.winner ?? '',
        s.trades, r2(s.trades ? s.tradeS / s.trades : 0), r2(s.autos ? s.orbOk / s.autos : 0), r2(s.roams / res.minutes), r2(s.wards / res.minutes), r2(s.recalls / res.minutes),
      ].join(','),
    );
  }
  process.stderr.write(`game ${g + 1}/${games} seed ${seed}: ${r1(res.minutes)} min in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);
}
// run summary (means over all champions; CS/min over laners)
const mean = (f: (x: { s: ChampStats; min: number }) => number, pred: (s: ChampStats) => boolean = () => true): number => {
  const xs = all.filter((x) => pred(x.s));
  return xs.length ? xs.reduce((a, x) => a + f(x), 0) / xs.length : 0;
};
const trades = all.reduce((a, x) => a + x.s.trades, 0);
const tradeS = all.reduce((a, x) => a + x.s.tradeS, 0);
const autos = all.reduce((a, x) => a + x.s.autos, 0);
const orbOk = all.reduce((a, x) => a + x.s.orbOk, 0);
process.stderr.write(
  `summary rank=${rank} archetype=${archetype ?? 'rolled'} games=${games}: laner CS/min ${r2(mean((x) => x.s.cs / x.min, (s) => s.role !== 'support' && s.role !== 'jungle'))}, ` +
    `deaths/game ${r2(mean((x) => x.s.deaths))}, kills/game ${r2(mean((x) => x.s.kills))}, game length ${r1(lengths.reduce((a, b) => a + b, 0) / lengths.length)} min, ` +
    `trade ${r2(trades ? tradeS / trades : 0)} s (${trades}), orbwalk ${r2(autos ? orbOk / autos : 0)}, roams/min ${r2(mean((x) => x.s.roams / x.min))}, ` +
    `wards/min ${r2(mean((x) => x.s.wards / x.min))}, recalls/min ${r2(mean((x) => x.s.recalls / x.min))}, max idle ${r1(Math.max(...all.map((x) => x.s.maxIdleS)))} s` +
    `, gold/min ${r1(mean((x) => x.s.goldEarned / x.min))}, total kills/game ${r1(all.reduce((a, x) => a + x.s.kills, 0) / Math.max(1, all.length / 10))}, decided ${decided}/${games}` +
    (vs ? `, blue (${rank}) vs red (${vs}): blue wins ${blueWins}/${games} (nexus, or more team gold at the end)` : '') +
    '\n',
);
const csv = lines.join('\n') + '\n';
if (outFile) {
  const fs = (await import('node:' + 'fs')) as { writeFileSync(path: string, data: string): void };
  fs.writeFileSync(outFile, csv);
} else process.stdout.write(csv);
