// Attention model (BRAIN-REWORK §9). A bot is focused or distracted(reason, until). While distracted a human is worse
// at everything for 0.5-3 s: last-hit plans are not executed (the minion is missed), the harass filler pauses,
// reaction time +150 ms, no predictive dodge; the attack scheduler keeps clicking the last target. This replaces
// "a lapse rolled once per minion" (lasthit.ts LAPSE_SHARE) by time windows, so no minion is ignored forever.
//
// Sources of windows (rates per rank in the profile, constants in data/bots/attention.json):
// - random: renewal process, exponential focused gap (distractionIntervalS) after each window, log-normal duration
//   (distractionDurMedianS / Sigma) clamped to [minS, maxS];
// - minimap: every perception glance (src/ai/perception/perceive.ts, minimapIntervalS + forced glances); a glance the
//   bot times into a free moment (minimapGlancePlannedPct) costs nothing, an unplanned one opens a 0.3-0.8 s window;
// - kill feed (champion death event), shop (gold crosses a shopGoldStep outside the fountain), chat (team chat line,
//   toxicity on): each with its rank chance;
// - tilt (BotExt.tilt): every window lasts tilt x tiltExtendPct longer (still capped at maxS).
// Target: share of distracted time = profile errorInjectionPct (Table B, Iron 35 % .. Challenger 3 %), calibrated in
// tests/attention.test.ts.
//
// Determinism: own Rng per bot seeded from the personality seed and slot - never the bot's think/reflex Rng, so the
// model can be queried at any cadence (reflex every tick, think 2-8 Hz) without changing the bot's other draws. The
// random schedule is advanced lazily to the queried tick: the same windows come out whether it is asked at 30 Hz or
// 2 Hz. Every window start (and extension) is logged: node 'attention', chosen 'distracted(<reason>)'.

import attn from '../../data/bots/attention.json';
import { Rng } from '../../sim/rng';
import { Kind } from '../../sim/types';
import type { Snapshot } from '../../sim/snapshot';
import type { DecisionLog } from '../contract';
import type { RankBehavior } from '../profiles/schema';
import type { BotMemory, BotStatic } from '../bot/types';

export const DISTRACTION_REASONS = ['random', 'minimap', 'killFeed', 'shop', 'chat'] as const;
export type DistractionReason = (typeof DISTRACTION_REASONS)[number];

export interface AttentionWindow {
  from: number;
  /** Exclusive: distracted at tick t iff from <= t < until. */
  until: number;
  reason: DistractionReason;
}

export interface AttentionState {
  rng: Rng;
  slot: number;
  log: DecisionLog;
  b: RankBehavior;
  /** Current or latest window. */
  cur: AttentionWindow | null;
  /** Tick the next random distraction starts. */
  nextRandom: number;
  /** Advanced up to this tick (inclusive). */
  at: number;
  /** First tick observed (share statistics). */
  since: number;
  /** Sum of all window lengths so far (ticks, incl. the not yet elapsed part of the current window). */
  distractedTicks: number;
  windows: number;
  maxWindowTicks: number;
  byReason: Record<DistractionReason, number>;
  history: AttentionWindow[];
  /** Trigger bookkeeping: latest perception glance and event tick handled, current gold step, tilt stacks. */
  glanceSeen: number;
  eventTickSeen: number;
  goldStep: number;
  tilt: number;
}

export interface AttentionEffects {
  distracted: boolean;
  reason: DistractionReason | null;
  /** First focused tick again (= tick when focused). */
  untilTick: number;
  /** §9: last-hit plans are not executed (plan cancel reason 'distracted'). */
  skipLastHit: boolean;
  /** §9: harass filler pauses (the scheduler keeps attacking the last target). */
  pauseHarass: boolean;
  /** §9: added to every sampled reaction time. */
  reactionPenaltyMs: number;
  /** §9: predictive dodges off while distracted. */
  predictiveDodge: boolean;
}

const TPS = 30;
const ticks = (s: number): number => Math.max(1, Math.round(s * TPS));
const states = new WeakMap<BotMemory, AttentionState>();

/** Attention state of a bot; created on first use (seeded from personality seed + slot, see header). */
export function ensureAttention(mem: BotMemory, ctx: Pick<BotStatic, 'slot' | 'log' | 'params'>, tick: number): AttentionState {
  let st = states.get(mem);
  if (st) return st;
  const rng = new Rng((Math.imul(ctx.params.personalitySeed ^ 0xa77e_9e11, 0x9e3779b1) + Math.imul(ctx.slot + 1, 0x27d4eb2f)) >>> 0);
  st = {
    rng,
    slot: ctx.slot,
    log: ctx.log,
    b: ctx.params.behavior,
    cur: null,
    nextRandom: 0,
    at: tick - 1,
    since: tick,
    distractedTicks: 0,
    windows: 0,
    maxWindowTicks: 0,
    byReason: { random: 0, minimap: 0, killFeed: 0, shop: 0, chat: 0 },
    history: [],
    glanceSeen: tick,
    eventTickSeen: tick - 1,
    goldStep: -1,
    tilt: 0,
  };
  st.nextRandom = tick + gap(st);
  states.set(mem, st);
  return st;
}

/** The bot's attention state if the model runs for it (null: never observed -> always focused). */
export const attentionState = (mem: BotMemory): AttentionState | null => states.get(mem) ?? null;

/** Exponential focused gap (ticks) before the next random distraction. */
function gap(st: AttentionState): number {
  const mean = st.b.distractionIntervalS * TPS;
  return Math.max(1, Math.round(-Math.log(1 - st.rng.next()) * mean));
}

const randomDurS = (st: AttentionState): number => Math.min(attn.maxS, Math.max(attn.minS, st.b.distractionDurMedianS * Math.exp(st.b.distractionDurSigma * st.rng.normal())));
const uniformS = (st: AttentionState, r: number[]): number => r[0]! + (r[1]! - r[0]!) * st.rng.next();

/** Open (or extend) a window at tick t. Tilt lengthens it; a window never exceeds maxS in total. */
function openWindow(st: AttentionState, t: number, reason: DistractionReason, durS: number): void {
  const d = Math.min(attn.maxS, durS * (1 + (st.tilt * attn.tiltExtendPct) / 100));
  const cap = ticks(attn.maxS);
  const cur = st.cur;
  if (cur && t < cur.until) {
    // already distracted: the new cause can only stretch the window (up to maxS since its start)
    const until = Math.min(Math.max(cur.until, t + ticks(d)), cur.from + cap);
    if (until <= cur.until) return;
    st.distractedTicks += until - cur.until;
    st.byReason[reason] += until - cur.until;
    cur.until = until;
    st.maxWindowTicks = Math.max(st.maxWindowTicks, until - cur.from);
    st.log.push({ tick: t, bot: st.slot, node: 'attention', inputs: { reason, durS: round1(d), tilt: st.tilt, until }, chosen: `distracted(${cur.reason}+${reason})`, reason: `extended to ${round1((until - cur.from) / TPS)} s (until ${until})` });
    return;
  }
  const w: AttentionWindow = { from: t, until: t + Math.min(cap, ticks(d)), reason };
  st.cur = w;
  st.windows++;
  st.distractedTicks += w.until - w.from;
  st.byReason[reason] += w.until - w.from;
  st.maxWindowTicks = Math.max(st.maxWindowTicks, w.until - w.from);
  st.history.push(w);
  if (st.history.length > attn.historyLen) st.history.shift();
  st.log.push({ tick: t, bot: st.slot, node: 'attention', inputs: { reason, durS: round1(d), tilt: st.tilt, until: w.until }, chosen: `distracted(${reason})`, reason: `${round1((w.until - w.from) / TPS)} s (until ${w.until})` });
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Advance the random schedule up to `tick` (inclusive). Cadence independent. */
function advance(st: AttentionState, tick: number): void {
  if (tick <= st.at) return;
  while (st.nextRandom <= tick) {
    const s = st.nextRandom;
    if (st.cur && s < st.cur.until) {
      // a triggered window is running: the renewal restarts after it (memoryless)
      st.nextRandom = st.cur.until + gap(st);
      continue;
    }
    openWindow(st, s, 'random', randomDurS(st));
    st.nextRandom = st.cur!.until + gap(st);
  }
  st.at = tick;
}

/**
 * Feed the triggers a bot noticed (call once per decision, after or before think; reflex may call it every tick -
 * events and glances are handled once): perception minimap glance, kill feed, team chat, gold steps, tilt.
 */
export function observeAttention(mem: BotMemory, ctx: Pick<BotStatic, 'slot' | 'log' | 'params' | 'team' | 'toxic'>, snap: Snapshot): AttentionState {
  const tick = snap.tick;
  const st = ensureAttention(mem, ctx, tick);
  advance(st, tick);
  st.tilt = mem.ext?.tilt ?? 0;
  const b = st.b;
  // minimap glance of the perception module (interval or forced by pings / objective spawns); the kill-feed glance is
  // handled by the kill-feed rule below, the recall glance happens while channelling (planned)
  const ps = mem.ext?.perception;
  if (ps && ps.lastGlance > st.glanceSeen && ps.lastGlance <= tick) {
    st.glanceSeen = ps.lastGlance;
    const why = ps.glanceReason.split('+');
    if (why.some((r) => r === 'interval' || r === 'ownPing' || r === 'allyPing' || r === 'objectiveSpawn')) {
      if (!st.rng.chance(b.minimapGlancePlannedPct / 100)) openWindow(st, tick, 'minimap', uniformS(st, attn.minimapS));
    }
  }
  const evTicks = snap.eventTicks;
  let maxEv = st.eventTickSeen;
  snap.events.forEach((ev, i) => {
    const et = evTicks?.[i] ?? tick;
    if (et <= st.eventTickSeen) return;
    maxEv = Math.max(maxEv, et);
    if (ev.e === 'death' && ev.kind === Kind.Champion) {
      if (st.rng.chance(b.distractKillFeedPct / 100)) openWindow(st, tick, 'killFeed', uniformS(st, attn.killFeedS));
    } else if (ev.e === 'chat' && ev.team === ctx.team && ev.slot !== ctx.slot && ctx.toxic) {
      if (st.rng.chance(b.distractChatPct / 100)) openWindow(st, tick, 'chat', uniformS(st, attn.chatS));
    }
  });
  st.eventTickSeen = maxEv;
  const me = snap.me;
  if (me && !me.dead) {
    const step = Math.floor(me.gold / attn.shopGoldStep);
    if (st.goldStep >= 0 && step > st.goldStep && !me.inFountain && st.rng.chance(b.distractShopPct / 100)) openWindow(st, tick, 'shop', uniformS(st, attn.shopS));
    st.goldStep = step;
  }
  return st;
}

const FOCUSED: AttentionEffects = { distracted: false, reason: null, untilTick: -1, skipLastHit: false, pauseHarass: false, reactionPenaltyMs: 0, predictiveDodge: true };

/** Effects of the bot's attention at `tick` (focused if the model never ran for this bot). */
export function attentionAt(mem: BotMemory, tick: number): AttentionEffects {
  const st = states.get(mem);
  if (!st) return { ...FOCUSED, untilTick: tick };
  advance(st, tick);
  const w = st.cur;
  if (!w || tick < w.from || tick >= w.until) return { ...FOCUSED, untilTick: tick };
  return { distracted: true, reason: w.reason, untilTick: w.until, skipLastHit: true, pauseHarass: true, reactionPenaltyMs: attn.reactionPenaltyMs, predictiveDodge: false };
}

/** A1/A2 hook: is the bot distracted at this tick? */
export const isDistracted = (mem: BotMemory, tick: number): boolean => attentionAt(mem, tick).distracted;

/** Reaction-time penalty (ms) to add to sampleReactionMs at this tick (0 when focused). */
export const reactionPenaltyMs = (mem: BotMemory, tick: number): number => attentionAt(mem, tick).reactionPenaltyMs;

/**
 * Probe for A1's reflex layer (docs/agents/plan-api.md §5: reflexState(mem).attention). Pure with respect to the
 * bot's Rng: only the attention model's own stream advances.
 */
export const attentionProbe =
  (mem: BotMemory) =>
  (tick: number): { distracted: boolean; reason?: string } => {
    const e = attentionAt(mem, tick);
    return e.distracted ? { distracted: true, reason: e.reason! } : { distracted: false };
  };

export interface AttentionStats {
  /** Distracted share of the observed time (0..1). */
  share: number;
  windows: number;
  maxWindowS: number;
  /** Share per reason. */
  byReason: Record<DistractionReason, number>;
  observedS: number;
}

/** Statistics up to `tick` (tests, bot-sim, F9). */
export function attentionStats(mem: BotMemory, tick: number): AttentionStats | null {
  const st = states.get(mem);
  if (!st) return null;
  advance(st, tick);
  const span = Math.max(1, tick - st.since + 1);
  const future = st.cur ? Math.max(0, st.cur.until - (tick + 1)) : 0;
  const byReason = { ...st.byReason };
  if (st.cur && future) byReason[st.cur.reason] -= future;
  for (const r of DISTRACTION_REASONS) byReason[r] = Math.max(0, byReason[r]) / span;
  return { share: (st.distractedTicks - future) / span, windows: st.windows, maxWindowS: st.maxWindowTicks / TPS, byReason, observedS: span / TPS };
}

/** F9 overlay: current attention in one line, e.g. "distracted(minimap) 0.4 s" / "focused", plus the share so far. */
export function attentionDebug(mem: BotMemory, tick: number): { text: string; share: number } | undefined {
  const s = attentionStats(mem, tick);
  if (!s) return undefined;
  const e = attentionAt(mem, tick);
  return { text: e.distracted ? `distracted(${e.reason}) ${round1((e.untilTick - tick) / TPS)} s` : 'focused', share: s.share };
}
