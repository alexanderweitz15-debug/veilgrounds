// Laning (positioning behind the own wave, last hits, light push, tower hits) and jungle routing.

import { MINION_STATS, minionScale } from '../../sim/systems/minions';
import { TOWER_AS } from '../../sim/systems/towers';
import type { LaneName, Pt } from '../../sim/map';
import type { Rng } from '../../sim/rng';
import type { BotAction, BotMemory, BotStatic, SnapEntity } from './types';
import type { View } from './perception';
import { dst, laneProgress, lanePoint } from './geo';

/** Units further than this from the lane polyline are not "in the lane". */
const LANE_WIDTH = 900;

const laneTowerAlive = (towers: SnapEntity[], p: Pt): boolean => towers.some((t) => dst(t, p) < 200);

/**
 * Where to stand in a lane: `behind` units behind the contact point of the two waves (or the own wave front).
 * Never inside the first enemy tower's range unless own minions are tanking it.
 */
export function laneSpot(v: View, ctx: BotStatic, lane: LaneName, behind: number): Pt {
  const side = ctx.map.sides[ctx.team];
  const pts = side.lanes[lane];
  let ownFront = -Infinity;
  for (const m of v.ownMinions) {
    const p = laneProgress(pts, m);
    if (p.off < LANE_WIDTH) ownFront = Math.max(ownFront, p.s);
  }
  let enemyFront = Infinity;
  for (const m of v.enemyMinions) {
    const p = laneProgress(pts, m);
    if (p.off < LANE_WIDTH) enemyFront = Math.min(enemyFront, p.s);
  }
  let ownTower = 0;
  for (const t of side.towers[lane]) if (laneTowerAlive(v.ownTowers, t)) ownTower = Math.max(ownTower, laneProgress(pts, t).s);
  let enemyTower = Infinity;
  for (const t of ctx.map.sides[1 - ctx.team]!.towers[lane]) if (laneTowerAlive(v.enemyTowers, t)) enemyTower = Math.min(enemyTower, laneProgress(pts, t).s);
  let anchor: number;
  if (ownFront > -Infinity) anchor = enemyFront < Infinity ? Math.min(ownFront, enemyFront) : ownFront;
  else anchor = enemyFront < Infinity ? enemyFront : ownTower + 700;
  let stand = anchor - behind;
  if (enemyTower < Infinity && ownFront < enemyTower - 700) stand = Math.min(stand, enemyTower - 1050);
  return lanePoint(pts, Math.max(0, stand));
}

/** Damage per second currently aimed at enemy minion `m` by the bot's own minions and towers (all visible). */
export function incomingDps(v: View, m: SnapEntity): number {
  let dps = 0;
  for (const a of v.ownMinions) {
    if (a.atkTarget !== m.id) continue;
    const s = MINION_STATS[a.kind];
    if (s) dps += s.ad * minionScale(v.tick) * s.as;
  }
  for (const t of v.ownTowers) if (t.atkTarget === m.id) dps += (MINION_STATS[m.kind]?.towerPct ?? 0.1) * m.maxHp * TOWER_AS;
  return dps;
}

/**
 * Damage expected on `m` within `t` seconds: attackers in wind-up land one hit soon, then hit at their attack rate;
 * the others start on average half an attack period from now. Towers continuous.
 */
function incomingWithin(v: View, m: SnapEntity, t: number): number {
  let dmg = 0;
  for (const a of v.ownMinions) {
    if (a.atkTarget !== m.id) continue;
    const s = MINION_STATS[a.kind];
    if (!s) continue;
    const ad = s.ad * minionScale(v.tick);
    const first = s.range > 300 ? 0.45 : 0.2; // caster: wind-up + travel
    if (a.atkPhase === 1) dmg += (t >= first ? ad : 0) + ad * s.as * Math.max(0, t - first - 1 / s.as);
    else dmg += ad * s.as * Math.max(0, t - 0.5 / s.as);
  }
  for (const tw of v.ownTowers) if (tw.atkTarget === m.id) dmg += (MINION_STATS[m.kind]?.towerPct ?? 0.1) * m.maxHp * TOWER_AS * t;
  return dmg;
}

/**
 * Last hit: attack now if the minion will be in kill range when the auto lands, or schedule the attack for the
 * predicted moment if that falls before the next decision. Timing error: profile lastHitJitterMs.
 */
export function lastHit(v: View, ctx: BotStatic, mem: BotMemory, rng: Rng, intervalTicks: number): BotAction | null {
  const b = ctx.profile.behavior;
  const as = Math.max(0.1, v.me.stats.as);
  const windup = ctx.champ.base.windup / as;
  const proj = ctx.champ.attackType === 'ranged' ? ctx.champ.base.projectileSpeed ?? 2000 : 0;
  const ms = Math.max(100, v.me.stats.ms);
  const jitter = (rng.normal() * b.lastHitJitterMs) / 1000;
  // own attack timer: estimated from the last observed wind-up/backswing (players see their own animation)
  const cooldown = Math.max(0, mem.atkStart + (30 / as) - v.tick) / 30;
  let now: SnapEntity | null = null;
  let later: { m: SnapEntity; delay: number } | null = null;
  for (const m of v.enemyMinions) {
    const d = dst(v.self, m);
    const reach = v.reach + m.radius;
    if (d > reach + 500) continue;
    const dmg = (v.me.stats.ad * 100) / (100 + (MINION_STATS[m.kind]?.armor ?? 0));
    const dps = incomingDps(v, m);
    const tLand = cooldown + windup + Math.max(0, d - reach) / ms + (proj > 0 ? Math.min(d, reach) / proj : 0);
    const hpAt = (t: number): number => m.hp - incomingWithin(v, m, t);
    if (hpAt(tLand) > 0 && hpAt(tLand + jitter) <= dmg) {
      if (!now || m.hp < now.hp) now = m;
    } else if (dps > 0) {
      const wait = (m.hp - dmg) / dps - tLand - jitter;
      const delay = Math.round(wait * 30);
      if (delay > 0 && delay <= intervalTicks && (!later || delay < later.delay)) later = { m, delay };
    }
  }
  if (now) return { cmd: { t: 'attack', target: now.id } };
  if (later) return { cmd: { t: 'attack', target: later.m.id }, delay: later.delay };
  return null;
}

/** Light push target (-1 = none): the healthiest minion in reach when nothing is about to die; else the first enemy tower. */
export function pushTarget(v: View, ctx: BotStatic): number {
  const dmg = v.me.stats.ad;
  const inReach = v.enemyMinions.filter((m) => dst(v.self, m) <= v.reach + m.radius + 50);
  if (inReach.length) {
    // wait for last hits instead of messing up the timing: no push while any nearby minion drops into kill
    // range within ~3 s
    if (v.enemyMinions.some((m) => dst(v.self, m) < v.reach + 600 && m.hp - incomingDps(v, m) * 3 < dmg * 1.5)) return -1;
    return inReach.sort((a, b) => b.hp - a.hp)[0]!.id;
  }
  // tower: only the first alive one in lane order (others are protected) and only with own minions tanking it
  for (const lane of ['top', 'mid', 'bot'] as const) {
    for (const p of ctx.map.sides[1 - ctx.team]!.towers[lane]) {
      const t = v.enemyTowers.find((e) => dst(e, p) < 200);
      if (!t) continue;
      if (dst(v.self, t) <= v.reach + t.radius + 300 && v.ownMinions.filter((m) => dst(m, t) < 850).length >= 2) {
        return t.id;
      }
      break; // later towers of this lane are protected
    }
  }
  return -1;
}

/**
 * Jungle route over the own camps (map data). Returns 'roam' when no monsters exist (camps not in yet)
 * or every camp was cleared recently.
 * ponytail: fixed route, no camp timers from vision, no smite, no objectives; Phase 3 jungle pathing.
 */
export function jungle(v: View, ctx: BotStatic, mem: BotMemory): BotAction | Pt | 'wait' | 'roam' {
  if (v.monsters.length) {
    mem.monstersSeen = true;
    mem.noMonsters = false;
  }
  if (mem.noMonsters) return 'roam';
  const m = v.monsters.filter((x) => dst(x, v.self) < 900).sort((a, b) => a.hp - b.hp)[0];
  if (m) return v.self.atkTarget === m.id ? 'wait' : { cmd: { t: 'attack', target: m.id } };
  const camps = ctx.map.sides[ctx.team].camps;
  for (let i = 0; i < camps.length; i++) {
    const c = camps[(mem.campIdx + i) % camps.length]!;
    if (v.tick - (mem.campCleared.get(c.id) ?? -1e9) < 150 * 30) continue;
    mem.campIdx = (mem.campIdx + i) % camps.length;
    if (dst(v.self, c) < 350) {
      if (v.time < 90) return 'wait'; // camps not up yet: wait at the first camp
      mem.campCleared.set(c.id, v.tick);
      mem.campIdx++;
      if (!mem.monstersSeen) mem.noMonsters = true;
      return 'wait';
    }
    return { x: c.x, y: c.y };
  }
  return 'roam';
}
