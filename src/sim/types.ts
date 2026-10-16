// Shared simulation types. No DOM, no worker assumptions: this module runs headless.

export const TICK_HZ = 30;
export const DT = 1 / TICK_HZ;
/** Seconds to ticks (rounded). */
export const sec = (s: number): number => Math.round(s * TICK_HZ);

export const Team = { Blue: 0, Red: 1, Neutral: 2 } as const;
export type TeamId = (typeof Team)[keyof typeof Team];
export const enemyOf = (t: number): TeamId => (t === Team.Blue ? Team.Red : t === Team.Red ? Team.Blue : Team.Neutral);

export const Kind = {
  Champion: 1,
  MinionMelee: 2,
  MinionCaster: 3,
  MinionSiege: 4,
  MinionSuper: 5,
  Tower: 6,
  Inhibitor: 7,
  Nexus: 8,
  Dummy: 9,
  Monster: 10,
  Projectile: 11,
  Ward: 12,
  /** Temporary allied unit spawned by a champion hook (src/sim/summons.ts). */
  Pet: 13,
  /** Jungle plant (src/sim/systems/plants.ts): neutral, 1 HP, popped by one champion basic attack. */
  Plant: 14,
} as const;
export type KindId = (typeof Kind)[keyof typeof Kind];
export const isMinion = (k: number): boolean => k >= Kind.MinionMelee && k <= Kind.MinionSuper;
export const isStructure = (k: number): boolean => k >= Kind.Tower && k <= Kind.Nexus;

/** Jungle monster types (sprite + name); small camp members have their own type. */
export const MONSTER_TYPES = [
  'dornenbock',
  'glutwaechter',
  'sumpfunke',
  'mooswolf',
  'mooswelpe',
  'hohlkaefer',
  'kaeferling',
  'schattenkrabbe',
  'krabbling',
  'nebelschleicher',
  'leviathan',
  'schleierwaechter',
  'kesselbrut',
] as const;
export type MonsterType = (typeof MONSTER_TYPES)[number];
export const PLANT_TYPES = ['sprungfrucht', 'honigfrucht', 'spaehfrucht'] as const;
export type PlantType = (typeof PLANT_TYPES)[number];
/** Unit.variant indexes this list (0 = none). Order is part of determinism/replays: append only. */
export const VARIANTS = ['', ...MONSTER_TYPES, ...PLANT_TYPES] as const;
export type Variant = (typeof VARIANTS)[number];
export const variantIndex = (v: Variant): number => VARIANTS.indexOf(v);

export const Lane = { Top: 0, Mid: 1, Bot: 2, None: 255 } as const;
export type LaneId = 0 | 1 | 2;

export type DamageType = 'phys' | 'magic' | 'true';

/** Player-equivalent inputs. Bots and humans produce exactly these; sim never trusts anything else. */
/** Player/bot pings (spec §9, docs/spec-bots.md §9). Team-only, rate-limited by the sim. */
export const PING_KINDS = ['alert', 'danger', 'onMyWay', 'back', 'missing', 'vision', 'help', 'group', 'focus', 'objective', 'ok', 'question'] as const;
export type PingKind = (typeof PING_KINDS)[number];

export type Command =
  | { t: 'move'; x: number; y: number }
  | { t: 'attack'; target: number }
  | { t: 'attackMove'; x: number; y: number }
  | { t: 'stop' }
  | { t: 'cast'; slot: 0 | 1 | 2 | 3; x: number; y: number; target?: number }
  | { t: 'spell'; slot: 0 | 1; x: number; y: number; target?: number }
  | { t: 'levelUp'; slot: 0 | 1 | 2 | 3 }
  | { t: 'recall' }
  /** Team ping at a map point; target = entity eid for focus/objective pings. */
  | { t: 'ping'; kind: PingKind; x: number; y: number; target?: number }
  /** Team chat line (bots: spec §9; ref = decision log tick the line refers to). Team-only, like pings. */
  | { t: 'chat'; text: string; ref?: number }
  | { t: 'buy'; item: string }
  | { t: 'sell'; slot: number }
  /** Use the item in inventory slot 0..5 (actives, consumables; src/sim/items/itemHooks.ts). */
  | { t: 'item'; slot: number; x?: number; y?: number }
  /** Use the trinket at a point: Schleierward places a ward, Suchfeuer sweeps (src/sim/wards.ts). */
  | { t: 'ward'; x: number; y: number }
  /** Swap the trinket (shop access, Suchfeuer from level 9). */
  | { t: 'trinket'; id: 'schleierward' | 'suchfeuer' }
  | { t: 'cheat'; op: CheatOp; x?: number; y?: number; value?: number };

export type CheatOp =
  | 'refreshCd'
  | 'refreshHp'
  | 'levelUp'
  | 'gold'
  | 'teleport'
  | 'spawnDummy'
  | 'toggleMinions'
  | 'towersInvulnerable'
  | 'skipTime'
  /** Sandbox (Phase 5): set the level to `value`, permanent cooldown reset, god mode, immediate wave, camps now. */
  | 'setLevel'
  | 'noCooldowns'
  | 'godMode'
  | 'spawnWave'
  | 'respawnCamps';

/** One input as recorded in replays: which player slot issued what on which tick. */
export interface TickInput {
  slot: number;
  cmd: Command;
}

/**
 * Why a cast command failed: cooldown, not enough mana/energy/HP, out of range (only if no walk-into-range was
 * possible), crowd control (stun/silence/airborne/suppress, root for dashes/Flash), still busy when the ~0.25 s input
 * buffer ran out, no valid target near the cursor, ability not learned.
 */
export type CastFailReason = 'cooldown' | 'mana' | 'range' | 'cc' | 'busy' | 'target' | 'unlearned';

/** Events are produced during a tick and consumed by render/stats. Cleared at the start of each tick. */
export type SimEvent =
  | { e: 'damage'; src: number; dst: number; amount: number; type: DamageType; crit?: boolean; /** Basic attack (render-only info: death recap). */ auto?: true }
  | {
      e: 'death'; eid: number; kind: number; team: number; killer: number; x: number; y: number;
      /** Victim champion id (champions only). */
      champ?: string;
      /** Killer unit kind/team (killer >= 0 in the sim; the eid itself may be fog-masked to -1 in snapshots). */
      killerKind?: number;
      killerTeam?: number;
      /** Killer champion id (champion kills only). */
      killerChamp?: string;
    }
  | { e: 'gold'; eid: number; amount: number; x: number; y: number }
  | { e: 'lastHitMiss'; eid: number; target: number; earlyHp?: number; lateMs?: number }
  | { e: 'level'; eid: number; level: number }
  | { e: 'attack'; src: number; dst: number }
  /** Ability cast started (slot 0..3; rank for telegraphs). recast: second cast of a recast ability (no new wind-up). */
  | { e: 'cast'; src: number; slot: number; x: number; y: number; rank?: number; recast?: boolean; /** Wind-up end tick (incl. hook time mods). */ at?: number }
  /**
   * A cast/summoner command that could not be executed (render: message + error sound). Only delivered to the
   * caster's own view. summoner: slot is the summoner slot 0/1 (D/F) instead of the ability slot.
   */
  | { e: 'castFail'; src: number; slot: number; reason: CastFailReason; summoner?: true }
  | { e: 'plate'; tower: number; team: number }
  | { e: 'wave'; lane: number; team: number; index: number }
  | { e: 'respawn'; eid: number }
  /** Team ping (only delivered to the pinging team). */
  | { e: 'ping'; slot: number; team: number; kind: PingKind; x: number; y: number; target: number }
  /** Team chat line (only delivered to the sender's team). */
  | { e: 'chat'; slot: number; team: number; text: string; ref?: number }
  /** Ground telegraph: AoE that resolves at tick `at` (render shows radius + fill). */
  | {
      e: 'zone'; src: number; team: number; x: number; y: number; r: number; start: number; at: number;
      /** Line zones (ability.line): segment from (ax, ay) to (bx, by), thickness `width`; circle otherwise. */
      line?: { ax: number; ay: number; bx: number; by: number; width: number };
      /** Persistent zones: last tick the area stays active (render keeps the area visible until then). */
      until?: number;
      /** Centre follows the caster until it resolves (self AoEs with a delay). */
      follow?: boolean;
    }
  | { e: 'gameOver'; winner: number };

export interface PlayerSetup {
  slot: number; // 0..4 blue, 5..9 red
  team: TeamId;
  champion: string; // champion id from data/champions
  role: 'top' | 'jungle' | 'mid' | 'adc' | 'support';
  summoners: [string, string];
  /** Sandbox/trainer summoner cooldown override in seconds by spell id (e.g. { sprung: 5 }). */
  summonerCd?: Record<string, number>;
  isHuman: boolean;
  /**
   * LoL "auto attack" option: a champion standing idle (no order, not after a Stop command) attacks the nearest
   * enemy unit in attack range, without chasing. Sim default off (tests, bots issue their own autos); the client sets
   * it for the human player (src/game/modes.ts withClientSettings, default on).
   */
  autoAttack?: boolean;
  /** Prägungen; omitted = champion's default preset (src/sim/items/runes.ts). */
  runes?: { keystone: string; minor: [string, string, string] };
  /** Bot-controlled slot (with isHuman false): rank profile + per-game variance (src/ai/runner.ts). */
  bot?: {
    rank: import('../ai/profiles/schema').Rank;
    variance: 'stable' | 'normal' | 'volatile';
    name?: string;
    /** Spec §2/§10: lobby archetype preset and/or manual axes (-5..+5); omitted = rank-typical roll. */
    archetype?: import('../ai/contract').Archetype;
    playstyle?: Partial<import('../ai/contract').Playstyle>;
    /** Seed of the playstyle roll (src/ai/params.ts); default derived from config seed + slot. */
    personalitySeed?: number;
    /** Division-exact skill 0..100 (spec-bots §10); default = rank anchor. */
    skill?: number;
  };
}

/** Trainer modes (Phase 5). 'lastHit' is also a trainer. */
export type TrainerKind = 'dodge' | 'kite' | 'laneDuel' | 'jungleDuel' | 'arena' | 'scenario';

export interface TrainerOpts {
  /** Run length in seconds (last-hit, kiting, jungle duel). */
  durationSec?: number;
  /** Last-hit: only enemy waves spawn, they push into the own outer tower (towers invulnerable). */
  tower?: boolean;
  /** Dodge: 1 easy, 2 normal, 3 hard. */
  difficulty?: 1 | 2 | 3;
  /** Dodge: hits until the run ends. */
  lives?: number;
  /** Kiting dummy: stands, strafes between random points, or chases the player. */
  dummy?: 'stand' | 'strafe' | 'chase';
  /** Start level (kiting, arena); abilities are levelled automatically. */
  level?: number;
  /** Arena: rounds to win; round time limit in seconds. */
  rounds?: number;
  roundSec?: number;
  /** Lane duel: kills / CS that end the duel (first tower always ends it). */
  kills?: number;
  cs?: number;
  /** Arena: items bought at the start, by player slot (string key for JSON). */
  items?: Record<string, string[]>;
  /** Szenario-Trainer: which scenario (src/sim/trainer/scenarios.ts SCENARIO_IDS). */
  scenario?: string;
}

export interface SimConfig {
  seed: number;
  mode: 'classic' | 'sandbox' | 'lastHit' | 'laneOnly' | TrainerKind;
  /** Trainer options (Phase 5, src/sim/trainer). Which trainer runs follows `mode`. */
  trainer?: TrainerOpts;
  /** Teams that spawn lane minions. Default: both (tower last-hit trainer: enemy only). */
  minionTeams?: TeamId[];
  players: PlayerSetup[];
  /** Bot toxicity (spec-bots §9: flame chat + rage '?' pings), default on; lobby/settings switch. */
  botToxicity?: boolean;
  /** Language of bot chat lines (client UI language); default German. */
  botLang?: 'de' | 'en';
  /** Lanes that spawn minions. Default: all three. */
  minionLanes?: LaneId[];
  minionsEnabled?: boolean;
  /** Spawn practice dummies at these positions at start. */
  dummies?: { x: number; y: number; team: TeamId; armor?: number; mr?: number }[];
}

/**
 * Data-ability damage against champions x this (docs/DECISIONS.md, pacing): the kits carry 1-3 damage effects where
 * LoL kits have 3-4 plus rune/passive procs, so a level-6 1v1 took ~2-3x LoL's time to kill and laning fights rarely
 * ended in a kill. Minions, monsters and structures are unaffected (farm, jungle and siege balance stay as tuned).
 */
export const CHAMP_ABILITY_DMG_MULT = 1.4;
