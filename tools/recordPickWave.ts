// Records the first mid-lane minion clash (positions only) as a picking fixture.
// run: npx tsx tools/recordPickWave.ts tests/fixtures/pickWave.json
import { query } from 'bitecs';
import { newSim, stepA } from '../tests/structuresHelpers';
import { isMinion } from '../src/sim/types';

// No @types/node in this repo (same as tools/botSim.ts).
declare const process: { argv: string[] };
const { writeFileSync } = (await import('node:' + 'fs')) as { writeFileSync(path: string, data: string): void };

const sim = newSim();
const out = process.argv[2]!;
let snapTick = -1;
const frames: { tick: number; units: { kind: number; team: number; x: number; y: number; radius: number }[] }[] = [];
while (sim.tick < 30 * 120) {
  stepA(sim);
  const { Unit, Pos } = sim.c;
  const ms = [...query(sim.world, [Unit])].filter((e) => Unit.alive[e] && isMinion(Unit.kind[e]!));
  // mid lane: near the diagonal x ~ y
  const mid = ms.filter((e) => Math.abs(Pos.x[e]! - Pos.y[e]!) < 1500);
  const a = mid.filter((e) => Unit.team[e] === 0);
  const b = mid.filter((e) => Unit.team[e] === 1);
  if (!a.length || !b.length) continue;
  let close = Infinity;
  for (const i of a) for (const j of b) close = Math.min(close, Math.hypot(Pos.x[i]! - Pos.x[j]!, Pos.y[i]! - Pos.y[j]!));
  if (snapTick < 0 && close < 300) snapTick = sim.tick;
  if (snapTick >= 0 && (sim.tick - snapTick) % 30 === 0 && frames.length < 4) {
    frames.push({ tick: sim.tick, units: mid.map((e) => ({ kind: Unit.kind[e]!, team: Unit.team[e]!, x: Math.round(Pos.x[e]!), y: Math.round(Pos.y[e]!), radius: Unit.radius[e]! })) });
  }
  if (frames.length >= 4) break;
}
writeFileSync(out, JSON.stringify(frames, null, 0));
console.log('frames', frames.map((f) => `${f.tick}:${f.units.length}`).join(' '));
