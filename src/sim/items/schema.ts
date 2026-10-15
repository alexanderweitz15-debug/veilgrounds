// Item + Prägung (rune) schema. Data in src/data/items.json and src/data/runes.json.
// Passives/actives with logic beyond plain stats are hook ids, implemented in Phase 2 next to the ability hooks.

import type { L10n } from '../champions/schema';

export type ItemStat =
  | 'ad'
  | 'ap'
  | 'hp'
  | 'mana'
  | 'armor'
  | 'mr'
  | 'asPct'
  | 'critPct'
  | 'lifestealPct'
  | 'haste'
  | 'msPct'
  | 'msFlat'
  | 'lethality'
  | 'hpRegenPct'
  | 'manaRegenPct'
  | 'healShieldPowerPct';

export type ItemTier = 'starter' | 'basic' | 'component' | 'legendary' | 'boots' | 'consumable';

export interface ItemData {
  id: string;
  name: L10n;
  tier: ItemTier;
  /** Total cost (recipe cost = cost - sum(component costs)). */
  cost: number;
  from: string[];
  stats: Partial<Record<ItemStat, number>>;
  passive?: { name: L10n; desc: L10n; hook?: string };
  active?: { name: L10n; desc: L10n; hook: string; cooldown: number };
  /** Spec §5 build notes: who buys it (bots use it for build validation). */
  tags: ('ad' | 'ap' | 'tank' | 'support' | 'jungle' | 'crit' | 'onhit' | 'lethality')[];
  /** Max one per inventory (starters, jungle item, boots group). */
  unique?: string;
}

export interface RuneData {
  id: string;
  name: L10n;
  desc: L10n;
  kind: 'keystone' | 'minor';
  stats?: Partial<Record<ItemStat | 'adaptive', number>>;
  hook?: string;
  /** Archetypes this rune fits (bots: optimal choice per champion archetype). */
  fits: string[];
}
