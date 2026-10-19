// Gold efficiency of an item's stats (C7, FEATURE-GAP 5.3; LoL wiki method): gold value of its stats / its cost.
// Gold per stat point comes from the cheapest basic item that gives only that stat (boots for flat move speed);
// stats without such an item use the reference values in goldValues.json. Passives/actives are not priced.
import itemsJson from '../data/items.json';
import values from './goldValues.json';
import type { ItemData } from '../sim/items/schema';

const ITEMS = itemsJson.items as unknown as ItemData[];

let table: Record<string, number> | null = null;

/** Gold per point of each stat key. */
export function goldPerStat(): Record<string, number> {
  if (table) return table;
  const t: Record<string, number> = { ...(values.reference as Record<string, number>) };
  for (const it of ITEMS) {
    const keys = Object.keys(it.stats);
    if (keys.length !== 1 || (it.tier !== 'basic' && it.tier !== 'boots')) continue;
    const k = keys[0]!;
    const per = it.cost / (it.stats as Record<string, number>)[k]!;
    if (t[k] === undefined || per < t[k]!) t[k] = per;
  }
  return (table = t);
}

/** Gold value of the item's stats and its efficiency in percent (null for free items or items without stats). */
export function goldEfficiency(item: ItemData): { value: number; pct: number } | null {
  const per = goldPerStat();
  let value = 0;
  let priced = false;
  for (const [k, v] of Object.entries(item.stats) as [string, number][]) {
    const g = per[k];
    if (g === undefined) continue;
    value += g * v;
    priced = true;
  }
  if (!priced || item.cost <= 0) return null;
  return { value: Math.round(value), pct: Math.round((100 * value) / item.cost) };
}
