import { botGameConfig } from '../../src/ai/runner';
import { runBotGame } from '../../src/ai/harness';
declare const process: { argv: string[]; stdout: { write(s: string): void } };
const min = Number(process.argv[2] ?? 3);
const slot = Number(process.argv[3] ?? 6);
const filt = process.argv[4] ?? '';
const cmds: string[] = [];
const r = runBotGame(botGameConfig(1, 'gold'), Math.round(min * 1800), (sim, inputs) => {
  for (const i of inputs) if (i.slot === slot && (filt === '' || i.cmd.t === filt)) cmds.push(`${sim.tick} ${JSON.stringify(i.cmd)}`);
});
for (const e of r.bots.log.entries(slot)) if (e.node !== 'mode') process.stdout.write(`${e.tick} ${e.node} ${e.chosen} | ${e.reason} ${JSON.stringify(e.scores ?? {})} ${JSON.stringify(e.inputs).slice(0, 300)}\n`);
process.stdout.write(cmds.join('\n') + '\n');
