// @ts-nocheck (scratch, node-only APIs)
// S2 measurement: records a long bot game (default 30 min), builds the checkpoint index and times seeks.
// Run: npx tsx tools/scratch/s2seekTime.ts [minutes]
import { botGameConfig, BotRunner } from '../../src/ai/runner';
import { createSim, step } from '../../src/sim/sim';
import { Recorder } from '../../src/replay/replay';
import { ReplayEngine } from '../../src/replay/engine';
import { freezeSim } from '../../src/replay/cloneSim';

const min = Number(process.argv[2] ?? 30);
const ticks = min * 60 * 30;
const cfg = botGameConfig(5, 'gold');
const sim = createSim(cfg);
const rec = new Recorder(cfg);
const bots = new BotRunner(cfg, undefined, { reflex: true });
let t0 = performance.now();
while (sim.tick < ticks && sim.state.winner == null) {
  const inputs = bots.tick(sim);
  rec.record(sim.tick, inputs);
  step(sim, inputs);
  rec.observe(sim);
}
const replay = rec.finish(sim, bots.log.toNDJSON());
console.log(`recorded ${replay.ticks} ticks (${(replay.ticks / 1800).toFixed(1)} min) in ${((performance.now() - t0) / 1000).toFixed(1)} s, winner ${replay.winner}`);
const eng = new ReplayEngine(replay);
t0 = performance.now();
while (!eng.advanceIndex(600)) {
  /* index pass */
}
const idxS = (performance.now() - t0) / 1000;
console.log(`index: ${eng.checkpoints.size} checkpoints in ${idxS.toFixed(1)} s (${(replay.ticks / idxS).toFixed(0)} ticks/s)`);
console.log(`replay JSON ${(JSON.stringify(replay).length / 1024).toFixed(0)} KB, markers ${replay.markers?.length}, botLog ${((replay.botLog?.length ?? 0) / 1024).toFixed(0)} KB`);
let worst = 0;
for (let i = 1; i <= 40; i++) {
  const target = i % 5 === 0 ? replay.ticks - 1 : (i * 2654435761) % replay.ticks;
  const s = performance.now();
  const steps = eng.seek(target);
  const ms = performance.now() - s;
  worst = Math.max(worst, ms);
  if (i <= 8) console.log(`seek ${target} (${steps} steps) ${ms.toFixed(0)} ms`);
}
const f0 = performance.now();
freezeSim(sim);
console.log(`worst of 40 seeks ${worst.toFixed(0)} ms; freeze of a late sim ${(performance.now() - f0).toFixed(0)} ms`);
