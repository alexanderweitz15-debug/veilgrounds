// @ts-nocheck
// Level-1 behaviour: per role, mean distance (units, then % of map size) to the own outer tower of the role's lane
// at fixed times, first-wave CS (at 2:30 / 3:00), deaths and kills before 2:00 / 3:00, level-1 invades.
// npx tsx tools/scratch/early.ts [seeds=1,2,3] [rank=gold] [dump=0]
import { botGameConfig } from '../../src/ai/runner';
import { runBotGame } from '../../src/ai/harness';

const seeds = (process.argv[2] ?? '1,2,3').split(',').map(Number);
const rank = process.argv[3] ?? 'gold';
const dump = process.argv[4] === '1';
const TIMES = [10, 30, 50, 65, 80, 95, 110, 130];
const acc: Record<string, Record<number, number[]>> = {};
const cs: Record<string, number[]> = {};
let d120 = 0, d180 = 0, k120 = 0, k180 = 0, games = 0, invadeGames = 0;
for (const seed of seeds) {
  const cfg = botGameConfig(seed, rank);
  cfg.botUtility = true;
  const sim0 = { done: false };
  const kills: [number, number][] = [];
  let invade = false;
  const res = runBotGame(cfg, 3 * 1800, (sim) => {
    const t = sim.tick / 30;
    const { Pos, Unit, Champ, Hp } = sim.c;
    if (sim.tick % 300 === 0 && dump) {
      process.stdout.write(`t=${t} ` + cfg.players.map((p) => { const e = sim.slots[p.slot]; return `${p.team}${p.role[0]}(${Math.round(Pos.x[e])},${Math.round(Pos.y[e])})`; }).join(' ') + '\n');
    }
    if (!TIMES.includes(t)) return;
    for (const p of cfg.players) {
      const e = sim.slots[p.slot];
      const side = sim.map.sides[p.team];
      const lane = p.role === 'mid' ? 'mid' : p.role === 'top' ? 'top' : p.role === 'jungle' ? null : 'bot';
      let d: number;
      if (lane) {
        const tw = side.towers[lane][0];
        d = Math.hypot(Pos.x[e] - tw.x, Pos.y[e] - tw.y);
      } else {
        const c = side.camps[0];
        d = Math.min(...side.camps.map((c) => Math.hypot(Pos.x[e] - c.x, Pos.y[e] - c.y)));
      }
      // invade: any champion on the other half of the map before 100 s
      const f = sim.map.sides[1 - p.team].fountain;
      const own = side.fountain;
      if (t <= 95 && Math.hypot(Pos.x[e] - f.x, Pos.y[e] - f.y) < Math.hypot(Pos.x[e] - own.x, Pos.y[e] - own.y) - 1500) invade = true;
      ((acc[p.role] ??= {})[t] ??= []).push(d);
    }
  }, { noVariance: true, reflex: true });
  games++;
  if (invade) invadeGames++;
  for (const s of res.stats) {
    (cs[s.role] ??= []).push(s.cs);
    d180 += s.deaths; k180 += s.kills;
  }
}
const mean = (a) => (a.reduce((x, y) => x + y, 0) / a.length) | 0;
process.stdout.write(`games ${games}  invadeGames ${invadeGames}\n`);
process.stdout.write('dist to own outer tower (jungle: nearest own camp)\nrole   ' + TIMES.map((t) => String(t).padStart(6)).join('') + '   cs@3:00\n');
for (const r of ['top', 'jungle', 'mid', 'adc', 'support']) process.stdout.write(r.padEnd(8) + TIMES.map((t) => String(mean(acc[r]?.[t] ?? [0])).padStart(6)).join('') + '   ' + (cs[r] ? (cs[r].reduce((a, b) => a + b, 0) / cs[r].length).toFixed(1) : '-') + '\n');
process.stdout.write(`deaths<3:00 per game ${(d180 / games).toFixed(2)} kills<3:00 per game ${(k180 / games).toFixed(2)}\n`);
