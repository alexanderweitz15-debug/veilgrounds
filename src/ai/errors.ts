// Named error injections (spec §6): rank-dependent probability per opportunity, data in
// data/bots/errors.json. Rolled with the bot's own Rng; the returned id goes into DecisionLogEntry.injectedError.
//
// BRAIN-REWORK §9 (A3): every named error is now an episode with a duration (errors.json durS, how long the bot stays
// in the mistake) and a detection: when the duration is over the bot notices it ("detect"), corrects (the caller ends
// the behaviour when errorActive() turns false) and from Silver says "Mein Fehler" with attention.json myBad.pct.
// Attention lapses (missed last hits) are no longer an error roll: they come from the attention windows of
// src/ai/humanize/attention.ts (isDistracted), not from a per-minion cache.

import errorsJson from '../data/bots/errors.json';
import attn from '../data/bots/attention.json';
import type { Rng } from '../sim/rng';
import { PROFILES } from './profiles';
import type { BotParams, DecisionLog, ErrorId } from './contract';
import type { BotAction, BotMemory, BotStatic } from './bot/types';
import { attentionOn, ensureAttention } from './humanize/attention';

export const ERROR_IDS = Object.keys(errorsJson.errors) as ErrorId[];
const TABLE = errorsJson.errors as Record<ErrorId, { p: number[]; durS: number[]; detect: string; note: string }>;
const ANCHORS = PROFILES.map((p) => p.skill);

/** Value of a per-rank table (Iron .. Challenger) at a continuous skill: linear between the rank anchors. */
function atSkill(p: readonly number[], skill: number): number {
  if (skill <= ANCHORS[0]!) return p[0]!;
  for (let i = 1; i < ANCHORS.length; i++) {
    if (skill <= ANCHORS[i]!) {
      const t = (skill - ANCHORS[i - 1]!) / (ANCHORS[i]! - ANCHORS[i - 1]!);
      return p[i - 1]! + (p[i]! - p[i - 1]!) * t;
    }
  }
  return p[p.length - 1]!;
}

/** Probability (0..1) of error `id` at a continuous skill: linear between the rank anchors. */
export function errorChance(id: ErrorId, skill: number): number {
  const p = TABLE[id]?.p;
  return p ? atSkill(p, skill) : 0;
}

/** Seconds the bot stays in error `id` before it notices (BRAIN-REWORK §9), at a continuous skill. */
export function errorDurationS(id: ErrorId, skill: number): number {
  const d = TABLE[id]?.durS;
  return d ? atSkill(d, skill) : 0;
}

/**
 * Roll error `id` for this bot (skill after variance). Returns the id when the bot makes the mistake (truthy,
 * assign it to injectedError), else undefined. Always draws exactly one number so the bot's Rng stream does
 * not depend on the rates.
 */
export function maybeInject(params: Pick<BotParams, 'skill'>, id: ErrorId, rng: Rng): ErrorId | undefined {
  const r = rng.next();
  return r < errorChance(id, params.skill) ? id : undefined;
}

// ------------------------------------------------------------------ error episodes (BRAIN-REWORK §9)

export interface ErrorEpisode {
  id: ErrorId;
  from: number;
  /** Tick the bot notices the mistake (from + durS). */
  until: number;
  detected: boolean;
}

const episodes = new WeakMap<BotMemory, ErrorEpisode[]>();
type ErrCtx = Pick<BotStatic, 'slot' | 'log' | 'params' | 'lang'>;

/**
 * Start an episode of error `id` at `tick` (the caller decided the bot makes it, e.g. via maybeInject) and log
 * "injectedError: <id> (dur <s> s)". A running episode of the same id is kept (not restarted).
 */
export function startErrorEpisode(mem: BotMemory, ctx: ErrCtx, id: ErrorId, tick: number, inputs: Record<string, number | string | boolean> = {}): ErrorEpisode {
  const list = episodes.get(mem) ?? [];
  episodes.set(mem, list);
  const running = list.find((e) => e.id === id && !e.detected && tick < e.until);
  if (running) return running;
  const durS = errorDurationS(id, ctx.params.skill);
  const ep: ErrorEpisode = { id, from: tick, until: tick + Math.round(durS * 30), detected: false };
  list.push(ep);
  ctx.log.push({ tick, bot: ctx.slot, node: 'error', inputs: { ...inputs, durS: Math.round(durS * 10) / 10 }, chosen: id, reason: `injectedError: ${id} (dur ${Math.round(durS * 10) / 10} s)`, injectedError: id });
  return ep;
}

/** Roll error `id` (one draw of the bot's Rng, like maybeInject) and start its episode when it hits. */
export function rollErrorEpisode(mem: BotMemory, ctx: ErrCtx, id: ErrorId, tick: number, rng: Rng, inputs?: Record<string, number | string | boolean>): ErrorEpisode | undefined {
  return maybeInject(ctx.params, id, rng) ? startErrorEpisode(mem, ctx, id, tick, inputs) : undefined;
}

/**
 * Hook for the classic error call sites (shared-changes A3-9): exactly one draw of the bot's Rng, like maybeInject /
 * bt rollError, so the Rng stream does not depend on the brain. With the attention model running for this bot (new
 * brain, attentionOn) a hit starts an episode (logged "injectedError: <id> (dur <s> s)", noticed later by
 * detectErrors) and the episode end (errors.json durS) is returned; otherwise the caller's old fixed duration
 * (`legacyTicks`) applies, so the pre-rework brain is unchanged. Returns -1 when the bot does not make the mistake.
 */
export function rollErrorUntil(mem: BotMemory, ctx: ErrCtx, p: Pick<BotParams, 'skill'>, id: ErrorId, tick: number, rng: Rng, legacyTicks = 0, inputs?: Record<string, number | string | boolean>): number {
  if (!maybeInject(p, id, rng)) return -1;
  if (!attentionOn(mem)) return tick + legacyTicks;
  return startErrorEpisode(mem, ctx, id, tick, inputs).until;
}

/** The running (not yet noticed) episode of error `id`, if any: the caller keeps the wrong behaviour while it runs. */
export function errorActive(mem: BotMemory, id: ErrorId, tick: number): ErrorEpisode | null {
  return episodes.get(mem)?.find((e) => e.id === id && !e.detected && tick < e.until) ?? null;
}

/** All episodes of the bot (newest last; post-game / F9). */
export const errorEpisodes = (mem: BotMemory): readonly ErrorEpisode[] => episodes.get(mem) ?? [];

/**
 * Detection (call once per decision): every episode whose duration is over is noticed and logged
 * (node 'error', chosen 'detected:<id>'); from attention.json myBad.fromSkill (Silver) the bot says "Mein Fehler"
 * with myBad.pct: a 'myBad' ping at its own position `at` (alive), else the team chat line. The roll uses the
 * attention model's own Rng, never the bot's.
 */
export function detectErrors(mem: BotMemory, ctx: ErrCtx, tick: number, at?: { x: number; y: number } | null): BotAction[] {
  const list = episodes.get(mem);
  if (!list?.length) return [];
  const out: BotAction[] = [];
  for (const ep of list) {
    if (ep.detected || tick < ep.until) continue;
    ep.detected = true;
    const rng = ensureAttention(mem, ctx, tick).rng;
    const say = ctx.params.skill >= attn.myBad.fromSkill && rng.chance(attn.myBad.pct / 100);
    const log: DecisionLog = ctx.log;
    log.push({ tick, bot: ctx.slot, node: 'error', inputs: { afterS: Math.round(((tick - ep.from) / 30) * 10) / 10, myBad: say }, chosen: `detected:${ep.id}`, reason: `${TABLE[ep.id]?.detect ?? 'noticed'}${say ? ' - "Mein Fehler"' : ''}` });
    if (say) out.push(at ? { cmd: { t: 'ping', kind: 'myBad', x: Math.round(at.x), y: Math.round(at.y) } } : { cmd: { t: 'chat', text: attn.myBad.text[ctx.lang === 'en' ? 'en' : 'de'] } });
  }
  // keep the list short: drop noticed episodes older than 60 s
  episodes.set(mem, list.filter((e) => !e.detected || tick - e.until < 1800));
  return out;
}
