// A3 scratch: attention share per bot in a real bot game (attention fed once per decision).
// npx tsx tools/scratch/a3attn.ts <rank> <minutes> <seeds,comma>
import { createSim, step } from '../../src/sim/sim';
import { BotRunner, botGameConfig } from '../../src/ai/runner';
import { think } from '../../src/ai/bot/brain';
import { attentionStats, observeAttention } from '../../src/ai/humanize/attention';
import type { Rank } from '../../src/ai/profiles/schema';
declare const process: { argv: string[] };
const rank = (process.argv[2] ?? 'iron') as Rank;
const min = Number(process.argv[3] ?? 5);
const seeds = (process.argv[4] ?? '7').split(',').map(Number);
const variance = (process.argv[5] ?? 'stable') as 'stable' | 'normal';
for (const seed of seeds) {
  const config = botGameConfig(seed, rank, variance);
  const sim = createSim(config);
  const bots = new BotRunner(config, (snap, ctx, mem, rng) => {
    const out = think(snap, ctx, mem, rng);
    observeAttention(mem, ctx, snap);
    return out;
  });
  while (sim.tick < min * 1800) step(sim, bots.tick(sim));
  for (const b of bots.bots) {
    const s = attentionStats(b.mem, sim.tick)!;
    const br = Object.entries(s.byReason).map(([k, v]) => `${k}=${(v * 100).toFixed(1)}`).join(' ');
    console.log(seed, b.ctx.params.rank, Math.round(b.ctx.params.skill), (s.share * 100).toFixed(1), 'target', b.ctx.params.behavior.errorInjectionPct.toFixed(1), 'win', s.windows, 'max', s.maxWindowS.toFixed(1), br);
  }
}
