// Headless bot-vs-bot game runner with per-champion stats (tests, tools/botSim.ts).
// The harness reads the Sim directly for statistics; only the brains are fog-restricted.

import { createSim, step, stateHash, type Sim } from '../sim/sim';
import { Kind, type SimConfig, type TickInput } from '../sim/types';
import { BotRunner } from './runner';

export interface ChampStats {
  slot: number;
  team: number;
  champion: string;
  role: string;
  rank: string;
  cs: number;
  /** CS at 15:00 (Table A reference point; the final CS if the game ended earlier). */
  cs15: number;
  kills: number;
  deaths: number;
  goldEarned: number;
  damageToChampions: number;
  /** Total path length walked. */
  moved: number;
  /** Longest stretch (s) alive, not recalling, not in fountain, not moving and not attacking (from 1:45 on, when the
   *  first waves have met; before that waiting at the tower is expected). */
  maxIdleS: number;
  /** Style metrics (spec-bots §10 acceptance): ward / recall commands, finished trades (count, total s),
   *  orbwalked autos / autos the bot issued, roams started (L's roam log). Bots only. */
  wards: number;
  recalls: number;
  trades: number;
  tradeS: number;
  orbOk: number;
  autos: number;
  roams: number;
  /** Pathing metrics (sampled every 0.5 s while alive, outside the fountain): move commands issued, heading reversals
   *  (> 120 deg turn between consecutive 0.5 s steps of >= 40 units each), stuck seconds (walking a path or chasing,
   *  < 15 units moved in 1 s, not attacking), path efficiency (net displacement / walked distance over 2 s windows
   *  with >= 300 walked: 1 = straight lines), sampled walking seconds. */
  moveCmds: number;
  reversals: number;
  stuckS: number;
  effSum: number;
  effN: number;
  walkS: number;
}

export interface GameResult {
  sim: Sim;
  ticks: number;
  minutes: number;
  winner: number | undefined;
  hash: string;
  stats: ChampStats[];
  /** The bot runner (decision log, per-bot memory) for metrics and tests. */
  bots: BotRunner;
  /** Pacing metrics (tools/botSim.ts): minute the first tower fell (undefined: none), towers destroyed per team
   *  (towers of the *other* team that fell), champion kills by 15:00 and 25:00. */
  firstTowerMin: number | undefined;
  towersTaken: [number, number];
  killsAt15: number;
  killsAt25: number;
}

const IDLE_FROM = 105 * 30;

export function runBotGame(config: SimConfig, maxTicks: number, onTick?: (sim: Sim, inputs: TickInput[], bots: BotRunner) => void): GameResult {
  const sim = createSim(config);
  const bots = new BotRunner(config);
  const { Champ, Unit, Pos, Atk } = sim.c;
  const stats: ChampStats[] = config.players.map((p) => ({
    slot: p.slot,
    team: p.team,
    champion: p.champion,
    role: p.role,
    rank: p.bot?.rank ?? 'human',
    cs: 0,
    cs15: 0,
    kills: 0,
    deaths: 0,
    goldEarned: 0,
    damageToChampions: 0,
    moved: 0,
    maxIdleS: 0,
    wards: 0,
    recalls: 0,
    trades: 0,
    tradeS: 0,
    orbOk: 0,
    autos: 0,
    roams: 0,
    moveCmds: 0,
    reversals: 0,
    stuckS: 0,
    effSum: 0,
    effN: 0,
    walkS: 0,
  }));
  // pathing samples per slot: last positions at 0.5 s steps (newest last), alive flag
  const trail = new Map<number, { x: number; y: number }[]>();
  const bySlot = new Map(stats.map((s) => [s.slot, s]));
  const slotOf = (eid: number): number => (eid >= 0 && Unit.kind[eid] === Kind.Champion ? Unit.slot[eid]! : -1);
  const lastGold = new Map<number, number>();
  const idleSince = new Map<number, number>();
  const lastPos = new Map<number, [number, number]>();
  let firstTowerMin: number | undefined;
  const towersTaken: [number, number] = [0, 0];
  let kills = 0;
  let killsAt15 = 0;
  let killsAt25 = 0;
  while (sim.tick < maxTicks && sim.state.winner === undefined) {
    const inputs = bots.tick(sim);
    step(sim, inputs);
    for (const i of inputs) {
      const s = bySlot.get(i.slot);
      if (s && i.cmd.t === 'ward') s.wards++;
      else if (s && i.cmd.t === 'recall') s.recalls++;
      else if (s && i.cmd.t === 'move') s.moveCmds++;
    }
    onTick?.(sim, inputs, bots);
    if (sim.tick <= 15 * 1800) {
      killsAt15 = kills;
      for (const s of stats) s.cs15 = Champ.cs[sim.slots[s.slot]!]!;
    }
    if (sim.tick <= 25 * 1800) killsAt25 = kills;
    for (const ev of sim.events) {
      if (ev.e === 'death' && ev.kind === Kind.Champion) {
        const v = bySlot.get(slotOf(ev.eid));
        if (v) v.deaths++;
        const k = bySlot.get(slotOf(ev.killer));
        if (k && k.team !== v?.team) k.kills++;
        kills++;
      } else if (ev.e === 'death' && ev.kind === Kind.Tower) {
        firstTowerMin ??= sim.tick / 1800;
        const t = ev.team === 0 ? 1 : 0;
        towersTaken[t]++;
      } else if (ev.e === 'damage') {
        const s = bySlot.get(slotOf(ev.src));
        if (s && slotOf(ev.dst) >= 0 && Unit.team[ev.dst] !== s.team) s.damageToChampions += ev.amount;
      }
    }
    for (const s of stats) {
      const eid = sim.slots[s.slot]!;
      const g = Champ.gold[eid]!;
      const prev = lastGold.get(s.slot) ?? g;
      if (g > prev) s.goldEarned += g - prev;
      lastGold.set(s.slot, g);
      const [px, py] = lastPos.get(s.slot) ?? [Pos.x[eid]!, Pos.y[eid]!];
      const step2 = Math.sqrt((Pos.x[eid]! - px) ** 2 + (Pos.y[eid]! - py) ** 2);
      s.moved += step2 < 500 ? step2 : 0; // ignore respawn/recall teleports
      lastPos.set(s.slot, [Pos.x[eid]!, Pos.y[eid]!]);
      const f = sim.map.sides[s.team === 1 ? 1 : 0].fountain;
      const inFountain = (Pos.x[eid]! - f.x) ** 2 + (Pos.y[eid]! - f.y) ** 2 < f.r * f.r;
      const busy = sim.tick < IDLE_FROM || !Unit.alive[eid] || Champ.recallAt[eid]! > 0 || inFountain || step2 > 0.5 || Atk.target[eid]! >= 0 || Atk.phase[eid] !== 0;
      if (sim.tick % 15 === 0) pathSample(s, eid, inFountain);
      if (busy) idleSince.delete(s.slot);
      else {
        const since = idleSince.get(s.slot) ?? sim.tick;
        idleSince.set(s.slot, since);
        s.maxIdleS = Math.max(s.maxIdleS, (sim.tick - since) / 30);
      }
    }
  }
  function pathSample(s: ChampStats, eid: number, inFountain: boolean): void {
    let tr = trail.get(s.slot);
    if (!tr) trail.set(s.slot, (tr = []));
    if (!Unit.alive[eid] || inFountain || Champ.recallAt[eid]! > 0) {
      tr.length = 0;
      return;
    }
    const p = { x: Pos.x[eid]!, y: Pos.y[eid]! };
    const last = tr[tr.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) > 400) tr.length = 0; // teleport / flash: new trail
    tr.push(p);
    if (tr.length > 5) tr.shift();
    const n = tr.length;
    if (n >= 2 && Math.hypot(tr[n - 1]!.x - tr[n - 2]!.x, tr[n - 1]!.y - tr[n - 2]!.y) > 5) s.walkS += 0.5;
    if (n >= 3) {
      const ax = tr[n - 2]!.x - tr[n - 3]!.x;
      const ay = tr[n - 2]!.y - tr[n - 3]!.y;
      const bx = tr[n - 1]!.x - tr[n - 2]!.x;
      const by = tr[n - 1]!.y - tr[n - 2]!.y;
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      if (la >= 40 && lb >= 40 && (ax * bx + ay * by) / (la * lb) < -0.5) s.reversals++;
      const moving = sim.c.Move.mode[eid] !== 0 && Atk.phase[eid] === 0 && !(Atk.target[eid]! >= 0 && sim.c.Move.mode[eid] === 2 && Math.hypot(bx, by) < 1);
      if (moving && Math.hypot(tr[n - 1]!.x - tr[n - 3]!.x, tr[n - 1]!.y - tr[n - 3]!.y) < 15 && sim.c.Move.mode[eid] === 1) s.stuckS += 0.5;
    }
    if (n === 5) {
      let walked = 0;
      for (let i = 1; i < n; i++) walked += Math.hypot(tr[i]!.x - tr[i - 1]!.x, tr[i]!.y - tr[i - 1]!.y);
      if (walked >= 300) {
        s.effSum += Math.hypot(tr[n - 1]!.x - tr[0]!.x, tr[n - 1]!.y - tr[0]!.y) / walked;
        s.effN++;
      }
    }
  }
  for (const s of stats) s.cs = Champ.cs[sim.slots[s.slot]!]!;
  for (const e of bots.log.entries()) {
    const s = bySlot.get(e.bot);
    if (!s) continue;
    if (e.node === 'roam' && e.chosen.startsWith('roam_')) s.roams++;
  }
  for (const b of bots.bots) {
    const s = bySlot.get(b.ctx.slot)!;
    s.orbOk = b.mem.ext.orb.ok;
    s.autos = b.mem.ext.orb.autos;
    s.trades = b.mem.ext.trades.n;
    s.tradeS = b.mem.ext.trades.s;
  }
  return { sim, ticks: sim.tick, minutes: sim.tick / 1800, winner: sim.state.winner as number | undefined, hash: stateHash(sim), stats, bots, firstTowerMin, towersTaken, killsAt15, killsAt25 };
}
