// Per-champion combat hints for the bot brain (A13). One JSON file per champion: src/data/bots/hints/<id>.json.
// The brain reads champion knowledge ONLY from here and from the champion data itself (never `if (champ === 'x')`).
//
// The entries are generated from src/data/champions/<id>.json (ability types, ranges, effects, combos) by
// tools/botHints/generate.ts through deriveHints (derive.ts) - nothing is guessed by hand. `status: 'generated'`
// entries are rewritten by the tool; A27 curates entries (status 'curated': the tool leaves them alone) and may
// change any field below as long as validateHints (validate.ts) passes.
//
// Everything here is static game knowledge a player has from the champion screen: no cooldowns, no hidden state.

export type SlotKey = 'Q' | 'W' | 'E' | 'R';
export const SLOT_KEYS: readonly SlotKey[] = ['Q', 'W', 'E', 'R'];
export const SLOT_INDEX: Readonly<Record<SlotKey, 0 | 1 | 2 | 3>> = { Q: 0, W: 1, E: 2, R: 3 };

/** What an ability is for (a slot may have several). */
export type AbilityRole =
  | 'poke' // cheap ranged damage worth throwing in lane
  | 'burst' // damage for trades and all-ins
  | 'engage' // starts a fight (gap closer with damage / CC, hook, long CC)
  | 'cc' // hard crowd control (root, stun, airborne, pull, knockback)
  | 'escape' // moves the caster out of danger (dash / blink)
  | 'disengage' // self-centred slow / knockback / stun that pushes enemies off
  | 'peel' // protects an ally (shield, heal, ally buff)
  | 'sustain' // heals / shields (self or ally)
  | 'zone' // area denial (ground zones, walls)
  | 'summon'
  | 'buff' // self or next-attack buffs, stances
  | 'ult'
  | 'utility';

export const ABILITY_ROLES: readonly AbilityRole[] = ['poke', 'burst', 'engage', 'cc', 'escape', 'disengage', 'peel', 'sustain', 'zone', 'summon', 'buff', 'ult', 'utility'];

export type AimKind = 'line' | 'circle' | 'cone' | 'target' | 'self' | 'dash' | 'blink';
export const AIM_KINDS: readonly AimKind[] = ['line', 'circle', 'cone', 'target', 'self', 'dash', 'blink'];

/** Why the bot keeps an ability instead of throwing it as poke: for the fight start, for an ally, for a kill. */
export type HoldFor = 'none' | 'engage' | 'peel' | 'kill';
export const HOLD_FOR: readonly HoldFor[] = ['none', 'engage', 'peel', 'kill'];

export interface AbilityHint {
  slot: SlotKey;
  aim: AimKind;
  roles: AbilityRole[];
  /** Cast range at the highest rank (self-centred: the radius; dash / blink: the travelled distance). */
  range: number;
  /** [min, max] distance to the target (centre to centre) in which the bot starts the ability. */
  useRange: [number, number];
  /** Projectile speed (units / s), line width, circle / area radius; 0 = not applicable. */
  speed: number;
  width: number;
  radius: number;
  /** Seconds from the key press to the cast (castTime) and from the cast to the area effect (delay). */
  castTime: number;
  delay: number;
  /** Strongest crowd control on enemies: 0 none, 1 slow, 2 blind / silence, 3 root / pull / knockback, 4 stun / airborne. */
  cc: number;
  /** Deals damage to enemies. */
  damage: boolean;
  /** An enemy can sidestep it (visible projectile or telegraph). */
  dodgeable: boolean;
  /** How much an enemy bot should fear being hit (dodge priority): 0 harmless .. 3 deadly. */
  threat: 0 | 1 | 2 | 3;
  holdFor: HoldFor;
}

export type ComboKind = 'trade' | 'allin' | 'engage' | 'poke' | 'peel';
export const COMBO_KINDS: readonly ComboKind[] = ['trade', 'allin', 'engage', 'poke', 'peel'];
export const COMBO_TOKENS: readonly string[] = ['Q', 'W', 'E', 'R', 'AA', 'FLASH'];

export interface ComboHint {
  id: string;
  kind: ComboKind;
  /** Tokens Q W E R AA FLASH (same alphabet as ChampionData.combos). */
  sequence: string[];
  /** Where the entry comes from: the champion's signature combos or a derived single-ability combo. */
  source: 'data' | 'generated' | 'curated';
}

export type FightRole = 'carry' | 'frontline' | 'assassin' | 'support';
export const FIGHT_ROLES: readonly FightRole[] = ['carry', 'frontline', 'assassin', 'support'];

export interface ChampionHints {
  id: string;
  schema: 1;
  /** 'generated': rewritten by tools/botHints/generate.ts. 'curated': hand-tuned (A27), never overwritten. */
  status: 'generated' | 'curated';
  /** Role in a fight and 0..5 role strengths (engage / peel from the champion scores, poke / burst derived). */
  roleHints: { fightRole: FightRole; engage: number; peel: number; poke: number; burst: number };
  /** Distances (units, centre to centre) the brain keys its spacing and decisions on. */
  keyRanges: {
    /** Auto attack range. */
    auto: number;
    /** Distance at which the champion starts a trade (reach of the first token of its main trade combo). */
    trade: number;
    /** Distance at which it can start a fight (engage ability reach). */
    engage: number;
    /** Longest cheap damage reach (poke). */
    poke: number;
    /** Everything beyond this is safe from the champion's damage and CC (enemies space against it). */
    threat: number;
    /** Reach of its peel abilities (allies it can protect). */
    peel: number;
  };
  combos: ComboHint[];
  /** Q, W, E, R. */
  abilities: [AbilityHint, AbilityHint, AbilityHint, AbilityHint];
}
