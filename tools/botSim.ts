// npm run bot-sim -- --rank=gold --games=5 --minutes=20 [--seed=1] [--archetype=farmer] [--vs=silver [--mirror]] [--sides]
//                    [--variance=0] [--out=bots.csv] [--game-out=games.csv] [--report[=report.md]] [--scenario=laneAlone]
// Runs headless bot-vs-bot games and prints one CSV line per champion per game (calibration against Table A in the
// rank profiles) plus style metrics (spec-bots §10 acceptance) and the brain-rework metrics (docs/BRAIN-REWORK.md
// §10: CS loss by cause, attack utilisation, idle share, harass, plates, objective conversion, gank deaths, recalls
// with the wave at the own tower, intent histogram, think / reflex cost). --archetype gives all ten bots that lobby
// preset (data/bots/archetypes.json); a summary per run goes to stderr. --vs gives the red team (slots 5-9) another
// rank: the summary then reports blue's win rate (nexus, or ahead in team gold earned when the time runs out).
// --variance=0 switches the per-game rank variance off (reproducible win rates). --report writes a markdown summary
// against the targets in tools/botSimTargets.json (red outside the tolerance) to stdout or the given file.
// --scenario=laneAlone: the last-hit trainer scenario (one bot alone in mid, autos only, --minutes default 10).
// --champion=<id>: laneAlone champion; in normal games blue's mid laner.
// --reflex=true: reflex layer on; --utility=true: utility model on; --brain=new: both (the game's beta brain).
// --jobs=N: parallel child processes (default CPU cores - 2; --jobs=1 sequential, same CSV).

import { RANKS, type Rank } from '../src/ai/profiles/schema';
import { ARCHETYPES, type Archetype } from '../src/ai/contract';
import { botGameConfig } from '../src/ai/runner';
import { CS_CAUSES, runBotGame, runLaneAlone, type ChampStats, type CsCause, type GameResult } from '../src/ai/harness';
import targets from './botSimTargets.json';
import { BUILDS } from '../src/ai/bot/builds';
import sevBuild from '../src/data/builds/sev.json';

// ponytail: Sev (agent E) has no line in src/ai/bot/builds.ts yet (brain team, docs/agents/issues.md); until then the
// tool registers his build at runtime so bot-sim Sevs buy items.
BUILDS.sev ??= sevBuild as (typeof BUILDS)[string];

// No @types/node in this repo: declare the bits of the Node API this tool uses.
declare const process: { argv: string[]; stdout: { write(s: string): void }; stderr: { write(s: string): void } };
declare const performance: { now(): number };

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
const scenario = args.get('scenario');
const games = Number(args.get('games') ?? 5);
const minutes = Number(args.get('minutes') ?? (scenario === 'laneAlone' ? 10 : 20));
const seed0 = Number(args.get('seed') ?? 1);
const outFile = args.get('out');
const gameOut = args.get('game-out');
const report = args.get('report');
const noVariance = args.get('variance') === '0';
const vs = args.get('vs') as Rank | undefined;
if (vs && !RANKS.includes(vs)) throw new Error(`unknown rank ${vs}`);
// --mirror (with --vs): every seed is played twice, the second time with the ranks swapped between the teams, so
// champion picks and map side cancel out; the summary reports the games won by --rank's team.
const mirror = args.get('mirror') === 'true';
// --sides: every seed is played twice, the second time with the two line-ups (champions, ranks, personalities)
// swapped between blue and red, so the summary separates a map-side bias (blue wins) from a line-up bias.
const sides = args.get('sides') === 'true';
if (sides && mirror) throw new Error('--sides and --mirror are exclusive');
let lineupAWins = 0;
let blueWins = 0;
let rankWins = 0;
let rankNexusWins = 0;
let decided = 0;

const lines = [
  'game,seed,rank,archetype,team,role,champion,cs,csPerMin,kills,deaths,goldPerMin,dmgToChamps,maxIdleS,gameMin,winner,trades,tradeS,orbwalk,roamsPerMin,wardsPerMin,recallsPerMin,' +
    'cs15,laneMinions15,laneCs15,' + CS_CAUSES.map((c) => `loss15_${c}`).join(',') + ',laneMinions,laneCs,' + CS_CAUSES.map((c) => `loss_${c}`).join(',') +
    ',attackUtil,idleShare,harassAutos,harassAutos14,harassSpells,tradesStarted,killsFromHarass,recallsWaveAtTower,gankDeaths,avoidableGankDeaths,deathsNoChamp,modeSwitchesPerMin,topModes',
];
const gameLines = ['game,seed,gameMin,winner,firstTowerMin,kills,kills14,kills15,plates0,plates1,towers0,towers1,fightsWon0,fightsWon1,converted0,converted1,thinkMsPerCall,reflexMsPerCall'];
const r1 = (n: number): string => n.toFixed(1);
const r2 = (n: number): string => n.toFixed(2);
const r3 = (n: number): string => n.toFixed(3);
const all: { s: ChampStats; min: number }[] = [];
/** What the summary needs of one game (serialisable: --jobs children send it back as JSON). */
type GameLite = Omit<GameResult, 'sim' | 'bots' | 'hash'> & { wallS: number };
interface GameRec {
  g: number;
  seed: number;
  rankTeam: number;
  aTeam: number;
  res: GameLite;
}
const results: { res: GameLite; seed: number }[] = [];
const lengths: number[] = [];
const pacing: { ft: number | undefined; k15: number; k25: number; towers: number; winner: number | undefined; min: number }[] = [];
const isLaner = (s: ChampStats): boolean => s.role === 'top' || s.role === 'mid' || s.role === 'adc';

function playGame(g: number): GameRec {
  const swap = !!vs && mirror && g % 2 === 1;
  const sideSwap = sides && g % 2 === 1;
  const seed = seed0 + (mirror || sides ? Math.floor(g / 2) : g);
  const t0 = Date.now();
  let res: GameResult;
  if (scenario === 'laneAlone') {
    res = runLaneAlone(rank, { minutes, seed, clock: () => performance.now(), noVariance: true, ...(args.has('champion') ? { champion: args.get('champion')! } : {}), ...(args.get('reflex') === '0' ? { reflex: false } : {}) });
  } else {
    const config = botGameConfig(seed, rank);
    if (archetype) for (const p of config.players) p.bot!.archetype = archetype;
    // --champion=<id> (normal games): blue's mid laner plays this champion
    if (args.has('champion')) config.players.find((p) => p.team === 0 && p.role === 'mid')!.champion = args.get('champion')!;
    if (vs) for (const p of config.players) if (p.team === (swap ? 0 : 1)) p.bot!.rank = vs;
    if (sideSwap) {
      for (const p of config.players) {
        p.slot = (p.slot + 5) % 10;
        p.team = p.team === 0 ? 1 : 0;
      }
      config.players.sort((a, b) => a.slot - b.slot);
    }
    // --brain=new: the game's beta setting 'Neues Bot-Gehirn' (reflex layer + utility model); --utility=true alone
    const newBrain = args.get('brain') === 'new';
    if (newBrain || args.get('utility') === 'true') config.botUtility = true;
    res = runBotGame(config, Math.round(minutes * 60 * 30), undefined, { noVariance, reflex: newBrain || args.get('reflex') === 'true', clock: () => performance.now() });
  }
  const { sim: _sim, bots: _bots, hash: _hash, ...lite } = res;
  void _sim;
  void _bots;
  void _hash;
  return { g, seed, rankTeam: swap ? 1 : 0, aTeam: sideSwap ? 1 : 0, res: { ...lite, wallS: (Date.now() - t0) / 1000 } };
}

// --jobs=N (default: CPU cores - 2): games run in parallel child processes, each plays its share and sends the
// summaries back as JSON; --jobs=1 runs everything in this process. Children are this script with --child-games.
const fsMod = (await import('node:' + 'fs')) as { writeFileSync(path: string, data: string): void; readFileSync(path: string, enc: string): string; unlinkSync(path: string): void };
const childGames = args.get('child-games');
const recs: GameRec[] = [];
if (childGames !== undefined) {
  const out: GameRec[] = childGames ? childGames.split(',').map((x) => playGame(Number(x))) : [];
  fsMod.writeFileSync(args.get('child-out')!, JSON.stringify(out));
  (process as unknown as { exit(code: number): never }).exit(0);
} else {
  const os = (await import('node:' + 'os')) as { cpus(): unknown[]; tmpdir(): string };
  const jobs = Math.max(1, Math.min(games, Number(args.get('jobs') ?? Math.max(1, os.cpus().length - 2))));
  if (jobs <= 1) {
    for (let g = 0; g < games; g++) recs.push(playGame(g));
  } else {
    const cp = (await import('node:' + 'child_process')) as { spawn(cmd: string, argv: string[], o: { stdio: unknown[] }): { on(ev: string, cb: (code: number) => void): void } };
    const nodeProc = process as unknown as { execPath: string; execArgv: string[]; pid: number };
    const fwd = process.argv.slice(2).filter((a) => !/^--(out|game-out|report|jobs|child-games|child-out)(=|$)/.test(a));
    const parts: number[][] = Array.from({ length: jobs }, () => []);
    for (let g = 0; g < games; g++) parts[g % jobs]!.push(g);
    const files = parts.map((_, i) => `${os.tmpdir()}/botsim-${nodeProc.pid}-${i}.json`);
    process.stderr.write(`running ${games} games in ${jobs} processes\n`);
    await Promise.all(
      parts.map(
        (list, i) =>
          new Promise<void>((resolve, reject) => {
            const child = cp.spawn(nodeProc.execPath, [...nodeProc.execArgv, process.argv[1]!, ...fwd, `--child-games=${list.join(',')}`, `--child-out=${files[i]}`], { stdio: ['ignore', 'ignore', 'inherit'] });
            child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`bot-sim child ${i} exited with ${code}`))));
          }),
      ),
    );
    for (const file of files) {
      recs.push(...(JSON.parse(fsMod.readFileSync(file, 'utf8')) as GameRec[]));
      fsMod.unlinkSync(file);
    }
    recs.sort((a, b) => a.g - b.g);
  }
}
for (const rec of recs) {
  const { g, seed, rankTeam, aTeam, res } = rec;
  results.push({ res, seed });
  lengths.push(res.minutes);
  pacing.push({ ft: res.firstTowerMin, k15: res.killsAt15, k25: res.killsAt25, towers: res.towersTaken[0] + res.towersTaken[1], winner: res.winner, min: res.minutes });
  if (res.winner !== undefined) decided++;
  const teamGold = (t: number): number => res.stats.filter((x) => x.team === t).reduce((a, x) => a + x.goldEarned, 0);
  if (res.winner === 0 || (res.winner === undefined && teamGold(0) > teamGold(1))) blueWins++;
  if (res.winner === rankTeam || (res.winner === undefined && teamGold(rankTeam) > teamGold(1 - rankTeam))) rankWins++;
  if (res.winner === rankTeam) rankNexusWins++;
  if (res.winner === aTeam || (res.winner === undefined && teamGold(aTeam) > teamGold(1 - aTeam))) lineupAWins++;
  for (const s of res.stats) {
    all.push({ s, min: res.minutes });
    const modeTotal = Object.values(s.modeTicks).reduce((a, b) => a + b, 0) || 1;
    const topModes = Object.entries(s.modeTicks).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m, t]) => `${m}:${Math.round((100 * t) / modeTotal)}`).join(' ');
    lines.push(
      [
        g, seed, s.rank, archetype ?? '', s.team, s.role, s.champion, s.cs, r1(s.cs / res.minutes), s.kills, s.deaths, r1(s.goldEarned / res.minutes), Math.round(s.damageToChampions), r1(s.maxIdleS), r1(res.minutes), res.winner ?? '',
        s.trades, r2(s.trades ? s.tradeS / s.trades : 0), r2(s.autos ? s.orbOk / s.autos : 0), r2(s.roams / res.minutes), r2(s.wards / res.minutes), r2(s.recalls / res.minutes),
        s.cs15, s.laneMinions15, s.laneCs15, ...CS_CAUSES.map((c) => s.csLoss15[c]), s.laneMinions, s.laneCs, ...CS_CAUSES.map((c) => s.csLoss[c]),
        r3(s.utilDen ? s.utilNum / s.utilDen : 0), r3(s.utilDen ? s.idleTicks / s.utilDen : 0), s.harassAutos, s.harassAutos14, s.harassSpells, s.tradesStarted, s.killsFromHarass, s.recallsWaveAtTower,
        s.gankDeaths, s.avoidableGankDeaths, s.deathsNoChamp, r2(s.modeSwitches / res.minutes), topModes,
      ].join(','),
    );
  }
  const tk = res.stats.reduce((a, x) => a + x.kills, 0);
  gameLines.push(
    [
      g, seed, r2(res.minutes), res.winner ?? '', res.firstTowerMin === undefined ? '' : r2(res.firstTowerMin), tk, res.killsAt14, res.killsAt15, res.plates[0], res.plates[1], res.towersTaken[0], res.towersTaken[1],
      res.fightsWon[0], res.fightsWon[1], res.fightsConverted[0], res.fightsConverted[1], r3(res.cost.thinks ? res.cost.thinkMs / res.cost.thinks : 0), r3(res.cost.reflexCalls ? res.cost.reflexMs / res.cost.reflexCalls : 0),
    ].join(','),
  );
  const laners = res.stats.filter(isLaner);
  const ln = laners.reduce((a, s) => a + s.laneMinions15, 0);
  const lc = laners.reduce((a, s) => a + s.laneCs15, 0);
  process.stderr.write(
    `game ${g + 1}/${games} seed ${seed}: ${r1(res.minutes)} min in ${r1(res.wallS)} s, winner ${res.winner ?? '-'}, ` +
      `first tower ${res.firstTowerMin === undefined ? '-' : r1(res.firstTowerMin)}, towers ${res.towersTaken[0]}:${res.towersTaken[1]}, kills ${res.killsAt15}@15 ${res.killsAt25}@25 ${tk} total, ` +
      `laner lane CS@15 ${lc}/${ln}${scenario === 'laneAlone' ? `, CS ${laners[0]?.cs ?? 0}` : ''}\n`,
  );
}
// run summary (means over all champions; CS/min over laners)
const mean = (f: (x: { s: ChampStats; min: number }) => number, pred: (s: ChampStats) => boolean = () => true): number => {
  const xs = all.filter((x) => pred(x.s));
  return xs.length ? xs.reduce((a, x) => a + f(x), 0) / xs.length : 0;
};
const mean2 = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const trades = all.reduce((a, x) => a + x.s.trades, 0);
const tradeS = all.reduce((a, x) => a + x.s.tradeS, 0);
const autos = all.reduce((a, x) => a + x.s.autos, 0);
const orbOk = all.reduce((a, x) => a + x.s.orbOk, 0);
const lanerSum = (f: (s: ChampStats) => number): number => all.filter((x) => isLaner(x.s)).reduce((a, x) => a + f(x.s), 0);
process.stderr.write(
  `summary rank=${rank} archetype=${archetype ?? 'rolled'} games=${games}: laner CS/min ${r2(mean((x) => x.s.cs / x.min, isLaner))}, ` +
    `laner CS/min @15 ${r2(mean((x) => x.s.cs15 / Math.min(15, x.min), isLaner))}, ` +
    `deaths/game ${r2(mean((x) => x.s.deaths))}, kills/game ${r2(mean((x) => x.s.kills))}, game length ${r1(lengths.reduce((a, b) => a + b, 0) / lengths.length)} min, ` +
    `trade ${r2(trades ? tradeS / trades : 0)} s (${trades}), orbwalk ${r2(autos ? orbOk / autos : 0)}, roams/min ${r2(mean((x) => x.s.roams / x.min))}, ` +
    `wards/min ${r2(mean((x) => x.s.wards / x.min))}, recalls/min ${r2(mean((x) => x.s.recalls / x.min))}, max idle ${r1(Math.max(...all.map((x) => x.s.maxIdleS)))} s` +
    `, gold/min ${r1(mean((x) => x.s.goldEarned / x.min))}, total kills/game ${r1(all.reduce((a, x) => a + x.s.kills, 0) / Math.max(1, games))}, decided ${decided}/${games}` +
    `, first tower ${r1(mean2(pacing.filter((p) => p.ft !== undefined).map((p) => p.ft!)))} min (${pacing.filter((p) => p.ft !== undefined).length}/${games})` +
    `, kills@15 ${r1(mean2(pacing.map((p) => p.k15)))}, kills@25 ${r1(mean2(pacing.map((p) => p.k25)))}, towers/game ${r1(mean2(pacing.map((p) => p.towers)))}` +
    `, pathing: moves/min ${r1(mean((x) => x.s.moveCmds / x.min))}, reversals/min ${r2(mean((x) => x.s.reversals / x.min))}, stuck s/min ${r2(mean((x) => x.s.stuckS / x.min))}, path eff ${r2(all.reduce((a, x) => a + x.s.effSum, 0) / Math.max(1, all.reduce((a, x) => a + x.s.effN, 0)))}` +
    `, decided games length ${r1(mean2(pacing.filter((p) => p.winner !== undefined).map((p) => p.min)))} min` +
    `, attack util ${r3(lanerSum((s) => s.utilNum) / Math.max(1, lanerSum((s) => s.utilDen)))}, idle share ${r3(lanerSum((s) => s.idleTicks) / Math.max(1, lanerSum((s) => s.utilDen)))}` +
    (vs && !mirror ? `, blue (${rank}) vs red (${vs}): blue wins ${blueWins}/${games} (nexus, or more team gold at the end)` : '') +
    (vs && mirror ? `, ${rank} vs ${vs} mirrored: ${rank} wins ${rankWins}/${games} (${rankNexusWins} by nexus; else more team gold at the end)` : '') +
    (sides ? `, sides swapped: blue wins ${blueWins}/${games}, line-up A wins ${lineupAWins}/${games}` : `, blue wins ${blueWins}/${games}`) +
    '\n',
);
const fs = fsMod;
const csv = lines.join('\n') + '\n';
if (outFile) fs.writeFileSync(outFile, csv);
else if (!report || report !== 'true') process.stdout.write(csv);
if (gameOut) fs.writeFileSync(gameOut, gameLines.join('\n') + '\n');
if (report) {
  const md = buildReport();
  if (report === 'true') process.stdout.write(md);
  else fs.writeFileSync(report, md);
}

// ------------------------------------------------------------------ markdown report (§10)

type MetricDef = { label: string; src: string; type: 'target' | 'max' | 'min'; values: Record<string, number | null> };

/** Target of a metric for the run's rank: exact anchor, or linear between the two neighbouring given anchors. */
function targetFor(def: MetricDef): number | null {
  const idx = RANKS.indexOf(rank);
  const anchors = Object.entries(targets.anchors as Record<string, number>).map(([r, i]) => ({ i, v: def.values[r] ?? null })).sort((a, b) => a.i - b.i);
  const exact = anchors.find((a) => a.i === idx);
  if (exact) return exact.v;
  const lo = [...anchors].reverse().find((a) => a.i < idx);
  const hi = anchors.find((a) => a.i > idx);
  if (!lo || !hi || lo.v === null || hi.v === null) return null;
  return lo.v + ((hi.v - lo.v) * (idx - lo.i)) / (hi.i - lo.i);
}

function status(def: MetricDef, value: number, target: number | null): string {
  if (target === null || !Number.isFinite(value)) return '-';
  const tol = targets.tolerance;
  const ok = def.type === 'max' ? value <= target * (1 + tol) : def.type === 'min' ? value >= target * (1 - tol) : Math.abs(value - target) <= Math.abs(target) * tol;
  return ok ? 'green' : '**red**';
}

function buildReport(): string {
  const laners = all.filter((x) => isLaner(x.s));
  const nL = Math.max(1, laners.length);
  const sumL = (f: (s: ChampStats) => number): number => laners.reduce((a, x) => a + f(x.s), 0);
  const deaths = all.reduce((a, x) => a + x.s.deaths, 0);
  const killsTotal = all.reduce((a, x) => a + x.s.kills, 0);
  const kills14 = results.reduce((a, r) => a + r.res.killsAt14, 0);
  const minuteSum = laners.reduce((a, x) => a + x.min, 0);
  const lanes15 = sumL((s) => s.laneMinions15);
  const absence15 = sumL((s) => s.csLoss15.absent_recall + s.csLoss15.absent_heal + s.csLoss15.absent_roam + s.csLoss15.absent_dead);
  const decidedLen = pacing.filter((p) => p.winner !== undefined).map((p) => p.min);
  const values: Record<string, number> = {
    lanerCsPerMin15: mean((x) => x.s.cs15 / Math.min(15, x.min), isLaner),
    lanerCsPerMinEnd: mean((x) => x.s.cs / x.min, isLaner),
    killsPerGame: killsTotal / Math.max(1, games),
    firstTowerMin: mean2(pacing.filter((p) => p.ft !== undefined).map((p) => p.ft!)),
    gameMin: decidedLen.length ? mean2(decidedLen) : NaN,
    attackUtil: sumL((s) => s.utilNum) / Math.max(1, sumL((s) => s.utilDen)),
    idleShare: sumL((s) => s.idleTicks) / Math.max(1, sumL((s) => s.utilDen)),
    harassPerMin: sumL((s) => s.harassAutos) / Math.max(1, minuteSum),
    laningKillShare: killsTotal ? kills14 / killsTotal : NaN,
    deathsNoChampShare: deaths ? all.reduce((a, x) => a + x.s.deathsNoChamp, 0) / deaths : NaN,
    tradeS: trades ? tradeS / trades : NaN,
    platesPerTeam14: results.reduce((a, r) => a + r.res.plates[0] + r.res.plates[1], 0) / Math.max(1, 2 * games),
    absenceLoss15: lanes15 ? absence15 / lanes15 : NaN,
  };
  const out: string[] = [];
  out.push(`# bot-sim report: ${rank}${vs ? ` vs ${vs}${mirror ? ' (mirrored)' : ''}` : ''}${scenario ? ` (${scenario})` : ''}`);
  out.push('');
  out.push(`Games ${games}, seeds ${seed0}..${seed0 + (mirror || sides ? Math.ceil(games / 2) : games) - 1}, limit ${minutes} min, variance ${noVariance ? 'off' : 'on'}, archetype ${archetype ?? 'rolled'}, decided ${decided}/${games}.`);
  out.push('');
  out.push('## Targets (docs/BRAIN-REWORK.md; tolerance ±' + Math.round(targets.tolerance * 100) + ' %)');
  out.push('');
  out.push('| Metric | Source | Value | Target | Status |');
  out.push('|---|---|---|---|---|');
  for (const [k, def] of Object.entries(targets.metrics as Record<string, MetricDef>)) {
    const v = values[k] ?? NaN;
    const t = targetFor(def);
    out.push(`| ${def.label} | ${def.src} | ${Number.isFinite(v) ? r3(v) : '-'} | ${t === null ? '-' : (def.type === 'max' ? '≤ ' : def.type === 'min' ? '≥ ' : '') + r3(t)} | ${status(def, v, t)} |`);
  }
  out.push('');
  out.push('## CS loss by cause (laners top/mid/adc, enemy minions of the own lane, until 15:00)');
  out.push('');
  const lc15 = sumL((s) => s.laneCs15);
  const lossSum = CS_CAUSES.reduce((a, c) => a + sumL((s) => s.csLoss15[c]), 0);
  out.push(`Lane minions ${lanes15}, last-hit by the laner ${lc15} (${r1((100 * lc15) / Math.max(1, lanes15))} %), lost ${lanes15 - lc15}. Sum of causes ${lossSum} - ${lossSum === lanes15 - lc15 ? 'matches the real losses (gate)' : '**does not match the real losses**'}.`);
  out.push('');
  out.push('| Cause | Minions | Share of lane minions | Per laner |');
  out.push('|---|---|---|---|');
  for (const c of CS_CAUSES) {
    const n = sumL((s) => s.csLoss15[c as CsCause]);
    out.push(`| ${c} | ${n} | ${r1((100 * n) / Math.max(1, lanes15))} % | ${r1(n / nL)} |`);
  }
  out.push('');
  out.push('## Other metrics');
  out.push('');
  const recalls = sumL((s) => s.recalls);
  const ganks = all.reduce((a, x) => a + x.s.gankDeaths, 0);
  const fw = results.reduce((a, r) => a + r.res.fightsWon[0] + r.res.fightsWon[1], 0);
  const fc = results.reduce((a, r) => a + r.res.fightsConverted[0] + r.res.fightsConverted[1], 0);
  const ff = results.reduce((a, r) => a + r.res.fightsFeasible[0] + r.res.fightsFeasible[1], 0);
  const ffc = results.reduce((a, r) => a + r.res.fightsConvertedFeasible[0] + r.res.fightsConvertedFeasible[1], 0);
  const cost = results.reduce((a, r) => ({ t: a.t + r.res.cost.thinkMs, tn: a.tn + r.res.cost.thinks, r: a.r + r.res.cost.reflexMs, rn: a.rn + r.res.cost.reflexCalls }), { t: 0, tn: 0, r: 0, rn: 0 });
  const roamers = all.filter((x) => x.s.role === 'mid' || x.s.role === 'support');
  const rows: [string, string][] = [
    ['Harass autos / spells per laner (game)', `${r1(sumL((s) => s.harassAutos) / nL)} / ${r1(sumL((s) => s.harassSpells) / nL)}`],
    ['Harass autos per laner before 14:00 (Phase 2 gate ≥ 40)', r1(sumL((s) => s.harassAutos14) / nL)],
    ['Trades started per laner, avg trade duration', `${r1(sumL((s) => s.tradesStarted) / nL)}, ${r2(trades ? tradeS / trades : 0)} s`],
    ['Kills from harass window (per game)', r2(all.reduce((a, x) => a + x.s.killsFromHarass, 0) / Math.max(1, games))],
    ['Plates per team before 14:00', r2(values.platesPerTeam14!)],
    ['First tower (min), games with a tower', `${r2(values.firstTowerMin!)}, ${pacing.filter((p) => p.ft !== undefined).length}/${games}`],
    ['Objective conversion after won fights (structure / epic / plate in 30 s)', `${fc}/${fw} (${fw ? r1((100 * fc) / fw) : '-'} %)`],
    ['Conversion of feasible won fights (winner near a live enemy tower / epic)', `${ffc}/${ff} (${ff ? r1((100 * ffc) / ff) : '-'} %)`],
    ['Gank deaths / avoidable (jungler seen 5-20 s before)', `${ganks} / ${all.reduce((a, x) => a + x.s.avoidableGankDeaths, 0)}`],
    ['Laner recalls with the enemy wave at the own tower', `${sumL((s) => s.recallsWaveAtTower)}/${recalls}`],
    ['Roams per 10 min (mid + support)', r2(roamers.reduce((a, x) => a + (10 * x.s.roams) / x.min, 0) / Math.max(1, roamers.length))],
    ['Wards per min (all bots)', r2(mean((x) => x.s.wards / x.min))],
    ['Mode switches per min (all bots)', r2(mean((x) => x.s.modeSwitches / x.min))],
    ['Think cost ms per decision (mean)', cost.tn ? r3(cost.t / cost.tn) : '-'],
    ['Reflex cost ms per bot and tick (mean)', cost.rn ? r3(cost.r / cost.rn) : '- (no reflex layer)'],
  ];
  out.push('| Metric | Value |');
  out.push('|---|---|');
  for (const [k, v] of rows) out.push(`| ${k} | ${v} |`);
  out.push('');
  out.push('## Mode / intent histogram (share of bot ticks, all bots)');
  out.push('');
  const modes: Record<string, number> = {};
  for (const x of all) for (const [m, t] of Object.entries(x.s.modeTicks)) modes[m] = (modes[m] ?? 0) + t;
  const mt = Object.values(modes).reduce((a, b) => a + b, 0) || 1;
  out.push('| Mode | Share |');
  out.push('|---|---|');
  for (const [m, t] of Object.entries(modes).sort((a, b) => b[1] - a[1])) out.push(`| ${m} | ${r1((100 * t) / mt)} % |`);
  out.push('');
  out.push('## Idle reasons (laners, idle ticks by the latest log entry)');
  out.push('');
  const idle: Record<string, number> = {};
  for (const x of laners) for (const [k, t] of Object.entries(x.s.idleReasons)) idle[k] = (idle[k] ?? 0) + t;
  const it = Object.values(idle).reduce((a, b) => a + b, 0) || 1;
  out.push('| Reason | Share |');
  out.push('|---|---|');
  for (const [k, t] of Object.entries(idle).sort((a, b) => b[1] - a[1]).slice(0, 12)) out.push(`| ${k} | ${r1((100 * t) / it)} % |`);
  out.push('');
  out.push('## in_range_no_attack by bot state at the death (laners, to 15:00: mode | lane intent | distance | attack)');
  out.push('');
  const noAtk: Record<string, number> = {};
  for (const x of laners) for (const [k, t] of Object.entries(x.s.noAtkReasons ?? {})) noAtk[k] = (noAtk[k] ?? 0) + t;
  const nt = Object.values(noAtk).reduce((a, b) => a + b, 0) || 1;
  out.push('| State | Share |');
  out.push('|---|---|');
  for (const [k, t] of Object.entries(noAtk).sort((a, b) => b[1] - a[1]).slice(0, 15)) out.push(`| ${k} | ${r1((100 * t) / nt)} % |`);
  out.push('');
  out.push('## Per role (CS/min @15, attack util, idle share)');
  out.push('');
  out.push('| Role | CS/min @15 | CS/min end | Util | Idle |');
  out.push('|---|---|---|---|---|');
  for (const role of ['top', 'mid', 'adc', 'jungle', 'support']) {
    const xs = all.filter((x) => x.s.role === role);
    if (!xs.length) continue;
    const ud = xs.reduce((a, x) => a + x.s.utilDen, 0);
    out.push(`| ${role} | ${r2(mean2(xs.map((x) => x.s.cs15 / Math.min(15, x.min))))} | ${r2(mean2(xs.map((x) => x.s.cs / x.min)))} | ${ud ? r3(xs.reduce((a, x) => a + x.s.utilNum, 0) / ud) : '-'} | ${ud ? r3(xs.reduce((a, x) => a + x.s.idleTicks, 0) / ud) : '-'} |`);
  }
  out.push('');
  return out.join('\n');
}
