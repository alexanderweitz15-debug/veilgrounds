// Headless bot-vs-bot game runner with per-champion stats (tests, tools/botSim.ts).
// The harness reads the Sim directly for statistics; only the brains are fog-restricted.
// Brain-rework metrics (docs/BRAIN-REWORK.md §10): CS loss by cause, attack utilisation, idle share, harass, plates,
// objective conversion, avoidable gank deaths, recalls with the wave at the own tower, intent histogram, brain cost.

import { query } from 'bitecs';
import { createSim, step, stateHash, type Sim } from '../sim/sim';
import { Kind, Lane, isMinion, type SimConfig, type TickInput, type PlayerSetup } from '../sim/types';
import { sees } from '../sim/vision';
import { BotRunner, seedPersonalities, type RunnerCost, type RunnerOptions } from './runner';
import { reflexState } from './reflex/state';
import type { Rank } from './profiles/schema';

/** Why a minion of the bot's own lane died without the bot's last hit (§10 csLossByCause). `ally_took` is an
 *  addition to the prompt's list: an allied champion (support, jungler, roamer) got the CS - the enemy laner cannot
 *  kill the bot's CS minions (they are his own), so `enemy_took` means zoned (an enemy champion kept the bot out of
 *  reach). Every lost minion gets exactly one cause; the causes sum to laneMinions - laneCs. */
export const CS_CAUSES = [
  'absent_recall',
  'absent_heal',
  'absent_roam',
  'absent_dead',
  'in_range_no_attack',
  'timing_miss',
  'window_collision',
  'tower_took',
  'enemy_took',
  'ally_took',
  'distracted',
] as const;
export type CsCause = (typeof CS_CAUSES)[number];
const zeroCauses = (): Record<CsCause, number> => Object.fromEntries(CS_CAUSES.map((c) => [c, 0])) as Record<CsCause, number>;

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
  // ---------------------------------------------------------------- brain rework §10 (laners: top / mid / adc)
  /** Enemy minions of the bot's lane that died until 15:00 / all game, of them last-hit by the bot, the rest by cause. */
  laneMinions15: number;
  laneCs15: number;
  csLoss15: Record<CsCause, number>;
  laneMinions: number;
  laneCs: number;
  csLoss: Record<CsCause, number>;
  /** 2:00-14:00, alive: ticks with an enemy minion / champion within reach + 200 (den) and of those with the own
   *  attack cycle running (wind-up or backswing, num), and idle ticks (no command > 45 ticks, no attack, standing). */
  utilDen: number;
  utilNum: number;
  idleTicks: number;
  /** Idle ticks by the bot's latest decision-log entry at the start of the idle stretch (node:chosen). */
  idleReasons: Record<string, number>;
  /** Hits on enemy champions outside a trade / all-in (auto / ability damage instances). */
  harassAutos: number;
  harassSpells: number;
  /** Harass autos before 14:00 (Phase 2 gate). */
  harassAutos14: number;
  tradesStarted: number;
  /** Kills by this champion within 10 s after >= 3 harass hits of its team on the victim (in the 20 s before). */
  killsFromHarass: number;
  recallsWaveAtTower: number;
  /** Deaths with the enemy jungler involved (damage in the 10 s before), of them avoidable: the jungler was in the
   *  team's vision 5-20 s before the death. Deaths without any enemy champion damage in the 10 s before. */
  gankDeaths: number;
  avoidableGankDeaths: number;
  deathsNoChamp: number;
  /** Ticks per brain mode (mem.mode; intents once the utility model exists) and mode switches. */
  modeTicks: Record<string, number>;
  modeSwitches: number;
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
  /** Champion kills by 14:00 (laning-phase share, §6.4). */
  killsAt14: number;
  /** Plates taken per team (plates of the other team's towers) before 14:00. */
  plates: [number, number];
  /** Won fights (>= 2 enemy deaths within 15 s, fewer own deaths) and those converted (tower / inhibitor / epic
   *  monster taken by the winner within 30 s), per team. */
  fightsWon: [number, number];
  fightsConverted: [number, number];
  /** Won fights where a conversion was feasible (a winner within 2500 of a live enemy tower, or an epic monster alive
   *  within 3000 of a winner) and how many of those converted (structure / epic / plate within 30 s). */
  fightsFeasible: [number, number];
  fightsConvertedFeasible: [number, number];
  /** Brain cost (only with a clock in the options). */
  cost: RunnerCost;
}

const IDLE_FROM = 105 * 30;
const UTIL_FROM = 120 * 30;
const UTIL_TO = 14 * 1800;
/** A bot further than this from a dying minion of its lane is absent. */
const ABSENT_R = 1400;
const LANER_LANE: Partial<Record<string, number>> = { top: Lane.Top, mid: Lane.Mid, adc: Lane.Bot };
const LANE_NAME = ['top', 'mid', 'bot'] as const;

/** Absence trip of a laner: why it left the lane (first reason; the trip lasts until it is back near its lane's
 *  minions in lane mode). A laner in lane mode far from a dying minion (holding back from the enemy tower, wave
 *  crashing elsewhere) is not absent: its losses get the in-lane causes. */
type Trip = 'recall' | 'heal' | 'roam' | 'dead' | null;
const tripOfMode = (mode: string): Exclude<Trip, null> =>
  mode === 'recall' || mode === 'shop' ? 'recall' : mode === 'home' || mode === 'heal' || mode === 'retreat' ? 'heal' : mode === 'dead' ? 'dead' : 'roam';
/** Modes in which a far laner is still "in lane" (no trip starts). */
const IN_LANE_MODES = new Set(['lane', 'start']);

interface LanerTrack {
  s: ChampStats;
  lane: number;
  trip: Trip;
  /** Minion eid -> last tick the bot started an auto on it / damaged it. */
  atkOn: Map<number, number>;
  dmgOn: Map<number, number>;
  /** Ticks of the bot's own lane last hits (window collision). */
  lh: number[];
  idle: string | null;
}

interface PendingLoss {
  laner: LanerTrack;
  tick: number;
  cause: CsCause | null;
  period: number;
  early: boolean;
}

export interface HarnessOptions extends RunnerOptions {
  /** Drop the bots' ability casts (last-hit trainer "only autos"). */
  autosOnly?: boolean;
  /** Last-hit trainer: the bot stays in lane (recall and ward commands are dropped, as in the practice tool). */
  trainer?: boolean;
}

export function runBotGame(config: SimConfig, maxTicks: number, onTick?: (sim: Sim, inputs: TickInput[], bots: BotRunner) => void, opts: HarnessOptions = {}): GameResult {
  const sim = createSim(config);
  const bots = new BotRunner(config, undefined, opts.autosOnly ? { ...opts, noSpells: true } : opts);
  const { Champ, Unit, Pos, Atk, Stats, Move } = sim.c;
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
    laneMinions15: 0,
    laneCs15: 0,
    csLoss15: zeroCauses(),
    laneMinions: 0,
    laneCs: 0,
    csLoss: zeroCauses(),
    utilDen: 0,
    utilNum: 0,
    idleTicks: 0,
    idleReasons: {},
    harassAutos: 0,
    harassSpells: 0,
    harassAutos14: 0,
    tradesStarted: 0,
    killsFromHarass: 0,
    recallsWaveAtTower: 0,
    gankDeaths: 0,
    avoidableGankDeaths: 0,
    deathsNoChamp: 0,
    modeTicks: {},
    modeSwitches: 0,
  }));
  // pathing samples per slot: last positions at 0.5 s steps (newest last), alive flag
  const trail = new Map<number, { x: number; y: number }[]>();
  const bySlot = new Map(stats.map((s) => [s.slot, s]));
  const botBySlot = new Map(bots.bots.map((b) => [b.ctx.slot, b]));
  const slotOf = (eid: number): number => (eid >= 0 && Unit.kind[eid] === Kind.Champion ? Unit.slot[eid]! : -1);
  const lastGold = new Map<number, number>();
  const idleSince = new Map<number, number>();
  const lastPos = new Map<number, [number, number]>();
  let firstTowerMin: number | undefined;
  const towersTaken: [number, number] = [0, 0];
  let kills = 0;
  let killsAt15 = 0;
  let killsAt25 = 0;
  let killsAt14 = 0;
  const plates: [number, number] = [0, 0];
  const fightsWon: [number, number] = [0, 0];
  const fightsConverted: [number, number] = [0, 0];
  const fightsFeasible: [number, number] = [0, 0];
  const fightsConvertedFeasible: [number, number] = [0, 0];
  const openFeasible: [boolean, boolean] = [false, false];
  // ---- rework metric state
  const laners: LanerTrack[] = stats
    .filter((s) => LANER_LANE[s.role] !== undefined && botBySlot.has(s.slot))
    .map((s) => ({ s, lane: LANER_LANE[s.role]!, trip: null, atkOn: new Map(), dmgOn: new Map(), lh: [], idle: null }));
  const lanerBySlot = new Map(laners.map((l) => [l.s.slot, l]));
  const pending: PendingLoss[] = [];
  const lastCmd = new Map<number, number>();
  const prevMode = new Map<number, string>();
  const prevTrade = new Map<number, boolean>();
  /** victim slot -> ticks of enemy harass hits; champion slot -> last tick of enemy champion damage; victim slot ->
   *  attacker slot -> last damage tick. */
  const harassOn = new Map<number, number[]>();
  const champDmgAt = new Map<number, number>();
  const dmgBy = new Map<number, Map<number, number>>();
  /** team -> ticks the enemy jungler was in that team's vision (sampled every 15 ticks). */
  const junglerSeen: [number[], number[]] = [[], []];
  const junglerSlot = (team: number): number => config.players.find((p) => p.team === team && p.role === 'jungle')?.slot ?? -1;
  const champDeaths: { tick: number; team: number }[] = [];
  const lastFight: [number, number] = [-1e9, -1e9];
  const openFight: [number, number] = [-1, -1];
  const isEpic = (x: number, y: number): boolean => Object.values(sim.map.objectives).some((o) => !Array.isArray(o) && Math.hypot((o as { x: number }).x - x, (o as { y: number }).y - y) < 1200);
  const inTrade = (slot: number): boolean => {
    const b = botBySlot.get(slot);
    return !!b && (!!b.mem.ext.trade || b.mem.mode === 'fight' || b.mem.mode === 'teamfight');
  };
  const finalize = (p: PendingLoss): void => {
    let cause = p.cause;
    if (!cause) {
      // window collision: the bot got another lane last hit around the same time (two windows, one attack timer)
      const near = p.laner.lh.some((t) => Math.abs(t - p.tick) <= p.period + 3);
      cause = near ? 'window_collision' : 'in_range_no_attack';
    }
    p.laner.s.csLoss[cause]++;
    if (p.early) p.laner.s.csLoss15[cause]++;
  };

  while (sim.tick < maxTicks && sim.state.winner === undefined) {
    let inputs = bots.tick(sim);
    if (opts.trainer) inputs = inputs.filter((i) => i.cmd.t !== 'recall' && i.cmd.t !== 'ward');
    if (opts.autosOnly) {
      inputs = inputs.filter((i) => {
        if (i.cmd.t !== 'cast') return true;
        // the brain set busyUntil for the cast it believes it made: the dropped cast must not freeze the bot
        const b = botBySlot.get(i.slot);
        if (b) (b.mem.busyUntil = 0), (b.mem.busySlot = -1);
        return false;
      });
    }
    step(sim, inputs);
    const T = sim.tick;
    for (const i of inputs) {
      const s = bySlot.get(i.slot);
      if (i.cmd.t !== 'levelUp') lastCmd.set(i.slot, T);
      if (s && i.cmd.t === 'ward') s.wards++;
      else if (s && i.cmd.t === 'recall') {
        s.recalls++;
        const l = lanerBySlot.get(i.slot);
        if (l) l.s.recallsWaveAtTower += waveAtOwnTower(sim, l) ? 1 : 0;
      } else if (s && i.cmd.t === 'move') s.moveCmds++;
    }
    onTick?.(sim, inputs, bots);
    if (T <= 15 * 1800) {
      killsAt15 = kills;
      for (const s of stats) s.cs15 = Champ.cs[sim.slots[s.slot]!]!;
    }
    if (T <= 14 * 1800) killsAt14 = kills;
    if (T <= 25 * 1800) killsAt25 = kills;
    // pass 1: attacks and damage (before deaths of the same tick)
    for (const ev of sim.events) {
      if (ev.e === 'attack') {
        const l = lanerBySlot.get(slotOf(ev.src));
        if (l && ev.dst >= 0 && isMinion(Unit.kind[ev.dst]!)) l.atkOn.set(ev.dst, T);
      } else if (ev.e === 'damage') {
        const srcSlot = slotOf(ev.src);
        const s = bySlot.get(srcSlot);
        const dstSlot = slotOf(ev.dst);
        if (s && dstSlot >= 0 && Unit.team[ev.dst] !== s.team) {
          s.damageToChampions += ev.amount;
          champDmgAt.set(dstSlot, T);
          let m = dmgBy.get(dstSlot);
          if (!m) dmgBy.set(dstSlot, (m = new Map()));
          m.set(srcSlot, T);
          if (!inTrade(srcSlot)) {
            if (ev.auto) {
              s.harassAutos++;
              if (T < 14 * 1800) s.harassAutos14++;
            }
            else s.harassSpells++;
            let h = harassOn.get(dstSlot);
            if (!h) harassOn.set(dstSlot, (h = []));
            h.push(T);
            while (h.length && h[0]! < T - 20 * 30) h.shift();
          }
        } else if (srcSlot >= 0 && ev.dst >= 0 && isMinion(Unit.kind[ev.dst]!)) {
          lanerBySlot.get(srcSlot)?.dmgOn.set(ev.dst, T);
        }
      }
    }
    // pass 2: deaths, plates
    for (const ev of sim.events) {
      if (ev.e === 'plate') {
        if (T < 14 * 1800) plates[ev.team === 0 ? 1 : 0]++;
        // a plate after a won lane fight is a (lane) conversion too
        const pw = ev.team === 0 ? 1 : 0;
        if (openFight[pw] >= T) convertFight(pw);
      } else if (ev.e === 'death' && isMinion(ev.kind)) {
        const lane = Unit.lane[ev.eid]!;
        for (const l of laners) {
          if (l.lane !== lane || l.s.team === ev.team) continue;
          const me = sim.slots[l.s.slot]!;
          const early = T <= 15 * 1800;
          l.s.laneMinions++;
          if (early) l.s.laneMinions15++;
          if (ev.killer === me) {
            l.s.laneCs++;
            if (early) l.s.laneCs15++;
            l.lh.push(T);
            continue;
          }
          pending.push({ laner: l, tick: T, cause: lossCause(l, me, ev.eid, ev.x, ev.y, ev.killer, ev.killerKind ?? -1, T), period: 30 / Math.max(0.1, Stats.as[me]!), early });
        }
      } else if (ev.e === 'death' && ev.kind === Kind.Champion) {
        const vSlot = slotOf(ev.eid);
        const v = bySlot.get(vSlot);
        if (v) v.deaths++;
        const kSlot = slotOf(ev.killer);
        const k = bySlot.get(kSlot);
        if (k && k.team !== v?.team) {
          k.kills++;
          const h = (harassOn.get(vSlot) ?? []).filter((t) => t >= T - 20 * 30);
          if (h.length >= 3 && h[h.length - 1]! >= T - 10 * 30) k.killsFromHarass++;
        }
        kills++;
        if (v) {
          if ((champDmgAt.get(vSlot) ?? -1e9) < T - 10 * 30) v.deathsNoChamp++;
          const jg = junglerSlot(1 - v.team);
          if (jg >= 0 && (dmgBy.get(vSlot)?.get(jg) ?? -1e9) >= T - 10 * 30) {
            v.gankDeaths++;
            if (junglerSeen[v.team === 1 ? 1 : 0].some((t) => t >= T - 20 * 30 && t <= T - 5 * 30)) v.avoidableGankDeaths++;
          }
          harassOn.delete(vSlot);
          champDeaths.push({ tick: T, team: v.team });
          fightCheck(T);
        }
      } else if (ev.e === 'death' && (ev.kind === Kind.Tower || ev.kind === Kind.Inhibitor || (ev.kind === Kind.Monster && isEpic(ev.x, ev.y)))) {
        if (ev.kind === Kind.Tower) {
          firstTowerMin ??= T / 1800;
          towersTaken[ev.team === 0 ? 1 : 0]++;
        }
        const winner = ev.kind === Kind.Monster ? ev.killerTeam ?? -1 : ev.team === 0 ? 1 : 0;
        if ((winner === 0 || winner === 1) && openFight[winner] >= T) convertFight(winner);
      }
    }
    while (pending.length && pending[0]!.tick + 40 <= T) finalize(pending.shift()!);
    // per bot: modes, trade starts; per laner: absence trip, utilisation, idle
    for (const b of bots.bots) {
      const s = bySlot.get(b.ctx.slot)!;
      const mode = b.mem.mode;
      s.modeTicks[mode] = (s.modeTicks[mode] ?? 0) + 1;
      if (prevMode.has(b.ctx.slot) && prevMode.get(b.ctx.slot) !== mode) s.modeSwitches++;
      prevMode.set(b.ctx.slot, mode);
      const tr = !!b.mem.ext.trade;
      if (tr && !prevTrade.get(b.ctx.slot)) s.tradesStarted++;
      prevTrade.set(b.ctx.slot, tr);
    }
    if (T % 15 === 0) {
      for (const team of [0, 1] as const) {
        const jg = junglerSlot(1 - team);
        const eid = jg >= 0 ? sim.slots[jg] : undefined;
        if (eid !== undefined && Unit.alive[eid] && sees(sim, team, eid)) {
          junglerSeen[team].push(T);
          while (junglerSeen[team][0]! < T - 30 * 30) junglerSeen[team].shift();
        }
      }
    }
    const needUnits = laners.length > 0;
    const units = needUnits ? liveUnits(sim) : [];
    for (const l of laners) {
      const me = sim.slots[l.s.slot]!;
      const b = botBySlot.get(l.s.slot)!;
      const alive = !!Unit.alive[me];
      if (!alive) l.trip = 'dead';
      else if (Champ.recallAt[me]! > 0 && l.trip !== 'dead' && l.trip !== 'heal') l.trip = 'recall'; // recalling = leaving, even next to the wave
      else if (T % 15 === 0) {
        const nearLane = units.some((u) => isMinion(Unit.kind[u]!) && Unit.lane[u] === l.lane && Math.hypot(Pos.x[u]! - Pos.x[me]!, Pos.y[u]! - Pos.y[me]!) < ABSENT_R);
        if (nearLane && IN_LANE_MODES.has(b.mem.mode)) l.trip = null;
        else if (!nearLane && l.trip === null && (Champ.recallAt[me]! > 0 || !IN_LANE_MODES.has(b.mem.mode))) l.trip = Champ.recallAt[me]! > 0 ? 'recall' : tripOfMode(b.mem.mode);
      }
      if (!alive || T < UTIL_FROM || T >= UTIL_TO || Champ.recallAt[me]! > 0) {
        l.idle = null;
        continue;
      }
      const reach = Stats.range[me]! + Unit.radius[me]! + 200;
      const inReach = units.some((u) => Unit.team[u] !== l.s.team && (isMinion(Unit.kind[u]!) || Unit.kind[u] === Kind.Champion) && Math.hypot(Pos.x[u]! - Pos.x[me]!, Pos.y[u]! - Pos.y[me]!) <= reach + Unit.radius[u]!);
      if (!inReach) {
        l.idle = null;
        continue;
      }
      l.s.utilDen++;
      if (Atk.phase[me] !== 0) l.s.utilNum++;
      const idle = Atk.phase[me] === 0 && Move.mode[me] === 0 && T - (lastCmd.get(l.s.slot) ?? 0) > 45;
      if (!idle) {
        l.idle = null;
        continue;
      }
      if (l.idle === null) {
        const e = bots.log.latest(l.s.slot);
        l.idle = e ? `${e.node}:${e.chosen}` : 'none';
      }
      l.s.idleTicks++;
      l.s.idleReasons[l.idle] = (l.s.idleReasons[l.idle] ?? 0) + 1;
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
      const busy = T < IDLE_FROM || !Unit.alive[eid] || Champ.recallAt[eid]! > 0 || inFountain || step2 > 0.5 || Atk.target[eid]! >= 0 || Atk.phase[eid] !== 0;
      if (T % 15 === 0) pathSample(s, eid, inFountain);
      if (busy) idleSince.delete(s.slot);
      else {
        const since = idleSince.get(s.slot) ?? T;
        idleSince.set(s.slot, since);
        s.maxIdleS = Math.max(s.maxIdleS, (T - since) / 30);
      }
    }
  }
  while (pending.length) finalize(pending.shift()!);

  /** Cause known at the death tick (null: decided 40 ticks later, window collision vs no attack). */
  function lossCause(l: LanerTrack, me: number, m: number, x: number, y: number, killer: number, killerKind: number, T: number): CsCause | null {
    if (!Unit.alive[me]) return 'absent_dead';
    if (Champ.recallAt[me]! > 0) return 'absent_recall';
    const d = Math.hypot(Pos.x[me]! - x, Pos.y[me]! - y);
    if (d > ABSENT_R) {
      const b = botBySlot.get(l.s.slot)!;
      if (l.trip === null && (Champ.recallAt[me]! > 0 || !IN_LANE_MODES.has(b.mem.mode))) l.trip = Champ.recallAt[me]! > 0 ? 'recall' : tripOfMode(b.mem.mode);
      const trip = l.trip;
      if (trip !== null) return trip === 'recall' ? 'absent_recall' : trip === 'heal' ? 'absent_heal' : trip === 'dead' ? 'absent_dead' : 'absent_roam';
    }
    if (killerKind === Kind.Champion) return 'ally_took';
    if ((l.atkOn.get(m) ?? -1e9) >= T - 45 || (l.dmgOn.get(m) ?? -1e9) >= T - 90) return 'timing_miss';
    const b = botBySlot.get(l.s.slot)!;
    const att = reflexState(b.mem).attention?.(T);
    if (att?.distracted || b.mem.ext.lh.roll.get(m)?.skip) return 'distracted';
    const reach = Stats.range[me]! + Unit.radius[me]! + 250;
    if (d > reach) {
      for (const s of stats) {
        if (s.team === l.s.team) continue;
        const e = sim.slots[s.slot]!;
        if (Unit.alive[e] && Math.hypot(Pos.x[e]! - Pos.x[me]!, Pos.y[e]! - Pos.y[me]!) < 900) return 'enemy_took';
      }
    }
    if (killerKind === Kind.Tower) return 'tower_took';
    void killer;
    return null;
  }

  /** >= 3 enemy minions of the bot's lane within 1000 of its frontmost own lane tower. */
  function waveAtOwnTower(sim: Sim, l: LanerTrack): boolean {
    const team = l.s.team === 1 ? 1 : 0;
    const spots = sim.map.sides[team].towers[LANE_NAME[l.lane]!];
    const towers = liveUnits(sim).filter((u) => Unit.kind[u] === Kind.Tower && Unit.team[u] === team && spots.some((p) => Math.hypot(p.x - Pos.x[u]!, p.y - Pos.y[u]!) < 200));
    if (!towers.length) return false;
    const front = towers[0]!; // lane order: outer first
    let n = 0;
    for (const u of liveUnits(sim)) if (isMinion(Unit.kind[u]!) && Unit.team[u] !== team && Unit.lane[u] === l.lane && Math.hypot(Pos.x[u]! - Pos.x[front]!, Pos.y[u]! - Pos.y[front]!) < 1000) n++;
    return n >= 3;
  }

  function convertFight(w: 0 | 1): void {
    fightsConverted[w]++;
    if (openFeasible[w]) fightsConvertedFeasible[w]++;
    openFight[w] = -1;
  }

  /** A conversion is feasible after a won fight: a living winner near a live enemy tower or a live epic monster. */
  function conversionFeasible(w: 0 | 1): boolean {
    const champs = liveUnits(sim).filter((u) => Unit.kind[u] === Kind.Champion && Unit.team[u] === w);
    for (const u of liveUnits(sim)) {
      const k = Unit.kind[u];
      const tower = k === Kind.Tower && Unit.team[u] !== w;
      const epic = k === Kind.Monster && isEpic(Pos.x[u]!, Pos.y[u]!);
      if (!tower && !epic) continue;
      const r = tower ? 2500 : 3000;
      if (champs.some((c) => Math.hypot(Pos.x[c]! - Pos.x[u]!, Pos.y[c]! - Pos.y[u]!) < r)) return true;
    }
    return false;
  }

  function fightCheck(T: number): void {
    while (champDeaths.length && champDeaths[0]!.tick < T - 15 * 30) champDeaths.shift();
    for (const loser of [0, 1] as const) {
      const w = loser === 0 ? 1 : 0;
      const lost = champDeaths.filter((d) => d.team === loser).length;
      const own = champDeaths.filter((d) => d.team === w).length;
      if (lost >= 2 && own < lost && lastFight[w] < T - 30 * 30) {
        lastFight[w] = T;
        fightsWon[w]++;
        openFight[w] = T + 30 * 30;
        openFeasible[w] = conversionFeasible(w);
        if (openFeasible[w]) fightsFeasible[w]++;
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
  return {
    sim,
    ticks: sim.tick,
    minutes: sim.tick / 1800,
    winner: sim.state.winner as number | undefined,
    hash: stateHash(sim),
    stats,
    bots,
    firstTowerMin,
    towersTaken,
    killsAt15,
    killsAt25,
    killsAt14,
    plates,
    fightsWon,
    fightsConverted,
    fightsFeasible,
    fightsConvertedFeasible,
    cost: bots.cost,
  };
}

/** Alive units with a position (minions, champions, towers ...). */
function liveUnits(sim: Sim): number[] {
  const out: number[] = [];
  for (const u of query(sim.world, [sim.c.Unit])) if (sim.c.Unit.alive[u]) out.push(u);
  return out;
}

/**
 * Last-hit trainer scenario (§4.7 acceptance, gate of Phase 1): one bot alone in the mid lane (laneOnly mode, both
 * teams' mid waves, no enemy champion), autos only, no recall / no wards (vision axis -5, recall and ward commands
 * dropped: a practice-tool session). 107 enemy minions arrive by 10:00.
 */
export function runLaneAlone(rank: Rank, opts: { minutes?: number; seed?: number; champion?: string; autosOnly?: boolean; clock?: () => number; noVariance?: boolean; reflex?: boolean } = {}): GameResult {
  const seed = opts.seed ?? 1;
  const players: PlayerSetup[] = [
    { slot: 0, team: 0, champion: opts.champion ?? 'mira', role: 'mid', summoners: ['sprung', 'heilen'], isHuman: false, bot: { rank, variance: 'normal', playstyle: { vision: -5 } } },
  ];
  seedPersonalities(seed, players);
  const config: SimConfig = { seed, mode: 'laneOnly', minionLanes: [Lane.Mid], players };
  return runBotGame(config, Math.round((opts.minutes ?? 10) * 1800), undefined, { autosOnly: opts.autosOnly ?? true, trainer: true, noVariance: opts.noVariance ?? true, reflex: opts.reflex ?? true, ...(opts.clock ? { clock: opts.clock } : {}) });
}
