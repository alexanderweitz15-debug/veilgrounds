// Per-bot state of the reflex layer (docs/agents/plan-api.md §5). Kept outside BotMemory (WeakMap keyed by the
// memory object) so the shared bot memory contract does not change. Read-only for A2 / A3 except `attention`.

import type { LaneName, Pt } from '../../sim/map';
import type { BotMemory } from '../bot/types';
import type { Plan, ReflexDebug } from '../plan';

/** Lane intent set by the decision (laneLeaf); the runner clears it before every think. */
export interface LaneIntent {
  kind: 'laneFarm';
  lane: LaneName;
  wave: 'push' | 'neutral' | 'slowPush' | 'freeze' | 'hold';
  farm: boolean;
  pushMinions: boolean;
  hitStructures: boolean;
  harass: boolean;
  behind: number;
  /** Support / special stand point (used instead of the lane stand point). */
  side?: Pt;
  setTick: number;
}

/** A3 hook (§9): pure function of the bot's own attention state; must not draw from the bot's rng. */
export type AttentionProbe = (tick: number) => { distracted: boolean; reason?: string } | null;

/** Utilisation window: 30 s of ticks. */
export const UTIL_WINDOW = 900;

export interface ReflexState {
  /** Reflex layer on for this bot (RunnerOptions.reflex; off = pre-rework laneLeaf). */
  enabled: boolean;
  intent: LaneIntent | null;
  plans: Plan[];
  issued: { plan: Plan; tick: number }[];
  nextPlanId: number;
  util: Uint8Array;
  utilIdx: number;
  utilSum: number;
  utilTick: number;
  stand: Pt | null;
  /** Last move order of the stand-point logic (spatial hysteresis). */
  standMove: Pt | null;
  lastCmdTick: number;
  harass: { autos: number[] };
  /** Orbwalk bookkeeping: wind-up start (recorded tick) already handled for the backswing move. */
  orbHandled: number;
  /** Latest attack command of the reflex layer (the wind-up shows one tick later: no second attack meanwhile). */
  attackCmd: { target: number; tick: number } | null;
  /** Issued last hit not yet thrown (walking in / timer): the reflex layer waits for it. */
  inflight: { target: number; tick: number } | null;
  /** Filler target chosen by the scheduler (stand moves wait while it is being attacked). */
  filler: number;
  /** Window-preparation rolls per minion pair (rolled once per pair). */
  prepRolls: Map<string, boolean>;
  /** Counters for tests / bot-sim: moves or stops issued during the own wind-up by the reflex layer (must stay 0
   *  except orbwalk timing errors), orbwalk early cancels, plans executed, cancels by reason. */
  stats: { windupBreaks: number; orbEarly: number; executed: number; cancels: Record<string, number>; fillers: number; prepares: number };
  attention?: AttentionProbe;
}

const STATES = new WeakMap<BotMemory, ReflexState>();

export function reflexState(mem: BotMemory): ReflexState {
  let s = STATES.get(mem);
  if (!s) {
    s = {
      enabled: false,
      intent: null,
      plans: [],
      issued: [],
      nextPlanId: 1,
      util: new Uint8Array(UTIL_WINDOW),
      utilIdx: 0,
      utilSum: 0,
      utilTick: -1,
      stand: null,
      standMove: null,
      lastCmdTick: -1,
      harass: { autos: [] },
      orbHandled: -1,
      attackCmd: null,
      inflight: null,
      filler: -1,
      prepRolls: new Map(),
      stats: { windupBreaks: 0, orbEarly: 0, executed: 0, cancels: {}, fillers: 0, prepares: 0 },
      attention: undefined,
    };
    STATES.set(mem, s);
  }
  return s;
}

export const setIntent = (mem: BotMemory, intent: LaneIntent): void => {
  reflexState(mem).intent = intent;
};
export const getIntent = (mem: BotMemory): LaneIntent | null => reflexState(mem).intent;
export const clearIntent = (mem: BotMemory): void => {
  reflexState(mem).intent = null;
};

/** Share 0..1 of the last 30 s with the own attack cycle running. */
export const util30s = (s: ReflexState): number => s.utilSum / UTIL_WINDOW;

/** F9 overlay / A2 read view. */
export function reflexDebug(mem: BotMemory, tick: number): ReflexDebug {
  const s = reflexState(mem);
  return {
    intent: s.intent ? `${s.intent.kind}:${s.intent.lane}:${s.intent.wave}` : 'none',
    plans: s.plans.map((p) => ({ kind: p.kind, targetId: p.targetId, inTicks: p.executeAtTick - tick })),
    util30s: util30s(s),
    stand: s.stand,
  };
}
