// @ts-nocheck
// Where do laners spend their time in the first N min: dead / fountain-or-walk-home / near enemy minions (<900) / elsewhere.
// Usage: tsx tools/scratch/farmtime.ts [min] [seeds]
import { createSim, step } from '../../src/sim/sim';
import { BotRunner, botGameConfig } from '../../src/ai/runner';
import { Kind, isMinion } from '../../src/sim/types';
import { query } from 'bitecs';

const min = Number(process.argv[2] ?? 10);
const seeds = (process.argv[3] ?? '1').split(',').map(Number);
const t = { dead: 0, fountain: 0, near: 0, away: 0 };
for (const seed of seeds) {
  const cfg = botGameConfig(seed, 'gold');
  const sim = createSim(cfg);
  const bots = new BotRunner(cfg, undefined, { noVariance: true });
  const laners = cfg.players.filter((p) => p.role === 'mid' || p.role === 'top' || p.role === 'adc');
  while (sim.tick < min * 1800) {
    step(sim, bots.tick(sim));
    if (sim.tick % 30 || sim.tick < 100 * 30) continue;
    const { Unit, Pos } = sim.c;
    const foes = [...query(sim.world, [Unit])].filter((e) => Unit.alive[e] && isMinion(Unit.kind[e]));
    for (const p of laners) {
      const e = sim.slots[p.slot];
      if (!Unit.alive[e]) { t.dead++; continue; }
      const f = sim.map.sides[p.team].fountain;
      if (Math.hypot(Pos.x[e] - f.x, Pos.y[e] - f.y) < f.r + 1500) { t.fountain++; continue; }
      const near = foes.some((m) => Unit.team[m] !== p.team && Math.hypot(Pos.x[m] - Pos.x[e], Pos.y[m] - Pos.y[e]) < 900);
      t[near ? 'near' : 'away']++;
    }
  }
}
const n = t.dead + t.fountain + t.near + t.away;
console.log(Object.entries(t).map(([k, v]) => `${k} ${((100 * v) / n).toFixed(0)}%`).join('  '));
