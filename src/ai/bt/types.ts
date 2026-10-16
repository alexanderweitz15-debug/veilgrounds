// Behaviour tree types (main spec §7: trees as data). A tree is JSON (src/data/bots/tree.json) made of standard
// nodes; leaves are named TypeScript functions looked up in a registry at load time (unknown names throw).
// Node state lives per bot in BotMemory.bt (one compiled tree is shared by all bots).

import type { Rng } from '../../sim/rng';
import type { BotParams, DecisionLogEntry, ErrorId, PerceptionView } from '../contract';
import type { BotAction, BotMemory, BotStatic, Snapshot } from '../bot/types';
import type { View } from '../bot/perception';

export type NodeResult = 'success' | 'failure' | 'running';

/** JSON node definition. */
export interface NodeDef {
  type: 'selector' | 'sequence' | 'parallel' | 'condition' | 'action' | 'cooldown' | 'reaction' | 'gate' | 'inverter';
  /** Stable id for per-bot node state and logs (required for decorators; defaults to name). */
  id?: string;
  /** Leaf name (condition/action) or score name (gate) in the registry. */
  name?: string;
  children?: NodeDef[];
  child?: NodeDef;
  /** parallel: 'all' = success if all succeed, 'one' = success if any succeeds, 'always' = success. */
  policy?: 'all' | 'one' | 'always';
  /** cooldown: seconds; optional knob multiplier (BotParams.knobs[scale]); 'any' = also after failure. */
  s?: number;
  scale?: string;
  on?: 'success' | 'any';
  /** gate: activation threshold (or a knob name) and minimum dwell before switching again (s). */
  threshold?: number | string;
  dwellS?: number;
  comment?: string;
}

/** Everything a node may read or write during one decision. Never the Sim. */
export interface NodeCtx {
  snap: Snapshot;
  v: View;
  ctx: BotStatic;
  mem: BotMemory;
  rng: Rng;
  p: BotParams;
  /** Perception layer (Agent L) or the local stub until it exists. */
  pv: PerceptionView;
  /** Commands of this decision. */
  out: BotAction[];
  /** Decision log (spec §1): every decision with inputs and reason. Returns the entry tick (chat refs). */
  log(node: string, chosen: string, reason: string, inputs?: DecisionLogEntry['inputs'], scores?: Record<string, number>, err?: ErrorId): number;
}

export type ActionFn = (n: NodeCtx) => NodeResult;
export type ConditionFn = (n: NodeCtx) => boolean;
/** Gate score: a utility in 0..1 (or any scale matching the gate threshold). */
export type ScoreFn = (n: NodeCtx) => number;

export interface Registry {
  actions: Record<string, ActionFn>;
  conditions: Record<string, ConditionFn>;
  scores: Record<string, ScoreFn>;
}

/** Per-bot node state (cooldowns, reaction timers, gates, running child). */
export interface NodeState {
  until?: number;
  readyAt?: number;
  on?: boolean;
  since?: number;
  running?: string;
  /** Teamfight focus: per-enemy-serial focus-score error rolled once per fight (rank focus quality). */
  err?: Record<number, number>;
}
