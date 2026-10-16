// Shared contract for the bot behaviour work (docs/spec-bots.md). Three agents build against these types in
// parallel: K = params/playstyle/log/errors/exchange estimate, L = perception/ganks/roams, M = behaviour tree,
// trades/kiting/positioning/macro/player interaction. Change only additively and tell the others.

import type { LaneName } from '../sim/map';
import type { Rank, RankBehavior } from './profiles/schema';

// ---------------------------------------------------------------- playstyle (spec §2)

/** Ten axes, integers -5..+5. Direction exactly as in spec §2 (left = -5): kiting -5 = "Profi", +5 = "keins". */
export const PLAYSTYLE_AXES = [
  'tradeLength',
  'kiting',
  'aggression',
  'roam',
  'objectiveRisk',
  'farmPriority',
  'vision',
  'resourceUse',
  'teamplay',
  'tempo',
] as const;
export type PlaystyleAxis = (typeof PLAYSTYLE_AXES)[number];
export type Playstyle = Record<PlaystyleAxis, number>;

export const ARCHETYPES = ['farmer', 'duelist', 'roamer', 'cautious', 'intBot', 'shotcaller', 'splitpusher', 'proStandard'] as const;
export type Archetype = (typeof ARCHETYPES)[number];

// ---------------------------------------------------------------- flat bot params (spec §10)

/**
 * Behaviour knobs derived from the playstyle axes via data/bots/playstyleAxes.json (base, perStep, clamp).
 * Never hard-code these numbers in behaviour code; read them from BotParams.knobs.
 */
export type Knob =
  // trades (§6)
  | 'tradeAbortS' // seconds after which a trade is abandoned (2 .. 7)
  | 'tradeAbortHpRatio' // own/enemy HP ratio below which a trade is abandoned
  | 'tradeWindowMult' // multiplier on trade-window threshold (short trades trade more often: 0.8)
  | 'tradeWinThreshold' // winProb needed (0.45 .. 0.7)
  | 'allInKillProb' // killProb needed for all-in
  | 'allInDeathProb' // max deathProb for all-in
  // kiting (§7)
  | 'orbwalkChance' // 0..1 per auto
  | 'spacingBuffer' // own range - buffer
  | 'kiteBack' // 0/1
  // aggression (§2)
  | 'fightWeight' // x0.6 .. x1.6
  | 'diveTolerancePctShift' // +-15 points on profile diveHpTolerancePct
  | 'towerDive' // 0/1
  | 'chaseChanceShift' // +-25 points on profile chaseIntoFogPct
  | 'escapeFightThreshold' // §4.2: fight instead of escape above (0.85 .. 0.4)
  | 'gankRiskShift' // §4.1 thresholds shift (+0.15 aggressive, negative cautious)
  // roam (§5)
  | 'roamDesireBase' // 0.1 .. 0.7
  | 'roamThreshold' // score needed (0.5 +- 0.2)
  | 'supportAdcBinding' // 0.9 .. 0.4
  // objectives (§8)
  | 'objectiveSafetyThreshold' // 0.8 .. 0.3
  | 'stealAttempts' // 0/1
  // farm (§2)
  | 'farmWeight'
  | 'pingFollowThreshold'
  // vision (§2)
  | 'wardIntervalMult' // x2 .. x0.5
  | 'controlWardBuyGold'
  | 'useSweeper' // 0/1
  // resources (§2, §4.2)
  | 'flashOffensive' // 0/1
  | 'flashDangerThreshold' // escape flash already at this danger (resourceUse +5: 0.5)
  | 'dashEngageWeight'
  | 'ultKillThreshold' // 0.9 .. 0.4
  // team (§2, §8, §9)
  | 'groupWeight'
  | 'splitWeight'
  | 'pingObedience' // 0.3 .. 0.95
  | 'fightJoinThreshold' // 0.45 +- 0.15
  | 'fightJoinLatencyMult'
  // tempo (§2, §8)
  | 'recallThresholdShift'
  | 'macroIntervalMult' // x1.5 .. x0.7
  | 'waveSacrifice' // willingness to give up a wave for an objective 0..1
  // jungle (§4.3)
  | 'gankThreshold' // 0.55 +- 0.15 (rank shifts in profile)
  | 'gankEvalIntervalS'
  // BRAIN-REWORK §4.3 / §5 (A3, additive): harass budget shift and utility style factors (x0.6 .. x1.6)
  | 'harassRateShift' // autos/min added to the profile harass budget (aggression +-3)
  | 'utilFarm' // Farm axis x farm value
  | 'utilTrade' // Aggression x trade / all-in value
  | 'utilHarass' // Aggression x harass-poke value
  | 'utilRoam' // Roam axis x roam value
  | 'utilPush' // Tempo x push / plates value
  | 'utilRecall' // Tempo x recall value (slow recalls more)
  | 'utilObjective' // Objective risk x objective value
  | 'utilVision' // Vision x ward / sweep value
  | 'utilGroup' // Teamplay x group / siege / end value
  | 'utilCatchLane'; // Farm x jungler "catch the lane" value

export interface BotParams {
  slot: number;
  rank: Rank;
  /** Continuous skill 0..100 after variance. */
  skill: number;
  /** Interpolated rank behaviour (Table B) after variance; tilt applied at runtime via withTilt(). */
  behavior: RankBehavior;
  playstyle: Playstyle;
  archetype: Archetype | null;
  /**
   * True if the playstyle was rolled (champion bias applied), false if set manually. An archetype preset counts as
   * manual (no bias); the roll is a pure function of the PlayerSetup (src/ai/params.ts resolvePlaystyle), so lobby
   * and scoreboard show exactly what the worker plays.
   */
  rolled: boolean;
  knobs: Record<Knob, number>;
  /** Hysteresis bonus for the running behaviour, 0.10 (Challenger) .. 0.25 (Gold). */
  hysteresis: number;
  /** Personality seed (spec §10). */
  personalitySeed: number;
}

// ---------------------------------------------------------------- decision log (spec §1, §10)

export type ErrorId =
  | 'trade_on_cooldown'
  | 'fight_in_enemy_wave'
  | 'ignore_minion_aggro'
  | 'no_flash_tracking'
  | 'chase_third_kill'
  | 'flash_into_wall'
  | 'overcommit_after_kill'
  | 'flash_wrong_direction'
  | 'roam_from_push'
  | 'flash_in_dive'
  | 'carry_too_far'
  | 'late_recall'
  | 'idle_after_shove';

export interface DecisionLogEntry {
  tick: number;
  /** Bot slot. */
  bot: number;
  /** Behaviour tree node id, e.g. 'escape', 'trade', 'gank', 'roam', 'recall'. */
  node: string;
  /**
   * Shortened inputs; positions only of entities the team saw or as cloud estimates (spec test 7).
   * Position convention (checked by checkFogConvention in src/ai/log.ts): every position is a triple
   *   `<p>X`, `<p>Y`, `<p>Src` with Src one of
   *     'seen'   enemy position the team saw (last sighting; add `<p>Slot` = enemy player slot),
   *     'cloud'  estimate after losing sight (add `<p>R` = cloud radius > 0; optional `<p>Slot`),
   *     'self' | 'ally' | 'static'   own champion, allied units, map points (towers, camps, wards).
   *   An X/Y pair without `<p>Src` is a violation; so is a 'seen' position the team never saw there.
   *   Example: { tgtX: 7020, tgtY: 1310, tgtSrc: 'seen', tgtSlot: 7, jgX: 5000, jgY: 6100, jgSrc: 'cloud', jgR: 900 }
   */
  inputs: Record<string, number | string | boolean>;
  scores?: Record<string, number>;
  chosen: string;
  reason: string;
  injectedError?: ErrorId;
  /** Age of the perception data the decision used. */
  perceptionAgeMs?: number;
  /** (K, additive) Reaction time sampled for the event that triggered this decision (F9 overlay). */
  reactionMs?: number;
}

export interface DecisionLog {
  push(e: DecisionLogEntry): void;
  /** Newest last. */
  entries(bot?: number, fromTick?: number): readonly DecisionLogEntry[];
}

// ---------------------------------------------------------------- perception (spec §3), built by L

export interface EnemyCooldowns {
  /** Ticks at which the bot believes the spell/ability is ready again (undefined = unknown). */
  flashReadyAt?: number;
  ultReadyAt?: number;
  mainReadyAt?: number;
}

export interface EnemyTrack {
  slot: number;
  champ: string;
  role: string;
  visibleNow: boolean;
  lastX: number;
  lastY: number;
  lastTick: number;
  dirX: number;
  dirY: number;
  level: number;
  hpFrac: number;
  /** Probability cloud after losing sight (null = unknown/not modelled for this rank). */
  cloud: { x: number; y: number; r: number; weight: number } | null;
  cds: EnemyCooldowns;
}

export interface PerceptionView {
  tick: number;
  /** Enemy champions per slot as the bot believes them (never contains unseen exact positions). */
  enemies: ReadonlyMap<number, EnemyTrack>;
  /** Gank risk per lane, next 20 s (0..1). */
  gankRisk: Readonly<Record<LaneName, number>>;
  /** Threat at a map point (ThreatMap layer), >= 0. */
  threat(x: number, y: number): number;
  /** Heard casts (audio cues within 1800) since the last decision. */
  audio: readonly { slot: number; abilitySlot: number; x: number; y: number; dx: number; dy: number; tick: number }[];
}

// ---------------------------------------------------------------- exchange estimate (spec §6), built by K

export interface ExchangeResult {
  winProb: number;
  killProb: number;
  deathProb: number;
}
