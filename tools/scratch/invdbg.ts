// @ts-nocheck
import { createSim, step } from '../../src/sim/sim';
import { BotRunner, botGameConfig } from '../../src/ai/runner';
const mk = (seed) => ({ ...botGameConfig(seed, 'challenger'), botUtility: true });
let seed = 1, team = -1, bots;
for (; seed <= 60 && team < 0; seed++) { bots = new BotRunner(mk(seed), undefined, { reflex: true }); team = bots.teams.findIndex((t) => t.earlyPlan().kind === 'invade'); }
seed--;
const cfg = mk(seed); const sim = createSim(cfg); const r = new BotRunner(cfg, undefined, { reflex: true });
const plan = r.teams[team].earlyPlan();
const jg = cfg.players.find((p) => p.team === team && p.role === 'jungle');
console.log('seed', seed, 'team', team, 'point', plan.point, 'jungler', jg.champion);
while (sim.tick < 85 * 30) { step(sim, r.tick(sim)); const e = sim.slots[jg.slot]; if (sim.tick % 150 === 0) console.log((sim.tick / 30).toFixed(0), Math.round(sim.c.Pos.x[e]), Math.round(sim.c.Pos.y[e]), Math.round(Math.hypot(sim.c.Pos.x[e] - plan.point.x, sim.c.Pos.y[e] - plan.point.y))); }
for (const x of r.log.entries(jg.slot)) if (x.tick < 85 * 30 && /intent|early|mode/.test(x.node)) console.log(x.tick, x.node, x.chosen, String(x.reason).slice(0, 60));
