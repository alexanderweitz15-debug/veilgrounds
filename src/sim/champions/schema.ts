// Champion + ability data schema (src/data/champions/<id>.json). The ability engine executes these generically;
// bots read range/width/speed/castTime from the same data to dodge or use abilities.
// Champion-specific logic that data cannot express lives in hooks: src/sim/champions/<id>.ts, referenced by id.

export type L10n = { de: string; en: string };
export type Role = 'top' | 'jungle' | 'mid' | 'adc' | 'support';
export type AbilityType = 'skillshot_line' | 'skillshot_circle' | 'cone' | 'targeted' | 'self' | 'dash' | 'blink' | 'zone' | 'summon';
/** Per-rank array (length 5 for Q/W/E, 3 for R) or a single value for all ranks. */
export type Ranked = number | number[];

/** Ratios are fractions (1.0 = +100 % AD). Engine: abilities.scaleAmount. */
export interface Scaling {
  base: Ranked;
  ad?: number; // total AD ratio
  bonusAd?: number;
  ap?: number;
  maxHp?: number; // caster max HP ratio
  bonusHp?: number;
  targetMaxHp?: number;
  targetMissingHp?: number;
  /** Linear by champion level 1..18 instead of rank (e.g. passives "10-40"). Overrides base. */
  byLevel?: [number, number];
}

export type EffectTarget = 'hit' | 'self' | 'ally' | 'allies' | 'enemies';

/**
 * pct values are percent points (40 = 40 %); durations are seconds. Default target is 'hit' (units hit by this
 * resolution); 'enemies'/'allies' use ability radius (else range) around the effect center.
 */
export type Effect =
  | { kind: 'damage'; type: 'phys' | 'magic' | 'true'; amount: Scaling; target?: EffectTarget }
  | { kind: 'heal'; amount: Scaling; target: EffectTarget }
  | { kind: 'shield'; amount: Scaling; duration: number; target: EffectTarget }
  | { kind: 'slow'; pct: Ranked; duration: Ranked; target?: EffectTarget }
  | { kind: 'root' | 'stun' | 'airborne' | 'blind' | 'silence' | 'stasis'; duration: Ranked; target?: EffectTarget }
  | { kind: 'knockback' | 'pull'; distance: number; target?: EffectTarget }
  | {
      kind: 'buff';
      stat: 'as' | 'ms' | 'ad' | 'ap' | 'armor' | 'mr' | 'dmgReduction' | 'tenacity' | 'invisible' | 'untargetable';
      pct?: Ranked;
      flat?: Ranked;
      duration: Ranked;
      target: EffectTarget;
    }
  | { kind: 'reveal'; duration: number; target?: EffectTarget }
  | { kind: 'mark'; id: string; duration: number; target?: EffectTarget }
  /** Champion-specific code in src/sim/champions/<champ>.ts, exported under this id. */
  | { kind: 'hook'; id: string };

export interface AbilityData {
  id: string;
  name: L10n;
  desc: L10n;
  type: AbilityType;
  /** Wind-up in seconds (0.2-0.45 for most abilities; 0 = instant). */
  castTime: number;
  range: Ranked;
  cooldown: Ranked;
  cost: Ranked;
  costType: 'mana' | 'energy' | 'hp' | 'none';
  /** Line skillshots: width and projectile speed (units/s). speed also = dash speed (default 1200) and makes
   *  'targeted' abilities fire a homing projectile (absent = instant). */
  width?: number;
  speed?: number;
  /** Circles/zones: radius; cones: angle in degrees (full angle). */
  radius?: number;
  angle?: number;
  /** Delay between cast end and effect (ground AoEs, telegraphed). */
  delay?: number;
  /** Zones/buffs lasting over time. */
  duration?: Ranked;
  /** Dash/blink distance (if different from range). Dashes go the full distance unless flag ground_target
   *  (then up to the cursor). */
  distance?: number;
  flags?: ('blocked_by_minions' | 'pierce' | 'unstoppable' | 'recast' | 'ground_target' | 'ally_target' | 'auto_reset' | 'channel')[];
  effects: Effect[];
}

export interface ChampionData {
  id: string;
  name: string;
  title: L10n;
  roles: [Role] | [Role, Role];
  /** Mechanic archetype from spec §3, e.g. "skillshot_mage", "hook_support". */
  archetype: string;
  trainingPurpose: L10n;
  attackType: 'melee' | 'ranged';
  resource: 'mana' | 'energy' | 'none';
  base: {
    hp: number;
    hpGrowth: number;
    hpRegen: number; // per 5 s, LoL convention
    hpRegenGrowth: number;
    mana: number;
    manaGrowth: number;
    manaRegen: number; // per 5 s
    manaRegenGrowth: number;
    ad: number;
    adGrowth: number;
    armor: number;
    armorGrowth: number;
    mr: number;
    mrGrowth: number;
    as: number;
    asGrowth: number; // % per level
    range: number;
    ms: number;
    /** Attack wind-up seconds at 1.0 AS (0.25-0.4). */
    windup: number;
    /** Ranged auto projectile speed. */
    projectileSpeed?: number;
    /** Hitbox radius: 65 melee, 55 ranged. */
    radius: number;
  };
  passive: { name: L10n; desc: L10n; hooks: string[] };
  /** Q, W, E, R. */
  abilities: [AbilityData, AbilityData, AbilityData, AbilityData];
  spikeLevels: number[];
  spikeNote: L10n;
  maxOrder: ['Q' | 'W' | 'E', 'Q' | 'W' | 'E', 'Q' | 'W' | 'E'];
  /** Exactly three signature combos for the combo trainer. Tokens: Q W E R AA (auto) FLASH. */
  combos: { name: L10n; sequence: string[] }[];
  /** 0..5 scores used by the team AI win-condition model. */
  scores: { engage: number; peel: number; range: number; scaling: number; waveclear: number; mobility: number };
  voiceLines: Record<'pick' | 'firstBlood' | 'kill' | 'death' | 'recall' | 'taunt', L10n>;
  /** Silhouette hint for procedural placeholder sprites. */
  silhouette: string;
}
