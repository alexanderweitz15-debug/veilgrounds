// @ts-nocheck
// Debug the level-1 invade: positions of the squad every 10 s. npx tsx tools/scratch/invade.ts [maxSeed=60]
import { createSim, step } from '../../src/sim/sim';
import { BotRunner, botGameConfig } from '../../src/ai/runner';
const mk = (seed) => ({ ...botGameConfig(seed, 'challenger'), botUtility: true });
let seed = 1, team = -1;
for (; seed <= 60 && team < 0; seed++) team = new BotRunner(mk(seed), undefined, { reflex: true }).teams.findIndex((t) => t.earlyPlan().kind === 'invade');
seed--;
const cfg = mk(seed), sim = createSim(cfg), r = new BotRunner(cfg, undefined, { reflex: true });
const plan = r.teams[team].earlyPlan();
console.log('seed', seed, 'team', team, 'point', plan.point, 'squad', [...plan.squad]);
while (sim.tick < 100 * 30) {
  step(sim, r.tick(sim));
  if (sim.tick % 300 === 0) {
    const { Pos } = sim.c;
    console.log(sim.tick / 30, cfg.players.filter((p) => plan.squad.has(p.slot)).map((p) => { const e = sim.slots[p.slot]; const b = r.bots.find((x) => x.ctx.slot === p.slot); return `${p.role}(${Math.round(Pos.x[e])},${Math.round(Pos.y[e])}) ${r.log.entries(p.slot).slice(-1)[0]?.node}:${r.log.entries(p.slot).slice(-1)[0]?.chosen}`; }).join('  '));
  }
}
