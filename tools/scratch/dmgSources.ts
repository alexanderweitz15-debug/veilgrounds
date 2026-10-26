// @ts-nocheck - scratch (lead): where does laner HP go? Damage taken by source kind, first N minutes.
// npx tsx tools/scratch/dmgSources.ts <minutes> <rank> <seed> [old]
import { botGameConfig } from '../../src/ai/runner';
import { runBotGame } from '../../src/ai/harness';
import { Kind } from '../../src/sim/types';

const min = Number(process.argv[2] ?? 10);
const rank = process.argv[3] ?? 'gold';
const seed = Number(process.argv[4] ?? 1);
const oldBrain = process.argv[5] === 'old';
const base = botGameConfig(seed, rank);
const cfg = oldBrain ? base : { ...base, botUtility: true, botReflex: true };
const laners = new Set(cfg.players.filter((p) => p.role !== 'jungle' && p.role !== 'support').map((p) => p.slot));
const names: Record<number, string> = {};
for (const [k, v] of Object.entries(Kind)) if (typeof v === 'number') names[v] = k;
const by: Record<string, number> = {};
let healed = 0;
runBotGame(cfg, Math.round(min * 1800), (sim) => {
  const eids = new Set([...laners].map((s) => sim.slots[s]));
  for (const e of sim.events) {
    if (e.e === 'damage' && eids.has(e.dst)) {
      const k = e.src >= 0 ? names[sim.c.Unit.kind[e.src]] ?? '?' : 'none';
      by[k] = (by[k] ?? 0) + e.amount;
    }
    if (e.e === 'heal' && eids.has(e.dst)) healed += e.amount ?? 0;
  }
}, { noVariance: true, reflex: !oldBrain });
const tot = Object.values(by).reduce((a, b) => a + b, 0);
const pct = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, `${Math.round(v)} (${Math.round((100 * v) / tot)} %)`]));
console.log(JSON.stringify({ min, rank, seed, brain: oldBrain ? 'old' : 'new', laners: laners.size, total: Math.round(tot), perLanerPerMin: Math.round(tot / laners.size / min), by: pct }));
