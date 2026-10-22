// A3 Phase 5 gate (BRAIN-REWORK §11): distracted share per bot in real bot games with the new brain on (real runner
// wiring: reflex layer + utility model; the runner feeds the attention model), error episodes per id, and the log check
// "every attention / error event logged".
// BOT_UTILITY=1 npx tsx tools/scratch/a3attn.ts <rank> <minutes> <seeds,comma> [stable|normal]
// One line per bot: seed rank skill share target windows maxS byReason; then per game the episode / log counts.
import { runBotGame } from '../../src/ai/harness';
import { botGameConfig } from '../../src/ai/runner';
import { attentionStats } from '../../src/ai/humanize/attention';
import { errorEpisodes } from '../../src/ai/errors';
import { reflexState } from '../../src/ai/reflex/state';
import type { Rank } from '../../src/ai/profiles/schema';
declare const process: { argv: string[]; env: Record<string, string | undefined> };
const rank = (process.argv[2] ?? 'gold') as Rank;
const min = Number(process.argv[3] ?? 10);
const seeds = (process.argv[4] ?? '1').split(',').map(Number);
const variance = (process.argv[5] ?? 'stable') as 'stable' | 'normal';
if (process.env.BOT_UTILITY !== '1') console.log('# warning: BOT_UTILITY != 1 (utility model off, reflex only)');
for (const seed of seeds) {
  const config = botGameConfig(seed, rank, variance);
  const g = runBotGame(config, Math.round(min * 1800), undefined, { reflex: true });
  const tick = g.sim.tick;
  let share = 0;
  let target = 0;
  let windows = 0;
  let logged = 0;
  const eps: Record<string, number> = {};
  let epsN = 0;
  let detected = 0;
  for (const b of g.bots.bots) {
    const s = attentionStats(b.mem, tick)!;
    const tgt = b.ctx.params.behavior.errorInjectionPct;
    share += (s.share * 100) / g.bots.bots.length;
    target += tgt / g.bots.bots.length;
    windows += s.windows;
    const entries = g.bots.log.entries(b.ctx.slot);
    logged += entries.filter((e) => e.node === 'attention' && !e.chosen.includes('+')).length;
    detected += entries.filter((e) => e.node === 'error' && e.chosen.startsWith('detected:')).length;
    for (const ep of errorEpisodes(b.mem)) (eps[ep.id] = (eps[ep.id] ?? 0) + 1), epsN++;
    const br = Object.entries(s.byReason).map(([k, v]) => `${k}=${(v * 100).toFixed(1)}`).join(' ');
    console.log(`bot ${seed} ${b.ctx.slot} ${b.ctx.params.rank} ${Math.round(b.ctx.params.skill)} share ${(s.share * 100).toFixed(1)} target ${tgt.toFixed(1)} win ${s.windows} max ${s.maxWindowS.toFixed(1)} ${br}`);
  }
  // episodes by id from the log (the in-memory list drops noticed episodes after 60 s)
  const byId: Record<string, number> = {};
  for (const e of g.bots.log.entries()) if (e.node === 'error' && e.reason.startsWith('injectedError:')) byId[e.chosen] = (byId[e.chosen] ?? 0) + 1;
  const injected = Object.values(byId).reduce((a, c) => a + c, 0);
  let distractedCancels = 0;
  for (const b of g.bots.bots) distractedCancels += reflexState(b.mem).stats.cancels.distracted ?? 0;
  console.log(`game ${rank} seed ${seed} ${min} min: mean share ${share.toFixed(1)} % target ${target.toFixed(1)} %, windows ${windows} logged ${logged}, lh cancels distracted ${distractedCancels}, episodes injected ${injected} detected ${detected} (in memory ${epsN}) ${JSON.stringify(byId)}`);
  void eps;
}
