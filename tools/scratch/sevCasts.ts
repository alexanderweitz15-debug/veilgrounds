// Agent E: bot games with Sev in blue mid; counts his casts per slot (Q fakes, decoys, fears) and compares his stats
// with the red mid laner. Usage: npx tsx tools/scratch/sevCasts.ts [games=2] [minutes=15] [rank=gold]
import { botGameConfig } from '../../src/ai/runner';
import { runBotGame } from '../../src/ai/harness';
import { BUILDS } from '../../src/ai/bot/builds';
import type { Rank } from '../../src/ai/profiles/schema';
import sevBuild from '../../src/data/builds/sev.json';
import { hasBuff } from '../../src/sim/buffs';

declare const process: { argv: string[]; stdout: { write(s: string): void } };
BUILDS.sev ??= sevBuild as (typeof BUILDS)[string];
const games = Number(process.argv[2] ?? 2);
const minutes = Number(process.argv[3] ?? 15);
const rank = (process.argv[4] ?? 'gold') as Rank;

for (let g = 0; g < games; g++) {
  const seed = 1 + g;
  const config = botGameConfig(seed, rank);
  const mid = config.players.find((p) => p.team === 0 && p.role === 'mid')!;
  mid.champion = 'sev';
  const red = config.players.find((p) => p.team === 1 && p.role === 'mid')!;
  const casts = [0, 0, 0, 0];
  let recasts = 0;
  let fearTicks = 0;
  let sevEid = -1;
  const r = runBotGame(config, Math.round(minutes * 1800), (sim) => {
    if (sevEid < 0) sevEid = sim.slots[mid.slot]!;
    for (const e of sim.events) {
      if (e.e !== 'cast' || e.src !== sevEid) continue;
      if (e.recast) recasts++;
      else casts[e.slot]!++;
    }
    for (const s of sim.slots) if (hasBuff(sim, s, 'fear', 'sev_r')) fearTicks++;
  });
  const st = (slot: number) => r.stats.find((s) => s.slot === slot)!;
  const fmt = (s: ReturnType<typeof st>) => `${s.champion}: cs ${s.cs} k/d ${s.kills}/${s.deaths} dmgToChamps ${Math.round(s.damageToChampions)} gold/min ${Math.round(s.goldEarned / r.minutes)}`;
  process.stdout.write(`game ${g + 1} seed ${seed} ${r.minutes.toFixed(1)} min winner ${r.winner ?? '-'}\n`);
  process.stdout.write(`  Sev casts Q/W/E/R ${casts.join('/')} recasts(fakes) ${recasts} fear seconds ${(fearTicks / 30).toFixed(1)}\n`);
  process.stdout.write(`  blue ${fmt(st(mid.slot))}\n  red  ${fmt(st(red.slot))}\n`);
}
