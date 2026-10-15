// BotRunner: drives every bot slot of a SimConfig. Headless and deterministic (own Rng from config.seed, no
// Math.random / clocks). The runner is the only AI code that touches the Sim, and only to build each bot's
// fog-filtered snapshot; brains get Snapshot + static data (see src/ai/bot/types.ts).
// Used by the sim worker (merged with the human's inputs, recorded in replays), tests and tools/botSim.ts.

import { buildSnapshot, teamEvents, type Snapshot, type SnapAudio } from '../sim/snapshot';
import type { Sim } from '../sim/sim';
import { loadMap, type LaneName, type MapData } from '../sim/map';
import { Rng } from '../sim/rng';
import type { PlayerSetup, SimConfig, SimEvent, TeamId, TickInput } from '../sim/types';
import { CHAMPION_DATA, championData } from '../sim/champions';
import { botRunes } from '../sim/items/runes';
import { profileAt, profileOf } from './profiles';
import { buildBotParams, defaultPersonalitySeed } from './params';
import { BotDecisionLog, debugRows, type BotDebugRow } from './log';
import type { Rank } from './profiles/schema';
import { BUILDS } from './bot/builds';
import { newMemory, type BotAction, type BotMemory, type BotStatic, type Brain } from './bot/types';
import { think, decisionTicks } from './bot/brain';
import { TeamAI } from './bot/teamai';

let mapCache: MapData | null = null;
/** Static map (walls, lanes, camps); built once and shared by all bots. */
const staticMap = (): MapData => (mapCache ??= loadMap());

const LANE_OF: Record<PlayerSetup['role'], LaneName | null> = { top: 'top', mid: 'mid', adc: 'bot', support: 'bot', jungle: null };

interface BotSlot {
  ctx: BotStatic;
  mem: BotMemory;
  rng: Rng;
  interval: number;
  next: number;
  /** Fog-filtered events + audio cues since the last decision (events live for one sim tick only). */
  events: SimEvent[];
  eventTicks: number[];
  audio: SnapAudio[];
}

export const isBotSlot = (p: PlayerSetup): boolean => !p.isHuman && !!p.bot;

export class BotRunner {
  readonly bots: BotSlot[] = [];
  /** Commands scheduled for a future tick (reaction delay, last-hit timing), in insertion order. */
  private queue: { tick: number; slot: number; action: BotAction }[] = [];
  /** Test hook: sees every snapshot handed to a brain (fog test). */
  onPerceive?: (slot: number, snap: Snapshot) => void;
  private bufferedTick = -1;
  /** Decision log of all bots of this game (spec-bots §1/§10): F9 overlay, Replay.botLog. */
  readonly log = new BotDecisionLog();
  /** Team AI per team (spec-bots §8, Agent M): desires re-evaluated at the macro interval. */
  readonly teams: [TeamAI, TeamAI];

  constructor(config: SimConfig, private readonly brain: Brain = think) {
    const rng = new Rng((config.seed ^ 0x5eed_b075) >>> 0);
    this.teams = [new TeamAI(0, staticMap(), config.players, config.seed, this.log), new TeamAI(1, staticMap(), config.players, config.seed, this.log)];
    for (const p of [...config.players].sort((a, b) => a.slot - b.slot)) {
      if (!isBotSlot(p)) continue;
      // spec-bots §10: rank profile -> variance -> champion bias (rolled only) -> playstyle axes (src/ai/params.ts)
      const params = buildBotParams(p, rng, config.seed);
      const profile = profileAt(params.skill);
      const champ = championData(p.champion);
      const ctx: BotStatic = {
        slot: p.slot,
        team: p.team,
        role: p.role,
        lane: LANE_OF[p.role],
        champ,
        build: BUILDS[p.champion] ?? null,
        profile,
        map: staticMap(),
        players: config.players,
        toxic: config.botToxicity ?? true,
        params,
        log: this.log,
        teamAI: this.teams[p.team === 1 ? 1 : 0],
      };
      ctx.teamAI.register({ slot: p.slot, role: p.role, champion: p.champion, profile, params });
      const interval = decisionTicks(ctx);
      // stagger first decisions so bots do not all think on the same tick
      this.bots.push({ ctx, mem: newMemory(), rng: new Rng(rng.u32()), interval, next: rng.int(interval), events: [], eventTicks: [], audio: [] });
    }
  }

  /** F9 overlay rows: latest decision, scores, injected error, reaction time and perception age per bot. */
  debugRows(): BotDebugRow[] {
    return debugRows(
      this.log,
      this.bots.map((b) => ({
        slot: b.ctx.slot,
        champ: b.ctx.champ.id,
        rank: b.ctx.params.rank,
        skill: Math.round(b.ctx.params.skill),
        archetype: b.ctx.params.archetype,
        rolled: b.ctx.params.rolled,
        mode: b.mem.mode,
      })),
    );
  }

  /** Bot is in its own cast wind-up / channel: delayed move/attack orders would break it, drop them. */
  private busy(slot: number, tick: number): boolean {
    const b = this.bots.find((x) => x.ctx.slot === slot);
    return !!b && tick < b.mem.busyUntil && tick > b.mem.busyFrom;
  }

  /** Inputs for the coming tick (call before step(sim, inputs)). */
  tick(sim: Sim): TickInput[] {
    const out: TickInput[] = [];
    // sim.events holds the tick just stepped and is cleared by the next step: buffer it per bot (fog-filtered per
    // team) so a brain sees every event and audio cue since its last decision, not only those of its decision tick
    if (sim.tick !== this.bufferedTick) {
      this.bufferedTick = sim.tick;
      const byTeam = new Map<number, ReturnType<typeof teamEvents>>();
      if (sim.events.length) {
        for (const b of this.bots) {
          let te = byTeam.get(b.ctx.team);
          if (!te) byTeam.set(b.ctx.team, (te = teamEvents(sim, b.ctx.team)));
          for (const ev of te.events) {
            b.events.push(ev);
            b.eventTicks.push(sim.tick);
          }
          for (const a of te.audio) b.audio.push(a);
        }
      }
    }
    for (const b of this.bots) {
      if (sim.tick < b.next) continue;
      // jitter the cadence a little (+-20 %) so decisions do not phase-lock with attack timers
      b.next = sim.tick + Math.max(1, Math.round(b.interval * (0.8 + 0.4 * b.rng.next())));
      const snap = buildSnapshot(sim, b.ctx.team, b.ctx.slot);
      snap.events = b.events;
      snap.audio = b.audio;
      snap.eventTicks = b.eventTicks;
      b.events = [];
      b.audio = [];
      b.eventTicks = [];
      this.onPerceive?.(b.ctx.slot, snap);
      const prevMode = b.mem.mode;
      const actions = this.brain(snap, b.ctx, b.mem, b.rng);
      // drop queued orders whose tag the brain cancelled (orbwalk plans superseded by a dodge / retreat)
      if (b.mem.cancelTags.size) {
        const slot = b.ctx.slot;
        this.queue = this.queue.filter((q) => q.slot !== slot || !q.action.tag || !b.mem.cancelTags.has(q.action.tag));
        b.mem.cancelTags.clear();
      }
      for (const a of actions) {
        if (a.delay && a.delay > 0) this.queue.push({ tick: sim.tick + a.delay, slot: b.ctx.slot, action: a });
        else out.push({ slot: b.ctx.slot, cmd: a.cmd });
      }
      // baseline log entry on every mode switch (behaviour nodes add their own detailed entries via ctx.log)
      if (b.mem.mode !== prevMode) this.log.push({ tick: sim.tick, bot: b.ctx.slot, node: 'mode', inputs: {}, chosen: b.mem.mode, reason: `${prevMode} -> ${b.mem.mode}` });
    }
    if (this.queue.length) {
      const keep: typeof this.queue = [];
      for (const q of this.queue) {
        if (q.tick > sim.tick) keep.push(q);
        else if (!this.busy(q.slot, sim.tick) || !['move', 'attack', 'attackMove', 'stop'].includes(q.action.cmd.t)) out.push({ slot: q.slot, cmd: q.action.cmd });
      }
      this.queue = keep;
    }
    return out;
  }
}

// ------------------------------------------------------------------ classic config builders

const ROLES: PlayerSetup['role'][] = ['top', 'jungle', 'mid', 'adc', 'support'];

/** Summoners by role. */
const SUMMONERS: Record<PlayerSetup['role'], [string, string]> = {
  top: ['sprung', 'teleport'],
  jungle: ['sprung', 'bannen'],
  mid: ['sprung', 'entflammen'],
  adc: ['sprung', 'heilen'],
  support: ['sprung', 'erschoepfen'],
};

/** Roster champions playing a role (data roles; first role counts most). */
export function championsForRole(role: PlayerSetup['role']): string[] {
  const ids = Object.keys(CHAMPION_DATA).sort();
  const primary = ids.filter((id) => CHAMPION_DATA[id]!.roles[0] === role);
  const secondary = ids.filter((id) => CHAMPION_DATA[id]!.roles[1] === role);
  return primary.length >= 2 ? primary : [...primary, ...secondary];
}

function botSetup(slot: number, team: TeamId, role: PlayerSetup['role'], champion: string, rank: Rank, rng: Rng): PlayerSetup {
  return {
    slot,
    team,
    champion,
    role,
    summoners: SUMMONERS[role],
    isHuman: false,
    runes: botRunes(champion, profileOf(rank).behavior.optimalRunesPct, rng),
    bot: { rank, variance: 'normal' },
  };
}

function pickChampion(role: PlayerSetup['role'], taken: Set<string>, rng: Rng): string {
  const pool = championsForRole(role).filter((c) => !taken.has(c));
  const any = Object.keys(CHAMPION_DATA).sort().filter((c) => !taken.has(c));
  const list = pool.length ? pool : any;
  const c = list[rng.int(list.length)]!;
  taken.add(c);
  return c;
}

/**
 * Classic 5v5 vs bots: the human takes slot 0 (blue) in `playerRole`; the other 9 slots are role-conform bots
 * with unique champions. For the lobby (Agent H).
 */
export function classicConfig(
  playerChampion: string,
  playerRole: PlayerSetup['role'],
  botRank: Rank = 'gold',
  opts: { seed?: number; summoners?: [string, string]; runes?: PlayerSetup['runes']; variance?: 'stable' | 'normal' | 'volatile' } = {},
): SimConfig {
  const seed = opts.seed ?? ((Math.random() * 2 ** 31) | 0); // lobby only; the game itself is seeded from here
  const rng = new Rng(seed ^ 0x10bb);
  const taken = new Set([playerChampion]);
  const players: PlayerSetup[] = [
    {
      slot: 0,
      team: 0,
      champion: playerChampion,
      role: playerRole,
      summoners: opts.summoners ?? SUMMONERS[playerRole],
      isHuman: true,
      ...(opts.runes ? { runes: opts.runes } : {}),
    },
  ];
  const blueRoles = ROLES.filter((r) => r !== playerRole);
  blueRoles.forEach((role, i) => players.push(botSetup(1 + i, 0, role, pickChampion(role, taken, rng), botRank, rng)));
  ROLES.forEach((role, i) => players.push(botSetup(5 + i, 1, role, pickChampion(role, taken, rng), botRank, rng)));
  if (opts.variance) for (const p of players) if (p.bot) p.bot.variance = opts.variance;
  seedPersonalities(seed, players);
  return { seed, mode: 'classic', players };
}

/** All 10 slots bots (tests, tools/botSim). Deterministic for a seed. */
export function botGameConfig(seed: number, rank: Rank = 'gold', variance: 'stable' | 'normal' | 'volatile' = 'normal'): SimConfig {
  const rng = new Rng(seed ^ 0x10bb);
  const taken = new Set<string>();
  const players: PlayerSetup[] = [];
  for (const team of [0, 1] as const) ROLES.forEach((role, i) => players.push(botSetup(team * 5 + i, team, role, pickChampion(role, taken, rng), rank, rng)));
  for (const p of players) p.bot!.variance = variance;
  seedPersonalities(seed, players);
  return { seed, mode: 'classic', players };
}

/** Every bot gets an explicit personality seed, so lobby/scoreboard show the same rolled playstyle as the worker. */
export function seedPersonalities(seed: number, players: PlayerSetup[]): void {
  for (const p of players) if (p.bot && p.bot.personalitySeed === undefined) p.bot.personalitySeed = defaultPersonalitySeed(seed, p.slot);
}
