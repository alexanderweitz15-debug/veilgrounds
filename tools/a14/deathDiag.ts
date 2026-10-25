// A14: where and how do the beta bots die? npx tsx tools/a14/deathDiag.ts --seed=101 --rank=gold [--minutes=20]
// One line per champion death: time, role, level, hp one second before, intent / mode / last intent log reason,
// enemy champions within 1500 (roles), nearest tower side and distance, enemy minions near, gold carried.
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
const newBrain = (args.get('brain') ?? 'new') === 'new';
const config = botGameConfig(seed, rank);
if (newBrain) config.botUtility = true;
const roleOf = new Map(config.players.map((p) => [p.slot, p.role]));
const fmt = (t: number): string => `${Math.floor(t / 1800)}:${String(Math.floor((t / 30) % 60)).padStart(2, '0')}`;
const wasAlive = new Map<number, boolean>();
const hist = new Map<number, { hp: number; intent: string; mode: string; x: number; y: number }[]>();
const out: string[] = [];
let deaths = 0;
runBotGame(
  config,
  Math.round(minutes * 60 * 30),
  (sim, _in, runnerAny) => {
    const runner = runnerAny as unknown as { bots: { ctx: { slot: number }; mem: never }[]; log: { latest(bot: number, pred?: (x: { node: string }) => boolean): { chosen: string; reason: string } | undefined } };
    const { Unit, Pos, Hp, Champ } = sim.c;
    const T = sim.tick;
    for (const p of config.players) {
      const e = sim.slots[p.slot]!;
      const alive = !!Unit.alive[e];
      const h = hist.get(p.slot) ?? [];
      if (alive && T % 5 === 0) {
        const b = runner.bots.find((x) => x.ctx.slot === p.slot)!;
        h.push({ hp: Hp.cur[e]! / Hp.max[e]!, intent: utilityDebug(b.mem)?.intent ?? '-', mode: (b.mem as { mode: string }).mode, x: Pos.x[e]!, y: Pos.y[e]! });
        if (h.length > 8) h.shift();
        hist.set(p.slot, h);
      }
      if (wasAlive.get(p.slot) && !alive) {
        deaths++;
        const first = h[0];
        const last = h[h.length - 1];
        const foes: string[] = [];
        let towerD = Infinity;
        let towerTeam = -1;
        let eMin = 0;
        for (let o = 0; o < Unit.kind.length; o++) {
          if (!Unit.alive[o]) continue;
          const k = Unit.kind[o]!;
          const d = Math.hypot(Pos.x[o]! - Pos.x[e]!, Pos.y[o]! - Pos.y[e]!);
          if (k === Kind.Champion && Unit.team[o] !== p.team && d < 1800) foes.push(`${roleOf.get(Unit.slot[o]!) ?? '?'}@${Math.round(d)}`);
          if (k === Kind.Tower && d < towerD) (towerD = d), (towerTeam = Unit.team[o]!);
          if ((k === Kind.MinionMelee || k === Kind.MinionCaster || k === Kind.MinionSiege) && Unit.team[o] !== p.team && d < 700) eMin++;
        }
        const b = runner.bots.find((x) => x.ctx.slot === p.slot)!;
        const le = runner.log.latest(p.slot, (x) => x.node === 'intent');
        out.push(
          `${fmt(T)} ${String(roleOf.get(p.slot)).padEnd(7)} team${p.team} lvl ${Champ.level[e]} hp(-1.3s) ${first ? Math.round(first.hp * 100) : '?'}% -> ${last ? Math.round(last.hp * 100) : '?'}% intent ${first?.intent}->${utilityDebug(b.mem)?.intent} mode ${first?.mode} log ${le?.chosen}:${le?.reason} foes [${foes.join(' ')}] tower ${towerTeam === p.team ? 'own' : 'ENEMY'}@${Math.round(towerD)} enemyMinions700 ${eMin} gold ${Math.round(Champ.gold[e]!)}`,
        );
      }
      wasAlive.set(p.slot, alive);
    }
  },
  { noVariance: args.get('variance') === '0', reflex: newBrain },
);
out.push(`deaths: ${deaths}`);
process.stdout.write(out.join('\n') + '\n');
