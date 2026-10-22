// Plate opportunities: ticks where a laner is within 1300 of the enemy outer tower of its lane with >= 2 own minions
// tanking it (no enemy champion near), bucketed by the governing intent and whether the bot attacks the tower.
import { botGameConfig } from '../../src/ai/runner';
import { runBotGame } from '../../src/ai/harness';
import { Kind } from '../../src/sim/types';
declare const process: { argv: string[]; stdout: { write(s: string): void } };
const min = Number(process.argv[2] ?? 14);
const seed = Number(process.argv[3] ?? 1);
const cfg = botGameConfig(seed, 'gold');
const LANE: Record<string, 'top' | 'mid' | 'bot'> = { top: 'top', mid: 'mid', adc: 'bot' };
const buckets: Record<string, number> = {};
const lastIntent = new Map<number, string>();
runBotGame(cfg, Math.round(min * 1800), (sim, _i, bots) => {
  if (sim.tick % 10) return;
  const { Unit, Pos, Atk } = sim.c;
  for (const e of bots.log.entries(undefined, sim.tick - 10)) if (e.node === 'intent' || e.node === 'main') lastIntent.set(e.bot, `${e.node}:${e.chosen}`);
  for (const p of cfg.players) {
    const lane = LANE[p.role];
    if (!lane) continue;
    const eid = sim.slots[p.slot]!;
    if (!Unit.alive[eid]) continue;
    const tp = sim.map.sides[p.team === 0 ? 1 : 0].towers[lane][0]!;
    let tower = -1;
    for (let u = 0; u < Unit.kind.length; u++) if (Unit.alive[u] && Unit.kind[u] === Kind.Tower && Math.hypot(Pos.x[u]! - tp.x, Pos.y[u]! - tp.y) < 200) tower = u;
    if (tower < 0 || Math.hypot(Pos.x[eid]! - tp.x, Pos.y[eid]! - tp.y) > 1300) continue;
    let tank = 0;
    let foes = 0;
    for (let u = 0; u < Unit.kind.length; u++) {
      if (!Unit.alive[u]) continue;
      const d = Math.hypot(Pos.x[u]! - tp.x, Pos.y[u]! - tp.y);
      const k = Unit.kind[u]!;
      if (Unit.team[u] === p.team && k >= 2 && k <= 5 && d < 800) tank++;
      if (Unit.team[u] !== p.team && k === Kind.Champion && d < 1400) foes++;
    }
    if (tank < 2 || foes > 0) continue;
    const key = `${lastIntent.get(p.slot) ?? '?'} | ${Atk.target[eid] === tower ? 'HITS TOWER' : Atk.target[eid]! >= 0 ? 'attacks other' : 'no attack'}`;
    buckets[key] = (buckets[key] ?? 0) + 1;
  }
});
for (const [k, v] of Object.entries(buckets).sort((a, b) => b[1] - a[1])) process.stdout.write(`${v} ${k}\n`);
