// @ts-nocheck
// Why do bots run away? Counts decision-log entries that move a bot away from fights (retreat / flee / disengage /
// back off / kite) with the bot's HP share at that moment, and how often an enemy champion was close.
// Usage: tsx tools/scratch/flee.ts [min] [brain old|new] [seed]
import { createSim, step } from '../../src/sim/sim';
import { BotRunner, botGameConfig } from '../../src/ai/runner';
import { Kind } from '../../src/sim/types';

const min = Number(process.argv[2] ?? 12);
const brain = process.argv[3] ?? 'old';
const seed = Number(process.argv[4] ?? 1);
const cfg = { ...botGameConfig(seed, 'gold'), ...(brain === 'new' ? { botUtility: true, botReflex: true } : {}) };
const sim = createSim(cfg);
const bots = new BotRunner(cfg, undefined, { reflex: brain === 'new' });
const hpAt = new Map();
let kills = 0;
while (sim.tick < min * 1800) {
  step(sim, bots.tick(sim));
  for (const ev of sim.events) if (ev.e === 'death' && ev.kind === Kind.Champion) kills++;
  if (sim.tick % 15 === 0) for (const p of cfg.players) { const e = sim.slots[p.slot]; hpAt.set(`${p.slot}:${sim.tick}`, sim.c.Hp.cur[e] / sim.c.Hp.max[e]); }
}
const by = {};
const all = {};
for (const p of cfg.players) for (const x of bots.log.entries(p.slot)) {
  const k0 = `${x.node}|${x.chosen}`;
  all[k0] = (all[k0] ?? 0) + 1;
  if (!/retreat|flee|disengage|back|escape|kite|run|avoid|step_out|survive|safe/i.test(`${x.node} ${x.chosen} ${x.reason}`)) continue;
  const hp = hpAt.get(`${p.slot}:${x.tick - (x.tick % 15)}`) ?? -1;
  const k = `${x.node}|${x.chosen}|${String(x.reason).replace(/[0-9.]+/g, '#').slice(0, 60)}`;
  const b = (by[k] ??= { n: 0, hpSum: 0, hiHp: 0 });
  b.n++; b.hpSum += hp; if (hp > 0.6) b.hiHp++;
}
console.log(`kills ${kills} in ${min} min`);
for (const [k, b] of Object.entries(by).sort((a, b) => b[1].n - a[1].n).slice(0, 25)) console.log(`${String(b.n).padStart(5)}  avgHP ${(b.hpSum / b.n).toFixed(2)}  >60%HP ${b.hiHp}  ${k}`);
console.log('--- top decisions');
for (const [k, n] of Object.entries(all).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${String(n).padStart(6)} ${k}`);
