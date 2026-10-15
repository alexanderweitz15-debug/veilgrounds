// Bot brain contract. A brain sees exactly what a player on its team sees (fog-filtered Snapshot) plus static
// game data (map, champion data, builds, lobby setup). It never receives the Sim: this file imports no sim state
// types, and the runner is the only place that touches the Sim (to build snapshots).

import type { Command, PlayerSetup } from '../../sim/types';
import type { MapData, LaneName, Pt } from '../../sim/map';
import type { ChampionData } from '../../sim/champions/schema';
import type { RankProfile } from '../profiles/schema';
import type { BotStyle } from '../profiles/style';
import type { Rng } from '../../sim/rng';
import type { BuildData } from './builds';

export type { Snapshot, SnapEntity, SnapProjectile, PlayerHud } from '../../sim/snapshot';

/** Static, fog-free knowledge: what any player knows from the lobby and the game files. */
export interface BotStatic {
  slot: number;
  team: number;
  role: PlayerSetup['role'];
  /** Lane by role (top/mid; adc + support bot; jungle null). */
  lane: LaneName | null;
  champ: ChampionData;
  build: BuildData | null;
  profile: RankProfile;
  /** Play-style axes 0..1 (src/ai/profiles/style.ts); rough use: aggression, risk, roaming. */
  style: BotStyle;
  map: MapData;
  /** Lobby: all players (champions/roles are public knowledge in pick phase). */
  players: readonly PlayerSetup[];
}

/** A command plus how many ticks from now it should be issued (reaction delay, last-hit timing). */
export interface BotAction {
  cmd: Command;
  delay?: number;
}

/** Mutable per-bot memory, owned by the brain. */
export interface BotMemory {
  /** Enemy champion serial -> tick from which the bot may react to it (reaction delay). */
  aware: Map<number, { from: number; lastSeen: number; x: number; y: number }>;
  /** Projectile id -> handled (dodge decision already taken). */
  projSeen: Map<number, number>;
  lastMove: (Pt & { tick: number }) | null;
  /** Positions sampled at decisions for stuck detection. */
  trail: (Pt & { tick: number })[];
  mode: string;
  fightTarget: number;
  fightReadyAt: number;
  chaseRolled: Map<number, boolean>;
  /** Shop: index into the build plan; phantom = gold the bot "spent" that the sim did not charge. */
  buyIdx: number;
  phantomGold: number;
  pendingBuy: { goldBefore: number; cost: number } | null;
  shopVisitDone: boolean;
  /** Jungle. */
  campIdx: number;
  campCleared: Map<string, number>;
  monstersSeen: boolean;
  noMonsters: boolean;
  /** Mid-game grouping decision (rolled once). */
  groupRolled: boolean | null;
  wasDead: boolean;
  /** No new move orders before this tick (unstick detour in progress). */
  holdUntil: number;
  /** Estimated tick the bot's latest auto attack started (own attack timer). */
  atkStart: number;
  /** No commands before this tick except level-ups (own cast wind-up or channel would break). */
  busyUntil: number;
  busyFrom: number;
  busySlot: number;
}

export const newMemory = (): BotMemory => ({
  aware: new Map(),
  projSeen: new Map(),
  lastMove: null,
  trail: [],
  mode: 'start',
  fightTarget: -1,
  fightReadyAt: 0,
  chaseRolled: new Map(),
  buyIdx: 0,
  phantomGold: 0,
  pendingBuy: null,
  shopVisitDone: false,
  campIdx: 0,
  campCleared: new Map(),
  monstersSeen: false,
  noMonsters: false,
  groupRolled: null,
  wasDead: false,
  holdUntil: 0,
  atkStart: -1000,
  busyUntil: 0,
  busyFrom: 0,
  busySlot: -1,
});

/** Brain signature: snapshot + static data + own memory + own RNG. Never the Sim. */
export type Brain = (snap: import('../../sim/snapshot').Snapshot, ctx: BotStatic, mem: BotMemory, rng: Rng) => BotAction[];
