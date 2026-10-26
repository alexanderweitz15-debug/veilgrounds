// Recommended-items plan for the shop (G/B2, LoL "Empfohlen": Start / Stiefel / Kern in Kaufreihenfolge / Situativ,
// the next core item highlighted, quick buy = the best affordable step toward it). DOM-free so tests can run it.
import type { BuildData } from '../ai/bot/builds';
import type { ItemData } from '../sim/items/schema';
import { ITEM_SLOTS, recipePrice } from '../sim/items/inventory';

export type Situation = 'ad' | 'ap';

export interface RecPlan {
  starter: string[];
  /** Standard boots first, then the situational alternatives that differ. */
  boots: { id: string; vs?: Situation }[];
  /** Core items in buy order; `next` = the first one not owned yet. */
  core: { id: string; owned: boolean; next: boolean }[];
  /** Core items of the vsAD / vsAP variants that are not in the standard core. */
  situational: { id: string; vs: Situation }[];
  /** The core item to work toward (null = the standard build is complete). */
  target: string | null;
  /** Best affordable purchase toward `target` right now: the item itself or the first missing component. */
  nextBuy: string | null;
}

/** A champion owns an item when it sits in an item slot (the trinket slot does not count). */
export const owns = (inv: readonly (string | null)[], id: string): boolean => inv.some((x, i) => i < ITEM_SLOTS && x === id);

/**
 * Best affordable step toward `target`: the whole item at its recipe price if the gold suffices, else (depth first,
 * recipe order) the first missing component that is affordable. Components already in the inventory are skipped
 * once each, so two Langschwerter in a recipe need two in the bag.
 */
export function nextPurchase(inv: readonly (string | null)[], gold: number, target: ItemData, byId: (id: string) => ItemData | undefined): string | null {
  if (recipePrice(inv, target).price <= gold) return target.id;
  const pool = inv.slice(0, ITEM_SLOTS);
  const take = (id: string): boolean => {
    const k = pool.indexOf(id);
    if (k < 0) return false;
    pool[k] = null;
    return true;
  };
  const walk = (it: ItemData): string | null => {
    for (const c of it.from) {
      if (take(c)) continue;
      const sub = byId(c);
      if (!sub) continue;
      if (recipePrice(inv, sub).price <= gold) return sub.id;
      const deeper = walk(sub);
      if (deeper) return deeper;
    }
    return null;
  };
  return walk(target);
}

export function recommendedPlan(build: BuildData, inv: readonly (string | null)[], gold: number, byId: (id: string) => ItemData | undefined): RecPlan {
  const starter = build.starter.filter((id) => byId(id));
  const boots: RecPlan['boots'] = [{ id: build.standard.boots }];
  for (const [vs, v] of [['ad', build.vsAD], ['ap', build.vsAP]] as const) {
    if (v && v.boots !== build.standard.boots && !boots.some((b) => b.id === v.boots)) boots.push({ id: v.boots, vs });
  }
  let next = true;
  const core = build.standard.core.map((id) => {
    const owned = owns(inv, id);
    const row = { id, owned, next: !owned && next };
    if (!owned) next = false;
    return row;
  });
  const situational: RecPlan['situational'] = [];
  for (const [vs, v] of [['ad', build.vsAD], ['ap', build.vsAP]] as const) {
    for (const id of v?.core ?? []) if (!build.standard.core.includes(id) && !situational.some((s) => s.id === id)) situational.push({ id, vs });
  }
  const target = core.find((c) => c.next)?.id ?? null;
  const t = target ? byId(target) : undefined;
  return { starter, boots, core, situational, target, nextBuy: t ? nextPurchase(inv, gold, t, byId) : null };
}
