import { botGameConfig } from '../../src/ai/runner';
import { runBotGame } from '../../src/ai/harness';
declare const process: { argv: string[]; stdout: { write(s: string): void } };
const min = Number(process.argv[2] ?? 6);
const per: Record<number, number> = {};
const r = runBotGame(botGameConfig(1, 'gold'), Math.round(min * 1800), (_s, inputs) => {
  for (const i of inputs) if (i.cmd.t === 'recall') per[i.slot] = (per[i.slot] ?? 0) + 1;
}, { noVariance: true });
process.stdout.write(`recall cmds per slot ${JSON.stringify(per)} roams ${r.stats.map((s) => s.roams).join(',')}\n`);
const c: Record<string, number> = {};
for (const e of r.bots.log.entries()) {
  if (e.node === 'recall' || e.node === 'roam' || (e.node === 'intent' && (e.chosen === 'recall' || e.chosen === 'roam'))) {
    const k = `${e.node}|${e.chosen}|${e.reason}`;
    c[k] = (c[k] ?? 0) + 1;
  }
}
process.stdout.write(JSON.stringify(c, null, 1) + '\n');
for (const e of r.bots.log.entries()) if (e.node === 'intent' && e.chosen === 'recall') process.stdout.write(`${e.tick} ${e.bot} ${JSON.stringify(e.inputs)} ${JSON.stringify(e.scores)}\n`);
