// A14: share of time per utility intent per role + structure state at the end.
// npx tsx tools/a14/intentHist.ts --seed=101 --rank=gold [--minutes=20] [--brain=new]
import { botGameConfig } from '../../src/ai/runner';
import { runBotGame } from '../../src/ai/harness';
import { utilityDebug } from '../../src/ai/utility/select';
import { Kind } from '../../src/sim/types';
import type { Rank } from '../../src/ai/profiles/schema';
import { BUILDS } from '../../src/ai/bot/builds';
import sevBuild from '../../src/data/builds/sev.json';
BUILDS.sev ??= sevBuild as (typeof BUILDS)[string];

declare const process: { argv: string[]; stdout: { write(s: string): void } };
const args = new Map(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true'] as const; }));
const seed = Number(args.get('seed') ?? 101);
const rank = (args.get('rank') ?? 'gold') as Rank;
const minutes = Number(args.get('minutes') ?? 20);
const config = botGameConfig(seed, rank);
config.botUtility = true;
const res = runBotGame(config, Math.round(minutes * 60 * 30), undefined, { noVariance: args.get('variance') === '0', reflex: true });
const out = [`# intentHist seed=${seed} rank=${rank} minutes=${res.minutes.toFixed(1)} kills=${res.killsAt15}@15 firstTower=${res.firstTowerMin}`];
const sum = new Map<string, Map<string, number>>();
for (const b of res.bots.bots) {
  const d = utilityDebug(b.mem);
  if (!d) continue;
  const role = b.ctx.role;
  const m = sum.get(role) ?? new Map<string, number>();
  for (const [k, v] of Object.entries(d.hist)) m.set(k, (m.get(k) ?? 0) + (v as number));
  sum.set(role, m);
}
for (const [role, m] of sum) {
  const tot = [...m.values()].reduce((a, b) => a + b, 0);
  out.push(`  ${role.padEnd(8)} ${[...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${((100 * v) / tot).toFixed(0)}%`).join('  ')}`);
}
const { Unit, Hp } = res.sim.c;
const towers: string[] = [];
for (let e = 0; e < Unit.kind.length; e++) if (Unit.alive[e] && Unit.kind[e] === Kind.Tower) towers.push(`t${Unit.team[e]}:${Math.round((100 * Hp.cur[e]!) / Hp.max[e]!)}%`);
out.push(`towers alive ${towers.length}: ${towers.join(' ')}`);
process.stdout.write(out.join('\n') + '\n');
