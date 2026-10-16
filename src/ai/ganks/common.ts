// Shared helpers of Agent L's tree leaves (ganks §4, roams §5). Leaves read only NodeCtx: snapshot, static data,
// BotParams and the L perception view (NodeCtx.pv as BotPerception). Never the Sim.

import type { NodeCtx } from '../bt/types';
import type { LaneName, Pt } from '../../sim/map';
import { findPath } from '../../sim/map';
import { Kind, type PingKind } from '../../sim/types';
import type { ChampionData } from '../../sim/champions/schema';
import { CHAMPION_DATA } from '../../sim/champions';
import type { SnapEntity } from '../../sim/snapshot';
import type { DecisionLogEntry, ErrorId } from '../contract';
import { dst } from '../bot/geo';
import { isCC } from '../perception/perceive';
import { pingChance } from '../perception/rankModel';
import type { BotPerception, TrackMem } from '../perception/types';

export type Inputs = DecisionLogEntry['inputs'];

/** The L perception view, or null while NodeCtx.pv is still a stub without L's fields. */
export const lv = (n: NodeCtx): BotPerception | null => ('mem' in n.pv && 'waves' in n.pv ? (n.pv as BotPerception) : null);

/** Typed slot of the persistent tactics memory. */
export function tac<T>(pv: BotPerception, key: string, init: () => T): T {
  let v = pv.mem.tactics[key] as T | undefined;
  if (v === undefined) pv.mem.tactics[key] = v = init();
  return v;
}

export const champOf = (id: string): ChampionData | undefined => (CHAMPION_DATA as Record<string, ChampionData>)[id];
export const hasCC = (c: ChampionData | undefined): boolean => !!c && c.abilities.some((a) => isCC(a));
export const hpFrac = (e: { hp: number; maxHp: number }): number => (e.maxHp > 0 ? e.hp / e.maxHp : 0);

export const LANE_ROLES: Record<LaneName, string[]> = { top: ['top'], mid: ['mid'], bot: ['adc', 'support'] };
export const laneOfRole = (role: string): LaneName | null => (role === 'top' ? 'top' : role === 'mid' ? 'mid' : role === 'adc' || role === 'support' ? 'bot' : null);

/** Enemy tracks of the laners of a lane. */
export const laneEnemies = (pv: BotPerception, lane: LaneName): TrackMem[] => [...pv.enemies.values()].filter((t) => LANE_ROLES[lane].includes(t.role));

/** Own champion entity of a role (self included). */
export function allyOfRole(n: NodeCtx, pv: BotPerception, role: string): SnapEntity | null {
  const p = n.ctx.players.find((q) => q.team === n.ctx.team && q.role === role);
  if (!p) return null;
  if (p.slot === n.ctx.slot) return pv.self;
  return pv.allies.find((a) => a.slot === p.slot) ?? null;
}

/** Own summoner index (0/1) of a spell id if ready, else -1. */
export function readySummoner(n: NodeCtx, id: string): 0 | 1 | -1 {
  const me = n.snap.me;
  if (!me) return -1;
  for (const i of [0, 1] as const) {
    const a = me.abilities[4 + i];
    if (a && a.id === id && a.rank > 0 && a.cdLeft <= 0) return i;
  }
  return -1;
}

export const ownMs = (n: NodeCtx): number => n.snap.me?.stats.ms ?? n.ctx.champ.base.ms;

/** Path (waypoints) and its length from the bot to p over the static nav grid. */
export function pathTo(n: NodeCtx, from: Pt, p: Pt): { path: Pt[]; length: number } {
  const path = findPath(n.ctx.map.nav, from.x, from.y, p.x, p.y);
  let length = 0;
  let a = from;
  for (const q of path) (length += dst(a, q)), (a = q);
  return { path, length };
}

/**
 * Move order with throttling (a new move only for a new goal, when stopped, or every 0.5 s). Returns false when
 * the bot is already there (no progress possible): a leaf must then not report 'running'.
 */
export function move(n: NodeCtx, pv: BotPerception, p: Pt): boolean {
  if (pv.self && dst(pv.self, p) < 150) return false;
  const last = tac<{ x: number; y: number; tick: number } | null>(pv, 'lastMove', () => null);
  // same goal while walking: keep the path (was re-issued every 0.5 s: needless re-paths and stutter); a moving goal
  // (chased target) drifts past 120 and is re-issued then, at most every 0.5 s
  if (pv.self && last && dst(last, p) < 120 && pv.self.moving && n.snap.tick - last.tick < 90) return true;
  if (pv.self && last && pv.self.moving && n.snap.tick - last.tick < 15) return true;
  pv.mem.tactics.lastMove = { x: p.x, y: p.y, tick: n.snap.tick };
  n.out.push({ cmd: { t: 'move', x: Math.round(p.x), y: Math.round(p.y) } });
  return true;
}

/** Team ping with the rank's ping probability (spec §4.2.7) unless `always`. Rate: one per kind per 4 s. */
export function ping(n: NodeCtx, pv: BotPerception, kind: PingKind, p: Pt, always = false): boolean {
  const last = tac<Record<string, number>>(pv, 'pingAt', () => ({}));
  if (n.snap.tick - (last[kind] ?? -1e9) < 120) return false;
  if (!always && !n.rng.chance(pingChance(n.p))) return false;
  last[kind] = n.snap.tick;
  n.out.push({ cmd: { t: 'ping', kind, x: Math.round(p.x), y: Math.round(p.y) } });
  return true;
}

/** Log helper with the perception age convention (inputs.perceptionAgeMs mirrors the view age). */
export function log(n: NodeCtx, pv: BotPerception, node: string, chosen: string, reason: string, inputs: Inputs = {}, scores?: Record<string, number>, err?: ErrorId): void {
  inputs.perceptionAgeMs = pv.ageMs;
  n.log(node, chosen, reason, inputs, scores, err);
}

/** Rough sustained damage per second of a champion at a level (data knowledge; no items). */
export function dpsOf(c: ChampionData | undefined, level: number): number {
  if (!c) return 120;
  const ad = c.base.ad + c.base.adGrowth * (level - 1);
  return ad * c.base.as * 1.3 + 15 * level;
}

/** Known enemy wards (team-visible ward entities). */
export const enemyWards = (n: NodeCtx): SnapEntity[] => n.snap.entities.filter((e) => e.kind === Kind.Ward && e.team !== n.ctx.team && e.alive);

/** Path passes within `r` of a known enemy ward. */
export function pathWarded(n: NodeCtx, from: Pt, path: readonly Pt[], r = 700): boolean {
  const wards = enemyWards(n);
  if (!wards.length) return false;
  let a = from;
  for (const b of path) {
    const d = dst(a, b);
    const k = Math.max(1, Math.ceil(d / 200));
    for (let i = 0; i <= k; i++) {
      const p = { x: a.x + ((b.x - a.x) * i) / k, y: a.y + ((b.y - a.y) * i) / k };
      if (wards.some((w) => dst(w, p) < r)) return true;
    }
    a = b;
  }
  return false;
}

/** Own trinket has a ward charge. */
export const canWard = (n: NodeCtx): boolean => !!n.snap.me?.trinket && n.snap.me.trinket.id === 'schleierward' && n.snap.me.trinket.charges > 0;

/** Seconds until an objective spawns, from public timers + announced deaths (pv.mem.objectiveDeaths). */
export function objectiveSpawnIn(pv: BotPerception, name: 'leviathan' | 'schleierwaechter'): number {
  const [first, respawn] = name === 'leviathan' ? [300, 300] : [1200, 360];
  const dead = pv.mem.objectiveDeaths.get(name);
  const at = dead === undefined ? first : dead / 30 + respawn;
  return at - pv.time;
}

/** Enemy jungler's player slot (lobby knowledge), or undefined. */
export const enemyJunglerSlot = (pv: BotPerception): number | undefined => [...pv.enemies.values()].find((t) => t.role === 'jungle')?.slot;
