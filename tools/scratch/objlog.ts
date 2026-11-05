// @ts-nocheck
// Objective execution log (node objective / pingIn objective / smite) between two minutes, one seed.
import { createSim, step } from '../../src/sim/sim';
import { BotRunner, botGameConfig } from '../../src/ai/runner';
const [from, to, seed] = [Number(process.argv[2] ?? 5), Number(process.argv[3] ?? 9), Number(process.argv[4] ?? 1)];
const cfg = botGameConfig(seed, 'gold');
const sim = createSim(cfg); const bots = new BotRunner(cfg);
while (sim.tick < to * 1800) step(sim, bots.tick(sim));
const rows = [];
for (const p of cfg.players) for (const x of bots.log.entries(p.slot)) if (x.tick >= from * 1800 && (x.node === 'objective' || x.node === 'mode' || x.node === 'survive' || x.node === 'escape')) rows.push(x);
rows.sort((a, b) => a.tick - b.tick);
for (const x of rows) console.log(`${(x.tick / 1800).toFixed(2)} s${x.bot} ${x.node}|${x.chosen}|${String(x.reason).slice(0, 70)}`);
