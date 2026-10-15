// Per-bot behaviour state of the tree leaves (trades, orbwalk, macro, player interaction) and the TeamAI handle.
// Kept separate from BotMemory's prototype fields so the bot memory contract only grows by one field.

import type { PingKind } from '../../sim/types';
import type { LaneName } from '../../sim/map';
import { newPerceptionState, type PerceptionState } from '../perception';

export interface TradeState {
  /** Enemy champion serial / entity id. */
  serial: number;
  id: number;
  kind: 'trade' | 'allin';
  start: number;
  trigger: string;
  combo: string[];
  step: number;
  /** Tick the current combo token was first tried (skip tokens that do not come up in time). */
  stepAt: number;
  comboDone: boolean;
  flash: boolean;
  ignite: boolean;
  /** Smoothed winProb over the trade (estimates are noisy per call). */
  win: number;
}

export interface WaveChoice {
  state: 'freeze' | 'slowPush' | 'crash' | 'hold' | 'default';
  at: number;
  reason: string;
}

/** A player/bot ping the bot reacts to (spec §9). */
export interface PingMemo {
  kind: PingKind;
  x: number;
  y: number;
  target: number;
  slot: number;
  until: number;
}

export interface BotExt {
  trade: TradeState | null;
  disengageUntil: number;
  lastTradeEnd: number;
  /** Own level last decision (power spike trigger). */
  level: number;
  levelUpAt: number;
  /** Enemy serial -> tick an enemy main ability (cast event) was seen (punish window). */
  enemyCastAt: Map<number, number>;
  /** Enemy serial -> tick it walked up to a minion that was about to die (CS window). */
  csWindowAt: Map<number, number>;
  /** Orbwalk bookkeeping: the attack start already planned for, counters for the style metrics. */
  orbPlanned: number;
  orb: { autos: number; ok: number; cancelled: number; wasted: number; stood: number };
  /** Finished trades: count and total seconds (style metrics). */
  trades: { n: number; s: number };
  /** Kills this life (overcommit / third kill errors). */
  killStreak: number;
  lastKillAt: number;
  ownKills: number;
  wave: WaveChoice;
  idleUntil: number;
  recallScoreAt: number;
  /** Teamfight join: tick the bot noticed a fight it wants to join (latency) and its spot. */
  joinSeenAt: number;
  /** Pings to react to (newest last) and own ping bookkeeping. */
  pings: PingMemo[];
  pingAt: number;
  chatAt: number;
  /** Player engage follow-up until tick (and target id). */
  followUntil: number;
  followTarget: number;
  /** Lane override from the team AI / player death (spec §9). */
  laneOverride: LaneName | null;
  splitting: boolean;
  roamAt: number;
  lastMode: string;
  /** Watchdog: tick since the bot stands still without orders. */
  stillSince: number;
  /** Agent L's perception memory (tracks, clouds, tactics of the gank/roam nodes). */
  perception: PerceptionState;
}

export const newExt = (): BotExt => ({
  trade: null,
  disengageUntil: 0,
  lastTradeEnd: -1e9,
  level: 0,
  levelUpAt: -1e9,
  enemyCastAt: new Map(),
  csWindowAt: new Map(),
  orbPlanned: -1,
  orb: { autos: 0, ok: 0, cancelled: 0, wasted: 0, stood: 0 },
  trades: { n: 0, s: 0 },
  killStreak: 0,
  lastKillAt: -1e9,
  ownKills: 0,
  wave: { state: 'default', at: -1e9, reason: '' },
  idleUntil: 0,
  recallScoreAt: -1e9,
  joinSeenAt: -1,
  pings: [],
  pingAt: -1e9,
  chatAt: -1e9,
  followUntil: 0,
  followTarget: -1,
  laneOverride: null,
  splitting: false,
  roamAt: -1e9,
  lastMode: '',
  stillSince: -1,
  perception: newPerceptionState(),
});

export type { TeamAI } from '../bot/teamai';
