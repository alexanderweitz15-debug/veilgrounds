// Scripted bot scenarios for Agent L's perception / gank / roam tests: hand-built fog-filtered snapshots (the
// bot code only ever sees Snapshot + static data), exact-rank BotParams and a NodeCtx for tree leaves.

import { loadMap, type LaneName, type MapData } from '../src/sim/map';
import { Kind, type PlayerSetup, type SimEvent } from '../src/sim/types';
import type { PlayerHud, ScoreRow, SnapAudio, SnapEntity, Snapshot } from '../src/sim/snapshot';
import { CHAMPION_DATA } from '../src/sim/champions';
import type { ChampionData } from '../src/sim/champions/schema';
import { Rng } from '../src/sim/rng';
import { profileOf } from '../src/ai/profiles';
import type { Rank } from '../src/ai/profiles/schema';
import { computeKnobs, neutralPlaystyle } from '../src/ai/params';
import type { BotParams, DecisionLogEntry, Playstyle } from '../src/ai/contract';
import { newMemory, type BotMemory, type BotStatic } from '../src/ai/bot/types';
import { perceive as perceiveM } from '../src/ai/bot/perception';
import type { NodeCtx } from '../src/ai/bt/types';
import { newPerceptionState, perceive, type BotPerception, type PerceptionState } from '../src/ai/perception';

export const MAP: MapData = loadMap();
export const champ = (id: string): ChampionData => (CHAMPION_DATA as Record<string, ChampionData>)[id]!;

/** Lobby: blue 0-4, red 5-9 (top, jungle, mid, adc, support). */
export const ROSTER: [string, PlayerSetup['role']][] = [
  ['brom', 'top'],
  ['lio', 'jungle'],
  ['aurel', 'mid'],
  ['mira', 'adc'],
  ['gorvam', 'support'],
  ['isolde', 'top'],
  ['grimald', 'jungle'],
  ['thessaly', 'mid'],
  ['tobin', 'adc'],
  ['kiran', 'support'],
];

export const PLAYERS: PlayerSetup[] = ROSTER.map(([c, role], slot) => ({
  slot,
  team: slot < 5 ? 0 : 1,
  champion: c,
  role,
  summoners: role === 'jungle' ? ['sprung', 'bannen'] : ['sprung', 'heilen'],
  isHuman: false,
  bot: { rank: 'gold', variance: 'stable' },
}));

export function paramsFor(rank: Rank, style: Partial<Playstyle> = {}, slot = 0): BotParams {
  const prof = profileOf(rank);
  const playstyle = { ...neutralPlaystyle(), ...style };
  return { slot, rank, skill: prof.skill, behavior: prof.behavior, playstyle, archetype: null, rolled: false, knobs: computeKnobs(playstyle), hysteresis: prof.behavior.hysteresis, personalitySeed: 1 };
}

const LANE: Record<string, LaneName | null> = { top: 'top', mid: 'mid', adc: 'bot', support: 'bot', jungle: null };

export function botStatic(slot: number, params: BotParams, log: DecisionLogEntry[] = []): BotStatic {
  const p = PLAYERS[slot]!;
  return {
    slot,
    team: p.team,
    role: p.role,
    lane: LANE[p.role]!,
    toxic: true,
    champ: champ(p.champion),
    build: null,
    profile: profileOf(params.rank),
    map: MAP,
    players: PLAYERS,
    params,
    log: { push: (e: DecisionLogEntry) => void log.push(e), entries: () => log },
    teamAI: null as never,
  } as BotStatic;
}

/** Champion entity id = 100 + slot. */
export const eidOf = (slot: number): number => 100 + slot;

export function champEnt(slot: number, x: number, y: number, o: Partial<SnapEntity> = {}): SnapEntity {
  const p = PLAYERS[slot]!;
  const c = champ(p.champion);
  const level = o.level ?? 6;
  const maxHp = c.base.hp + c.base.hpGrowth * (level - 1);
  return {
    id: eidOf(slot),
    serial: eidOf(slot),
    kind: Kind.Champion,
    team: p.team,
    x,
    y,
    px: x,
    py: y,
    fx: 1,
    fy: 0,
    hp: maxHp,
    maxHp,
    shield: 0,
    mana: 300,
    maxMana: 300,
    radius: c.base.radius,
    level,
    champ: p.champion,
    slot,
    atkPhase: 0,
    atkTarget: -1,
    moving: false,
    alive: true,
    ...o,
  };
}

let nextId = 2000;
export function minion(team: number, x: number, y: number, kind: number = Kind.MinionMelee): SnapEntity {
  const id = nextId++;
  return { id, serial: id, kind, team, x, y, px: x, py: y, fx: 1, fy: 0, hp: 400, maxHp: 400, shield: 0, mana: 0, maxMana: 0, radius: 40, level: 0, champ: null, slot: -1, atkPhase: 0, atkTarget: -1, moving: false, alive: true };
}

/** All towers (structures are always in a snapshot). */
export function towers(): SnapEntity[] {
  const out: SnapEntity[] = [];
  let id = 900;
  for (const team of [0, 1] as const)
    for (const lane of ['top', 'mid', 'bot'] as const)
      for (const p of MAP.sides[team].towers[lane]) out.push({ id: id, serial: id++, kind: Kind.Tower, team, x: p.x, y: p.y, px: p.x, py: p.y, fx: 0, fy: 0, hp: 3000, maxHp: 3000, shield: 0, mana: 0, maxMana: 0, radius: 88, level: 0, champ: null, slot: -1, atkPhase: 0, atkTarget: -1, moving: false, alive: true });
  return out;
}

export function hud(slot: number, o: Partial<PlayerHud> = {}, flashCd = 0): PlayerHud {
  const c = champ(PLAYERS[slot]!.champion);
  const sums = PLAYERS[slot]!.summoners;
  return {
    eid: eidOf(slot),
    champ: c.id,
    level: 6,
    xp: 0,
    gold: 500,
    cs: 40,
    dead: false,
    respawnIn: 0,
    items: [null, null, null, null, null, null, null],
    itemCds: [],
    inFountain: false,
    marks: [],
    recallLeft: 0,
    cc: 0,
    trinket: { id: 'schleierward', charges: 0, maxCharges: 2, cdLeft: 60, cdTotal: 90, canSwap: null },
    abilities: [
      ...c.abilities.map((a, i) => ({ id: a.id, rank: i === 3 ? 1 : 2, maxRank: i === 3 ? 3 : 5, cdLeft: 0, cdTotal: 8, cost: 50, canLevel: false })),
      ...sums.map((id) => ({ id, rank: 1, maxRank: 1, cdLeft: id === 'sprung' ? flashCd : 0, cdTotal: 300, cost: 0, canLevel: false })),
    ],
    stats: { ad: 80, ap: 0, armor: 40, mr: 32, as: 0.7, ms: c.base.ms, range: c.base.range, crit: 0 },
    ...o,
  };
}

export function rows(o: Partial<Record<number, Partial<ScoreRow>>> = {}): ScoreRow[] {
  return PLAYERS.map((p) => ({ slot: p.slot, team: p.team, champ: p.champion, level: 6, kills: 0, deaths: 0, assists: 0, cs: 40, dead: false, itemValue: 0, ...(o[p.slot] ?? {}) }));
}

export interface SnapSpec {
  tick: number;
  team: number;
  entities: SnapEntity[];
  me: PlayerHud | null;
  events?: SimEvent[];
  eventTicks?: number[];
  audio?: SnapAudio[];
  players?: ScoreRow[];
}

export const snapshot = (s: SnapSpec): Snapshot => ({
  tick: s.tick,
  time: s.tick / 30,
  team: s.team,
  entities: [...s.entities, ...towers()],
  projectiles: [],
  objects: [],
  me: s.me,
  events: s.events ?? [],
  ...(s.eventTicks ? { eventTicks: s.eventTicks } : {}),
  audio: s.audio ?? [],
  players: s.players ?? rows(),
});

/** One bot: its static data, perception state, Rng and decision log. */
export class ScriptedBot {
  readonly log: DecisionLogEntry[] = [];
  readonly st: PerceptionState = newPerceptionState();
  readonly mem: BotMemory = newMemory();
  readonly rng: Rng;
  readonly ctx: BotStatic;
  constructor(
    readonly slot: number,
    readonly params: BotParams,
    seed: number,
  ) {
    this.rng = new Rng(seed);
    this.ctx = botStatic(slot, params, this.log);
  }
  perceive(snap: Snapshot): BotPerception {
    return perceive(this.st, snap, this.ctx, this.params, this.rng);
  }
  /** NodeCtx for one decision (M's View + L's perception). */
  node(snap: Snapshot): NodeCtx {
    const pv = this.perceive(snap);
    const v = perceiveM(snap, this.ctx, this.mem, this.rng)!;
    const log = this.log;
    const slot = this.slot;
    return {
      snap,
      v,
      ctx: this.ctx,
      mem: this.mem,
      rng: this.rng,
      p: this.params,
      pv,
      out: [],
      log(node, chosen, reason, inputs = {}, scores, err) {
        log.push({ tick: snap.tick, bot: slot, node, inputs, ...(scores ? { scores } : {}), chosen, reason, ...(err ? { injectedError: err } : {}) });
        return snap.tick;
      },
    };
  }
  /** Decision interval in ticks (profile microHz). */
  get interval(): number {
    return Math.max(1, Math.round(30 / this.params.behavior.microHz));
  }
}
