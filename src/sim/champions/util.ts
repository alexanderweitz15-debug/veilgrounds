// Small helpers shared by champion hook files (state maps, level scaling, rebuilt effect contexts).

import type { Sim } from '../sim';
import { Kind } from '../types';
import { abilityOf } from '../systems/abilities';
import type { EffectCtx } from './hooks';

/** Per-sim map stored in sim.state[key] (hook state keyed by entity id). */
export function hookState<T>(sim: Sim, key: string): Map<number, T> {
  let m = sim.state[key] as Map<number, T> | undefined;
  if (!m) sim.state[key] = m = new Map();
  return m;
}

/** Linear by champion level 1..18. */
export const byLevel = (sim: Sim, eid: number, lo: number, hi: number): number => lo + ((hi - lo) * (Math.max(1, sim.c.Champ.level[eid]!) - 1)) / 17;

/** Effect context for a later hit instance of an ability (hooks that resolve hits over time). */
export function ctxFor(sim: Sim, caster: number, slot: number, rank: number, x: number, y: number, hits: number[] = []): EffectCtx {
  const f = sim.c.Face;
  return { caster, slot, rank, ability: abilityOf(sim, caster, slot), hits, x, y, target: -1, phase: 'cast', dx: f.x[caster]!, dy: f.y[caster]!, cursorX: x, cursorY: y };
}

/** Champion or practice dummy. */
export const isChampLike = (sim: Sim, e: number): boolean => sim.c.Unit.kind[e] === Kind.Champion || sim.c.Unit.kind[e] === Kind.Dummy;
