// Rank profile loading + interpolation over a continuous skill value (spec §8).
// The only place rank numbers enter the AI; everything else reads a RankProfile.

import type { Rng } from '../../sim/rng';
import { RANKS, type Rank, type RankBehavior, type RankProfile, type RankTargets } from './schema';
import iron from '../../data/bots/profiles/iron.json';
import bronze from '../../data/bots/profiles/bronze.json';
import silver from '../../data/bots/profiles/silver.json';
import gold from '../../data/bots/profiles/gold.json';
import platinum from '../../data/bots/profiles/platinum.json';
import emerald from '../../data/bots/profiles/emerald.json';
import diamond from '../../data/bots/profiles/diamond.json';
import master from '../../data/bots/profiles/master.json';
import grandmaster from '../../data/bots/profiles/grandmaster.json';
import challenger from '../../data/bots/profiles/challenger.json';

// JSON imports widen string unions; the profile test validates the enum fields at runtime.
export const PROFILES = [iron, bronze, silver, gold, platinum, emerald, diamond, master, grandmaster, challenger] as unknown as RankProfile[];

export const profileOf = (rank: Rank): RankProfile => PROFILES[RANKS.indexOf(rank)]!;

/** Per-game variance setting from the lobby (§7): stable halves, volatile doubles the rank variance. */
export type VarianceMode = 'stable' | 'normal' | 'volatile';
const VARIANCE_MULT: Record<VarianceMode, number> = { stable: 0.5, normal: 1, volatile: 2 };

/** Fractional rank index (0 = Iron, 9 = Challenger) for a skill value. */
function rankIndex(skill: number): number {
  const s = PROFILES.map((p) => p.skill);
  if (skill <= s[0]!) return 0;
  for (let i = 1; i < s.length; i++) if (skill <= s[i]!) return i - 1 + (skill - s[i - 1]!) / (s[i]! - s[i - 1]!);
  return s.length - 1;
}

function skillOfIndex(idx: number): number {
  const i = Math.max(0, Math.min(PROFILES.length - 1, idx));
  const lo = Math.floor(i);
  const hi = Math.min(PROFILES.length - 1, lo + 1);
  return PROFILES[lo]!.skill + (PROFILES[hi]!.skill - PROFILES[lo]!.skill) * (i - lo);
}

function lerpRecord<T extends object>(a: T, b: T, t: number): T {
  const out = {} as Record<string, unknown>;
  for (const k of Object.keys(a) as (keyof T & string)[]) {
    const va = a[k] as unknown;
    const vb = b[k] as unknown;
    // numbers interpolate; enums and nulls snap to the nearer anchor
    out[k] = typeof va === 'number' && typeof vb === 'number' ? va + (vb - va) * t : t < 0.5 ? va : vb;
  }
  return out as T;
}

/** Profile at a continuous skill value 0..100 (e.g. Gold II between Gold and Platinum). */
export function profileAt(skill: number): RankProfile {
  const idx = rankIndex(skill);
  const lo = Math.floor(idx);
  const hi = Math.min(PROFILES.length - 1, lo + 1);
  const t = idx - lo;
  const a = PROFILES[lo]!;
  const b = PROFILES[hi]!;
  const near = t < 0.5 ? a : b;
  return {
    rank: near.rank,
    skill,
    targets: lerpRecord<RankTargets>(a.targets, b.targets, t),
    behavior: lerpRecord<RankBehavior>(a.behavior, b.behavior, t),
    archetypes: near.archetypes,
    notes: near.notes,
  };
}

/**
 * Game-start roll (§7 "Varianz"): offset in rank steps drawn from N(0, variance), applied to the whole profile.
 * A Platinum bot may play like Gold one game and Emerald the next.
 */
export function rollBotProfile(rank: Rank, mode: VarianceMode, rng: Rng): RankProfile {
  const base = profileOf(rank);
  const sigma = base.behavior.varianceRanks * VARIANCE_MULT[mode];
  const idx = RANKS.indexOf(rank) + rng.normal() * sigma;
  return profileAt(skillOfIndex(idx));
}

/** Reaction time for one event (ms): log-normal with the profile's median and approx. standard deviation. */
export function sampleReactionMs(b: RankBehavior, rng: Rng): number {
  const s = b.reactionSigmaMs / b.reactionMedianMs; // log-space sigma ~ relative spread
  return b.reactionMedianMs * Math.exp(s * rng.normal()); // ponytail: Math.exp only in AI, never in sim physics
}
