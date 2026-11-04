// Timing harness: ms per sim step and per bots.tick in a 10-bot game. Usage: tsx tools/scratch/simtick.ts [minutes] [seed]
import { createSim, step, stateHash } from '../../src/sim/sim';
import { BotRunner, botGameConfig } from '../../src/ai/runner';
declare const process: { argv: string[]; stdout: { write(s: string): void } };
const min = Number(process.argv[2] ?? 30);
const seed = Number(process.argv[3] ?? 1);
const config = botGameConfig(seed, 'gold');
const sim = createSim(config);
const bots = new BotRunner(config);
const tb: number[] = [];
const ts: number[] = [];
const max = Math.round(min * 1800);
const t0 = performance.now();
while (sim.tick < max && sim.state.winner === undefined) {
  const a = performance.now();
  const inputs = bots.tick(sim);
  const b = performance.now();
  step(sim, inputs);
  const c = performance.now();
  tb.push(b - a);
  ts.push(c - b);
}
const wall = (performance.now() - t0) / 1000;
const stat = (x: number[]): string => {
  const s = [...x].sort((p, q) => p - q);
  return `avg ${(x.reduce((p, q) => p + q, 0) / x.length).toFixed(3)} p95 ${s[Math.floor(s.length * 0.95)]!.toFixed(3)} p99 ${s[Math.floor(s.length * 0.99)]!.toFixed(3)} max ${s[s.length - 1]!.toFixed(2)}`;
};
process.stdout.write(`ticks ${sim.tick} wall ${wall.toFixed(1)} s hash ${stateHash(sim)}\nsim.step ms: ${stat(ts)}\nbots.tick ms: ${stat(tb)}\n`);
