// Lane presence probe (brain-lane): the two mid laners every 2 s - distance, who is away from the lane and why.
// npx tsx tools/scratch/lanePresence.ts [seed] [minutes]
import { botGameConfig } from '../../src/ai/runner';
import { runBotGame } from '../../src/ai/harness';
import { isMinion } from '../../src/sim/types';
import { query } from 'bitecs';
declare const process: { argv: string[]; stdout: { write(s: string): void } };
const seed = Number(process.argv[2] ?? 1);
const min = Number(process.argv[3] ?? 14);
const cfg = botGameConfig(seed, 'gold');
cfg.botUtility = true;
const mids = cfg.players.filter((p) => p.role === 'mid').map((p) => p.slot);
const bins: Record<string, number>[] = [];
const dists: number[] = [];
const res = runBotGame(
  cfg,
  Math.round(min * 1800),
  (sim) => {
    if (sim.tick % 60 !== 0 || sim.tick < 2 * 1800) return;
    const { Pos, Unit, Hp, Champ } = sim.c;
    const [a, b] = mids.map((s) => sim.slots[s]!) as [number, number];
    const d = Math.hypot(Pos.x[a]! - Pos.x[b]!, Pos.y[a]! - Pos.y[b]!);
    let away = 0;
    for (const e of [a, b]) if (!Unit.alive[e] || Champ.recallAt[e]! > sim.tick) away++;
    // enemy minions within 1200 of each laner
    let near = 0;
    for (const m of query(sim.world, [Unit])) if (Unit.alive[m] && isMinion(Unit.kind[m]!)) for (const e of [a, b]) if (Unit.team[m] !== Unit.team[e] && Math.hypot(Pos.x[m]! - Pos.x[e]!, Pos.y[m]! - Pos.y[e]!) < 1200) near++;
    dists.push(d);
    bins.push({ t: sim.tick / 1800, d: Math.round(d), hpA: Math.round((Hp.cur[a]! / Hp.max[a]!) * 100), hpB: Math.round((Hp.cur[b]! / Hp.max[b]!) * 100), near, away });
  },
  { noVariance: true, reflex: true },
);
const q = (p: number): number => [...dists].sort((x, y) => x - y)[Math.floor(p * (dists.length - 1))]!;
process.stdout.write(`samples ${dists.length}  dist p10 ${q(0.1)} p25 ${q(0.25)} p50 ${q(0.5)} p75 ${q(0.75)} p90 ${q(0.9)}\n`);
for (const th of [700, 1000, 1300, 1600, 2000]) process.stdout.write(`  d<${th}: ${((dists.filter((x) => x < th).length / dists.length) * 100).toFixed(0)}%\n`);
process.stdout.write(`  someone dead/recalling: ${((bins.filter((b) => b.away).length / bins.length) * 100).toFixed(0)}%\n`);
for (const b of bins.filter((_, i) => i % 5 === 0)) process.stdout.write(`${b.t!.toFixed(1)} d=${b.d} hp ${b.hpA}/${b.hpB} enemyMinionsNear=${b.near} away=${b.away}\n`);
for (const s of mids) {
  const b = res.bots.bots.find((x) => x.ctx.slot === s)!;
  const st = (b.mem.ext as { reflex?: { stats: { harassBlock: Record<string, number> }; harass: { autos: number[] } } }).reflex;
  process.stdout.write(`slot ${s} harassBlock ${JSON.stringify(st?.stats?.harassBlock)}\n`);
}
for (const st of res.stats.filter((x) => mids.includes(x.slot))) process.stdout.write(`slot ${st.slot} harassAutos ${st.harassAutos} harassAutos14 ${st.harassAutos14} spells ${st.harassSpells} kills ${st.kills} deaths ${st.deaths} cs ${st.cs}\n`);
