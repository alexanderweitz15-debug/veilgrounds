// @ts-nocheck
// Roam outcomes (new brain): starts, how each ended, kills by the roamer within 30 s of a start, CS lost to roams.
// npx tsx tools/scratch/roams.ts [minutes=12] [seeds=1,2] [rank=gold]
import { botGameConfig } from '../../src/ai/runner';
import { runBotGame } from '../../src/ai/harness';
import { Kind } from '../../src/sim/types';

const min = Number(process.argv[2] ?? 12);
const seeds = (process.argv[3] ?? '1,2').split(',').map(Number);
const rank = process.argv[4] ?? 'gold';
const T = { starts: 0, ended: {}, byRole: {}, roamKills: 0, roamAssistKills: 0, allKills: 0, minutes: 0, absSec: 0, lossRoam: 0, laneMin: 0, laneCs: 0, games: 0 };
for (const seed of seeds) {
  const cfg = botGameConfig(seed, rank);
  cfg.botUtility = true;
  const deaths = [];
  const res = runBotGame(cfg, Math.round(min * 1800), (sim) => {
    for (const ev of sim.events) if (ev.e === 'death' && ev.kind === Kind.Champion) deaths.push({ tick: sim.tick, killer: ev.killer });
  }, { noVariance: true, reflex: true });
  T.games++;
  T.minutes += res.minutes;
  T.allKills += deaths.length;
  for (const p of cfg.players) {
    const ent = res.sim.slots[p.slot];
    const log = res.bots.log.entries(p.slot);
    let start = null;
    const windows = [];
    for (const x of log) {
      if (x.node !== 'roam') continue;
      if (String(x.chosen).startsWith('roam_')) {
        T.starts++;
        T.byRole[p.role] = (T.byRole[p.role] ?? 0) + 1;
        start = x.tick;
      } else if (x.chosen === 'done' || x.chosen === 'abort') {
        const why = `${x.chosen}: ${String(x.reason).replace(/[0-9.]+/g, '#').split(';')[0]}`;
        T.ended[why] = (T.ended[why] ?? 0) + 1;
        if (start !== null) { T.absSec += (x.tick - start) / 30; windows.push([start, x.tick + 90]); }
        start = null;
      }
    }
    if (start !== null) windows.push([start, start + 900]);
    for (const d of deaths) if (d.killer === ent && windows.some(([a, b]) => d.tick >= a && d.tick <= b)) T.roamKills++;
  }
  for (const s of res.stats) if (['mid', 'top', 'adc'].includes(s.role)) { T.lossRoam += s.csLoss.absent_roam; T.laneMin += s.laneMinions; T.laneCs += s.laneCs; }
}
console.log(`games ${T.games} min ${T.minutes.toFixed(0)}  roam starts ${T.starts} (${(T.starts / T.minutes).toFixed(2)}/game-min), roamer kills ${T.roamKills} of ${T.allKills} kills, roamSec ${T.absSec.toFixed(0)}, lane CS lost to roam ${(100 * T.lossRoam / T.laneMin).toFixed(1)}% of minions, laner csShare ${(100 * T.laneCs / T.laneMin).toFixed(0)}%`);
console.log('by role', JSON.stringify(T.byRole));
for (const [k, v] of Object.entries(T.ended).sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(4), k);
