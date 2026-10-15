// Shop: buy along src/data/builds/<champ>.json (starter, then per core item its components in `from` order,
// boots after the first core item). Only in the fountain.
// ponytail: inventory is not in the snapshot yet, so the bot tracks its own plan pointer and detects a no-op shop
// via gold deltas ("phantom gold"). Upgrade: read the inventory from the HUD once Agent H exposes it, and
// situational builds (vsAD/vsAP, adaptiveBuildPct) for higher ranks.

import itemsJson from '../../data/items.json';
import type { BotAction, BotMemory, BotStatic, PlayerHud } from './types';

interface ItemRow {
  id: string;
  cost: number;
  from: string[];
  tier: string;
}
const ITEMS = new Map((itemsJson.items as ItemRow[]).map((i) => [i.id, i]));

const expand = (id: string): string[] => [...(ITEMS.get(id)?.from ?? []).flatMap(expand), id];

const planCache = new Map<string, string[]>();
/** Ordered purchase list for a champion. */
export function buildPlan(ctx: BotStatic): string[] {
  const b = ctx.build;
  if (!b) return [];
  let plan = planCache.get(b.champion);
  if (!plan) {
    const core = b.standard.core;
    plan = [...b.starter, ...(core[0] ? expand(core[0]) : []), b.standard.boots, ...core.slice(1).flatMap(expand)].filter((id) => ITEMS.has(id));
    planCache.set(b.champion, plan);
  }
  return plan;
}

/** Price when its direct components were bought before (plan order guarantees that). */
export function itemPrice(id: string): number {
  const it = ITEMS.get(id);
  if (!it) return Infinity;
  return Math.max(0, it.cost - it.from.reduce((s, c) => s + (ITEMS.get(c)?.cost ?? 0), 0));
}

/** Gold the bot believes it can spend. */
export const spendable = (me: PlayerHud, mem: BotMemory): number => me.gold - mem.phantomGold;

/** Called every decision: settle a pending buy (did the sim actually charge?). */
export function settleBuys(me: PlayerHud, mem: BotMemory): void {
  if (!mem.pendingBuy) return;
  if (me.gold > mem.pendingBuy.goldBefore - mem.pendingBuy.cost * 0.5) mem.phantomGold += mem.pendingBuy.cost;
  mem.pendingBuy = null;
}

/** Issue all affordable next purchases (once per fountain visit). */
export function shop(me: PlayerHud, ctx: BotStatic, mem: BotMemory): BotAction[] {
  if (mem.shopVisitDone) return [];
  mem.shopVisitDone = true;
  const plan = buildPlan(ctx);
  const out: BotAction[] = [];
  let gold = spendable(me, mem);
  let cost = 0;
  while (mem.buyIdx < plan.length && out.length < 6) {
    const id = plan[mem.buyIdx]!;
    const p = itemPrice(id);
    if (p > gold) break;
    out.push({ cmd: { t: 'buy', item: id }, delay: out.length });
    gold -= p;
    cost += p;
    mem.buyIdx++;
  }
  if (cost > 0) mem.pendingBuy = { goldBefore: me.gold, cost };
  return out;
}

/** Price of the next planned item (for "recall when I can afford something"). */
export function nextItemPrice(ctx: BotStatic, mem: BotMemory): number {
  const plan = buildPlan(ctx);
  return mem.buyIdx < plan.length ? itemPrice(plan[mem.buyIdx]!) : Infinity;
}
