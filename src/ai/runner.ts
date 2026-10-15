// BotRunner: drives every bot slot of a SimConfig. Headless and deterministic (own Rng from config.seed, no
// Math.random / clocks). The runner is the only AI code that touches the Sim, and only to build each bot's
// fog-filtered snapshot; brains get Snapshot + static data (see src/ai/bot/types.ts).
// Used by the sim worker (merged with the human's inputs, recorded in replays), tests and tools/botSim.ts.

import { buildSnapshot, type Snapshot } from '../sim/snapshot';
import type { Sim } from '../sim/sim';
import { loadMap, type LaneName, type MapData } from '../sim/map';
import { Rng } from '../sim/rng';
import type { PlayerSetup, SimConfig, TeamId, TickInput } from '../sim/types';
import { CHAMPION_DATA, championData } from '../sim/champions';
import { botRunes } from '../sim/items/runes';
import { profileOf, rollBotProfile } from './profiles';
import { rollStyle } from './profiles/style';
import type { Rank } from './profiles/schema';
import { BUILDS } from './bot/builds';
import { newMemory, type BotAction, type BotMemory, type BotStatic, type Brain } from './bot/types';
import { think, decisionTicks } from './bot/brain';

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
}

export const isBotSlot = (p: PlayerSetup): boolean => !p.isHuman && !!p.bot;

export class BotRunner {
  readonly bots: BotSlot[] = [];
  /** Commands scheduled for a future tick (reaction delay, last-hit timing), in insertion order. */
  private queue: { tick: number; slot: number; action: BotAction }[] = [];
  /** Test hook: sees every snapshot handed to a brain (fog test). */
  onPerceive?: (slot: number, snap: Snapshot) => void;

  constructor(config: SimConfig, private readonly brain: Brain = think) {
    const rng = new Rng((config.seed ^ 0x5eed_b075) >>> 0);
    for (const p of [...config.players].sort((a, b) => a.slot - b.slot)) {
      if (!isBotSlot(p)) continue;
      const profile = rollBotProfile(p.bot!.rank, p.bot!.variance, rng);
      const champ = championData(p.champion);
      const ctx: BotStatic = {
        slot: p.slot,
        team: p.team,
        role: p.role,
        lane: LANE_OF[p.role],
        champ,
        build: BUILDS[p.champion] ?? null,
        profile,
        style: rollStyle(rng, champ.archetype),
        map: staticMap(),
        players: config.players,
      };
      const interval = decisionTicks(ctx);
      // stagger first decisions so bots do not all think on the same tick
      this.bots.push({ ctx, mem: newMemory(), rng: new Rng(rng.u32()), interval, next: rng.int(interval) });
    }
  }

  /** Bot is in its own cast wind-up / channel: delayed move/attack orders would break it, drop them. */
  private busy(slot: number, tick: number): boolean {
    const b = this.bots.find((x) => x.ctx.slot === slot);
    return !!b && tick < b.mem.busyUntil && tick > b.mem.busyFrom;
  }

  /** Inputs for the coming tick (call before step(sim, inputs)). */
  tick(sim: Sim): TickInput[] {
    const out: TickInput[] = [];
    for (const b of this.bots) {
      if (sim.tick < b.next) continue;
      // jitter the cadence a little (+-20 %) so decisions do not phase-lock with attack timers
      b.next = sim.tick + Math.max(1, Math.round(b.interval * (0.8 + 0.4 * b.rng.next())));
      const snap = buildSnapshot(sim, b.ctx.team, b.ctx.slot);
      this.onPerceive?.(b.ctx.slot, snap);
      for (const a of this.brain(snap, b.ctx, b.mem, b.rng)) {
        if (a.delay && a.delay > 0) this.queue.push({ tick: sim.tick + a.delay, slot: b.ctx.slot, action: a });
        else out.push({ slot: b.ctx.slot, cmd: a.cmd });
      }
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
  top: ['sprung', 'entflammen'],
  jungle: ['sprung', 'bannen'],
  mid: ['sprung', 'entflammen'],
  adc: ['sprung', 'heilen'],
  support: ['sprung', 'heilen'],
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
  return { seed, mode: 'classic', players };
}

/** All 10 slots bots (tests, tools/botSim). Deterministic for a seed. */
export function botGameConfig(seed: number, rank: Rank = 'gold', variance: 'stable' | 'normal' | 'volatile' = 'normal'): SimConfig {
  const rng = new Rng(seed ^ 0x10bb);
  const taken = new Set<string>();
  const players: PlayerSetup[] = [];
  for (const team of [0, 1] as const) ROLES.forEach((role, i) => players.push(botSetup(team * 5 + i, team, role, pickChampion(role, taken, rng), rank, rng)));
  for (const p of players) p.bot!.variance = variance;
  return { seed, mode: 'classic', players };
}
