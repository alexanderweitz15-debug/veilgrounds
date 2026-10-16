// Shared inputs of the utility value functions, computed once per decision from the bot's view only (fog snapshot,
// L's perception, public game rules: minion gold/XP, wave timing, death timer, static map paths).

import type { LaneName, Pt } from '../../sim/map';
import { findPath } from '../../sim/map';
import { Kind } from '../../sim/types';
import { MINION_STATS } from '../../sim/systems/minions';
import { waveInterval } from '../../sim/systems/waves';
import { deathTimerTicks } from '../../sim/systems/economy';
import type { NodeCtx } from '../bt/types';
import { lv } from '../ganks/common';
import { dst, laneProgress } from '../bot/geo';
import { incomingDps } from '../bot/laning';
import { VALUES, rankCurve } from './values';
import type { World } from './types';

const G = VALUES.gold;
const L = VALUES.lane;

/** Siege minion share per wave (public wave rule, src/sim/systems/waves.ts: every 3rd wave, 2nd from 15:00, every
 *  wave from 25:00). */
const siegeShare = (time: number): number => (time < 15 * 60 ? 1 / 3 : time < 25 * 60 ? 1 / 2 : 1);

/** Gold equivalent of one lane minion for this bot (last-hit share x gold + XP x xp gold). */
export function minionValue(kind: number, csShare: number): number {
  const s = MINION_STATS[kind];
  if (!s) return 0;
  return s.gold * csShare + s.xp * G.xp;
}

/** Expected gold/s of lane presence: one wave per waveInterval (3 melee + 3 casters + siege share). */
export function laneRateOf(time: number, csShare: number, support: boolean): number {
  const interval = waveInterval(Math.round(time * 30)) / 30;
  const melee = MINION_STATS[Kind.MinionMelee]!;
  const caster = MINION_STATS[Kind.MinionCaster]!;
  const siege = MINION_STATS[Kind.MinionSiege]!;
  const sh = siegeShare(time);
  const gold = 3 * melee.gold + 3 * caster.gold + sh * siege.gold;
  const xp = 3 * melee.xp + 3 * caster.xp + sh * siege.xp;
  // XP is shared in a duo lane (economy.ts: 65 % each for two champions)
  if (support) return (xp * 0.65 * G.xp) / interval + L.supportPresenceGoldPerS;
  return (gold * csShare + xp * G.xp) / interval;
}

/** Kill gold the bot's own death gives the enemy (public bounty rule with the bot's own kill streak). */
export function ownBounty(streak: number): number {
  const k = G.kill;
  return streak >= 2 ? Math.min(k.streakMax, k.base + k.streakStep * (streak - 1)) : k.base;
}

/** Kill gold an enemy is worth (streak unknown to the bot: base bounty). */
export const killGold = (): number => G.kill.base;

/** Gold value of damaging an enemy champion by `hp` points (kill lead; more on a low target, spec §5). */
export function hpGold(hp: number, targetHpFrac: number): number {
  const low = 1 + (G.hpPerPointLowMult - 1) * Math.max(0, Math.min(1, 1 - targetHpFrac));
  return hp * G.hpPerPointFull * low;
}

const tripCache = new Map<string, number>();

/** Walk length fountain -> the lane's outer stand area (static nav path; cached per team and lane). */
export function laneTripLength(n: NodeCtx, lane: LaneName): number {
  const key = `${n.ctx.team}:${lane}`;
  let len = tripCache.get(key);
  if (len === undefined) {
    const side = n.ctx.map.sides[n.ctx.team];
    const f = side.fountain;
    const t = side.towers[lane][0]!;
    const path = findPath(n.ctx.map.nav, f.x, f.y, t.x, t.y);
    let a: Pt = f;
    len = 0;
    for (const q of path) (len += dst(a, q)), (a = q);
    tripCache.set(key, len);
  }
  return len;
}

/** Lane of the bot right now (team-AI override, role lane); jungler: null unless overridden. */
export const laneNow = (n: NodeCtx): LaneName | null => n.mem.ext.laneOverride ?? n.ctx.lane;

export function buildWorld(n: NodeCtx): World {
  const v = n.v;
  const pv = lv(n);
  const lane = laneNow(n);
  const skill = n.ctx.params.skill;
  const csShare = rankCurve(L.csShare, skill);
  const support = n.ctx.role === 'support';
  const laneRate = lane ? laneRateOf(v.time, csShare, support) : 0;
  const ownRate = Math.max(VALUES.death.ownGoldRateFloor, n.ctx.role === 'jungle' ? VALUES.jungle.campGoldPerS : laneRate);
  const respawnS = deathTimerTicks(v.me.level, v.tick) / 30;
  const deathCost = ownBounty(n.mem.ext.killStreak) + respawnS * ownRate + VALUES.death.objectiveRisk;
  const gankRisk = lane ? n.pv.gankRisk[lane] ?? 0 : 0;
  const minions: World['minions'] = [];
  if (lane) {
    const pts = n.ctx.map.sides[n.ctx.team].lanes[lane];
    const myDps = v.me.stats.ad * Math.max(0.1, v.me.stats.as);
    for (const m of v.enemyMinions) {
      if (dst(m, v.self) > L.farmRadius || laneProgress(pts, m).off > L.laneWidth) continue;
      const dps = incomingDps(v, m) + myDps;
      minions.push({ m, dieS: m.hp / Math.max(1, dps), gold: support ? (MINION_STATS[m.kind]?.xp ?? 0) * 0.65 * G.xp : minionValue(m.kind, csShare) });
    }
  }
  const wave = lane && pv ? pv.waves[lane] : null;
  const absenceFrac = wave ? (wave.atOwnTower ? L.absenceLossFrac.atOwnTower : wave.crashed ? L.absenceLossFrac.crashed : L.absenceLossFrac.neutral) : L.absenceLossFrac.neutral;
  const ms = Math.max(200, v.me.stats.ms);
  const recallTripS = (lane ? laneTripLength(n, lane) : laneTripLength(n, 'mid')) / ms + VALUES.horizons.recallChannel;
  return {
    n,
    pv,
    tick: v.tick,
    time: v.time,
    lane,
    gankRisk,
    laneRate,
    ownRate,
    deathCost,
    minions,
    absenceFrac,
    waveCrashed: !!wave?.crashed,
    waveAtOwnTower: !!wave?.atOwnTower,
    recallTripS,
  };
}

/** Gold the own lane loses while the bot is away for `s` seconds (wave state decides how much dies unfarmed). */
export const absenceLoss = (w: World, s: number): number => w.laneRate * s * w.absenceFrac;

