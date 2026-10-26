// A14 recall statistics: npx tsx tools/a14/recallStats.ts --seed=101 --rank=gold [--minutes=12] [--brain=new]
// Counts recall commands, started channels, completed recalls and broken channels (why: bot moved / attacked /
// cast, took damage, other) per role.
import { botGameConfig } from '../../src/ai/runner';
import { runBotGame } from '../../src/ai/harness';
import type { Rank } from '../../src/ai/profiles/schema';
import { BUILDS } from '../../src/ai/bot/builds';
import sevBuild from '../../src/data/builds/sev.json';
BUILDS.sev ??= sevBuild as (typeof BUILDS)[string];

declare const process: { argv: string[]; stdout: { write(s: string): void } };
const args = new Map(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true'] as const; }));
const seed = Number(args.get('seed') ?? 101);
const rank = (args.get('rank') ?? 'gold') as Rank;
const minutes = Number(args.get('minutes') ?? 12);
const newBrain = (args.get('brain') ?? 'new') === 'new';
const config = botGameConfig(seed, rank);
if (newBrain) config.botUtility = true;

interface S { cmds: number; started: number; done: number; broken: Record<string, number>; chanTicks: number }
const stats = new Map<number, S>();
for (const p of config.players) stats.set(p.slot, { cmds: 0, started: 0, done: 0, broken: {}, chanTicks: 0 });
const prev = new Map<number, { rec: number; hp: number; x: number; y: number; cmd: string }>();
const lastCmd = new Map<number, string>();
const roleOf = new Map(config.players.map((p) => [p.slot, p.role]));

const res = runBotGame(
  config,
  Math.round(minutes * 60 * 30),
  (sim, inputs) => {
    const { Champ, Pos, Hp, Unit } = sim.c;
    for (const i of inputs) {
      const s = stats.get(i.slot);
      if (!s) continue;
      const t = (i.cmd as { t: string }).t;
      if (t === 'recall') s.cmds++;
      if (t === 'move' || t === 'attack' || t === 'spell' || t === 'stop' || t === 'recall') lastCmd.set(i.slot, t);
    }
    for (const p of config.players) {
      const e = sim.slots[p.slot]!;
      const s = stats.get(p.slot)!;
      const rec = Champ.recallAt[e]!;
      const pr = prev.get(p.slot);
      if (pr) {
        if (rec > 0) s.chanTicks++;
        if (pr.rec === 0 && rec > 0) s.started++;
        if (pr.rec > 0 && rec === 0) {
          const f = sim.map.sides[Unit.team[e]!]!.fountain;
          const home = Math.hypot(Pos.x[e]! - f.x, Pos.y[e]! - f.y) <= f.r + 200;
          if (home && Math.hypot(pr.x - Pos.x[e]!, pr.y - Pos.y[e]!) > 500) s.done++;
          else {
            const why = Hp.cur[e]! < pr.hp - 0.5 ? 'damage' : lastCmd.get(p.slot) === 'recall' ? 'other' : `cmd:${lastCmd.get(p.slot)}`;
            s.broken[why] = (s.broken[why] ?? 0) + 1;
          }
        }
      }
      prev.set(p.slot, { rec, hp: Hp.cur[e]!, x: Pos.x[e]!, y: Pos.y[e]!, cmd: '' });
    }
  },
  { noVariance: args.get('variance') === '0', reflex: newBrain },
);
const out = [`# recallStats seed=${seed} rank=${rank} brain=${newBrain ? 'new' : 'default'} minutes=${res.minutes.toFixed(1)}`];
const tot: S = { cmds: 0, started: 0, done: 0, broken: {}, chanTicks: 0 };
for (const [slot, s] of stats) {
  out.push(`  slot ${slot} ${String(roleOf.get(slot)).padEnd(7)} cmds ${s.cmds} started ${s.started} done ${s.done} broken ${JSON.stringify(s.broken)} channelS ${(s.chanTicks / 30).toFixed(0)}`);
  tot.cmds += s.cmds;
  tot.started += s.started;
  tot.done += s.done;
  tot.chanTicks += s.chanTicks;
  for (const [k, v] of Object.entries(s.broken)) tot.broken[k] = (tot.broken[k] ?? 0) + v;
}
out.push(`TOTAL cmds ${tot.cmds} started ${tot.started} done ${tot.done} broken ${JSON.stringify(tot.broken)} channelS ${(tot.chanTicks / 30).toFixed(0)}`);
const reasons = new Map<string, number>();
for (const p of config.players) for (const e of res.bots.log.entries(p.slot)) if (e.node === 'recall' || (e.node === 'intent' && e.chosen === 'recall')) reasons.set(`${e.node}:${e.chosen}:${e.reason}`, (reasons.get(`${e.node}:${e.chosen}:${e.reason}`) ?? 0) + 1);
out.push('log entries (deduped 5 s):');
for (const [k, c] of [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) out.push(`  ${String(c).padStart(4)}  ${k}`);
process.stdout.write(out.join('\n') + '\n');
