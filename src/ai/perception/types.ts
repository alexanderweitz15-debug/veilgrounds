// Perception state and view types (Agent L, spec-bots §3). The view extends the shared PerceptionView contract.

import type { EnemyTrack, PerceptionView } from '../contract';
import type { LaneName, Pt } from '../../sim/map';
import type { PingKind } from '../../sim/types';
import type { SnapEntity, Snapshot } from '../../sim/snapshot';
import type { EnemyStyleObs } from './enemyStyle';

/**
 * Where a logged/used enemy position comes from (spec test 7): 'seen' = the team saw the champion there at
 * EnemyTrack.lastTick; 'cloud' = estimate from a seen/heard/pinged anchor; 'audio' = blurred heard cast;
 * 'ping' = ally ping; 'prior' = map-knowledge estimate (camp/gank timers), derived from no sighting at all.
 */
export type PosSource = 'seen' | 'cloud' | 'audio' | 'ping' | 'prior';

/** Bot-internal track: the public EnemyTrack plus bookkeeping. */
export interface TrackMem extends EnemyTrack {
  /** Entity id last seen for this slot (stable while the champion lives). */
  eid: number;
  /** Bot has noticed the champion in near range from this tick (reaction delay); -1 = not in near range. */
  noticedFrom: number;
  /** Previous perceived sample (for direction and blink detection). */
  prev: { x: number; y: number; tick: number } | null;
  /** Ever perceived. */
  known: boolean;
  /** Cloud anchor (last seen / heard / pinged position) and its source. */
  anchor: { x: number; y: number; tick: number; src: PosSource } | null;
  /** Per ability slot 0..3: tick the bot believes it is ready again (all-tracking ranks). */
  abilityReadyAt: number[];
  /** Last casts the bot saw (newest last, max 6) incl. bot-relative aim info for hook pattern recognition. */
  casts: { tick: number; slot: number; tx: number; ty: number; myX: number; myY: number; myVx: number; myVy: number }[];
  /** Scoreboard: dead flag and CS (public). */
  dead: boolean;
  cs: number;
  csAtLastSeen: number;
  /** Tick from which a Silver bot may use the latest sighting for GankRisk (8-15 s late). */
  usableFrom: number;
  /** Missing ping about this enemy received (tick), -1 none. */
  missingPingTick: number;
  /** Flash uses observed (style estimate). */
  flashes: number;
}

export interface WaveInfo {
  /** Any lane minion visible to the team. */
  visible: boolean;
  ownCount: number;
  enemyCount: number;
  /** Arc position (0 = own nexus, 1 = enemy nexus) of the clash (mean of visible lane minions), NaN if none. */
  pos: number;
  /** Clash past the lane middle toward the enemy (the bot's laner is pushed up). */
  enemySide: boolean;
  /** Own minions under the enemy outer-most alive tower in this lane (wave crashed). */
  crashed: boolean;
  /** Clash at/under the own outer-most alive tower. */
  atOwnTower: boolean;
  /** Own wave clearly bigger (pushing toward the enemy). */
  pushing: boolean;
  /** Own siege minion present. */
  siege: boolean;
}

export interface PingMem {
  slot: number;
  kind: PingKind;
  x: number;
  y: number;
  tick: number;
  target: number;
}

export interface AudioCue {
  slot: number;
  abilitySlot: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  tick: number;
}

/** Incoming enemy cast the bot saw start (predictive dodge input, spec §3 "Vorhersage"). */
export interface IncomingCast {
  slot: number;
  abilitySlot: number;
  /** Caster position at cast start and unit direction to the cursor. */
  ox: number;
  oy: number;
  dx: number;
  dy: number;
  range: number;
  width: number;
  /** Tick the cast started (wind-up begin). */
  tick: number;
  /** Tick the effect reaches the bot's current position (wind-up + flight). */
  hitTick: number;
  cc: boolean;
  /** The aimed line/area covers the bot's current position. */
  onMe: boolean;
}

/** Mutable per-bot perception memory (one per bot; create with newPerceptionState). */
export interface PerceptionState {
  initialized: boolean;
  tracks: Map<number, TrackMem>;
  eidToSlot: Map<number, number>;
  lastGlance: number;
  nextGlance: number;
  glanceReason: string;
  /** Last decision tick (perception age reference). */
  lastTick: number;
  wasRecalling: boolean;
  pings: PingMem[];
  /** Bush index -> last tick an ally/ward stood in it (fog uncertainty grows from there). */
  bushClear: Map<number, number>;
  /** Enemy ward entity ids already counted (style estimate). */
  wardsSeen: Set<number>;
  /** Jungle camp id (team-qualified, "0:dornenbock") -> tick it was seen cleared/killed. */
  campKilled: Map<string, number>;
  /** Enemy jungler start side estimate from the leash read (Challenger), null = unknown. */
  junglerStart: 'top' | 'bot' | null;
  /** Epic objective death ticks (announced), for spawn glances. */
  objectiveDeaths: Map<string, number>;
  /** Per enemy slot: behaviour observations for style estimation (§5.3). */
  styleObs: Map<number, EnemyStyleObs>;
  /** Own recent damage taken (tick, amount) for burst detection. */
  dmgTaken: { tick: number; amount: number }[];
  /** Escape/gank/roam node memory (owned by src/ai/ganks + src/ai/roams). */
  tactics: Record<string, unknown>;
  /** Own champion position at the previous decision (own velocity for hook pattern recognition). */
  selfPrev: (Pt & { tick: number }) | null;
}

export interface BotPerception extends PerceptionView {
  enemies: ReadonlyMap<number, TrackMem>;
  time: number;
  snap: Snapshot;
  self: SnapEntity | null;
  /** Perceived enemy champions right now (noticed in near range or seen at this tick's minimap glance). */
  visibleEnemies: SnapEntity[];
  allies: SnapEntity[];
  waves: Readonly<Record<LaneName, WaveInfo>>;
  /** Minimap glance happened at this decision (and why). */
  glanced: string | null;
  /** Team pings since the last decision (incl. own). */
  newPings: readonly PingMem[];
  /** Enemy casts seen starting since the last decision. */
  incoming: readonly IncomingCast[];
  /** Hook champions' aim pattern over their last 3 casts at this bot. */
  hookPattern: ReadonlyMap<number, 'position' | 'lead' | 'mixed'>;
  /** Damage taken in the last second as a fraction of max HP. */
  burst1s: number;
  /** Ticks since the bot's information about the most relevant enemy was refreshed (log perceptionAgeMs). */
  ageMs: number;
  /** Persistent memory (escape/gank/roam nodes keep their state here). */
  mem: PerceptionState;
  /** Probability-weighted position of the enemy jungler (cloud / timer prior), null = unknown. */
  junglerEstimate: { x: number; y: number; r: number; weight: number; src: PosSource; tick: number } | null;
}

export const newPerceptionState = (): PerceptionState => ({
  initialized: false,
  tracks: new Map(),
  eidToSlot: new Map(),
  lastGlance: -1e9,
  nextGlance: 0,
  glanceReason: '',
  lastTick: 0,
  wasRecalling: false,
  pings: [],
  bushClear: new Map(),
  wardsSeen: new Set(),
  campKilled: new Map(),
  junglerStart: null,
  objectiveDeaths: new Map(),
  styleObs: new Map(),
  dmgTaken: [],
  tactics: {},
  selfPrev: null,
});
