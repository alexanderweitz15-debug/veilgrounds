// BotRunner: drives every bot slot of a SimConfig. Headless and deterministic (own Rng from config.seed, no
// Math.random / clocks). The runner is the only AI code that touches the Sim, and only to build each bot's
// fog-filtered snapshot; brains get Snapshot + static data (see src/ai/bot/types.ts).
// Used by the sim worker (merged with the human's inputs, recorded in replays), tests and tools/botSim.ts.

import { query } from 'bitecs';
import { buildSnapshot, teamEvents, type Snapshot, type SnapAudio, type SnapEntity, type PlayerHud } from '../sim/snapshot';
import type { Sim } from '../sim/sim';
import { loadMap, type LaneName, type MapData } from '../sim/map';
import { Rng } from '../sim/rng';
import { Kind, isStructure, type PlayerSetup, type SimConfig, type SimEvent, type TeamId, type TickInput } from '../sim/types';
import { sees } from '../sim/vision';
import { attackStartTick } from '../sim/systems/attack';
import { walkedLastTick } from '../sim/systems/movement';
import { abilityHud } from '../sim/systems/abilities';
import { reflex } from './reflex/reflex';
import { clearIntent, reflexDebug, reflexState } from './reflex/state';
import type { ReflexDebug } from './plan';
import { CHAMPION_DATA, championData } from '../sim/champions';
import { botRunes } from '../sim/items/runes';
import { profileAt, profileOf } from './profiles';
import { buildBotParams, defaultPersonalitySeed, nominalSkill } from './params';
import { BotDecisionLog, debugRows, type BotDebugRow } from './log';
import type { Rank } from './profiles/schema';
import { BUILDS } from './bot/builds';
import { newMemory, type BotAction, type BotMemory, type BotStatic, type Brain } from './bot/types';
import { think, decisionTicks } from './bot/brain';
import { TeamAI } from './bot/teamai';
import { utilityOn } from './utility/flag';
import { attentionDebug, attentionProbe, ensureAttention, observeAttention } from './humanize/attention';
import { detectErrors } from './errors';

let mapCache: MapData | null = null;
/** Static map (walls, lanes, camps); built once and shared by all bots. */
const staticMap = (): MapData => (mapCache ??= loadMap());

/** Decision-log throttle: an unchanged decision of a node is logged again at most every 5 s (heartbeat). */
export const LOG_DEDUP_TICKS = 150;

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
  /** HUD of the latest decision snapshot (reflex patches its live fields every tick). */
  hud: PlayerHud | null;
  /** New bot brain on for this bot (reflex layer or utility model): the BRAIN-REWORK §9 attention model and error
   *  episodes run only then (src/ai/humanize/attention.ts); off = pre-rework behaviour, bit-identical. */
  human: boolean;
}

const NO_TAGS: ReadonlySet<string> = new Set();

/** Commands that conflict with a reflex command of the same tick (the decision wins that tick). */
const ORDER_CMDS = new Set(['move', 'attack', 'attackMove', 'stop', 'cast', 'spell', 'recall', 'ward']);

export const isBotSlot = (p: PlayerSetup): boolean => !p.isHuman && !!p.bot;

/** Measurement options (tools/botSim.ts, tests). None of them changes a decision. */
export interface RunnerOptions {
  /** --variance=0: every bot plays its nominal rank profile (the variance roll is still drawn, so the rng streams and
   *  everything else stay identical; only the rolled offset is discarded). */
  noVariance?: boolean;
  /** Wall clock (ms) for the think / reflex cost metrics. Only read when given; never feeds a decision. */
  clock?: () => number;
  /** Last-hit trainer scenario "autos only": the reflex layer plans no spell last hits. */
  noSpells?: boolean;
  /** Brain rework reflex layer (src/ai/reflex). Off by default until the Phase 1 gate is met (docs/agents/a1.md). */
  reflex?: boolean;
}

/** Accumulated brain cost (bot-sim reflexCostMs / thinkCostMs). */
export interface RunnerCost {
  thinkMs: number;
  thinks: number;
  /** Reflex logic per bot and tick (excl. the per-tick view). */
  reflexMs: number;
  reflexCalls: number;
  /** Per-tick fog-filtered reflex view (once per team and tick) + per-bot HUD patch. */
  viewMs: number;
  views: number;
}

export class BotRunner {
  readonly bots: BotSlot[] = [];
  /** Commands scheduled for a future tick (reaction delay, last-hit timing), in insertion order. */
  private queue: { tick: number; slot: number; action: BotAction }[] = [];
  /** Test hook: sees every snapshot handed to a brain (fog test). */
  onPerceive?: (slot: number, snap: Snapshot) => void;
  private bufferedTick = -1;
  /** Fog-filtered events of the latest sim tick per team (the reflex layer observes exactly one tick at a time). */
  private tickEvents: [SimEvent[], SimEvent[]] = [[], []];
  /** Decision log of all bots of this game (spec-bots §1/§10): F9 overlay, Replay.botLog. */
  readonly log = new BotDecisionLog(100_000, 50 * 1024 * 1024, LOG_DEDUP_TICKS);
  /** Team AI per team (spec-bots §8, Agent M): desires re-evaluated at the macro interval. */
  readonly teams: [TeamAI, TeamAI];
  /** Brain cost, only accumulated with RunnerOptions.clock. */
  readonly cost: RunnerCost = { thinkMs: 0, thinks: 0, reflexMs: 0, reflexCalls: 0, viewMs: 0, views: 0 };
  /** Per-tick team views of the reflex layer: [tick, entities] per team. */
  private teamView: [number, SnapEntity[]][] = [
    [-1, []],
    [-1, []],
  ];
  private readonly clock: (() => number) | undefined;
  private readonly noSpells: boolean;
  private readonly reflexOn: boolean;

  constructor(config: SimConfig, private readonly brain: Brain = think, opts: RunnerOptions = {}) {
    this.clock = opts.clock;
    this.noSpells = !!opts.noSpells;
    this.reflexOn = !!opts.reflex;
    const rng = new Rng((config.seed ^ 0x5eed_b075) >>> 0);
    this.teams = [new TeamAI(0, staticMap(), config.players, config.seed, this.log), new TeamAI(1, staticMap(), config.players, config.seed, this.log)];
    for (const p of [...config.players].sort((a, b) => a.slot - b.slot)) {
      if (!isBotSlot(p)) continue;
      // spec-bots §10: rank profile -> variance -> champion bias (rolled only) -> playstyle axes (src/ai/params.ts)
      let params = buildBotParams(p, rng, config.seed);
      const nominal = nominalSkill(p.bot!);
      if (opts.noVariance) {
        const np = profileAt(nominal);
        params = { ...params, rank: np.rank, skill: nominal, behavior: np.behavior, hysteresis: np.behavior.hysteresis };
      }
      // rework §8: the per-game variance offset is in the log (and switchable with --variance=0)
      this.log.push({ tick: 0, bot: p.slot, node: 'variance', inputs: { nominal: Math.round(nominal * 10) / 10, skill: Math.round(params.skill * 10) / 10 }, chosen: params.rank, reason: opts.noVariance ? 'variance off (nominal profile)' : `per-game offset ${(params.skill - nominal).toFixed(1)} skill` });
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
        lang: config.botLang ?? 'de',
        params,
        log: this.log,
        teamAI: this.teams[p.team === 1 ? 1 : 0],
        mode: config.mode,
        ...(config.botUtility !== undefined ? { utility: config.botUtility } : {}),
      };
      ctx.teamAI.register({ slot: p.slot, role: p.role, champion: p.champion, profile, params });
      const interval = decisionTicks(ctx);
      // stagger first decisions so bots do not all think on the same tick
      const mem = newMemory();
      reflexState(mem).enabled = !!opts.reflex;
      const human = !!opts.reflex || utilityOn(ctx);
      if (human) {
        // §9 attention model (own Rng from the personality seed, never this bot's Rng): created before the first
        // decision so think's hooks (reaction penalty, tilt mode, error episodes) see it; reflex only queries it
        ensureAttention(mem, ctx, 0);
        reflexState(mem).attention = attentionProbe(mem);
      }
      this.bots.push({ ctx, mem, rng: new Rng(rng.u32()), interval, next: rng.int(interval), events: [], eventTicks: [], audio: [], hud: null, human });
    }
  }

  /** F9 overlay rows: latest decision, scores, injected error, reaction time and perception age per bot, plus the
   *  reflex layer (intent, plans with countdown, attack utilisation of the last 30 s; plan-api.md §5). */
  debugRows(): (BotDebugRow & { reflex: ReflexDebug; attention?: { text: string; share: number } })[] {
    const tick = this.bufferedTick;
    const rows = debugRows(
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
    return rows.map((r) => {
      const b = this.bots.find((x) => x.ctx.slot === r.slot);
      const attention = b?.human ? attentionDebug(b.mem, tick) : undefined;
      return { ...r, reflex: b ? reflexDebug(b.mem, tick) : { intent: 'none', plans: [], util30s: 0, stand: null }, ...(attention ? { attention } : {}) };
    });
  }

  /**
   * Per-tick snapshot of the reflex layer: the same fog rule as buildSnapshot (own team, structures, alive units the
   * team sees) for the entities, built once per team and tick; the bot's own HUD from its latest decision snapshot
   * with the live own values patched in (own champion data only); events = this tick's fog-filtered team events.
   * Projectiles / objects / score rows are not part of it (reflex does not use them; buildSnapshot costs ~0.7 ms).
   */
  private reflexSnapshot(sim: Sim, b: BotSlot): Snapshot | null {
    const team = b.ctx.team === 1 ? 1 : 0;
    const me = sim.slots[b.ctx.slot];
    if (me === undefined || me < 0 || !b.hud) return null;
    const { Unit, Champ, Stats } = sim.c;
    if (!Unit.alive[me]) return null;
    const tv = this.teamView[team]!;
    if (tv[0] !== sim.tick) {
      tv[0] = sim.tick;
      tv[1] = this.buildTeamEntities(sim, team);
    }
    const hud: PlayerHud = {
      ...b.hud,
      level: Champ.level[me]!,
      gold: Champ.gold[me]!,
      cs: Champ.cs[me]!,
      dead: false,
      recallLeft: Champ.recallAt[me]! > sim.tick ? (Champ.recallAt[me]! - sim.tick) / 30 : 0,
      abilities: abilityHud(sim, me),
      stats: { ad: Stats.ad[me]!, ap: Stats.ap[me]!, armor: Stats.armor[me]!, mr: Stats.mr[me]!, as: Stats.as[me]!, ms: Stats.ms[me]!, range: Stats.range[me]!, crit: Stats.crit[me]! },
    };
    const events = this.tickEvents[team]!;
    return { tick: sim.tick, time: sim.tick / 30, team, entities: tv[1], projectiles: [], objects: [], me: hud, events, eventTicks: events.map(() => sim.tick), audio: [], players: [] };
  }

  private buildTeamEntities(sim: Sim, team: number): SnapEntity[] {
    const { Unit, Pos, Face, Hp, Mana, Champ, Atk } = sim.c;
    const out: SnapEntity[] = [];
    for (const e of query(sim.world, [Unit])) {
      const k = Unit.kind[e]!;
      if (k === Kind.Projectile) continue;
      const alive = Unit.alive[e] === 1;
      const visible = Unit.team[e] === team || isStructure(k) || (alive && sees(sim, team, e));
      if (!visible) continue;
      const ci = Unit.champ[e]!;
      const ent: SnapEntity = {
        id: e,
        serial: Unit.serial[e]!,
        kind: k,
        team: Unit.team[e]!,
        x: Pos.x[e]!,
        y: Pos.y[e]!,
        px: Pos.px[e]!,
        py: Pos.py[e]!,
        fx: Face.x[e]!,
        fy: Face.y[e]!,
        hp: Hp.cur[e]!,
        maxHp: Hp.max[e]!,
        shield: Hp.shield[e]!,
        mana: Mana.cur[e]!,
        maxMana: Mana.max[e]!,
        radius: Unit.radius[e]!,
        level: k === Kind.Champion ? Champ.level[e]! : 0,
        champ: ci >= 0 ? sim.championIds[ci]! : null,
        slot: Unit.slot[e]!,
        atkPhase: Atk.phase[e]!,
        atkTarget: Atk.target[e]!,
        moving: alive && walkedLastTick(sim, e),
        alive,
      };
      if (Atk.phase[e]) {
        ent.atkStart = attackStartTick(sim, e);
        ent.atkEnd = Atk.phaseEnd[e]!;
      }
      if (k === Kind.Tower && sim.c.Tower.tier[e] === 0) ent.plates = sim.c.Tower.plates[e]!;
      out.push(ent);
    }
    // same eid-leak rule as buildSnapshot (B3): an attack / chase target outside this view is masked
    const inView = new Set<number>();
    for (const s of out) inView.add(s.id);
    for (const s of out) if (s.atkTarget >= 0 && !inView.has(s.atkTarget)) s.atkTarget = -1;
    return out;
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
      this.tickEvents = [[], []];
      if (sim.events.length) {
        for (const b of this.bots) {
          let te = byTeam.get(b.ctx.team);
          if (!te) {
            byTeam.set(b.ctx.team, (te = teamEvents(sim, b.ctx.team)));
            this.tickEvents[b.ctx.team === 1 ? 1 : 0] = te.events;
          }
          for (const ev of te.events) {
            b.events.push(ev);
            b.eventTicks.push(sim.tick);
          }
          for (const a of te.audio) b.audio.push(a);
        }
      }
    }
    // what each decision of this tick did, for the reflex pass below
    const decided = new Map<number, { issued: boolean; cancelled: ReadonlySet<string> }>();
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
      b.hud = snap.me;
      const prevMode = b.mem.mode;
      // the lane intent lives for exactly one decision: the reflex layer executes what this decision chose
      clearIntent(b.mem);
      const t0 = this.clock?.() ?? 0;
      const actions = this.brain(snap, b.ctx, b.mem, b.rng);
      if (this.clock) {
        this.cost.thinkMs += this.clock() - t0;
        this.cost.thinks++;
      }
      if (b.human) {
        // §9: feed the attention triggers of this decision (perception glance, kill feed, chat, gold step, tilt) with
        // the think snapshot (its eventTicks dedupe the event buffer), then notice error episodes whose time is up
        observeAttention(b.mem, b.ctx, snap);
        const me = snap.me && !snap.me.dead ? snap.entities.find((e) => e.id === snap.me!.eid) : undefined;
        actions.push(...detectErrors(b.mem, b.ctx, snap.tick, me));
      }
      let cancelled: ReadonlySet<string> = NO_TAGS;
      // drop queued orders whose tag the brain cancelled (orbwalk plans superseded by a dodge / retreat)
      if (b.mem.cancelTags.size) {
        const slot = b.ctx.slot;
        this.queue = this.queue.filter((q) => q.slot !== slot || !q.action.tag || !b.mem.cancelTags.has(q.action.tag));
        cancelled = new Set(b.mem.cancelTags);
        b.mem.cancelTags.clear();
      }
      let issued = false;
      for (const a of actions) {
        if (a.delay && a.delay > 0) this.queue.push({ tick: sim.tick + a.delay, slot: b.ctx.slot, action: a });
        else {
          out.push({ slot: b.ctx.slot, cmd: a.cmd });
          if (ORDER_CMDS.has(a.cmd.t)) issued = true;
        }
      }
      decided.set(b.ctx.slot, { issued, cancelled });
      // baseline log entry on every mode switch (behaviour nodes add their own detailed entries via ctx.log)
      if (b.mem.mode !== prevMode) this.log.push({ tick: sim.tick, bot: b.ctx.slot, node: 'mode', inputs: {}, chosen: b.mem.mode, reason: `${prevMode} -> ${b.mem.mode}` });
    }
    // reflex layer (rework §3): every tick, every bot, in slot order, after the decisions of this tick
    for (const b of this.reflexOn ? this.bots : []) {
      if (!b.hud) continue; // no decision yet
      const t0 = this.clock?.() ?? 0;
      const snap = this.reflexSnapshot(sim, b);
      if (this.clock) {
        this.cost.viewMs += this.clock() - t0;
        this.cost.views++;
      }
      if (!snap) continue;
      this.onPerceive?.(b.ctx.slot, snap);
      const d = decided.get(b.ctx.slot);
      const t1 = this.clock?.() ?? 0;
      const acts = reflex(snap, b.ctx, b.mem, b.rng, { thinkIssued: d?.issued ?? false, cancelled: d?.cancelled ?? NO_TAGS, noSpells: this.noSpells });
      if (this.clock) {
        this.cost.reflexMs += this.clock() - t1;
        this.cost.reflexCalls++;
      }
      for (const a of acts) out.push({ slot: b.ctx.slot, cmd: a.cmd });
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
