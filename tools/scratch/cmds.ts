import { botGameConfig } from '../../src/ai/runner';
import { runBotGame } from '../../src/ai/harness';
import { utilityDebug } from '../../src/ai/utility/select';
declare const process: { argv: string[]; stdout: { write(s: string): void } };
const min = Number(process.argv[2] ?? 3);
const counts: Record<string, number> = {};
const t0 = performance.now();
let simMs = 0;
const r = runBotGame(botGameConfig(1, 'gold'), Math.round(min * 1800), (_sim, inputs) => {
  for (const i of inputs) counts[i.cmd.t] = (counts[i.cmd.t] ?? 0) + 1;
});
void simMs;
process.stdout.write(`total ${((performance.now() - t0) / 1000).toFixed(1)} s ${JSON.stringify(counts)}\n`);
for (const b of r.bots.bots) process.stdout.write(`${b.ctx.slot} ${b.ctx.role} ${JSON.stringify(utilityDebug(b.mem))}\n`);
const chosen: Record<string, number> = {};
for (const e of r.bots.log.entries()) if (e.node === 'utility') chosen[e.chosen + '|' + e.reason] = (chosen[e.chosen + '|' + e.reason] ?? 0) + 1;
process.stdout.write(JSON.stringify(chosen) + '\n');
