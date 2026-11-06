// @ts-nocheck
// Recall / heal trips per laner and why (decision-log reasons), default brain, Gold.
import { createSim, step } from '../../src/sim/sim';
import { BotRunner, botGameConfig } from '../../src/ai/runner';
const min = Number(process.argv[2] ?? 12), seed = Number(process.argv[3] ?? 1);
const cfg = botGameConfig(seed, 'gold');
const sim = createSim(cfg); const bots = new BotRunner(cfg);
const hp = new Map(), gold = new Map();
while (sim.tick < min * 1800) { step(sim, bots.tick(sim)); if (sim.tick % 15 === 0) for (const p of cfg.players) { const e = sim.slots[p.slot]; hp.set(`${p.slot}:${sim.tick}`, sim.c.Hp.cur[e] / sim.c.Hp.max[e]); } }
const by = {};
for (const p of cfg.players) for (const x of bots.log.entries(p.slot)) {
  if (!/^(recall|mode)$/.test(x.node)) continue;
  if (x.node === 'mode' && !/-> (recall|home|heal)$/.test(String(x.reason))) continue;
  const h = hp.get(`${p.slot}:${x.tick - (x.tick % 15)}`) ?? -1;
  const k = `${p.role} ${x.node}|${x.chosen}|${String(x.reason).replace(/[0-9.]+/g, '#').slice(0, 50)}`;
  const b = (by[k] ??= { n: 0, hp: 0 }); b.n++; b.hp += h;
}
for (const [k, b] of Object.entries(by).sort((a, b) => b[1].n - a[1].n).slice(0, 30)) console.log(String(b.n).padStart(4), 'hp', (b.hp / b.n).toFixed(2), k);
