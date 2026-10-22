import { botGameConfig } from '../../src/ai/runner';
import { runBotGame } from '../../src/ai/harness';
import { Kind } from '../../src/sim/types';
declare const process: { argv: string[]; stdout: { write(s: string): void } };
const min = Number(process.argv[2] ?? 15);
const seed = Number(process.argv[3] ?? 1);
const deaths: { tick: number; slot: number; killerKind: number }[] = [];
const r = runBotGame(botGameConfig(seed, 'gold'), Math.round(min * 1800), (sim) => {
  for (const ev of sim.events) {
    if (ev.e !== 'death' || ev.kind !== Kind.Champion) continue;
    const e = ev as unknown as { eid: number; killerKind: number };
    if (e.killerKind === Kind.Champion) continue;
    deaths.push({ tick: sim.tick, slot: sim.c.Unit.slot[e.eid]!, killerKind: e.killerKind });
  }
}, { noVariance: true });
for (const d of deaths) {
  process.stdout.write(`--- death tick ${d.tick} slot ${d.slot} killerKind ${d.killerKind}\n`);
  const es = r.bots.log.entries(d.slot).filter((e) => e.tick <= d.tick && e.tick > d.tick - 300 && e.node !== 'mode');
  for (const e of es.slice(-8)) process.stdout.write(`  ${e.tick} ${e.node} ${e.chosen} | ${e.reason} ${JSON.stringify(e.scores ?? {}).slice(0, 120)} ${JSON.stringify(e.inputs).slice(0, 200)}\n`);
}
