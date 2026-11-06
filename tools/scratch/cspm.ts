// @ts-nocheck
// CS per minute by role at minute N (Champ.cs: minions + monsters). Usage: tsx tools/scratch/cspm.ts [min] [seeds] [rank]
import { createSim, step } from '../../src/sim/sim';
import { BotRunner, botGameConfig } from '../../src/ai/runner';

const min = Number(process.argv[2] ?? 10);
const seeds = (process.argv[3] ?? '1,2').split(',').map(Number);
const rank = process.argv[4] ?? 'gold';
const by = {};
for (const seed of seeds) {
  const cfg = botGameConfig(seed, rank);
  const sim = createSim(cfg);
  const bots = new BotRunner(cfg, undefined, { noVariance: true });
  while (sim.tick < min * 1800) step(sim, bots.tick(sim));
  for (const p of cfg.players) (by[p.role] ??= []).push(sim.c.Champ.cs[sim.slots[p.slot]] / min);
}
const all = [];
for (const [r, a] of Object.entries(by)) { all.push(...a); console.log(r.padEnd(8), (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2), 'cs/min'); }
console.log('ALL     ', (all.reduce((x, y) => x + y, 0) / all.length).toFixed(2));
