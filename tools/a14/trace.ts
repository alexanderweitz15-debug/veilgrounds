// A14: macro trace. npx tsx tools/a14/trace.ts --seed=101 --rank=gold --from=8 --to=20 --every=30
// Every `every` seconds: per team the team-AI desires, per bot role / intent / lane / distance to the nearest enemy
// tower / HP / gold / mode. For finding out what the team does between minute 8 and the end.
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
const from = Number(args.get('from') ?? 8) * 1800;
const to = Number(args.get('to') ?? 20) * 1800;
const every = Number(args.get('every') ?? 30) * 30;
const team = Number(args.get('team') ?? 0);
const config = botGameConfig(seed, rank);
config.botUtility = true;
const out: string[] = [];
const fmt = (t: number): string => `${Math.floor(t / 1800)}:${String(Math.floor((t / 30) % 60)).padStart(2, '0')}`;
runBotGame(
  config,
  to,
  (sim, _in, runner) => {
    const T = sim.tick;
    if (T < from || T % every !== 0) return;
    const { Unit, Pos, Hp, Champ } = sim.c;
    const towers: { x: number; y: number; team: number }[] = [];
    for (let e = 0; e < Unit.kind.length; e++) if (Unit.alive[e] && Unit.kind[e] === Kind.Tower) towers.push({ x: Pos.x[e]!, y: Pos.y[e]!, team: Unit.team[e]! });
    const ta = (runner as unknown as { teams: { desires: { kind: string; lane?: string; slots: number[]; reason: string }[] }[] }).teams[team]!;
    out.push(`${fmt(T)} towers b${towers.filter((t) => t.team === 0).length} r${towers.filter((t) => t.team === 1).length} desires[${ta.desires.map((d) => `${d.kind}${d.lane ? ':' + d.lane : ''}(${d.slots.join('')})`).join(' ')}]`);
    for (const b of (runner as unknown as { bots: { ctx: { slot: number; team: number; role: string }; mem: never }[] }).bots) {
      if (b.ctx.team !== team) continue;
      const e = sim.slots[b.ctx.slot]!;
      if (!Unit.alive[e]) {
        out.push(`    ${b.ctx.role.padEnd(7)} dead`);
        continue;
      }
      let dn = Infinity;
      for (const t of towers) if (t.team !== team) dn = Math.min(dn, Math.hypot(t.x - Pos.x[e]!, t.y - Pos.y[e]!));
      const d = utilityDebug(b.mem);
      out.push(`    ${b.ctx.role.padEnd(7)} ${String(d?.intent).padEnd(9)} mode ${String((b.mem as { mode: string }).mode).padEnd(8)} hp ${String(Math.round((100 * Hp.cur[e]!) / Hp.max[e]!)).padStart(3)}% gold ${String(Math.round(Champ.gold[e]!)).padStart(5)} toEnemyTower ${String(Math.round(dn)).padStart(5)} at ${Math.round(Pos.x[e]!)},${Math.round(Pos.y[e]!)}`);
    }
  },
  { noVariance: args.get('variance') === '0', reflex: true },
);
process.stdout.write(out.join('\n') + '\n');
