// @ts-nocheck
// Pathing quality: one champion gets random move orders across the map (no bots). Per order: walked distance vs the
// path length findPath planned, time vs ideal (distance / ms), ticks without progress, and orders that never arrive.
// Usage: tsx tools/scratch/pathq.ts [orders] [seed]
import { createSim, step } from '../../src/sim/sim';
import { findPath, nearestWalkable } from '../../src/sim/map';
import { Rng } from '../../src/sim/rng';
import { CX, CY, makeSim, place } from '../../tests/combat-helpers';

const N = Number(process.argv[2] ?? 120);
const rng = new Rng(Number(process.argv[3] ?? 7));
const sim = makeSim({ players: [{ slot: 0, team: 0, champion: 'mira', role: 'mid', summoners: ['sprung', 'heilen'], isHuman: true }] });
const e = sim.slots[0];
place(sim, e, CX, CY);
const S = sim.map.size;
let sumRatio = 0, sumTime = 0, stuckTicks = 0, failed = 0, orders = 0;
const worst = [];
for (let k = 0; k < N; k++) {
  const sx = sim.c.Pos.x[e], sy = sim.c.Pos.y[e];
  // targets: half nearby (300-1500), half far
  const far = k % 2 === 0;
  const r = far ? 2000 + rng.next() * 5000 : 300 + rng.next() * 1200;
  const a = rng.next() * 6.283;
  const raw = { x: Math.max(100, Math.min(S - 100, sx + Math.cos(a) * r)), y: Math.max(100, Math.min(S - 100, sy + Math.sin(a) * r)) };
  const goal = nearestWalkable(sim.map.nav, raw.x, raw.y);
  const plan = findPath(sim.map.nav, sx, sy, goal.x, goal.y);
  let planLen = 0, px = sx, py = sy;
  for (const p of plan) { planLen += Math.hypot(p.x - px, p.y - py); px = p.x; py = p.y; }
  if (planLen < 50) continue;
  sim.c.Hp.cur[e] = sim.c.Hp.max[e];
  step(sim, [{ slot: 0, cmd: { t: 'move', x: raw.x, y: raw.y } }]);
  let walked = 0, lx = sim.c.Pos.x[e], ly = sim.c.Pos.y[e], t = 1, noProg = 0;
  const ideal = planLen / sim.c.Stats.ms[e] * 30;
  while (sim.c.Move.mode[e] !== 0 && t < ideal * 3 + 60) {
    step(sim, []);
    t++;
    const d = Math.hypot(sim.c.Pos.x[e] - lx, sim.c.Pos.y[e] - ly);
    walked += d;
    if (d < sim.c.Stats.ms[e] / 30 * 0.3) { noProg++; (globalThis.np ??= []).push([Math.round(lx / 50) * 50, Math.round(ly / 50) * 50, t]); }
    lx = sim.c.Pos.x[e]; ly = sim.c.Pos.y[e];
  }
  const miss = Math.hypot(lx - goal.x, ly - goal.y);
  orders++;
  if (miss > 80) { failed++; worst.push({ k, from: [Math.round(sx), Math.round(sy)], to: [Math.round(goal.x), Math.round(goal.y)], miss: Math.round(miss), t }); }
  sumRatio += walked / planLen; sumTime += t / ideal; stuckTicks += noProg;
}
console.log(`orders ${orders}  walked/plan ${(sumRatio / orders).toFixed(3)}  time/ideal ${(sumTime / orders).toFixed(3)}  no-progress ticks ${stuckTicks} (${(stuckTicks / orders).toFixed(1)}/order)  not arrived ${failed}`);
for (const w of worst.slice(0, 10)) console.log('  miss', JSON.stringify(w));
const byT = {}; for (const [x, y, t] of globalThis.np ?? []) { const k = t <= 3 ? 'start(t<=3)' : 'mid'; byT[k] = (byT[k] ?? 0) + 1; }
console.log('no-progress by phase', JSON.stringify(byT));
const spots = {}; for (const [x, y, t] of globalThis.np ?? []) if (t > 3) { const k = `${Math.round(x / 200) * 200},${Math.round(y / 200) * 200}`; spots[k] = (spots[k] ?? 0) + 1; }
console.log('mid spots', JSON.stringify(Object.entries(spots).sort((a, b) => b[1] - a[1]).slice(0, 12)));
