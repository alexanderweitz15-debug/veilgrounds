// Veilgrounds bot benchmark (A6). Headless bot-vs-bot matches with fixed seeds, metrics measured from sim state,
// events and bot commands only (tools/benchmark/observer.ts); JSON + markdown + self-contained HTML report.
//
//   npx tsx tools/benchmark/cli.ts run --brain=new --pairs=iron:gold,gold:gold,diamond:gold,challenger:gold \
//        --seeds=1..4 --minutes=15 --set=L --jobs=2 --out=bench/new-L.json
//   npx tsx tools/benchmark/cli.ts report --in=bench/old-L.json,bench/new-L.json,bench/old-F.json,bench/new-F.json --out=bench/report
//
// run options:
//   --brain=old|new     old = default brain, new = beta brain (reflex layer + utility model, like botSim --brain=new)
//   --pairs=x:ref,...   rank X against reference rank (default iron:gold,gold:gold,diamond:gold,challenger:gold). x == ref:
//                       one game per seed (both teams count). x != ref: one game per seed, X on red for even seeds, or with
//                       --mirror=1 every seed twice with the ranks swapped between the sides (cancels line-up / side bias).
//   --seeds=1..4|1,2,5  sim seeds (default 1..4);  --minutes=15  limit per game;  --set=L|F  (L: lane set, F: full set)
//   --variance=1        keep the per-game rank variance (default off, like botSim --variance=0)
//   --jobs=N            parallel child processes (default 2);  --out=file.json  results (written after every game;
//                       an existing file is resumed: games already in it are skipped)
// report options: --in=a.json,b.json  --out=dir  -> dir/report.html, dir/report.md, dir/results.json (merged)
// Same seeds + same commit -> same numbers (tests/benchmarkDeterminism.test.ts).

import type { Rank } from '../../src/ai/profiles/schema';
import { RANKS } from '../../src/ai/profiles/schema';
import { playGame, type GameRaw, type GameSpec } from './play';
import { buildHtml, buildMarkdown, type ReportMeta } from './report';

declare const process: { argv: string[]; execPath: string; execArgv: string[]; pid: number; stderr: { write(s: string): void }; stdout: { write(s: string): void }; exit(code: number): never; cwd(): string };
declare const performance: { now(): number };

interface ResultFile {
  version: 1;
  head: string;
  commands: string[];
  games: GameRaw[];
}

const argv = process.argv.slice(2);
const mode = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'run';
const args = new Map(
  argv
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, ...v] = a.replace(/^--/, '').split('=');
      return [k!, v.length ? v.join('=') : 'true'] as const;
    }),
);

const fsMod = (await import('node:' + 'fs')) as {
  writeFileSync(p: string, d: string): void;
  readFileSync(p: string, e: string): string;
  existsSync(p: string): boolean;
  mkdirSync(p: string, o: { recursive: boolean }): void;
  unlinkSync(p: string): void;
  renameSync(a: string, b: string): void;
};
const cp = (await import('node:' + 'child_process')) as {
  spawn(cmd: string, argv: string[], o: { stdio: unknown[] }): { on(ev: string, cb: (code: number) => void): void };
  execSync(cmd: string, o?: { encoding: string }): string;
};
const osMod = (await import('node:' + 'os')) as { tmpdir(): string };

const specKey = (s: GameSpec): string => `${s.brain}|${s.set}|${s.pair}|${s.seed}|${s.flip ? 1 : 0}|${s.minutes}|${s.variance ? 1 : 0}`;

function parseSeeds(s: string): number[] {
  const out: number[] = [];
  for (const part of s.split(',')) {
    const m = /^(\d+)\.\.(\d+)$/.exec(part);
    if (m) for (let i = Number(m[1]); i <= Number(m[2]); i++) out.push(i);
    else out.push(Number(part));
  }
  return out;
}

function gitHead(): string {
  try {
    return cp.execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function planGames(): GameSpec[] {
  const brain = (args.get('brain') ?? 'new') as 'old' | 'new';
  if (brain !== 'old' && brain !== 'new') throw new Error('--brain=old|new');
  const set = (args.get('set') ?? 'L') as 'L' | 'F';
  const minutes = Number(args.get('minutes') ?? (set === 'F' ? 45 : 15));
  const seeds = parseSeeds(args.get('seeds') ?? '1..4');
  const variance = args.get('variance') === '1';
  const pairs = (args.get('pairs') ?? 'iron:gold,gold:gold,diamond:gold,challenger:gold').split(',');
  const mirror = args.get('mirror') === '1';
  const specs: GameSpec[] = [];
  // seeds outer, pairs inner: a partial run already covers every pair evenly
  for (const seed of seeds) {
    for (const p of pairs) {
      const [x, ref] = p.split(':') as [Rank, Rank];
      if (!RANKS.includes(x) || !RANKS.includes(ref)) throw new Error(`unknown rank in pair ${p}; ranks: ${RANKS.join(', ')}`);
      // x == ref: one game, both teams count. x != ref: --mirror=1 plays the seed twice (sides swapped), otherwise once
      // with X on red for even seeds (side and line-up bias are balanced over the seeds, not per seed)
      const flips = x === ref ? [false] : mirror ? [false, true] : [seed % 2 === 0];
      for (const flip of flips) specs.push({ pair: p, x, ref, seed, flip, brain, minutes, set, variance });
    }
  }
  return specs;
}

async function runChild(): Promise<void> {
  const spec = JSON.parse(args.get('child-spec')!) as GameSpec;
  const res = playGame(spec, () => performance.now());
  fsMod.writeFileSync(args.get('child-out')!, JSON.stringify(res));
  process.exit(0);
}

async function runMain(): Promise<void> {
  const out = args.get('out');
  const jobs = Math.max(1, Number(args.get('jobs') ?? 2));
  const specs = planGames();
  const done: GameRaw[] = [];
  if (out && fsMod.existsSync(out)) {
    const prev = JSON.parse(fsMod.readFileSync(out, 'utf8')) as ResultFile;
    done.push(...prev.games);
  }
  const have = new Set(done.map((g) => specKey(g.spec)));
  const todo = specs.filter((s) => !have.has(specKey(s)));
  const cmd = `npx tsx tools/benchmark/cli.ts ${argv.join(' ')}`;
  const head = gitHead();
  const save = (): void => {
    if (!out) return;
    const file: ResultFile = { version: 1, head, commands: [cmd], games: done };
    fsMod.writeFileSync(out + '.tmp', JSON.stringify(file));
    fsMod.renameSync(out + '.tmp', out);
  };
  process.stderr.write(`benchmark: ${todo.length} games to play (${done.length} already in ${out ?? 'memory'}), ${jobs} jobs\n`);
  let next = 0;
  let finished = 0;
  const t0 = Date.now();
  const worker = async (id: number): Promise<void> => {
    while (next < todo.length) {
      const spec = todo[next++]!;
      const file = `${osMod.tmpdir()}/bench-${process.pid}-${id}-${next}.json`;
      await new Promise<void>((resolve, reject) => {
        const child = cp.spawn(process.execPath, [...process.execArgv, process.argv[1]!, 'child', `--child-spec=${JSON.stringify(spec)}`, `--child-out=${file}`], { stdio: ['ignore', 'ignore', 'inherit'] });
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`benchmark child exited with ${code} for ${specKey(spec)}`))));
      });
      const res = JSON.parse(fsMod.readFileSync(file, 'utf8')) as GameRaw;
      fsMod.unlinkSync(file);
      done.push(res);
      finished++;
      save();
      process.stderr.write(`[${((Date.now() - t0) / 60000).toFixed(1)} min] ${finished}/${todo.length} ${specKey(spec)}: ${res.minutes.toFixed(1)} sim-min in ${res.wallS.toFixed(0)} s, winner ${res.winner ?? '-'}, hash ${res.hash}\n`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, Math.max(1, todo.length)) }, (_, i) => worker(i)));
  save();
  if (!out) process.stdout.write(JSON.stringify({ version: 1, head, commands: [cmd], games: done }));
}

function reportMain(): void {
  const ins = (args.get('in') ?? '').split(',').filter(Boolean);
  const outDir = args.get('out') ?? 'bench/report';
  if (!ins.length) throw new Error('report: --in=a.json,b.json');
  const games: GameRaw[] = [];
  const commands: string[] = [];
  let head = '';
  for (const f of ins) {
    const r = JSON.parse(fsMod.readFileSync(f, 'utf8')) as ResultFile;
    games.push(...r.games);
    commands.push(...r.commands);
    head ||= r.head;
  }
  games.sort((a, b) => (a.spec.brain + a.spec.set + a.spec.pair).localeCompare(b.spec.brain + b.spec.set + b.spec.pair) || a.spec.seed - b.spec.seed || Number(a.spec.flip) - Number(b.spec.flip));
  const meta: ReportMeta = { commands: [...new Set(commands)], head, ...(args.get('note') ? { note: args.get('note')! } : {}) };
  fsMod.mkdirSync(outDir, { recursive: true });
  fsMod.writeFileSync(`${outDir}/report.md`, buildMarkdown(games, meta));
  fsMod.writeFileSync(`${outDir}/report.html`, buildHtml(games, meta));
  fsMod.writeFileSync(`${outDir}/results.json`, JSON.stringify({ version: 1, head, commands: meta.commands, games } satisfies ResultFile));
  process.stderr.write(`report written to ${outDir}/ (report.html, report.md, results.json), ${games.length} games\n`);
}

if (mode === 'child') await runChild();
else if (mode === 'report') reportMain();
else if (mode === 'run') await runMain();
else throw new Error(`unknown mode ${mode}; run | report`);
