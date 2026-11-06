// @ts-nocheck
// ARAM bot game: kills, towers, relic pickups, winner. Usage: tsx tools/scratch/aram.ts [min] [seed] [aram|urf]
import { createSim, step } from '../../src/sim/sim';
import { BotRunner } from '../../src/ai/runner';
import { variantConfig } from '../../src/game/modes';
import { Kind } from '../../src/sim/types';

const min = Number(process.argv[2] ?? 12), seed = Number(process.argv[3] ?? 1), id = process.argv[4] ?? 'aram';
const cfg = variantConfig(id, 'gold', seed);
for (const p of cfg.players) p.isHuman = false, p.bot ??= { rank: 'gold', variance: 'normal' };
if (process.env.NOLANE) delete cfg.rules.oneLane;
const t0 = Date.now();
const sim = createSim(cfg);
const bots = new BotRunner(cfg, undefined, { noVariance: true });
let kills = 0, towers = 0, relic = 0;
const last = (sim.state.relics ?? []).map((r) => r.respawnAt);
while (sim.tick < min * 1800 && sim.state.winner === undefined) {
  step(sim, bots.tick(sim));
  for (const ev of sim.events) if (ev.e === 'death') (ev.kind === Kind.Champion && kills++, ev.kind === Kind.Tower && towers++);
  (sim.state.relics ?? []).forEach((r, i) => { if (r.respawnAt !== last[i] && r.respawnAt > 0) relic++; last[i] = r.respawnAt; });
}
console.log(((Date.now() - t0) / 1000).toFixed(0) + 's', `${id} seed ${seed}: ${(sim.tick / 1800).toFixed(1)} min, kills ${kills}, towers ${towers}, relic pickups ${relic}, winner ${sim.state.winner ?? '-'}`);
