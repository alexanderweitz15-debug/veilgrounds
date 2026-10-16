// Per-bot state of the reflex layer (docs/agents/plan-api.md §5). Kept outside BotMemory (WeakMap keyed by the
// memory object) so the shared bot memory contract does not change. Read-only for A2 / A3 except `attention`.

import type { LaneName, Pt } from '../../sim/map';
import type { BotMemory } from '../bot/types';
import type { Plan } from '../plan';

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
  attention?: AttentionProbe;
}

const STATES = new WeakMap<BotMemory, ReflexState>();

export function reflexState(mem: BotMemory): ReflexState {
  let s = STATES.get(mem);
  if (!s) {
    s = {
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
export function reflexDebug(mem: BotMemory, tick: number): { intent: string; plans: { kind: string; targetId: number; inTicks: number }[]; util30s: number; stand: Pt | null } {
  const s = reflexState(mem);
  return {
    intent: s.intent ? `${s.intent.kind}:${s.intent.lane}:${s.intent.wave}` : 'none',
    plans: s.plans.map((p) => ({ kind: p.kind, targetId: p.targetId, inTicks: p.executeAtTick - tick })),
    util30s: util30s(s),
    stand: s.stand,
  };
}
