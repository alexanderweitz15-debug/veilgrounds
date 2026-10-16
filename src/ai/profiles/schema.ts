// Bot rank profile schema. All rank parameters live in src/data/bots/profiles/<rank>.json (spec §7, §8):
// no rank value is hard-coded in AI code. Profiles are interpolated over a continuous skill value 0..100
// (Iron 5 ... Challenger 100) so divisions and per-game variance can be expressed.

export const RANKS = ['iron', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'master', 'grandmaster', 'challenger'] as const;
export type Rank = (typeof RANKS)[number];

/** Table A: measured outcome targets (bot-sim must land within ±10%). */
export interface RankTargets {
  csPerMin: number;
  csAt10: number;
  goldPerMin: number;
  deathsPerGame: number;
  killsPerGame: number;
  killParticipationJgSup: number; // %
  wardsPerMinSupport: number;
  wardsPerMinJungle: number;
  wardsPerMinAdc: number;
  controlWardsSupport: number;
  controlWardsLaner: number;
  visionScoreSupport: number;
  visionScoreLaner: number;
  gameLengthMin: number;
}

export type CooldownTracking = 'none' | 'own' | 'enemyBasic' | 'ults' | 'flash50' | 'flash' | 'all';
export type JungleTracking = 'none' | 'sideOnSight' | 'side' | 'sideTimer' | 'ahead60' | 'ahead90' | 'ahead90Leash' | 'full';
export type BuildQuality = 'random' | 'recommended' | 'standard70' | 'standard' | 'adaptive';
export type AbilityOrder = 'unlock' | 'standard' | 'situational';

/** Table B: behaviour parameters (the actual knobs). Numeric fields interpolate; enum fields switch at the nearer rank. */
export interface RankBehavior {
  reactionMedianMs: number;
  reactionSigmaMs: number;
  microHz: number;
  macroIntervalS: number;
  minimapIntervalS: number;
  predictiveDodgePct: number;
  dodgeRateLine900Pct: number;
  skillshotHitPct: number;
  aimErrorDeg: number;
  lastHitJitterMs: number;
  errorInjectionPct: number;
  cooldownTracking: CooldownTracking;
  jungleTracking: JungleTracking;
  waveStateDeliberatePct: number;
  shoveAndRecallPct: number;
  /** Gold at which the bot wants to recall to buy; null = ignores gold. */
  recallGoldThreshold: number | null;
  objectiveConversionPct: number;
  chaseIntoFogPct: number;
  diveHpTolerancePct: number;
  /** Seconds to decide on an objective; null = no objective decisions (Iron). */
  objectiveLatencyS: number | null;
  baronWithoutVisionPct: number;
  groupAfterFirstTowerPct: number;
  sideLaneFarmAfter15Pct: number;
  buildQuality: BuildQuality;
  /** Share of games/purchases using the adaptive (situational) build variant. */
  adaptiveBuildPct: number;
  /** Share of standard-build adherence when buildQuality = standard70. */
  standardBuildPct: number;
  optimalRunesPct: number;
  abilityOrder: AbilityOrder;
  situationalAbilityPct: number;
  rotationGroupSize: number;
  tiltPerformanceDropPct: number;
  varianceRanks: number;
  pingsPerMin: number;
  surrenderAtMinus8kPct: number;
  /** Spec §8 APM cap (interpolated between the given anchor ranks). */
  apmCap: number;
  /** Behaviour inertia (hysteresis bonus for the running behaviour, 0..1). Gold high, Challenger low (§8). */
  inertia: number;
  /** Spec-bots §1 hysteresis: bonus (fraction) for the running behaviour in withHysteresis(), 0.25 Gold .. 0.10 Challenger. */
  hysteresis: number;
  /** Visible hesitation before engages, seconds (§8: 0.3-1.0 by rank). */
  engageHesitationS: number;
  // ---- brain rework §4.7 laning (A1 reflex layer, src/ai/reflex/**)
  /** How far ahead (s) the per-tick last-hit planner considers kill windows (Iron 1 .. Diamond+ 3). */
  planHorizonS: number;
  /** Chance (%) to pull two overlapping kill windows apart with a preparing auto (Gold 30 .. Challenger 100). */
  windowPrepPct: number;
  /** Spatial stand-point hysteresis (units): a new move only when the stand point is further away (Iron 220 .. Challenger 90). */
  standHysteresis: number;
  /** Orbwalk chance (%) per auto at kiting axis 0 (Iron 20 .. Challenger 97); the kiting axis shifts it. */
  orbwalkPct: number;
  /** Harass budget: autos per minute on the enemy laner without trade intent (Iron 2 .. Challenger 12; aggression axis +-3). */
  harassPerMin: number;
  /** Chance (%) to time harass into the enemy's CS window (Diamond 50, Challenger 90). */
  harassCsWindowPct: number;
}

export interface RankProfile {
  rank: Rank;
  /** Continuous skill anchor 0..100 (spec-bots §10: Iron 5, Bronze 15, Silver 30, Gold 45, Platinum 58, Emerald 68,
   *  Diamond 80, Master 88, GM 94, Challenger 100). */
  skill: number;
  targets: RankTargets;
  behavior: RankBehavior;
  /** Diamond only: weakness archetypes, one is rolled per bot (§7). */
  archetypes?: { id: string; desc: string; planAbortInFightPct?: number }[];
  /** Coaching-derived behaviour notes shown in the encyclopedia (§7 "Verhaltensmuster"). */
  notes: { de: string; en: string };
}
