// @ts-nocheck
import { step } from '../../src/sim/sim';
import { findPath, walkable } from '../../src/sim/map';
import { makeSim, place } from '../../tests/combat-helpers';
const sim = makeSim({ players: [{ slot: 0, team: 0, champion: 'mira', role: 'mid', summoners: ['sprung', 'heilen'], isHuman: true }] });
const e = sim.slots[0];
const [sx, sy, tx, ty] = process.argv.slice(2).map(Number);
place(sim, e, sx, sy);
console.log('start walkable', walkable(sim.map.nav, sx, sy), 'plan', JSON.stringify(findPath(sim.map.nav, sx, sy, tx, ty).map(p => [Math.round(p.x), Math.round(p.y)])));
step(sim, [{ slot: 0, cmd: { t: 'move', x: tx, y: ty } }]);
for (let i = 0; i < 400; i++) { step(sim, []); if (i % 25 === 0) console.log(i, Math.round(sim.c.Pos.x[e]), Math.round(sim.c.Pos.y[e]), 'mode', sim.c.Move.mode[e], 'hp', Math.round(sim.c.Hp.cur[e]), 'alive', sim.c.Unit.alive[e], 'path', JSON.stringify((sim.paths.get(e) ?? []).slice(0, 2).map(p => [Math.round(p.x), Math.round(p.y)]))); }
