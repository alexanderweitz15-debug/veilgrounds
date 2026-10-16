import { botGameConfig } from '../../src/ai/runner';
import { runBotGame } from '../../src/ai/harness';
declare const process: { argv: string[]; stdout: { write(s: string): void } };
const seed = Number(process.argv[2] ?? 1);
const min = Number(process.argv[3] ?? 4);
const t0 = Date.now();
const r = runBotGame(botGameConfig(seed, 'gold'), Math.round(min * 1800));
const cs = r.stats.filter((s) => s.role !== 'jungle' && s.role !== 'support').map((s) => s.cs);
process.stdout.write(`seed ${seed} ${min} min hash ${r.hash} cs ${cs.join(' ')} kills ${r.stats.reduce((a, s) => a + s.kills, 0)} log ${r.bots.log.entries().length} in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);
