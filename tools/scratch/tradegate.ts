// @ts-nocheck
// Trade window: which conditions fail when an enemy champion is within 1300 (temporary DBGTRADE hook in trade.ts).
import { createSim, step } from '../../src/sim/sim';
import { BotRunner, botGameConfig } from '../../src/ai/runner';
globalThis.DBGTRADE = {};
const min = Number(process.argv[2] ?? 10), seed = Number(process.argv[3] ?? 1);
const cfg = botGameConfig(seed, 'gold');
const sim = createSim(cfg); const bots = new BotRunner(cfg);
while (sim.tick < min * 1800) step(sim, bots.tick(sim));
const tot = Object.values(globalThis.DBGTRADE).reduce((a, b) => a + b, 0);
for (const [k, v] of Object.entries(globalThis.DBGTRADE).sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(String(v).padStart(6), (100 * v / tot).toFixed(1) + '%', k);
const wp = globalThis.DBGWP; const thr = wp[0]?.[1];
const buckets = [0.3, 0.4, 0.5, 0.55, 0.6, 0.7, 1.01]; const c = buckets.map(() => 0);
for (const [w] of wp) c[buckets.findIndex((b) => w < b)]++;
console.log('winProb thr ~', thr?.toFixed(2), 'dist <', buckets.join(' '), '->', c.join(' '));
