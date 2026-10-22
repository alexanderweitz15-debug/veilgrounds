// Agent E: bot games with Sev (Fassung 3) in blue mid; counts his casts per slot, the bot's ult choice, hard CC he
// lands and compares his stats with the red mid laner (and the blue/red team totals for AoE / wave clear).
// Usage: npx tsx tools/scratch/sevCasts.ts [games=2] [minutes=15] [rank=gold] [firstSeed=1]
import { botGameConfig } from '../../src/ai/runner';
import { runBotGame } from '../../src/ai/harness';
import type { Rank } from '../../src/ai/profiles/schema';
import { hasBuff } from '../../src/sim/buffs';
import { ultChoiceOf } from '../../src/sim/systems/abilities';

declare const process: { argv: string[]; stdout: { write(s: string): void } };
const games = Number(process.argv[2] ?? 2);
const minutes = Number(process.argv[3] ?? 15);
const rank = (process.argv[4] ?? 'gold') as Rank;
const ULTS = ['Amaterasu', 'Susanoo', 'Tsukuyomi'];

for (let g = 0; g < games; g++) {
  const seed = Number(process.argv[5] ?? 1) + g;
  const config = botGameConfig(seed, rank);
  const mid = config.players.find((p) => p.team === 0 && p.role === 'mid')!;
  mid.champion = 'sev';
  const red = config.players.find((p) => p.team === 1 && p.role === 'mid')!;
  const casts = [0, 0, 0, 0];
  let recasts = 0;
  let ccTicks = 0;
  let genjutsu = 0;
  let ult = -1;
  let sevEid = -1;
  const r = runBotGame(config, Math.round(minutes * 1800), (sim) => {
    if (sevEid < 0) sevEid = sim.slots[mid.slot]!;
    for (const e of sim.events) {
      if (e.e !== 'cast' || e.src !== sevEid) continue;
      if (e.recast) recasts++;
      else casts[e.slot]!++;
    }
    for (const s of sim.slots) {
      if (hasBuff(sim, s, 'suppress', 'sev_r3') || hasBuff(sim, s, 'stun', 'sev_e')) ccTicks++;
      if (hasBuff(sim, s, 'stun', 'sev_genjutsu')) genjutsu++;
    }
    if (ult < 0) ult = ultChoiceOf(sim, sevEid);
  });
  const st = (slot: number) => r.stats.find((s) => s.slot === slot)!;
  const fmt = (s: ReturnType<typeof st>) => `${s.champion}: cs ${s.cs} k/d ${s.kills}/${s.deaths} dmgToChamps ${Math.round(s.damageToChampions)} gold/min ${Math.round(s.goldEarned / r.minutes)}`;
  process.stdout.write(`game ${g + 1} seed ${seed} ${r.minutes.toFixed(1)} min winner ${r.winner ?? '-'}\n`);
  process.stdout.write(`  Sev casts Q/W/E/R ${casts.join('/')} recasts ${recasts} ult ${ULTS[ult] ?? '-'} E-stun+R3 s ${(ccTicks / 30).toFixed(1)} genjutsu s ${(genjutsu / 30).toFixed(1)}\n`);
  process.stdout.write(`  blue ${fmt(st(mid.slot))}\n  red  ${fmt(st(red.slot))}\n`);
}
