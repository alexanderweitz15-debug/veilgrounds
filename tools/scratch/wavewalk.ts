// @ts-nocheck
// Walking through minion waves: a lone champion in mid (laneOnly, waves on) walks back and forth across the wave
// clash point. Reports time vs ideal and no-progress ticks per crossing (collision / body-block feel).
import { createSim, step } from '../../src/sim/sim';
import { Lane } from '../../src/sim/types';
const cfg = { seed: 3, mode: 'laneOnly', minionLanes: [Lane.Mid], players: [{ slot: 0, team: 0, champion: process.argv[2] ?? 'mira', role: 'mid', summoners: ['sprung', 'heilen'], isHuman: true }] };
const sim = createSim(cfg);
const e = sim.slots[0];
while (sim.tick < 95 * 30) step(sim, []);
const C = sim.map.size / 2;
const pts = [[C - 700, C + 700], [C + 500, C - 500]];
let tot = 0, ideal = 0, np = 0, n = 0;
for (let k = 0; k < 12; k++) {
  const [x, y] = pts[k % 2];
  sim.c.Hp.cur[e] = sim.c.Hp.max[e];
  const sx = sim.c.Pos.x[e], sy = sim.c.Pos.y[e];
  step(sim, [{ slot: 0, cmd: { t: 'move', x, y } }]);
  let t = 1, lx = sim.c.Pos.x[e], ly = sim.c.Pos.y[e];
  while (sim.c.Move.mode[e] !== 0 && t < 400) { step(sim, []); t++; const d = Math.hypot(sim.c.Pos.x[e] - lx, sim.c.Pos.y[e] - ly); if (d < sim.c.Stats.ms[e] / 30 * 0.3) np++; lx = sim.c.Pos.x[e]; ly = sim.c.Pos.y[e]; sim.c.Hp.cur[e] = sim.c.Hp.max[e]; }
  const id = Math.hypot(x - sx, y - sy) / sim.c.Stats.ms[e] * 30;
  tot += t; ideal += id; n++;
}
console.log(`crossings ${n} time/ideal ${(tot / ideal).toFixed(3)} no-progress ticks ${np} (${(np / n).toFixed(1)}/crossing)`);
