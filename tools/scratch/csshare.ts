// @ts-nocheck
// Who kills lane minions in the first N min: champion / minion / tower / other (share). Usage: tsx tools/scratch/csshare.ts [min] [seed]
import { createSim, step } from '../../src/sim/sim';
import { BotRunner, botGameConfig } from '../../src/ai/runner';
import { Kind, isMinion } from '../../src/sim/types';

const min = Number(process.argv[2] ?? 10), seed = Number(process.argv[3] ?? 1);
const cfg = botGameConfig(seed, 'gold');
const sim = createSim(cfg);
const bots = new BotRunner(cfg, undefined, { noVariance: true });
const n = { champion: 0, minion: 0, tower: 0, other: 0 };
let total = 0;
while (sim.tick < min * 1800) {
  step(sim, bots.tick(sim));
  for (const ev of sim.events) {
    if (ev.e !== 'death' || !isMinion(ev.kind)) continue;
    total++;
    const k = ev.killer >= 0 ? sim.c.Unit.kind[ev.killer] : -1;
    n[k === Kind.Champion ? 'champion' : isMinion(k) ? 'minion' : k === Kind.Tower ? 'tower' : 'other']++;
  }
}
console.log('minion deaths', total, JSON.stringify(n));
