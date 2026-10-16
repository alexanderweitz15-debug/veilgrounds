// "Was ein Challenger getan hätte" (Challenger-Geist, Phase 6): a shadow Challenger bot brain that sees exactly the
// PLAYER's fog-filtered snapshot (same perception, no cheating) and decides at a reduced rate. Its commands are never
// sent: the ghost only records its intents (back off, recall, Flash, last hit, objective, all-in) with the decision
// log reasons, and a DivergenceTracker compares them with what the player actually did and what happened next
// (death, burst damage, missed CS, objective lost). The most impactful moments end up in the post-game screen.
//
// The ghost never touches the Sim: it runs in the worker on the snapshot already built for the client (after it was
// posted), so replays and state hashes stay bit-identical with or without it.

import type { Snapshot, SnapAudio } from '../sim/snapshot';
import type { Command, PlayerSetup, SimConfig, SimEvent } from '../sim/types';
import { Kind } from '../sim/types';
import { loadMap, type MapData } from '../sim/map';
import { Rng } from '../sim/rng';
import { championData } from '../sim/champions';
import { profileAt } from './profiles';
import { buildBotParams } from './params';
import { BotDecisionLog } from './log';
import type { DecisionLog, DecisionLogEntry } from './contract';
import { BUILDS } from './bot/builds';
import { newMemory, type BotAction, type BotMemory, type BotStatic } from './bot/types';
import { think } from './bot/brain';
import { TeamAI } from './bot/teamai';

// ---------------------------------------------------------------- moments (shared with the client)

export type GhostKind = 'retreat' | 'recall' | 'flash' | 'lastHit' | 'objective' | 'allin';

/** One divergence for the post-game timeline. Texts come from i18n (ghost.<kind>.*) with `vars`. */
export interface GhostMoment {
  /** Game time in seconds. */
  t: number;
  kind: GhostKind;
  /** 0..10: death 9-10, burst / lost objective 6-8, farm 2-6. */
  impact: number;
  /** Outcome key: what happened to the player (ghost.out.<outcome>). */
  outcome: string;
  /** Raw decision-log reason of the ghost (English dev string; the UI maps known ones to German). */
  why: string;
  vars: Record<string, number | string>;
}

/** What the ghost wanted to do at one decision (derived from its actions, log entries and team desire). */
export interface GhostIntent {
  tick: number;
  kind: GhostKind;
  why: string;
  /** lastHit: minion id; allin: enemy champion id. */
  target?: number;
  /** allin: target HP share at the decision. */
  targetHp?: number;
  /** objective: id and position. */
  obj?: string;
  x?: number;
  y?: number;
}

/** What the player did / what happened this tick (from the player's own snapshot + commands). */
export interface PlayerFacts {
  tick: number;
  eid: number;
  team: number;
  dead: boolean;
  /** HP share 0..1 (1 while dead / unknown). */
  hp: number;
  x: number;
  y: number;
  /** Distance to the own fountain. */
  home: number;
  recalling: boolean;
  flashed: boolean;
  /** Attacked or cast at an enemy champion this tick. */
  engaged: boolean;
  /** Visible events of this tick. */
  events: SimEvent[];
  /** Alive enemy champions the player sees: id -> HP share. */
  enemyHp: Map<number, number>;
}

const SEC = 30;
/** Same kind of moment at most once per this many ticks (one bad fight is one moment, not ten). */
const SAME_KIND_GAP = 20 * SEC;
export const MAX_MOMENTS = 10;

interface Pending {
  kind: GhostKind;
  tick: number;
  until: number;
  why: string;
  target?: number;
  targetHp?: number;
  obj?: string;
  x?: number;
  y?: number;
  /** Player state when the ghost decided. */
  hp0: number;
  home0: number;
  /** Lowest player HP since. */
  hpMin: number;
}

/**
 * Pure divergence detection: feed ghost intents and per-tick player facts in tick order, read `moments()`.
 * No sim, no brain: unit-testable with synthetic data.
 */
export class DivergenceTracker {
  private pending: Pending[] = [];
  private all: GhostMoment[] = [];
  private lastOfKind = new Map<GhostKind, number>();
  private lastDeath = -1;
  private flashTicks: number[] = [];
  private engageTicks: number[] = [];
  /** Missed last hits (minion died to someone else while the ghost had it planned) per 60 s bucket. */
  private missed: { from: number; n: number; why: string } | null = null;
  private plannedMinions = new Set<number>();
  private last: PlayerFacts | null = null;
  /** True while a farm bucket with >= 3 missed last hits is open (its moment is provisional). */
  get openFarm(): boolean {
    return !!this.missed && this.missed.n >= 3;
  }
  /** Bumped whenever the moment list changes (the worker only posts on change). */
  version = 0;

  onIntent(i: GhostIntent): void {
    const f = this.last;
    if (!f || f.dead) return;
    if (i.kind === 'lastHit') {
      if (i.target === undefined || this.plannedMinions.has(i.target)) return;
      this.plannedMinions.add(i.target);
      this.pending.push(this.mk(i, f, i.tick + 2 * SEC));
      return;
    }
    if (this.pending.some((p) => p.kind === i.kind)) return; // one open expectation per kind
    // the player already does it: no divergence
    if ((i.kind === 'recall' || i.kind === 'retreat') && f.recalling) return;
    if (i.kind === 'flash' && this.flashTicks.some((t) => i.tick - t <= 15)) return;
    if (i.kind === 'allin' && this.engageTicks.some((t) => i.tick - t <= SEC)) return;
    if (i.kind === 'objective' && i.x !== undefined && i.y !== undefined && Math.hypot(f.x - i.x, f.y - i.y) < 2500) return;
    const span = i.kind === 'flash' ? 3 * SEC : i.kind === 'objective' ? 50 * SEC : i.kind === 'allin' ? 6 * SEC : 10 * SEC;
    this.pending.push(this.mk(i, f, i.tick + span));
  }

  private mk(i: GhostIntent, f: PlayerFacts, until: number): Pending {
    return { kind: i.kind, tick: i.tick, until, why: i.why, target: i.target, targetHp: i.targetHp, obj: i.obj, x: i.x, y: i.y, hp0: f.hp, home0: f.home, hpMin: f.hp };
  }

  onTick(f: PlayerFacts): void {
    const died = !!this.last && !this.last.dead && f.dead;
    this.last = f;
    if (f.flashed) this.flashTicks.push(f.tick);
    if (f.engaged) this.engageTicks.push(f.tick);
    this.flashTicks = this.flashTicks.filter((t) => f.tick - t <= 2 * SEC);
    this.engageTicks = this.engageTicks.filter((t) => f.tick - t <= 3 * SEC);
    const deaths = f.events.filter((e): e is Extract<SimEvent, { e: 'death' }> => e.e === 'death');
    const keep: Pending[] = [];
    for (const p of this.pending) {
      if (!f.dead) p.hpMin = Math.min(p.hpMin, f.hp);
      const r = this.resolve(p, f, died, deaths);
      if (r === 'keep') keep.push(p);
    }
    this.pending = keep;
    if (this.missed && f.tick - this.missed.from >= 60 * SEC) this.flushMissed(f.tick);
  }

  /** 'keep' while undecided, 'done' when agreed / no consequence / reported. */
  private resolve(p: Pending, f: PlayerFacts, died: boolean, deaths: Extract<SimEvent, { e: 'death' }>[]): 'keep' | 'done' {
    const t = p.tick;
    switch (p.kind) {
      case 'retreat':
      case 'recall': {
        // agreed: recalled or walked clearly towards the base
        if (f.recalling || (!f.dead && p.home0 - f.home > 900)) return 'done';
        if (died) return this.report(p, f.tick, 'died', 10, { hp: pct(p.hp0) });
        if (f.tick >= p.until) return p.hp0 - p.hpMin >= 0.35 ? this.report(p, t, 'hurt', 5, { hp: pct(p.hp0), low: pct(p.hpMin) }) : 'done';
        return 'keep';
      }
      case 'flash': {
        if (this.flashTicks.some((x) => x >= p.tick - 15)) return 'done';
        if (died) return this.report(p, f.tick, 'died', 9, { hp: pct(p.hp0) });
        if (f.tick >= p.until) return p.hp0 - p.hpMin >= 0.3 ? this.report(p, t, 'hurt', 6, { hp: pct(p.hp0), low: pct(p.hpMin) }) : 'done';
        return 'keep';
      }
      case 'lastHit': {
        const d = deaths.find((e) => e.eid === p.target);
        if (d) {
          this.plannedMinions.delete(p.target!);
          if (d.killer !== f.eid) this.addMissed(f.tick, p.why);
          return 'done';
        }
        if (f.tick >= p.until) {
          this.plannedMinions.delete(p.target!);
          return 'done';
        }
        return 'keep';
      }
      case 'objective': {
        if (!f.dead && p.x !== undefined && p.y !== undefined && Math.hypot(f.x - p.x, f.y - p.y) < 1800) return 'done';
        const d = deaths.find((e) => e.kind === Kind.Monster && p.x !== undefined && p.y !== undefined && Math.hypot(e.x - p.x, e.y - p.y) < 900);
        if (d) {
          const kt = (d as { killerTeam?: number }).killerTeam;
          if (kt !== undefined && kt !== f.team) return this.report(p, t, 'objLost', 8, { obj: p.obj ?? '' });
          return 'done';
        }
        return f.tick >= p.until ? 'done' : 'keep';
      }
      case 'allin': {
        if (this.engageTicks.some((x) => x >= p.tick)) return 'done';
        if (died) return 'done'; // the player had other problems
        if (f.tick >= p.until) {
          const hp = p.target !== undefined ? f.enemyHp.get(p.target) : undefined;
          // the target got away (still alive, seen or not) while it was low
          return (p.targetHp ?? 1) <= 0.4 && !deaths.some((e) => e.eid === p.target) ? this.report(p, t, 'escaped', 5, { hp: pct(p.targetHp ?? 1), now: hp !== undefined ? pct(hp) : -1 }) : 'done';
        }
        if (deaths.some((e) => e.eid === p.target)) return 'done';
        return 'keep';
      }
    }
  }

  private addMissed(tick: number, why: string): void {
    if (!this.missed) this.missed = { from: tick, n: 0, why };
    this.missed.n++;
  }

  private missedMoment(m: { from: number; n: number; why: string }, tick: number): GhostMoment | null {
    if (m.n < 3) return null;
    // ~20 gold per lane minion: 3 missed ~ impact 3.4, 8+ missed ~ impact 7
    return { t: m.from / SEC, kind: 'lastHit', impact: Math.min(7, 1 + m.n * 0.8), outcome: 'missedCs', why: m.why, vars: { n: m.n, gold: m.n * 20, span: Math.max(1, Math.round((tick - m.from) / SEC)) } };
  }

  private flushMissed(tick: number): void {
    const m = this.missedMoment(this.missed!, tick);
    this.missed = null;
    if (m) this.push(m);
  }

  private report(p: Pending, tick: number, outcome: string, impact: number, vars: Record<string, number | string>): 'done' {
    const last = this.lastOfKind.get(p.kind);
    if (last !== undefined && p.tick - last < SAME_KIND_GAP) return 'done';
    // one death is one moment (the ghost may have wanted to retreat and then to Flash before the same death)
    if (outcome === 'died') {
      if (tick === this.lastDeath) return 'done';
      this.lastDeath = tick;
    }
    this.lastOfKind.set(p.kind, p.tick);
    this.push({ t: p.tick / SEC, kind: p.kind, impact, outcome, why: p.why, vars: { ...vars, after: Math.round((tick - p.tick) / SEC) } });
    return 'done';
  }

  private push(m: GhostMoment): void {
    this.all.push(m);
    this.version++;
  }

  /** Call at the end of the match (closes the farm bucket). */
  finish(tick: number): void {
    if (this.missed) this.flushMissed(tick);
  }

  /** Up to MAX_MOMENTS most impactful moments, in time order; `now` also counts the open farm bucket. */
  moments(now?: number): GhostMoment[] {
    const open = now !== undefined && this.missed ? this.missedMoment(this.missed, now) : null;
    const top = [...this.all, ...(open ? [open] : [])].sort((a, b) => b.impact - a.impact || a.t - b.t).slice(0, MAX_MOMENTS);
    return top.sort((a, b) => a.t - b.t);
  }
}

const pct = (v: number): number => Math.round(Math.max(0, Math.min(1, v)) * 100);

// ---------------------------------------------------------------- intents from one ghost decision

const RETREAT_NODES = new Set(['retreat', 'pingRetreat', 'splitPush']);

/** Ghost intent of one decision: actions first (Flash, recall, last hit), then the logged decision. */
export function intentOf(tick: number, snap: Snapshot, actions: BotAction[], logs: DecisionLogEntry[], flashSlot: number, desire: { kind: string; obj?: string; x: number; y: number; reason: string } | null): GhostIntent[] {
  const out: GhostIntent[] = [];
  const why = (pred: (e: DecisionLogEntry) => boolean, dflt: string): string => [...logs].reverse().find(pred)?.reason ?? dflt;
  const me = snap.me;
  if (!me || me.dead) return out;
  for (const a of actions) {
    const c = a.cmd;
    if (c.t === 'spell' && c.slot === flashSlot) out.push({ tick, kind: 'flash', why: why((e) => ['dodge', 'escape', 'diveDefence', 'trade'].includes(e.node), 'flash') });
    else if (c.t === 'recall') out.push({ tick, kind: 'recall', why: why((e) => e.node === 'recall', 'recall') });
    else if (c.t === 'attack') {
      const t = snap.entities.find((e) => e.id === c.target);
      if (t && t.team !== snap.team && t.kind >= Kind.MinionMelee && t.kind <= Kind.MinionSuper && t.hp <= me.stats.ad * 1.3) out.push({ tick, kind: 'lastHit', target: t.id, why: why((e) => e.node === 'lane' || e.node === 'lasthit', 'last hit') });
    }
  }
  for (const e of logs) {
    if ((RETREAT_NODES.has(e.node) && (e.chosen === 'retreat' || e.chosen === 'leave')) || (e.node === 'escape' && (e.chosen === 'escape' || e.chosen === 'run')) || (e.node === 'teamfight' && e.chosen === 'leave')) {
      out.push({ tick, kind: 'retreat', why: e.reason });
    } else if (e.node === 'trade' && (e.chosen === 'allin' || e.chosen === 'ignite')) {
      const slot = e.inputs.targetSlot ?? e.inputs.tgtSlot;
      const t = snap.entities.find((x) => x.kind === Kind.Champion && x.team !== snap.team && (slot === undefined || x.slot === slot));
      if (t) out.push({ tick, kind: 'allin', target: t.id, targetHp: t.maxHp > 0 ? t.hp / t.maxHp : 1, why: e.reason });
    }
  }
  if (desire && desire.kind === 'take_objective' && desire.obj) out.push({ tick, kind: 'objective', obj: desire.obj, x: desire.x, y: desire.y, why: desire.reason });
  return out;
}

// ---------------------------------------------------------------- the ghost runner (worker side)

let mapCache: MapData | null = null;

/** Modes with a meaningful ghost (opponents, decisions); trainers without enemies are skipped. */
export const GHOST_MODES = new Set(['classic', 'scenario', 'laneDuel', 'jungleDuel', 'arena']);

/** Ghost decision interval in ticks (Challenger profile thinks every 4 ticks; the ghost every 6: ~5 Hz). */
export const GHOST_INTERVAL = 6;

export class GhostRunner {
  readonly tracker = new DivergenceTracker();
  private readonly ctx: BotStatic;
  private mem: BotMemory = newMemory();
  private readonly rng: Rng;
  private next = 0;
  private resyncAt = 0;
  private events: SimEvent[] = [];
  private eventTicks: number[] = [];
  private audio: SnapAudio[] = [];
  private fresh: DecisionLogEntry[] = [];
  private readonly flashSlot: number;
  private readonly fountain: { x: number; y: number };
  /** Decisions taken / intents reported (debug, tests). */
  decisions = 0;
  intents = 0;
  /** Disabled after an exception (the ghost must never break a game). */
  dead = false;

  constructor(config: SimConfig, readonly slot: number) {
    const human = config.players.find((p) => p.slot === slot)!;
    const setup: PlayerSetup = { ...human, isHuman: false, bot: { rank: 'challenger', variance: 'stable', archetype: 'proStandard' } };
    this.rng = new Rng((config.seed ^ 0x6057_c4a1) >>> 0);
    const params = buildBotParams(setup, this.rng, config.seed);
    const profile = profileAt(params.skill);
    const map = (mapCache ??= loadMap());
    const inner = new BotDecisionLog(4000, 2 * 1024 * 1024, 150);
    const log: DecisionLog = {
      push: (e) => {
        if (e.bot === slot) this.fresh.push(e);
        inner.push(e);
      },
      entries: (b, f) => inner.entries(b, f),
    };
    const teamAI = new TeamAI(human.team, map, config.players, (config.seed ^ 0x6057) >>> 0, log);
    // the ghost's team AI reasons for the whole team (all at the ghost's level), but only the ghost acts on it
    for (const p of config.players) if (p.team === human.team) teamAI.register({ slot: p.slot, role: p.role, champion: p.champion, profile, params });
    this.ctx = {
      slot,
      team: human.team,
      role: human.role,
      lane: human.role === 'top' ? 'top' : human.role === 'mid' ? 'mid' : human.role === 'jungle' ? null : 'bot',
      champ: championData(human.champion),
      build: BUILDS[human.champion] ?? null,
      profile,
      map,
      players: config.players,
      toxic: false,
      lang: config.botLang ?? 'de',
      params,
      log,
      teamAI,
      mode: config.mode,
    };
    this.flashSlot = human.summoners.indexOf('sprung');
    this.fountain = map.sides[human.team === 1 ? 1 : 0]!.fountain;
  }

  /**
   * One tick of the player's own snapshot (already posted to the client) and the player's commands of that tick.
   * Never mutates `snap` in a way the client could see (it was cloned on postMessage).
   */
  observe(snap: Snapshot, cmds: readonly Command[]): void {
    if (this.dead) return;
    try {
      this.step(snap, cmds);
    } catch (e) {
      this.dead = true;
      console.warn('challenger ghost disabled', e);
    }
  }

  private step(snap: Snapshot, cmds: readonly Command[]): void {
    const me = snap.me;
    if (!me) return;
    for (const ev of snap.events) {
      this.events.push(ev);
      this.eventTicks.push(snap.tick);
    }
    if (snap.audio) this.audio.push(...snap.audio);
    this.tracker.onTick(this.facts(snap, cmds));
    if (snap.tick < this.next) return;
    this.next = snap.tick + GHOST_INTERVAL;
    if (snap.tick >= this.resyncAt) this.resync(snap.tick);
    const view: Snapshot = { ...snap, events: this.events, eventTicks: this.eventTicks, audio: this.audio };
    this.events = [];
    this.eventTicks = [];
    this.audio = [];
    this.fresh = [];
    const actions = think(view, this.ctx, this.mem, this.rng);
    // the ghost's commands are never sent: forget queued-command bookkeeping
    this.mem.cancelTags.clear();
    const d = this.ctx.teamAI.desireFor(this.slot, snap.tick);
    const intents = intentOf(snap.tick, snap, actions, this.fresh, this.flashSlot, d ? { kind: d.kind, obj: d.obj, x: d.x, y: d.y, reason: d.reason } : null);
    this.decisions++;
    this.intents += intents.length;
    for (const i of intents) this.tracker.onIntent(i);
  }

  /**
   * The ghost's memory assumes its commands ran; they did not (the player plays). Every 10 s reset what would drift
   * (mode, pending moves/casts/buys); perception memory (aware, projectiles, tree state) stays.
   */
  private resync(tick: number): void {
    this.resyncAt = tick + 10 * SEC;
    const m = this.mem;
    m.mode = this.ctx.role === 'jungle' ? 'jungle' : 'lane';
    m.lastMove = null;
    m.holdUntil = 0;
    m.busyUntil = 0;
    m.busyFrom = 0;
    m.busySlot = -1;
    m.fightTarget = -1;
    m.pendingBuy = null;
    m.phantomGold = 0;
    m.trail = [];
  }

  private facts(snap: Snapshot, cmds: readonly Command[]): PlayerFacts {
    const me = snap.me!;
    const self = snap.entities.find((e) => e.id === me.eid);
    const enemyHp = new Map<number, number>();
    for (const e of snap.entities) if (e.kind === Kind.Champion && e.team !== snap.team && e.hp > 0) enemyHp.set(e.id, e.maxHp > 0 ? e.hp / e.maxHp : 1);
    const isEnemyChamp = (id: number | undefined): boolean => id !== undefined && enemyHp.has(id);
    const x = self?.x ?? this.fountain.x;
    const y = self?.y ?? this.fountain.y;
    return {
      tick: snap.tick,
      eid: me.eid,
      team: snap.team,
      dead: me.dead,
      hp: self && self.maxHp > 0 && !me.dead ? self.hp / self.maxHp : 1,
      x,
      y,
      home: Math.hypot(x - this.fountain.x, y - this.fountain.y),
      recalling: me.recallLeft > 0,
      flashed: this.flashSlot >= 0 && cmds.some((c) => c.t === 'spell' && c.slot === this.flashSlot),
      engaged: cmds.some((c) => (c.t === 'attack' && isEnemyChamp(c.target)) || ((c.t === 'cast' || c.t === 'spell') && isEnemyChamp(c.target)) || c.t === 'cast'),
      events: snap.events,
      enemyHp,
    };
  }

  /** Final moment list (closes open buckets). */
  finish(tick: number): GhostMoment[] {
    this.tracker.finish(tick);
    return this.tracker.moments();
  }
}
