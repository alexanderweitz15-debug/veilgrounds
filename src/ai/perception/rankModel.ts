// Rank-dependent perception depth (spec-bots §3/§4/§5), derived in ONE place from the profile enums
// (jungleTracking, cooldownTracking) and the continuous skill value. Behaviour code asks these helpers, never
// switches on rank names itself.
// ponytail: the spec gives these as text (Iron none, Gold 30 s, Diamond 90 s, Challenger until contact ...); they
// are mapped from the existing profile enums instead of new profile JSON fields. Move to profiles if tuned.

import type { BotParams } from '../contract';
import { RANKS, type CooldownTracking, type JungleTracking, type Rank } from '../profiles/schema';

export const rankIdx = (r: Rank): number => RANKS.indexOf(r);
/** True if the bot's (variance-rolled) rank is at least `r`. */
export const atLeast = (p: BotParams, r: Rank): boolean => rankIdx(p.rank) >= rankIdx(r);

const JT_ORDER: JungleTracking[] = ['none', 'sideOnSight', 'side', 'sideTimer', 'ahead60', 'ahead90', 'ahead90Leash', 'full'];
const jt = (p: BotParams): number => JT_ORDER.indexOf(p.behavior.jungleTracking);

/** Seconds a probability cloud is kept after sight loss (0 = no clouds; Infinity = until next contact). */
export function cloudHorizonS(p: BotParams): number {
  return [0, 30, 45, 60, 90, 120, 180, Infinity][jt(p)] ?? 0;
}

/** Inputs of the jungler model / GankRisk (spec §3 "Rang-Eingaben"). */
export interface JunglerInputs {
  /** Any GankRisk at all (Iron/Bronze: none, react only to a jungler in near range). */
  enabled: boolean;
  /** Sightings are used only after this extra delay range in seconds (Silver 8-15 s; 0 above). */
  sightDelayS: [number, number];
  wave: boolean;
  timers: boolean;
  pathPrediction: boolean;
  leash: boolean;
  csCounting: boolean;
}

export function junglerInputs(p: BotParams): JunglerInputs {
  const j = jt(p);
  const silverPlus = atLeast(p, 'silver');
  return {
    enabled: silverPlus,
    sightDelayS: j === 0 ? [8, 15] : [0, 0],
    wave: j >= 1,
    timers: j >= 2,
    pathPrediction: j >= 4,
    leash: j >= 6,
    csCounting: j >= 7,
  };
}

/** Which enemy cooldowns the bot tracks from seen/heard casts (spec §3, profile cooldownTracking). */
export interface CdTracking {
  main: boolean;
  ult: boolean;
  /** Seen Flashes are tracked at all (a share is still forgotten: errors.ts no_flash_tracking). */
  flash: boolean;
  all: boolean;
}

export function cdTracking(p: BotParams): CdTracking {
  const c: CooldownTracking = p.behavior.cooldownTracking;
  const order: CooldownTracking[] = ['none', 'own', 'enemyBasic', 'ults', 'flash50', 'flash', 'all'];
  const i = order.indexOf(c);
  return { main: i >= 2, ult: i >= 3, flash: i >= 2, all: i >= 6 };
}

/** Linear interpolation over skill anchors [skill, value][] (skill 0..100, clamped). */
export function bySkill(p: BotParams, anchors: [number, number][]): number {
  const s = p.skill;
  if (s <= anchors[0]![0]) return anchors[0]![1];
  for (let i = 1; i < anchors.length; i++) {
    const [s1, v1] = anchors[i]!;
    const [s0, v0] = anchors[i - 1]!;
    if (s <= s1) return v0 + ((v1 - v0) * (s - s0)) / (s1 - s0);
  }
  return anchors[anchors.length - 1]![1];
}

/** Ping probability per occasion (§4.2.7: Iron 10 %, Diamond 90 %). */
export const pingChance = (p: BotParams): number => bySkill(p, [[5, 0.1], [80, 0.9], [100, 0.95]]);

/** Seconds of team-help latency (§4.4: Gold 5 s, Diamond immediate). */
export const helpLatencyS = (p: BotParams): number => bySkill(p, [[5, 8], [45, 5], [80, 0]]);

/** Rank shift on the jungler gank threshold (§4.3: Iron 0.3, neutral 0.55, Challenger 0.6). */
export const gankThresholdRankShift = (p: BotParams): number => bySkill(p, [[5, -0.25], [45, 0], [100, 0.05]]);

/** Seconds after sight loss before the bot's own "missing" ping (§5.2.1: Iron never, Silver 10, Gold 5, Diamond 0). */
export function missingPingDelayS(p: BotParams): number {
  if (!atLeast(p, 'silver')) return Infinity;
  return bySkill(p, [[30, 10], [45, 5], [80, 0]]);
}

/** Rank is in the "coin flip" band for fight-or-flight (§4.2.2: Iron-Silver 50 %). */
export const coinFlipFights = (p: BotParams): boolean => !atLeast(p, 'gold');
