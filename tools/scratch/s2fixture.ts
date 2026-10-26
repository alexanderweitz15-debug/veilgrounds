// @ts-nocheck (scratch, node-only APIs)
// S2: writes a short recorded bot game as an eval script that stores it in the browser's IndexedDB (replay browser demo).
// Run: npx tsx tools/scratch/s2fixture.ts <out.js> [minutes]
import { writeFileSync } from 'node:fs';
import { botGameConfig, BotRunner } from '../../src/ai/runner';
import { createSim, step } from '../../src/sim/sim';
import { Recorder } from '../../src/replay/replay';
import { metaOf } from '../../src/replay/store';
import { Rng } from '../../src/sim/rng';

const [out = 'fixture.js', min = '4'] = process.argv.slice(2);
const cfg = botGameConfig(3, 'gold');
cfg.players[0] = { ...cfg.players[0]!, isHuman: true, bot: undefined } as never;
const sim = createSim(cfg);
const rec = new Recorder(cfg);
const bots = new BotRunner(cfg, undefined, { reflex: true });
while (sim.tick < +min * 1800 && sim.state.winner == null) {
  const r = new Rng(sim.tick * 31 + 7);
  const human = r.chance(0.03) ? [{ slot: 0, cmd: { t: 'move', x: r.range(1500, 9000), y: r.range(1500, 9000) } }] : [];
  const inputs = [...human, ...bots.tick(sim)] as never[];
  rec.record(sim.tick, inputs);
  step(sim, inputs);
  rec.observe(sim);
}
const replay = rec.finish(sim, bots.log.toNDJSON());
const meta = metaOf(replay, Date.now());
const js = `(async () => {
  const db = await new Promise((res, rej) => { const q = indexedDB.open('veilgrounds', 1); q.onupgradeneeded = () => q.result.createObjectStore('kv'); q.onsuccess = () => res(q.result); q.onerror = rej; });
  const put = (k, v) => new Promise((res, rej) => { const r = db.transaction('kv', 'readwrite').objectStore('kv').put(v, k); r.onsuccess = res; r.onerror = rej; });
  await put(${JSON.stringify(`replay:v1:${meta.id}`)}, ${JSON.stringify(replay)});
  await put('replays:v1', [${JSON.stringify(meta)}]);
  return 'stored';
})()`;
writeFileSync(out, js);
console.log(`${replay.ticks} ticks, ${(js.length / 1024).toFixed(0)} KB, markers ${replay.markers?.length}, errors ${replay.botLog?.split('\n').filter((l) => l.includes('"node":"error"')).length}, player ${replay.player?.length}`);
