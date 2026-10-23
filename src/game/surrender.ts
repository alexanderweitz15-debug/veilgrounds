// Client side of the surrender vote (S1, FEATURE-GAP 2.10): folds the team-private `ff` events into the current vote.
import type { SimEvent } from '../sim/types';

type FfEvent = Extract<SimEvent, { e: 'ff' }>;

export interface FfView {
  yes: number[];
  no: number[];
  voters: number[];
  need: number;
  /** Tick the vote times out. */
  until: number;
}

/** Vote after one event: start/vote replace it, pass/fail close it, denied changes nothing. */
export function ffReduce(view: FfView | null, ev: FfEvent): FfView | null {
  if (ev.phase === 'pass' || ev.phase === 'fail') return null;
  if (ev.phase === 'denied') return view;
  return { yes: ev.yes, no: ev.no, voters: ev.voters, need: ev.need, until: ev.until };
}

export const myVote = (v: FfView, slot: number): 'yes' | 'no' | null => (v.yes.includes(slot) ? 'yes' : v.no.includes(slot) ? 'no' : null);

/** Whole seconds left (never negative). */
export const ffSecondsLeft = (v: FfView, tick: number, hz = 30): number => Math.max(0, Math.ceil((v.until - tick) / hz));
