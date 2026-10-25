// Item passives, actives and consumables (Phase 2, Agent I; data-driven engine: Agent A7, docs/ITEMS-FORMAT.md).
// What items do is data (items.json: passive.rules, active, use); engine.ts compiles and executes it. This file
// connects the engine to the sim: the hook list of a champion (champions/index.ts passiveHooksOf appends it to the
// champion's own passives, so every engine event reaches the items), per-tick upkeep (abilities system,
// tickItemsAndRunes), the item command (useItem) and queries other systems use. Numbers: docs/DECISIONS.md.

import type { Sim } from '../sim';
import { Kind, sec } from '../types';
import { canAttack } from '../buffs';
import { ITEM_SLOTS, inventory, itemById, itemStats } from './inventory';
import { runeHooksOf } from './runeHooks';
import { absorbLeft, counterOf, itemState, passiveHook, runUse, tickPools, type ItemHook } from './engine';
import type { ItemData } from './schema';

export type { ItemHook } from './engine';
export { startSecondWind, healPower } from './engine';

// ------------------------------------------------------------------ stat-driven hooks

/** Generic: healShieldPowerPct item stat (Hüterlampe) on outgoing ability heals/shields. */
const HEAL_POWER: ItemHook = {
  modifyHeal: (sim, eid, _t, amount) => amount * (1 + (itemStats(sim, eid).healShieldPowerPct ?? 0) / 100),
};

/** Generic: tenacityPct item stat on top of the tenacity buffs (Stats.tenacity is rebuilt every tick before this runs). */
const TENACITY: ItemHook = {
  onComputeStats(sim, eid) {
    sim.c.Stats.tenacity[eid] = Math.min(1, sim.c.Stats.tenacity[eid]! + (itemStats(sim, eid).tenacityPct ?? 0) / 100);
  },
};

// ------------------------------------------------------------------ dispatch

/**
 * Item hooks of a champion in inventory order, plus the stat-driven hooks. Unique passives: owned copies with the same
 * passive key (default: the item id) apply once; `stack: "stack"` passives apply per copy.
 */
export function itemHooksOf(sim: Sim, eid: number): ItemHook[] {
  const out: ItemHook[] = [];
  const seen = new Map<string, number>();
  let healPct = false;
  let tenacity = false;
  for (const id of inventory(sim, eid)) {
    const it = id ? itemById(id) : undefined;
    if (!it) continue;
    if (it.stats.healShieldPowerPct) healPct = true;
    if (it.stats.tenacityPct) tenacity = true;
    const p = it.passive;
    if (!p?.rules?.length) continue;
    const key = p.key ?? it.id;
    const n = seen.get(key) ?? 0;
    if (n > 0 && p.stack !== 'stack') continue;
    seen.set(key, n + 1);
    const h = passiveHook(it, n > 0 ? `${key}#${n + 1}` : key);
    if (h) out.push(h);
  }
  if (tenacity) out.push(TENACITY);
  if (healPct) out.push(HEAL_POWER);
  return out;
}

// Pure derived cache (hook object lists by inventory content), keyed by sim so parallel sims never share it.
const extraCache = new WeakMap<Sim, Map<number, { inv: (string | null)[]; list: ItemHook[] }>>();

/** Item + rune hooks of a champion entity; champions/index.ts passiveHooksOf appends these. */
export function extraHooksOf(sim: Sim, eid: number): ItemHook[] {
  let m = extraCache.get(sim);
  if (!m) extraCache.set(sim, (m = new Map()));
  const inv = inventory(sim, eid);
  const c = m.get(eid);
  if (c && c.inv.every((x, i) => x === inv[i])) return c.list;
  const list = [...itemHooksOf(sim, eid), ...runeHooksOf(sim, eid)];
  m.set(eid, { inv: [...inv], list });
  return list;
}

/** Per-tick upkeep for one champion (abilities system, after the champion's own onTick). */
export function tickItemsAndRunes(sim: Sim, eid: number): void {
  tickPools(sim, eid);
  for (const h of extraHooksOf(sim, eid)) h.onTick?.(sim, eid);
}

// ------------------------------------------------------------------ actives + consumables

/** Item command: use the active / consumable in inventory slot 0..5. Returns true if something happened. */
export function useItem(sim: Sim, eid: number, slot: number, x?: number, y?: number): boolean {
  const { Unit, Pos } = sim.c;
  if (!Unit.alive[eid] || Unit.kind[eid] !== Kind.Champion || !(slot >= 0 && slot < ITEM_SLOTS)) return false;
  const inv = inventory(sim, eid);
  const id = inv[slot];
  const it = id ? itemById(id) : undefined;
  if (!it) return false;
  const spec = it.active ?? (it.tier === 'consumable' ? it.use : undefined);
  if (!spec) return false;
  // failed actives report a castFail like abilities (HUD message + sound; issue from agent C, FEATURE-GAP 1.15)
  const fail = (reason: 'cooldown' | 'cc' | 'target'): false => (sim.events.push({ e: 'castFail', src: eid, slot, reason, item: true }), false);
  if (itemCooldownLeft(sim, eid, it.id) > 0) return fail('cooldown');
  if (!runUse(sim, eid, it, spec, x ?? Pos.x[eid]!, y ?? Pos.y[eid]!)) return fail(canAttack(sim, eid) ? 'target' : 'cc');
  if (it.active) {
    const s = itemState(sim);
    let m = s.cd.get(eid);
    if (!m) s.cd.set(eid, (m = new Map()));
    m.set(it.id, [sim.tick + sec(it.active.cooldown), sec(it.active.cooldown)]);
  }
  if (it.tier === 'consumable') inv[slot] = null;
  return true;
}

/** Ticks until the item's active is ready again (0 = ready). */
export function itemCooldownLeft(sim: Sim, eid: number, itemId: string): number {
  const cd = itemState(sim).cd.get(eid)?.get(itemId);
  return cd ? Math.max(0, cd[0] - sim.tick) : 0;
}

/** HUD: cooldown per inventory slot (7 entries, seconds; total 0 = no active). */
export function itemCooldownHud(sim: Sim, eid: number): { left: number; total: number }[] {
  return inventory(sim, eid).map((id) => {
    const it = id ? itemById(id) : undefined;
    if (!it?.active) return { left: 0, total: 0 };
    return { left: itemCooldownLeft(sim, eid, it.id) / 30, total: it.active.cooldown };
  });
}

// ------------------------------------------------------------------ queries for other systems

/** Lane-minion gold multiplier for a champion (Jägerzahn: 50 % until 14:00). economy.ts minionDeath. */
export function minionGoldMult(sim: Sim, eid: number): number {
  let mult = 1;
  const seen = new Set<string>();
  for (const id of inventory(sim, eid)) {
    const p = id ? itemById(id)?.passive : undefined;
    if (!p?.laneMinionGold || sim.tick >= sec(p.laneMinionGold.untilSeconds)) continue;
    const key = p.key ?? id!;
    if (seen.has(key)) continue;
    seen.add(key);
    mult *= p.laneMinionGold.mult;
  }
  return mult;
}

/** Does the champion own an item whose passive quest (passive.quest) is done? */
export function questDone(sim: Sim, eid: number, item: ItemData): boolean {
  const q = item.passive?.quest;
  return !!q && counterOf(sim, eid, item, q.counter) >= q.goal;
}

/** Giving Lamp quest (500 gold earned) done: Agent J grants +1 ward charge. */
export function givingLampQuestDone(sim: Sim, eid: number): boolean {
  const it = itemById('spenderlampe');
  return !!it && questDone(sim, eid, it);
}

/** Remaining Storm Mantle absorb (for tests/HUD). */
export function stormMantleLeft(sim: Sim, eid: number): number {
  const it = itemById('sturmgewand');
  return it ? absorbLeft(sim, eid, it) : 0;
}
