// Utility model types (docs/BRAIN-REWORK.md §5). A candidate intent is scored in gold per second:
// score = (benefit - cost) x style factor, + hysteresis x |score| for the running intent, + rank noise.

import type { LaneName } from '../../sim/map';
import type { NodeCtx, NodeResult } from '../bt/types';
import type { SnapEntity } from '../bot/types';
import type { BotPerception } from '../perception/types';
import type { ExchangeResult } from '../contract';

export const INTENTS = ['farm', 'poke', 'trade', 'fight', 'push', 'roam', 'gank', 'recall', 'objective', 'ward', 'group', 'catchLane'] as const;
export type IntentId = (typeof INTENTS)[number];

/** Value of one candidate: benefit and cost in gold over its horizon (s), the terms behind them (log). */
export interface CandidateValue {
  benefit: number;
  cost: number;
  horizonS: number;
  terms: Record<string, number>;
  /** Candidate-specific payload the intent subtree needs (target, lane, desire ...). */
  data?: IntentData;
}

export interface IntentData {
  target?: SnapEntity;
  slot?: 0 | 1 | 2 | 3;
  lane?: LaneName;
  kind?: 'trade' | 'allin';
  trigger?: string;
  ex?: ExchangeResult;
  exK?: ExchangeResult;
  /** Roam / gank evaluation handed to the starter (roams/roam.ts, ganks/jungle.ts). */
  roam?: unknown;
  gank?: unknown;
  /** Recall: shove the wave first (Silver+ shove-and-recall, §4.6). */
  shoveFirst?: boolean;
  /** Group: desire kind and whether the bot crashes the wave. */
  desire?: string;
  crash?: boolean;
}

/** A scored candidate after style, hysteresis and noise. */
export interface Scored {
  id: IntentId;
  raw: number;
  score: number;
  value: CandidateValue;
}

/** Shared per-decision inputs of the value functions (computed once). */
export interface World {
  n: NodeCtx;
  pv: BotPerception | null;
  tick: number;
  time: number;
  lane: LaneName | null;
  gankRisk: number;
  /** Expected gold/s of being present in the own lane (waves x cs share + XP). */
  laneRate: number;
  /** Own gold/s while alive (lane presence or jungle, floor from values). */
  ownRate: number;
  /** Gold the team loses if the bot dies now (enemy bounty + respawn x own rate + objective risk). */
  deathCost: number;
  /** Visible enemy minions in the own lane near the bot, with an estimated time to die (s). */
  minions: { m: SnapEntity; dieS: number; gold: number }[];
  /** Fraction of the lane value lost per second of absence (wave state). */
  absenceFrac: number;
  waveCrashed: boolean;
  waveAtOwnTower: boolean;
  /** Recall round trip (s): walk back from the fountain to the lane + channel. */
  recallTripS: number;
}

/** A candidate definition: precondition + value function (null = not a candidate now). */
export interface CandidateDef {
  id: IntentId;
  value(w: World): CandidateValue | null;
}

/** Intent executor: runs the intent's subtree; failure = the intent has nothing to do now. */
export type IntentRun = (n: NodeCtx, data: IntentData | undefined) => NodeResult;

/** Per-bot selector state (kept outside BotMemory: WeakMap in select.ts). */
export interface UtilityState {
  intent: IntentId | 'none';
  since: number;
  until: number;
  /** Last full evaluation tick (commit rule: re-evaluation every commitReevalS during a teamfight). */
  evalAt: number;
  last: Scored[];
  /** Ticks per intent (histogram) and switches. */
  hist: Partial<Record<IntentId | 'none', number>>;
  switches: number;
  lastTick: number;
  /** idle_after_shove rolled for the current crash of the own wave. */
  crashRolled: boolean;
}

/**
 * Plan objects of A1's reflex layer (docs/BRAIN-REWORK.md §3), stubbed until docs/agents/plan-api.md is published
 * on brain/a1-reflex. The utility model only reads plans (e.g. "last hit due") and never creates them.
 */
export interface PlanLike {
  kind: string;
  targetId: number;
  executeAtTick: number;
  validUntilTick: number;
  cancelTags?: string[];
}
