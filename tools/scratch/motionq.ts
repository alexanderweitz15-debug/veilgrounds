// @ts-nocheck
// Bot motion quality in a headless classic game: zigzag (heading flips > 90 deg within 0.5 s while walking), move
// orders per second, and champions standing inside each other (pair distance < 60 % of the radius sum).
// Usage: tsx tools/scratch/motionq.ts [min] [seed]
import { createSim, step } from '../../src/sim/sim';
import { BotRunner, botGameConfig } from '../../src/ai/runner';

const min = Number(process.argv[2] ?? 8), seed = Number(process.argv[3] ?? 1);
const cfg = botGameConfig(seed, 'gold');
const sim = createSim(cfg);
const bots = new BotRunner(cfg, undefined, { noFluid: process.env.NOFLUID === '1' });
const head = new Map(), lastFlip = new Map();
let walkTicks = 0, flips = 0, orders = 0, overlapTicks = 0, pairTicks = 0, aliveTicks = 0;
const orderBy = {};
while (sim.tick < min * 1800) {
  const inp = bots.tick(sim);
  if (sim.tick > 100 * 30) for (const i of inp) if (['move', 'attack', 'attackMove'].includes(i.cmd.t)) { orders++; orderBy[i.cmd.t] = (orderBy[i.cmd.t] ?? 0) + 1; }
  const before = cfg.players.map((p) => [sim.c.Pos.x[sim.slots[p.slot]], sim.c.Pos.y[sim.slots[p.slot]]]);
  step(sim, inp);
  if (sim.tick < 100 * 30) continue;
  const champs = [];
  cfg.players.forEach((p, i) => {
    const e = sim.slots[p.slot];
    if (!sim.c.Unit.alive[e]) return;
    aliveTicks++;
    champs.push(e);
    const dx = sim.c.Pos.x[e] - before[i][0], dy = sim.c.Pos.y[e] - before[i][1];
    const d = Math.hypot(dx, dy);
    if (d < 3 || d > 60) return;
    walkTicks++;
    const h = [dx / d, dy / d];
    const prev = head.get(e);
    if (prev && prev[0] * h[0] + prev[1] * h[1] < 0 && sim.tick - (lastFlip.get(e) ?? -99) > 0) { flips++; lastFlip.set(e, sim.tick); }
    head.set(e, h);
  });
  for (let a = 0; a < champs.length; a++) for (let b = a + 1; b < champs.length; b++) {
    const A = champs[a], B = champs[b];
    const r = (sim.c.Unit.radius[A] + sim.c.Unit.radius[B]);
    const d = Math.hypot(sim.c.Pos.x[A] - sim.c.Pos.x[B], sim.c.Pos.y[A] - sim.c.Pos.y[B]);
    if (d < r * 1.5) { pairTicks++; if (d < r * 0.6) overlapTicks++; }
  }
}
const s = (min * 60 - 100);
console.log(`heading reversals per champion-minute walking: ${(flips / (walkTicks / 30 / 60)).toFixed(1)}  (walk ${(100 * walkTicks / aliveTicks).toFixed(0)}% of alive time)`);
console.log(`orders per bot per second: ${(orders / 10 / s).toFixed(2)}  ${JSON.stringify(orderBy)}`);
console.log(`close champion pairs inside each other (<60% radius sum): ${(100 * overlapTicks / Math.max(1, pairTicks)).toFixed(1)}% of close-pair ticks`);
