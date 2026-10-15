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
}

const IDLE_FROM = 105 * 30;

export function runBotGame(config: SimConfig, maxTicks: number, onTick?: (sim: Sim, inputs: TickInput[]) => void): GameResult {
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
  }));
  const bySlot = new Map(stats.map((s) => [s.slot, s]));
  const slotOf = (eid: number): number => (eid >= 0 && Unit.kind[eid] === Kind.Champion ? Unit.slot[eid]! : -1);
  const lastGold = new Map<number, number>();
  const idleSince = new Map<number, number>();
  const lastPos = new Map<number, [number, number]>();
  while (sim.tick < maxTicks && sim.state.winner === undefined) {
    const inputs = bots.tick(sim);
    step(sim, inputs);
    for (const i of inputs) {
      const s = bySlot.get(i.slot);
      if (s && i.cmd.t === 'ward') s.wards++;
      else if (s && i.cmd.t === 'recall') s.recalls++;
    }
    onTick?.(sim, inputs);
    for (const ev of sim.events) {
      if (ev.e === 'death' && ev.kind === Kind.Champion) {
        const v = bySlot.get(slotOf(ev.eid));
        if (v) v.deaths++;
        const k = bySlot.get(slotOf(ev.killer));
        if (k && k.team !== v?.team) k.kills++;
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
      if (busy) idleSince.delete(s.slot);
      else {
        const since = idleSince.get(s.slot) ?? sim.tick;
        idleSince.set(s.slot, since);
        s.maxIdleS = Math.max(s.maxIdleS, (sim.tick - since) / 30);
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
  return { sim, ticks: sim.tick, minutes: sim.tick / 1800, winner: sim.state.winner as number | undefined, hash: stateHash(sim), stats, bots };
}
