// Plan objects of the reflex layer (docs/BRAIN-REWORK.md §3, contract in docs/agents/plan-api.md).
// A plan is plain data: what to do (cmd), when (executeAtTick), until when it is valid, which conditions the reflex
// layer re-checks every tick, and which cancel tags drop it. Nothing here reads the Sim.

import type { Command } from '../sim/types';

export type PlanKind = 'lastHit' | 'prehit' | 'prepare' | 'spellLastHit' | 'orbwalkMove';

export type CancelReason = 'minion_died' | 'prediction_drift' | 'out_of_range' | 'overridden_by_dodge' | 'intent_changed' | 'distracted' | 'expired';

export type Precondition = 'targetVisible' | 'targetAlive' | 'inWindow' | 'reachable' | 'notBusy' | 'intentFarm';

export interface Plan {
  id: number;
  kind: PlanKind;
  targetId: number;
  /** Tick at which reflex issues the command (own wind-up starts at executeAtTick + 1). */
  executeAtTick: number;
  validUntilTick: number;
  preconditions: Precondition[];
  cancelTags: string[];
  cmd: Command;
  createdTick: number;
  /** Timing error (ticks) rolled at creation, kept while validating. */
  biasTicks: number;
  /** Kill window [a, b) (recorded ticks, incl. bias) at the latest validation. */
  window?: { a: number; b: number };
}

/** Farm-plan kinds: the queue holds at most one of these for the next minion. */
export const FARM_KINDS: readonly PlanKind[] = ['lastHit', 'prehit', 'spellLastHit'];

/** Insert keeping the queue ordered by executeAtTick, ties by id (deterministic). */
export function insertPlan(plans: Plan[], p: Plan): void {
  let i = plans.length;
  while (i > 0 && (plans[i - 1]!.executeAtTick > p.executeAtTick || (plans[i - 1]!.executeAtTick === p.executeAtTick && plans[i - 1]!.id > p.id))) i--;
  plans.splice(i, 0, p);
}
