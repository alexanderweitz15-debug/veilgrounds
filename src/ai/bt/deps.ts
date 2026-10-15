// Adapters from the tree leaves to the parallel agents' modules (K: params/errors/exchange, L: perception), so the
// leaves keep one small call surface. L's leaves import estimateExchange from here too.

import type { Rng } from '../../sim/rng';
import { RANKS, type Rank } from '../profiles/schema';
import type { BotParams, ErrorId, ExchangeResult } from '../contract';
import { maybeInject } from '../errors';
import { exchangeFromSnapshot } from '../exchange';
import type { BotStatic, SnapEntity } from '../bot/types';
import type { View } from '../bot/perception';
import { dst } from '../bot/geo';

export { neutralPlaystyle, ARCHETYPE_PLAYSTYLES } from '../params';

import type { LaningSafety } from '../ganks/risk';
import type { TrackMem } from '../perception/types';
import { mainAbility } from '../perception/perceive';
import { championData } from '../../sim/champions';

/** L's enemy tracks per decision view (set by runTree), so every estimateExchange caller gets known cooldowns. */
const viewTracks = new WeakMap<object, ReadonlyMap<number, TrackMem>>();
export const attachTracks = (v: View, tracks: ReadonlyMap<number, TrackMem>): void => void viewTracks.set(v, tracks);

/** Known enemy cooldowns (seconds until Q W E R ready; undefined = unknown) from L's tracks for K's estimate. */
function knownCds(v: View, slots: number[]): Map<number, (number | undefined)[]> | undefined {
  const tracks = viewTracks.get(v);
  if (!tracks) return undefined;
  const out = new Map<number, (number | undefined)[]>();
  const secs = (t: number | undefined): number | undefined => (t === undefined ? undefined : Math.max(0, (t - v.tick) / 30));
  for (const slot of slots) {
    const t = tracks.get(slot);
    if (!t) continue;
    const cds: (number | undefined)[] = [undefined, undefined, undefined, undefined];
    if (t.abilityReadyAt.some((x) => x > 0)) t.abilityReadyAt.forEach((x, i) => (cds[i] = secs(x)));
    else {
      if (t.cds.mainReadyAt !== undefined) cds[mainAbility(championData(t.champ))] = secs(t.cds.mainReadyAt);
      if (t.cds.ultReadyAt !== undefined) cds[3] = secs(t.cds.ultReadyAt);
    }
    if (cds.some((c) => c !== undefined)) out.set(slot, cds);
  }
  return out.size ? out : undefined;
}
import type { BotMemory } from '../bot/types';

/** L's §4.1 laning modifiers for this decision (written by the gankRiskReaction leaf), if any. */
export const laningSafety = (mem: BotMemory): LaningSafety | null => (mem.ext.perception.tactics.laningSafety as LaningSafety | undefined) ?? null;

/** L's gank focus hand-off (jungle gank engage / roam): enemy slot + eid until a tick. */
export const tacticsFocus = (mem: BotMemory, tick: number): { slot: number; eid: number } | null => {
  const f = mem.ext.perception.tactics.focus as { slot: number; eid: number; until: number } | null | undefined;
  return f && f.until > tick ? f : null;
};

export const rankIdx = (r: Rank): number => RANKS.indexOf(r);

/** Roll a named error (K's errors.ts, rank-interpolated rates); true = make the mistake. Caller logs it. */
export const rollError = (id: ErrorId, params: Pick<BotParams, 'skill'>, rng: Rng): boolean => !!maybeInject(params, id, rng);

const sig = (x: number): number => 1 / (1 + Math.exp(-x));
const logit = (p: number): number => Math.log(Math.max(1e-6, p) / Math.max(1e-6, 1 - p));

/**
 * K's ExchangeEstimate from the bot's view: the bot + allies within 1000 of the target vs the target + enemies
 * within 1000 of the bot, over `horizonS`. extraAllyDps (an ally arriving, e.g. the own jungler or the player's
 * engage) is folded in as extra damage on the target side.
 */
export function estimateExchange(v: View, ctx: BotStatic, target: SnapEntity, horizonS: number, rng: Rng, opt: { orbwalk?: number; extraAllyDps?: number } = {}): ExchangeResult {
  const allies = [v.me.eid, ...v.allies.filter((a) => dst(a, target) < 1000).map((a) => a.id)];
  const enemies = [target.id, ...v.enemies.filter((e) => e.id !== target.id && dst(e, v.self) < 1000).map((e) => e.id)];
  const slots = [target.slot, ...v.enemies.filter((e) => enemies.includes(e.id)).map((e) => e.slot)];
  const cds = knownCds(v, slots);
  const d = exchangeFromSnapshot(v.snap, { allies, enemies, horizonS, skill: ctx.params.skill, rng, orbwalk: opt.orbwalk ?? ctx.params.knobs.orbwalkChance, ...(cds ? { knownCds: cds } : {}) });
  const extra = (opt.extraAllyDps ?? 0) * horizonS;
  if (extra <= 0) return { winProb: d.winProb, killProb: d.killProb, deathProb: d.deathProb };
  const enemyAfter = d.enemyHpAfter - extra / Math.max(1, target.maxHp * enemies.length);
  const killRatio = (1 + 0.15 * logit(d.killProb)) * (1 + extra / Math.max(1, d.dealt * d.noiseDealt));
  return { winProb: sig(5 * (d.allyHpAfter - enemyAfter)), killProb: sig((killRatio - 1) / 0.15), deathProb: d.deathProb };
}
