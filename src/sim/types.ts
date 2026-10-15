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
} as const;
export type KindId = (typeof Kind)[keyof typeof Kind];
export const isMinion = (k: number): boolean => k >= Kind.MinionMelee && k <= Kind.MinionSuper;
export const isStructure = (k: number): boolean => k >= Kind.Tower && k <= Kind.Nexus;

export const Lane = { Top: 0, Mid: 1, Bot: 2, None: 255 } as const;
export type LaneId = 0 | 1 | 2;

export type DamageType = 'phys' | 'magic' | 'true';

/** Player-equivalent inputs. Bots and humans produce exactly these; sim never trusts anything else. */
export type Command =
  | { t: 'move'; x: number; y: number }
  | { t: 'attack'; target: number }
  | { t: 'attackMove'; x: number; y: number }
  | { t: 'stop' }
  | { t: 'cast'; slot: 0 | 1 | 2 | 3; x: number; y: number; target?: number }
  | { t: 'spell'; slot: 0 | 1; x: number; y: number; target?: number }
  | { t: 'levelUp'; slot: 0 | 1 | 2 | 3 }
  | { t: 'recall' }
  | { t: 'buy'; item: string }
  | { t: 'sell'; slot: number }
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
  | 'skipTime';

/** One input as recorded in replays: which player slot issued what on which tick. */
export interface TickInput {
  slot: number;
  cmd: Command;
}

/** Events are produced during a tick and consumed by render/stats. Cleared at the start of each tick. */
export type SimEvent =
  | { e: 'damage'; src: number; dst: number; amount: number; type: DamageType; crit?: boolean }
  | { e: 'death'; eid: number; kind: number; team: number; killer: number; x: number; y: number }
  | { e: 'gold'; eid: number; amount: number; x: number; y: number }
  | { e: 'lastHitMiss'; eid: number; target: number; earlyHp?: number; lateMs?: number }
  | { e: 'level'; eid: number; level: number }
  | { e: 'attack'; src: number; dst: number }
  | { e: 'cast'; src: number; slot: number; x: number; y: number }
  | { e: 'plate'; tower: number; team: number }
  | { e: 'wave'; lane: number; team: number; index: number }
  | { e: 'respawn'; eid: number }
  /** Ground telegraph: AoE that resolves at tick `at` (render shows radius + fill). */
  | { e: 'zone'; src: number; team: number; x: number; y: number; r: number; start: number; at: number }
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
  /** Prägungen; omitted = champion's default preset (src/sim/items/runes.ts). */
  runes?: { keystone: string; minor: [string, string, string] };
  /** Bot-controlled slot (with isHuman false): rank profile + per-game variance (src/ai/runner.ts). */
  bot?: { rank: import('../ai/profiles/schema').Rank; variance: 'stable' | 'normal' | 'volatile'; name?: string };
}

export interface SimConfig {
  seed: number;
  mode: 'classic' | 'sandbox' | 'lastHit' | 'laneOnly';
  players: PlayerSetup[];
  /** Lanes that spawn minions. Default: all three. */
  minionLanes?: LaneId[];
  minionsEnabled?: boolean;
  /** Spawn practice dummies at these positions at start. */
  dummies?: { x: number; y: number; team: TeamId; armor?: number; mr?: number }[];
}
