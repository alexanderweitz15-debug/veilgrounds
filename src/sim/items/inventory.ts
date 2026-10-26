// Inventory + shop rules (Agent H). 6 item slots + trinket slot (index 6, unused for now).
// Buy/sell only inside the own fountain circle (or while dead, like LoL). Recipes consume owned direct components
// and cost `cost - sum(consumed component costs)`. Selling refunds 70 % of the full item cost.
// ponytail: recipe discount looks at direct components only (no component-of-component discount); consumables
// do not stack (one per slot). Passives/actives/consumable use: itemHooks.ts; rune stats: runeHooks.ts.

import itemsJson from '../../data/items.json';
import type { Sim } from '../sim';
import type { ItemData, ItemStat } from './schema';
import { hasBuff } from '../buffs';
import { dist2 } from '../vec';
import { drakeState } from '../systems/jungle';
import { drakeBonus } from '../drakes';
import { bootsPriceMult, runeStats } from './runeHooks';

export const ITEMS = itemsJson.items as unknown as ItemData[];
const BY_ID = new Map(ITEMS.map((i) => [i.id, i]));
export const itemById = (id: string): ItemData | undefined => BY_ID.get(id);

export const ITEM_SLOTS = 6;
export const TRINKET_SLOT = 6;
export const SELL_RATIO = 0.7;
/** Gold a sale returns (70 % of the full cost; +1e-9 keeps 350 * 0.7 = 244.999... at 245). */
export const sellValue = (id: string): number => Math.floor((itemById(id)?.cost ?? 0) * SELL_RATIO + 1e-9);

export type Inventory = (string | null)[];

function invState(sim: Sim): Map<number, Inventory> {
  let s = sim.state.inventory as Map<number, Inventory> | undefined;
  if (!s) sim.state.inventory = s = new Map();
  return s;
}

/** Inventory of a champion (7 entries, null = empty). Champion eids are never recycled. */
export function inventory(sim: Sim, eid: number): Inventory {
  const s = invState(sim);
  let inv = s.get(eid);
  if (!inv) s.set(eid, (inv = [null, null, null, null, null, null, null]));
  return inv;
}

export function inFountain(sim: Sim, eid: number): boolean {
  const { Unit, Pos } = sim.c;
  const f = sim.map.sides[Unit.team[eid]!]?.fountain;
  return !!f && dist2(Pos.x[eid]!, Pos.y[eid]!, f.x, f.y) <= f.r * f.r;
}

/** Shop access: alive in the own fountain, or dead (respawn happens there anyway). */
export const canShop = (sim: Sim, eid: number): boolean => !sim.c.Unit.alive[eid] || inFountain(sim, eid);

export interface BuyQuote {
  ok: boolean;
  reason?: 'unknown' | 'notInShop' | 'unique' | 'full' | 'gold';
  price: number;
  /** Inventory slots consumed as components. */
  consumes: number[];
}

/** Recipe price of `item` given an inventory (pure; the shop UI uses it on snapshot data too). */
export function recipePrice(inv: readonly (string | null)[], item: ItemData): { price: number; consumes: number[] } {
  // LoL rule, recursive: an owned component counts with its full cost; a missing component may still be partly
  // covered by owned sub-components (e.g. Langschwert towards Spitzhacke towards Sturmbogen).
  const consumes: number[] = [];
  const cover = (it: ItemData): number => {
    let covered = 0;
    for (const comp of it.from) {
      const slot = inv.findIndex((x, i) => i < ITEM_SLOTS && x === comp && !consumes.includes(i));
      if (slot >= 0) {
        consumes.push(slot);
        covered += itemById(comp)?.cost ?? 0;
      } else {
        const sub = itemById(comp);
        if (sub) covered += cover(sub);
      }
    }
    return covered;
  };
  const price = item.cost - cover(item);
  return { price: Math.max(0, price), consumes };
}

/** What buying `id` would cost right now, and whether it is allowed. */
export function quote(sim: Sim, eid: number, id: string): BuyQuote {
  const item = itemById(id);
  if (!item) return { ok: false, reason: 'unknown', price: 0, consumes: [] };
  const inv = inventory(sim, eid);
  const r = recipePrice(inv, item);
  const { consumes } = r;
  // ponytail: the Inspiration boots discount is sim-side only; the shop UI (recipePrice on snapshot data) shows full price
  const price = item.tier === 'boots' ? Math.round(r.price * bootsPriceMult(sim, eid)) : r.price;
  const res = (reason?: BuyQuote['reason']): BuyQuote => ({ ok: !reason, reason, price, consumes });
  if (!canShop(sim, eid)) return res('notInShop');
  if (item.unique && inv.some((x, i) => x && !consumes.includes(i) && itemById(x)?.unique === item.unique)) return res('unique');
  // LoL rule: at most one of each legendary item
  if (item.tier === 'legendary' && inv.some((x, i) => x === item.id && !consumes.includes(i))) return res('unique');
  const free = inv.some((x, i) => i < ITEM_SLOTS && (x === null || consumes.includes(i)));
  if (!free) return res('full');
  if (sim.c.Champ.gold[eid]! < price) return res('gold');
  return res();
}

// ------------------------------------------------------------------ undo ledger (G/B1, LoL shop "Rückgängig")

/** One shop transaction: the inventory before it and the gold it moved (+ paid on a buy, - received on a sell). */
interface LedgerEntry {
  inv: Inventory;
  gold: number;
}
export const UNDO_MAX = 10;

function ledger(sim: Sim, eid: number): LedgerEntry[] {
  let s = sim.state.undo as Map<number, LedgerEntry[]> | undefined;
  if (!s) sim.state.undo = s = new Map();
  let l = s.get(eid);
  if (!l) s.set(eid, (l = []));
  return l;
}

function record(sim: Sim, eid: number, inv: Inventory, gold: number): void {
  const l = ledger(sim, eid);
  l.push({ inv: [...inv], gold });
  if (l.length > UNDO_MAX) l.shift();
}

/** Buys/sells that can still be reverted (snapshot `me.undo`). */
export const undoDepth = (sim: Sim, eid: number): number => (sim.state.undo as Map<number, LedgerEntry[]> | undefined)?.get(eid)?.length ?? 0;

/** Leaving the fountain or using an item ends the undo window (itemHooks.ts calls this). */
export function clearUndo(sim: Sim, eid: number): void {
  (sim.state.undo as Map<number, LedgerEntry[]> | undefined)?.get(eid)?.splice(0);
}

/**
 * Revert the last buy or sell: the inventory returns to its state before it, the gold moves back. Only in the shop
 * (fountain or dead); undoing a sell needs the sale gold to still be there.
 */
export function undoLast(sim: Sim, eid: number): boolean {
  if (!canShop(sim, eid)) return false;
  const l = ledger(sim, eid);
  const e = l[l.length - 1];
  if (!e) return false;
  const gold = sim.c.Champ.gold[eid]! + e.gold;
  if (gold < 0) return false; // sold, spent the gold elsewhere: cannot take the sale back
  l.pop();
  const inv = inventory(sim, eid);
  for (let i = 0; i < inv.length; i++) inv[i] = e.inv[i] ?? null;
  sim.c.Champ.gold[eid] = gold;
  return true;
}

export function buyItem(sim: Sim, eid: number, id: string): boolean {
  const q = quote(sim, eid, id);
  if (!q.ok) return false;
  const inv = inventory(sim, eid);
  record(sim, eid, inv, q.price);
  for (const s of q.consumes) inv[s] = null;
  const slot = inv.findIndex((x, i) => i < ITEM_SLOTS && x === null);
  inv[slot] = id;
  sim.c.Champ.gold[eid] = sim.c.Champ.gold[eid]! - q.price;
  return true;
}

export function sellItem(sim: Sim, eid: number, slot: number): boolean {
  const inv = inventory(sim, eid);
  const id = inv[slot];
  if (!id || !canShop(sim, eid)) return false;
  const refund = sellValue(id);
  record(sim, eid, inv, -refund);
  inv[slot] = null;
  sim.c.Champ.gold[eid] = sim.c.Champ.gold[eid]! + refund;
  return true;
}

export type BonusStat = ItemStat | 'adPct' | 'apPct';

/** Summed plain stats of all owned items. */
export function itemStats(sim: Sim, eid: number): Partial<Record<ItemStat, number>> {
  const out: Partial<Record<ItemStat, number>> = {};
  for (const id of inventory(sim, eid)) {
    const it = id ? itemById(id) : undefined;
    if (!it) continue;
    for (const [k, v] of Object.entries(it.stats) as [ItemStat, number][]) out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

/** Inventory value (sum of full item costs); scoreboard shows this for enemies instead of gold. */
export function itemValue(sim: Sim, eid: number): number {
  let v = 0;
  for (const id of inventory(sim, eid)) if (id) v += itemById(id)?.cost ?? 0;
  return v;
}

const SECONDARY = [
  ['crit', 'critPct', 0.01],
  ['lifesteal', 'lifestealPct', 0.01],
  ['lethality', 'lethality', 1],
  ['haste', 'haste', 1],
] as const;

/**
 * Crit/lifesteal/lethality/haste are not recomputed from a base each tick (hooks/tests may write them), so the
 * item part is applied as a delta against what this function added last time.
 */
export function applySecondaryStats(sim: Sim, eid: number, it: Partial<Record<BonusStat, number>>): void {
  let s = sim.state.itemSecondary as Map<number, number[]> | undefined;
  if (!s) sim.state.itemSecondary = s = new Map();
  const prev = s.get(eid) ?? [0, 0, 0, 0];
  const next = SECONDARY.map(([, k, f]) => (it[k] ?? 0) * f);
  SECONDARY.forEach(([field], i) => {
    sim.c.Stats[field][eid] = sim.c.Stats[field][eid]! - prev[i]! + next[i]!;
  });
  s.set(eid, next);
}

/** Dornenbock buff: ~15 % CDR (haste 18) and doubled mana regen. */
export const DORNENBOCK_HASTE = 18;
export const DORNENBOCK_MANA_REGEN_PCT = 100;
/** Items + runes + jungle buffs; stats.ts folds these into the champion stat computation. */
export function bonusStats(sim: Sim, eid: number): Partial<Record<BonusStat, number>> {
  const out: Partial<Record<BonusStat, number>> = itemStats(sim, eid);
  for (const [k, v] of Object.entries(runeStats(sim, eid)) as [BonusStat, number][]) out[k] = (out[k] ?? 0) + v;
  if (hasBuff(sim, eid, 'mark', 'dornenbock')) {
    out.haste = (out.haste ?? 0) + DORNENBOCK_HASTE;
    out.manaRegenPct = (out.manaRegenPct ?? 0) + DORNENBOCK_MANA_REGEN_PCT;
  }
  // elemental Leviathan kills + soul of the team (src/data/drakes.json)
  for (const [k, v] of Object.entries(drakeBonus(drakeState(sim), sim.c.Unit.team[eid]!)) as [BonusStat, number][]) out[k] = (out[k] ?? 0) + v;
  return out;
}
