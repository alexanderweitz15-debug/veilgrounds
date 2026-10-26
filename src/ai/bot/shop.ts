// Shop: buy along src/data/builds/<champ>.json (starter, then per core item its components in `from` order,
// boots after the first core item). Only in the fountain.
// ponytail: inventory is not in the snapshot yet, so the bot tracks its own plan pointer and detects a no-op shop
// via gold deltas ("phantom gold"). Upgrade: read the inventory from the HUD once Agent H exposes it, and
// situational builds (vsAD/vsAP, adaptiveBuildPct) for higher ranks.

import itemsJson from '../../data/items.json';
import type { BotAction, BotMemory, BotStatic, PlayerHud } from './types';
import { utilityOn } from '../utility/flag';

interface ItemRow {
  id: string;
  cost: number;
  from: string[];
  tier: string;
  unique?: string;
}
const ITEMS = new Map((itemsJson.items as ItemRow[]).map((i) => [i.id, i]));

const expand = (id: string): string[] => [...(ITEMS.get(id)?.from ?? []).flatMap(expand), id];

const planCache = new Map<string, string[]>();
/**
 * Ordered purchase list for a champion. Beta brain (utility flag): the tier-2 boots are bought via their base boots
 * (A14: the plain entry was priced as upgrade-only 800 while the sim charges the full 1100 without the base boots,
 * so a bot with 800..1100 gold had the purchase refused and the shop's phantom-gold logic hid 800 gold for the rest
 * of the game - items and recalls on gold were delayed for good). The default brain keeps the old plan.
 */
export function buildPlan(ctx: BotStatic): string[] {
  const b = ctx.build;
  if (!b) return [];
  const beta = utilityOn(ctx);
  const key = beta ? `${b.champion}:beta` : b.champion;
  let plan = planCache.get(key);
  if (!plan) {
    const core = b.standard.core;
    plan = [...b.starter, ...(core[0] ? expand(core[0]) : []), ...(beta ? expand(b.standard.boots) : [b.standard.boots]), ...core.slice(1).flatMap(expand)].filter((id) => ITEMS.has(id));
    planCache.set(key, plan);
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

/** Beta brain: decisions still to wait before a buy batch is settled. The bot's snapshot is a reaction time old, so
 *  the gold it sees right after the order is still the old one; settling at once flagged a successful purchase as a
 *  no-op (phantom gold). Two decisions are >= the reaction time of every rank. */
const betaBuy = new WeakMap<BotMemory, number>();
const SETTLE_AFTER_DECISIONS = 2;

/** Beta brain: own items as of the latest decision (nextItemPrice has no HUD parameter). */
const itemsOf = new WeakMap<BotMemory, readonly (string | null)[]>();

/**
 * Beta brain: a plan entry the bot must not buy. The sim refuses a second item of the same unique group
 * (boots, starter): the Inspiration rune gives free boots at 12:00, after which the plan's boots were refused, the
 * shop flagged the refusal as phantom gold and hid the price of the entry for good (A14).
 */
function blocked(items: readonly (string | null)[] | undefined, id: string): boolean {
  const it = ITEMS.get(id);
  if (!it || !items) return false;
  return !!it.unique && items.some((x, i) => i < 6 && !!x && ITEMS.get(x)?.unique === it.unique);
}

/** Called every decision: settle a pending buy (did the sim actually charge?). */
export function settleBuys(me: PlayerHud, mem: BotMemory): void {
  if (betaBuy.has(mem)) itemsOf.set(mem, me.items);
  if (!mem.pendingBuy) return;
  const wait = betaBuy.get(mem) ?? 0;
  if (wait > 0) {
    betaBuy.set(mem, wait - 1);
    return;
  }
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
  const beta = utilityOn(ctx);
  if (beta) {
    betaBuy.set(mem, betaBuy.get(mem) ?? 0);
    itemsOf.set(mem, me.items);
  }
  // items bought in this batch count as owned for the next entries (boots then their upgrade is no conflict: the
  // upgrade consumes the base boots)
  while (mem.buyIdx < plan.length && out.length < 6) {
    const id = plan[mem.buyIdx]!;
    if (beta && blocked(me.items, id)) {
      mem.buyIdx++;
      continue;
    }
    const p = itemPrice(id);
    if (p > gold) break;
    out.push({ cmd: { t: 'buy', item: id }, delay: out.length });
    gold -= p;
    cost += p;
    mem.buyIdx++;
  }
  if (cost > 0) mem.pendingBuy = { goldBefore: me.gold, cost };
  if (cost > 0 && utilityOn(ctx)) betaBuy.set(mem, SETTLE_AFTER_DECISIONS);
  return out;
}

/** Price of the next planned item (for "recall when I can afford something"). */
export function nextItemPrice(ctx: BotStatic, mem: BotMemory): number {
  const plan = buildPlan(ctx);
  let i = mem.buyIdx;
  if (utilityOn(ctx)) while (i < plan.length && blocked(itemsOf.get(mem), plan[i]!)) i++;
  return i < plan.length ? itemPrice(plan[i]!) : Infinity;
}
