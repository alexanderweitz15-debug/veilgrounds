// Item + Prägung (rune) schema. Data in src/data/items.json and src/data/runes.json.
//
// Items are data-driven (docs/ITEMS-FORMAT.md): plain stats, a passive made of trigger rules, an optional active or a
// consumable use. Rules compose triggers (onHit, onKill, ...), conditions and effects; the engine (engine.ts) executes
// them generically, so a new item needs JSON only. validate.ts rejects unknown triggers, effects and typos at load.
// Conventions as in the ability data: pct values are percent points (40 = 40 %), `scale` ratios are fractions
// (0.2 = 20 % of the stat), durations are seconds (or exact `ticks`), levels count from 1.
// Runes (RuneData) still use code hooks (runeHooks.ts).

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
  | 'healShieldPowerPct'
  /** Percent armor penetration (30 = ignore 30 % of the target's armor). */
  | 'armorPenPct'
  /** Flat magic penetration. */
  | 'magicPen'
  /** Tenacity in percent points (30 = CC lasts 30 % shorter). */
  | 'tenacityPct';

export const ITEM_STATS: readonly ItemStat[] = [
  'ad', 'ap', 'hp', 'mana', 'armor', 'mr', 'asPct', 'critPct', 'lifestealPct', 'haste', 'msPct', 'msFlat', 'lethality',
  'hpRegenPct', 'manaRegenPct', 'healShieldPowerPct', 'armorPenPct', 'magicPen', 'tenacityPct',
];

export type ItemTier = 'starter' | 'basic' | 'component' | 'legendary' | 'boots' | 'consumable';
export const ITEM_TIERS: readonly ItemTier[] = ['starter', 'basic', 'component', 'legendary', 'boots', 'consumable'];
export type ItemTag = 'ad' | 'ap' | 'tank' | 'support' | 'jungle' | 'crit' | 'onhit' | 'lethality';
export const ITEM_TAGS: readonly ItemTag[] = ['ad', 'ap', 'tank', 'support', 'jungle', 'crit', 'onhit', 'lethality'];

// ------------------------------------------------------------------ triggers

/**
 * When a rule runs (its owner is the champion carrying the item).
 * onHit: own basic attack landed. onAbilityHit: own ability resolution hit a unit. onCast: own ability cast resolved.
 * onKill: owner killed a unit (target = victim). onTakedown: owner killed or assisted an enemy champion.
 * onDamageTaken: owner took damage (source = attacker). onShieldBreak: a hit emptied the owner's shield.
 * onTick: every sim tick while the item is owned. modifyDamage / modifyHeal / onComputeStats: pure modifiers
 * (effects damageMult / healMult / statMult / statAdd only).
 */
export const TRIGGERS = [
  'onHit',
  'onAbilityHit',
  'onCast',
  'onKill',
  'onTakedown',
  'onDamageTaken',
  'onShieldBreak',
  'onTick',
  'modifyDamage',
  'modifyHeal',
  'onComputeStats',
] as const;
export type Trigger = (typeof TRIGGERS)[number];

// ------------------------------------------------------------------ values

/** What a Value can scale with (coefficients are fractions: 0.2 = 20 % of the stat). */
export interface ValueScale {
  /** Owner stats. */
  ap?: number;
  ad?: number;
  bonusAd?: number;
  armor?: number;
  mr?: number;
  maxHp?: number;
  curHp?: number;
  missingHp?: number;
  /** Target stats (the unit the trigger is about: hit unit, victim; for actives the chosen unit). */
  targetMaxHp?: number;
  targetCurHp?: number;
  targetMissingHp?: number;
  /** The unit an effect is applied to (matters for area recipients: each unit hit scales with its own HP). */
  recipientMaxHp?: number;
  recipientCurHp?: number;
  recipientMissingHp?: number;
  /** Damage amount of the trigger (onHit: the hit; onDamageTaken: the damage taken after armor / MR, shield part included). */
  damage?: number;
  /** Lifesteal healing lost to full HP (onHit). */
  overheal?: number;
  /** Stack counters of this passive: value += coefficient * current stacks. */
  stacks?: Record<string, number>;
}

/** base + perLevel * (level - 1) + sum(coefficient * stat), then clamped to [min, max]. */
export type Value = number | { base?: number; perLevel?: number; scale?: ValueScale; min?: number; max?: number };

// ------------------------------------------------------------------ conditions

export type TargetKind = 'champion' | 'minion' | 'monster' | 'structure' | 'ward' | 'pet' | 'plant' | 'dummy';
export const TARGET_KINDS: readonly TargetKind[] = ['champion', 'minion', 'monster', 'structure', 'ward', 'pet', 'plant', 'dummy'];

/** Checks on the trigger's target (or source) unit. All given checks must hold. */
export interface UnitCond {
  kind?: TargetKind[];
  notKind?: TargetKind[];
  team?: 'enemy' | 'ally';
  /** Current HP strictly below / strictly above this share of max HP (percent points). */
  hpBelowPct?: number;
  hpAbovePct?: number;
  /** Has an active buff / CC with this id (buff id) or kind. */
  hasBuff?: string;
}

export interface SelfCond {
  hpBelowPct?: number;
  hpAbovePct?: number;
  attack?: 'melee' | 'ranged';
  alive?: boolean;
  /** Under any crowd control (slow, root, stun, ...). */
  crowdControlled?: boolean;
  hasBuff?: string;
  levelAtLeast?: number;
}

/** Flat object of checks; every given key must hold (an unknown key is a load error). */
export interface Cond {
  target?: UnitCond;
  source?: UnitCond;
  self?: SelfCond;
  /** onHit: the hit was a crit. */
  crit?: boolean;
  /** onHit: lifesteal healing was lost to full HP. */
  overheal?: boolean;
  /** onDamageTaken / modifyDamage: damage type is one of these. */
  damageType?: ('phys' | 'magic' | 'true')[];
  /** modifyDamage / onDamageTaken: the damage is a basic attack. */
  isAuto?: boolean;
  /** onDamageTaken: the damage taken (after armor / MR, shield part included) is at least this share of the owner's max HP (percent points). */
  damageTakenPctMaxHp?: number;
  /** The owner dealt or took damage within the last N seconds. */
  inCombatSeconds?: number;
  /** sim.tick is a multiple of N. */
  everyTicks?: number;
  /** Game time before / after N seconds. */
  beforeSeconds?: number;
  afterSeconds?: number;
  /** onCast / onAbilityHit: ability slot 0..3 (Q W E R). */
  castSlot?: number[];
  /** Stack counters of this passive have at least these values. */
  stacksAtLeast?: Record<string, number>;
}

// ------------------------------------------------------------------ effects

/** Who an effect applies to. */
export type Recipient = 'self' | 'target' | 'source' | 'nearestAlly' | 'alliesInRadius' | 'enemiesInRadius';
export const RECIPIENTS: readonly Recipient[] = ['self', 'target', 'source', 'nearestAlly', 'alliesInRadius', 'enemiesInRadius'];

/** Shared recipient options: radius (alliesInRadius / enemiesInRadius), range (nearestAlly), around (area center). */
interface Aim {
  to: Recipient;
  radius?: number;
  range?: number;
  /** Area center: the owner (default) or the target / hit unit. */
  around?: 'self' | 'target';
}

interface Timed {
  seconds?: number;
  ticks?: number;
}

export type BuffKindData = 'slow' | 'blind' | 'root' | 'silence' | 'fear' | 'stun' | 'stasis' | 'unstoppable' | 'grievous' | 'stat' | 'dot';
export const BUFF_KINDS: readonly BuffKindData[] = ['slow', 'blind', 'root', 'silence', 'fear', 'stun', 'stasis', 'unstoppable', 'grievous', 'stat', 'dot'];
export type BuffStatData = 'as' | 'ms' | 'ad' | 'ap' | 'armor' | 'mr' | 'dmgReduction' | 'tenacity' | 'range' | 'armorPen' | 'dmgDealt';
export const BUFF_STATS: readonly BuffStatData[] = ['as', 'ms', 'ad', 'ap', 'armor', 'mr', 'dmgReduction', 'tenacity', 'range', 'armorPen', 'dmgDealt'];

export interface DamageEffect extends Aim {
  type: 'damage';
  dmgType: 'phys' | 'magic' | 'true';
  value: Value;
}
export interface HealEffect extends Aim {
  type: 'heal';
  value: Value;
  /** The value is per N seconds and applied evenly each tick (life-root style regen). */
  perSeconds?: number;
}
export interface ShieldEffect extends Aim, Timed {
  type: 'shield';
  value: Value;
  /** Buff id (a shield with the same id and source refreshes). */
  id: string;
  /** Scale with the owner's heal/shield power passives (healShieldPowerPct, modifyHeal). */
  healPower?: boolean;
  /** Add the value to the current shield of this id instead of replacing it, up to `cap`. */
  accumulate?: boolean;
  cap?: Value;
}
export interface BuffEffect extends Aim, Timed {
  type: 'applyBuff';
  kind: BuffKindData;
  id: string;
  /** kind 'stat': which stat. */
  stat?: BuffStatData;
  /** slow / grievous / stat: percent points (negative stat pct = debuff). */
  pct?: number;
  /** stat: flat amount. */
  flat?: number;
  /** kind 'stat' with pct: repeated applications stack, pct is multiplied by the stack count (max `stacks.max`). */
  stacks?: { max: number };
  /** kind 'dot': total damage over the duration, split into one instance per period. */
  damage?: Value;
  dmgType?: 'phys' | 'magic' | 'true';
  period?: number;
  /** Not removed by cleanses. */
  uncleansable?: boolean;
}
export interface CleanseEffect extends Aim {
  type: 'cleanse';
  /** Crowd-control kinds removed (default slow, blind, root, silence, stun). */
  kinds?: ('slow' | 'blind' | 'root' | 'silence' | 'stun' | 'fear' | 'grievous')[];
  /** Also remove buffs with these ids. */
  ids?: string[];
}
export interface ManaEffect {
  type: 'restoreMana';
  value: Value;
}
export interface GoldEffect extends Aim {
  type: 'gold';
  amount: number;
  /** Also add the amount to this counter of the passive (quests: Spenderlampe). */
  counter?: string;
}
export interface AbsorbEffect {
  type: 'absorbDamage';
  /** Pool size. Damage of the rule's condition type is restored to HP right after it landed, until the pool is empty. */
  value: Value;
  /** The pool refills this long after it first absorbed something. */
  rechargeSeconds?: number;
}
export interface HealOverTimeEffect extends Timed {
  type: 'healOverTime';
  value: Value;
  /** Pool name (default: the item id). Pools of the owner survive the item (consumables). */
  pool?: string;
}
export interface StackEffect extends Timed {
  type: 'addStack';
  name: string;
  amount?: number;
  max: number;
  /** With seconds / ticks: all stacks expire that long after the last gain (omit: permanent). */
}
export interface ClearStackEffect {
  type: 'clearStack';
  name: string;
}
export interface DamageMultEffect {
  type: 'damageMult';
  mult: number;
}
export interface HealMultEffect {
  type: 'healMult';
  mult: number;
}
export interface StatMultEffect {
  type: 'statMult';
  stat: 'ad' | 'ap' | 'armor' | 'mr' | 'as' | 'ms';
  mult: number;
}
export interface StatAddEffect {
  type: 'statAdd';
  stat: 'ad' | 'ap' | 'armor' | 'mr' | 'as' | 'ms' | 'range' | 'tenacity';
  value: Value;
}
export interface StopEffect {
  type: 'stopMovement';
}
export interface SealWardEffect {
  type: 'placeSealWard';
}

export type Effect =
  | DamageEffect
  | HealEffect
  | ShieldEffect
  | BuffEffect
  | CleanseEffect
  | ManaEffect
  | GoldEffect
  | AbsorbEffect
  | HealOverTimeEffect
  | StackEffect
  | ClearStackEffect
  | DamageMultEffect
  | HealMultEffect
  | StatMultEffect
  | StatAddEffect
  | StopEffect
  | SealWardEffect;

export const EFFECT_TYPES = [
  'damage', 'heal', 'shield', 'applyBuff', 'cleanse', 'restoreMana', 'gold', 'absorbDamage', 'healOverTime', 'addStack', 'clearStack',
  'damageMult', 'healMult', 'statMult', 'statAdd', 'stopMovement', 'placeSealWard',
] as const satisfies readonly Effect['type'][];

// ------------------------------------------------------------------ rules, passives, actives

export interface Rule {
  on: Trigger | Trigger[];
  if?: Cond;
  /** Internal cooldown in seconds (shared by all triggers of the rule). */
  cooldown?: number;
  /** Charges: each proc spends one; one is regained every regenSeconds, the timer starts at the first spend. */
  charges?: { max: number; regenSeconds: number };
  do: Effect[];
}

export interface PassiveData {
  name: L10n;
  desc: L10n;
  /**
   * Unique-passive key: owned copies (also different items) with the same key apply only once (the first in inventory
   * order). Default: the item id. Plain stats always stack.
   */
  key?: string;
  /** 'unique' (default) or 'stack': every owned copy applies on its own (own cooldowns and stacks). */
  stack?: 'unique' | 'stack';
  rules?: Rule[];
  /** Lane-minion gold multiplier until the given game time (economy.ts; Jägerzahn). */
  laneMinionGold?: { mult: number; untilSeconds: number };
  /** Quest: done once `counter` (a gold effect's counter) reaches `goal`. Read by `questDone` (Agent J: ward charge). */
  quest?: { counter: string; goal: number };
}

/** How an active or consumable picks its target. unit targets are chosen by the item command's x/y (nearest unit). */
export type ActiveTarget = 'self' | 'point' | 'allyChampion' | 'enemyChampion';
export const ACTIVE_TARGETS: readonly ActiveTarget[] = ['self', 'point', 'allyChampion', 'enemyChampion'];

export interface UseBase {
  target: ActiveTarget;
  /** allyChampion / enemyChampion: max distance from the owner to the picked unit. */
  range?: number;
  /** Usable only while not stunned / feared / airborne / suppressed / in stasis. */
  requires?: 'canAttack'[];
  /** Run in order; an effect that cannot apply (immune target, ward limit) aborts the use without cooldown. */
  effects: Effect[];
}

export interface ActiveData extends UseBase {
  name: L10n;
  desc: L10n;
  /** Seconds. */
  cooldown: number;
}

export interface ItemData {
  id: string;
  name: L10n;
  tier: ItemTier;
  /** Total cost (recipe cost = cost - sum(component costs)). */
  cost: number;
  from: string[];
  stats: Partial<Record<ItemStat, number>>;
  passive?: PassiveData;
  active?: ActiveData;
  /** Consumable use (tier 'consumable' only): the item is spent on success. */
  use?: UseBase;
  /** Spec §5 build notes: who buys it (bots use it for build validation). */
  tags: ItemTag[];
  /** Max one per inventory per group (starters, jungle item, boots group). */
  unique?: string;
  /** Max copies owned at once. Default: 1 for legendary, unlimited otherwise. */
  maxOwned?: number;
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
