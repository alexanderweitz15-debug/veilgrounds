// A13 combat micro measurement (docs/agents/wave1-a13.md). Plays headless beta-brain games (reflex + utility) and
// measures, from the sim's ground truth (harness side, never the brain): skillshot hit rate, dodge rate, trade
// balance, deaths in teamfights, kills per game, CS@10 of the laners, idle share and game length.
//
//   npx tsx tools/botHints/combatBench.ts --rank=gold --games=4 --minutes=20 --seed=101            (self play)
//   npx tsx tools/botHints/combatBench.ts --rank=gold --pairs=4 --minutes=20 --seed=101 --ab        (micro vs no micro)
//
// --ab plays every seed twice with the sides swapped: team A has the combat micro layer on, team B plays like before
// A13 (BOT_MICRO=0 behaviour, src/ai/combat/flag.ts). Self play (default) has it on for both teams; run it with
// BOT_MICRO=0 for the "before" numbers of the same code.
// Definitions (all ground truth, per team of the caster / victim):
//   skillshot hit rate  = aimed skillshot casts (cursor within AIMED_R of an enemy champion) that damaged an enemy
//                         champion within HIT_WINDOW ticks / aimed casts
//   dodge rate          = threats (an enemy line projectile on a path through the champion, or a ground telegraph over
//                         it, the first time that holds) that did not damage it / threats
//   trade balance       = champion damage dealt / (dealt + taken) of the team, laning phase (before 14:00)
//   teamfight deaths    = champion deaths with >= 2 other allies and >= 2 enemies within TF_R

import { query } from 'bitecs';
import { RANKS, type Rank } from '../../src/ai/profiles/schema';
import { botGameConfig } from '../../src/ai/runner';
import { runBotGame } from '../../src/ai/harness';
import { setMicroOverride } from '../../src/ai/combat/flag';
import { championData } from '../../src/sim/champions';
import { Kind } from '../../src/sim/types';
import type { Sim } from '../../src/sim/sim';
import { BUILDS } from '../../src/ai/bot/builds';
import sevBuild from '../../src/data/builds/sev.json';

BUILDS.sev ??= sevBuild as (typeof BUILDS)[string];

declare const process: { argv: string[]; stdout: { write(s: string): void } };

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k!, v ?? 'true'] as const;
  }),
);
const rank = (args.get('rank') ?? 'gold') as Rank;
if (!RANKS.includes(rank)) throw new Error(`unknown rank ${rank}`);
const ab = args.get('ab') === 'true';
const games = Number(args.get('pairs') ?? args.get('games') ?? 4);
const minutes = Number(args.get('minutes') ?? 20);
const seed0 = Number(args.get('seed') ?? 101);
const noVariance = args.get('variance') === '0';
const json = args.get('json') === 'true';

const AIMED_R = 350;
const HIT_WINDOW = 75;
const TF_R = 1500;
const LANE_END = 14 * 1800;
const LINE_AHEAD = 1300;

interface Side {
  casts: number;
  hits: number;
  threats: number;
  dodged: number;
  lineThreats: number;
  lineDodged: number;
  zoneThreats: number;
  zoneDodged: number;
  dealt: number;
  taken: number;
  dealtLane: number;
  takenLane: number;
  kills: number;
  deaths: number;
  tfDeaths: number;
  cs10: number;
  laners: number;
  idleTicks: number;
  utilDen: number;
}
const newSide = (): Side => ({ casts: 0, hits: 0, threats: 0, dodged: 0, lineThreats: 0, lineDodged: 0, zoneThreats: 0, zoneDodged: 0, dealt: 0, taken: 0, dealtLane: 0, takenLane: 0, kills: 0, deaths: 0, tfDeaths: 0, cs10: 0, laners: 0, idleTicks: 0, utilDen: 0 });

interface Pending {
  kind: 'cast' | 'line' | 'zone';
  /** Team of the caster (cast) or of the victim (line / zone). */
  team: number;
  src: number;
  victim: number;
  from: number;
  until: number;
}

interface GameOut {
  sides: [Side, Side];
  ticks: number;
  winner: number | undefined;
}

function playGame(seed: number, microTeam: number | undefined): GameOut {
  const config = botGameConfig(seed, rank);
  config.botUtility = true;
  setMicroOverride(microTeam === undefined ? null : (ctx) => ctx.team === microTeam);
  const sides: [Side, Side] = [newSide(), newSide()];
  const pend: Pending[] = [];
  const lineSeen = new Set<string>();
  const tfDeathsSeen = new Set<number>();
  const res = runBotGame(
    config,
    Math.round(minutes * 60 * 30),
    (sim: Sim) => {
      const { Unit, Pos, Proj } = sim.c;
      const T = sim.tick;
      const champs: number[] = [];
      for (const p of config.players) {
        const e = sim.slots[p.slot];
        if (e !== undefined && e >= 0) champs.push(e);
      }
      const alive = (e: number): boolean => Unit.alive[e] === 1;
      const dist = (a: number, x: number, y: number): number => Math.hypot(Pos.x[a]! - x, Pos.y[a]! - y);
      const isChamp = (e: number): boolean => e >= 0 && Unit.kind[e] === Kind.Champion;
      for (const ev of sim.events) {
        if (ev.e === 'cast' && !ev.recast && isChamp(ev.src)) {
          const champ = sim.championIds[Unit.champ[ev.src]!] ?? '';
          const ab = championData(champ).abilities[ev.slot];
          if (!ab || !(ab.type === 'skillshot_line' || ab.type === 'skillshot_circle' || ab.type === 'zone' || ab.type === 'cone')) continue;
          if (!ab.effects.some((x) => x.kind === 'damage')) continue;
          const team = Unit.team[ev.src]!;
          const victim = champs.find((c) => alive(c) && Unit.team[c] !== team && dist(c, ev.x, ev.y) <= AIMED_R);
          if (victim === undefined) continue;
          sides[team === 1 ? 1 : 0].casts++;
          pend.push({ kind: 'cast', team, src: ev.src, victim: -1, from: T, until: T + HIT_WINDOW + Math.round((ab.delay ?? 0) * 30) });
        } else if (ev.e === 'zone' && isChamp(ev.src) && !ev.line) {
          for (const c of champs) {
            if (!alive(c) || Unit.team[c] === ev.team || dist(c, ev.x, ev.y) > ev.r + Unit.radius[c]!) continue;
            sides[Unit.team[c] === 1 ? 1 : 0].threats++;
            sides[Unit.team[c] === 1 ? 1 : 0].zoneThreats++;
            pend.push({ kind: 'zone', team: Unit.team[c]!, src: ev.src, victim: c, from: T, until: ev.at + 8 });
          }
        } else if (ev.e === 'damage' && isChamp(ev.dst) && isChamp(ev.src) && Unit.team[ev.src] !== Unit.team[ev.dst]) {
          const st = sides[Unit.team[ev.src] === 1 ? 1 : 0];
          const vt = sides[Unit.team[ev.dst] === 1 ? 1 : 0];
          st.dealt += ev.amount;
          vt.taken += ev.amount;
          if (T < LANE_END) {
            st.dealtLane += ev.amount;
            vt.takenLane += ev.amount;
          }
          if (!ev.auto) {
            for (const p of pend) {
              if (p.until < T || p.from > T || p.src !== ev.src) continue;
              if (p.kind === 'cast' && p.victim === -1) {
                p.victim = -2; // resolved as a hit
                sides[p.team === 1 ? 1 : 0].hits++;
              } else if ((p.kind === 'zone' || p.kind === 'line') && p.victim === ev.dst) {
                p.victim = -3; // resolved as a hit on the victim
              }
            }
          }
        } else if (ev.e === 'death' && ev.kind === Kind.Champion) {
          const vTeam = ev.team;
          sides[vTeam === 1 ? 1 : 0].deaths++;
          if (ev.killer >= 0 && Unit.team[ev.killer] !== undefined && Unit.team[ev.killer] !== vTeam) sides[Unit.team[ev.killer] === 1 ? 1 : 0].kills++;
          let allies = 0;
          let foes = 0;
          for (const c of champs) {
            if (c === ev.eid || !alive(c) || dist(c, ev.x, ev.y) > TF_R) continue;
            if (Unit.team[c] === vTeam) allies++;
            else foes++;
          }
          if (allies >= 2 && foes >= 2 && !tfDeathsSeen.has(ev.eid * 1e6 + T)) {
            tfDeathsSeen.add(ev.eid * 1e6 + T);
            sides[vTeam === 1 ? 1 : 0].tfDeaths++;
          }
        }
      }
      // line projectiles: a threat the first tick a champion of the other team stands on the path
      for (const e of query(sim.world, [Proj])) {
        if (Proj.kind[e] !== 1) continue;
        const src = Proj.src[e]!;
        if (!isChamp(src)) continue;
        for (const c of champs) {
          if (!alive(c) || Unit.team[c] === Proj.team[e]) continue;
          const rx = Pos.x[c]! - Pos.x[e]!;
          const ry = Pos.y[c]! - Pos.y[e]!;
          const along = rx * Proj.dx[e]! + ry * Proj.dy[e]!;
          if (along <= 0 || along > LINE_AHEAD) continue;
          const perp = rx * Proj.dy[e]! - ry * Proj.dx[e]!;
          if (Math.abs(perp) > Proj.width[e]! / 2 + Unit.radius[c]! + 20) continue;
          const key = `${e}:${Proj.srcSerial[e]}:${c}`;
          if (lineSeen.has(key)) continue;
          lineSeen.add(key);
          const s = sides[Unit.team[c] === 1 ? 1 : 0];
          s.threats++;
          s.lineThreats++;
          pend.push({ kind: 'line', team: Unit.team[c]!, src, victim: c, from: T, until: T + Math.ceil((along / Math.max(1, Proj.speed[e]!)) * 30) + 12 });
        }
      }
      // resolve what ran out of time
      for (let i = pend.length - 1; i >= 0; i--) {
        const p = pend[i]!;
        if (p.until >= T) continue;
        if (p.kind !== 'cast' && p.victim !== -3) {
          const s = sides[p.team === 1 ? 1 : 0];
          s.dodged++;
          if (p.kind === 'line') s.lineDodged++;
          else s.zoneDodged++;
        }
        pend.splice(i, 1);
      }
      if (T === 10 * 1800) {
        for (const p of config.players) {
          if (p.role === 'jungle' || p.role === 'support') continue;
          const e = sim.slots[p.slot]!;
          const s = sides[p.team === 1 ? 1 : 0];
          s.cs10 += sim.c.Champ.cs[e]!;
          s.laners++;
        }
      }
    },
    { noVariance, reflex: true },
  );
  setMicroOverride(null);
  for (const st of res.stats) {
    if (st.role === 'jungle' || st.role === 'support') continue;
    const s = sides[st.team === 1 ? 1 : 0];
    s.idleTicks += st.idleTicks;
    s.utilDen += st.utilDen;
  }
  return { sides, ticks: res.ticks, winner: res.winner };
}

const sum = (a: Side, b: Side): Side => {
  const o = newSide();
  for (const k of Object.keys(o) as (keyof Side)[]) o[k] = a[k] + b[k];
  return o;
};
const pct = (a: number, b: number): string => (b > 0 ? ((100 * a) / b).toFixed(1) + '%' : 'n/a');

function report(label: string, s: Side, n: number): void {
  const out = [
    `${label}:`,
    `skillshot ${pct(s.hits, s.casts)} (${s.hits}/${s.casts})`,
    `dodge ${pct(s.dodged, s.threats)} (${s.dodged}/${s.threats}; line ${pct(s.lineDodged, s.lineThreats)}, zone ${pct(s.zoneDodged, s.zoneThreats)})`,
    `tradeBal ${pct(s.dealtLane, s.dealtLane + s.takenLane)}`,
    `dmgBal ${pct(s.dealt, s.dealt + s.taken)}`,
    `kills/game ${(s.kills / n).toFixed(1)}`,
    `deaths/game ${(s.deaths / n).toFixed(1)} tfDeaths ${(s.tfDeaths / n).toFixed(1)} (${pct(s.tfDeaths, s.deaths)})`,
    `cs10 ${(s.cs10 / Math.max(1, s.laners)).toFixed(1)}`,
    `idle ${pct(s.idleTicks, s.utilDen)}`,
  ];
  process.stdout.write(out.join(' | ') + '\n');
}

const t0 = Date.now();
if (ab) {
  let on = newSide();
  let off = newSide();
  let ticks = 0;
  let wins = 0;
  for (let g = 0; g < games; g++) {
    for (const microTeam of [0, 1]) {
      const r = playGame(seed0 + g, microTeam);
      on = sum(on, r.sides[microTeam]!);
      off = sum(off, r.sides[1 - microTeam]!);
      ticks += r.ticks;
      if (r.winner === microTeam) wins++;
    }
  }
  const n = games * 2;
  process.stdout.write(`A/B ${rank} seeds ${seed0}..${seed0 + games - 1} x2 sides, ${minutes} min, avg length ${(ticks / n / 1800).toFixed(1)} min, micro wins ${wins}/${n}, wall ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
  report('micro ON ', on, n);
  report('micro OFF', off, n);
  if (json) process.stdout.write(JSON.stringify({ on, off, n }) + '\n');
} else {
  let all = newSide();
  let ticks = 0;
  for (let g = 0; g < games; g++) {
    const r = playGame(seed0 + g, undefined);
    all = sum(all, sum(r.sides[0], r.sides[1]));
    ticks += r.ticks;
  }
  process.stdout.write(`self ${rank} seeds ${seed0}..${seed0 + games - 1}, ${minutes} min, avg length ${(ticks / games / 1800).toFixed(1)} min, wall ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
  // kills/game counts both teams in self play
  report('all teams', all, games);
  if (json) process.stdout.write(JSON.stringify({ all, n: games }) + '\n');
}
