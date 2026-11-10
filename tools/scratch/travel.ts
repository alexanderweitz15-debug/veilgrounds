// @ts-nocheck
// Travel times on the map at 345 move speed: fountain -> each own outer tower, mid -> top/bot river, lane to lane.
import { createSim } from '../../src/sim/sim';
import { findPath } from '../../src/sim/map';
import { Kind } from '../../src/sim/types';
const sim = createSim({ seed: 1, mode: 'classic', players: [] });
const len = (a, b) => { const p = findPath(sim.map.nav, a.x, a.y, b.x, b.y); let l = 0, x = a.x, y = a.y; for (const q of p) { l += Math.hypot(q.x - x, q.y - y); x = q.x; y = q.y; } return l; };
const f = sim.map.sides[0].fountain;
const towers = [];
for (let e = 0; e < sim.c.Unit.kind.length; e++) if (sim.c.Unit.alive[e] && sim.c.Unit.kind[e] === Kind.Tower && sim.c.Unit.team[e] === 0 && sim.c.Tower.tier[e] === 0) towers.push({ x: sim.c.Pos.x[e], y: sim.c.Pos.y[e] });
console.log('map size', sim.map.size);
for (const t of towers) { const l = len(f, t); console.log(`fountain -> outer tower (${Math.round(t.x)},${Math.round(t.y)}): ${Math.round(l)} u = ${(l / 345).toFixed(1)} s`); }
const C = { x: sim.map.size / 2, y: sim.map.size / 2 };
const [a, b] = [towers[0], towers[towers.length - 1]];
console.log(`mid centre -> outer towers: ${(len(C, a) / 345).toFixed(1)} s / ${(len(C, b) / 345).toFixed(1)} s`);
console.log(`top outer -> bot outer: ${(len(a, b) / 345).toFixed(1)} s`);
