// A14 recall diagnosis: npx tsx tools/a14/recallDiag.ts --seed=101 --rank=gold [--minutes=15]
// Lists the recall decisions of the beta brain (intent 'recall' chosen) with the terms that made them: item / hp /
// mana benefit, wave cost, gold, HP, and whether the bot recalled on the wave it had.
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
const minutes = Number(args.get('minutes') ?? 15);
const config = botGameConfig(seed, rank);
config.botUtility = true;
const res = runBotGame(config, Math.round(minutes * 60 * 30), undefined, { noVariance: args.get('variance') === '0', reflex: true });
const out: string[] = [`# recallDiag seed=${seed} rank=${rank} minutes=${res.minutes.toFixed(1)}`];
const fmt = (t: number): string => `${Math.floor(t / 1800)}:${String(Math.floor((t / 30) % 60)).padStart(2, '0')}`;
const byRole = new Map(config.players.map((p) => [p.slot, p.role]));
let count = 0;
const per = new Map<string, number>();
for (const p of config.players) {
  let last = -1e9;
  for (const e of res.bots.log.entries(p.slot)) {
    if (e.node !== 'intent' || e.chosen !== 'recall') continue;
    if (e.tick - last < 600) {
      last = e.tick;
      continue;
    }
    last = e.tick;
    count++;
    const i = e.inputs;
    const cause = Number(i.t_item) > 0 && Number(i.t_hp) <= 0 && Number(i.t_mana) <= 0 ? 'item' : Number(i.t_hp) > 0 ? 'hp' : Number(i.t_mana) > 0 ? 'mana' : 'other';
    per.set(`${byRole.get(p.slot)}:${cause}`, (per.get(`${byRole.get(p.slot)}:${cause}`) ?? 0) + 1);
    out.push(`  ${fmt(e.tick)} slot ${p.slot} ${String(byRole.get(p.slot)).padEnd(7)} cause=${cause} gold=${i.t_gold} price=${i.t_price} item=${i.t_item} stayDeath=${i.t_stayDeath} hp=${i.t_hp} mana=${i.t_mana} trip=${i.t_tripS} waveCost=${i.t_wave} plates=${i.t_plates} forgone=${i.t_forgonePlates} reason=${e.reason}`);
  }
}
out.push(`recall episodes: ${count} (${(count / (config.players.length * res.minutes)).toFixed(2)} per bot-minute)`);
for (const [k, c] of [...per.entries()].sort()) out.push(`  ${k}: ${c}`);
process.stdout.write(out.join('\n') + '\n');
