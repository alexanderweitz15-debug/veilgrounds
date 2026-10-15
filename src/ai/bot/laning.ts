// Laning (positioning behind the own wave, last hits, light push, tower hits) and jungle routing.

import { MINION_STATS, minionScale } from '../../sim/systems/minions';
import { TOWER_AS } from '../../sim/systems/towers';
import { CAMPS } from '../../sim/systems/jungle';
import type { LaneName, Pt } from '../../sim/map';
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

/** Light push target (-1 = none): the healthiest minion in reach when nothing is about to die; else the first enemy tower. */
export function pushTarget(v: View, ctx: BotStatic): number {
  const dmg = v.me.stats.ad;
  const inReach = v.enemyMinions.filter((m) => dst(v.self, m) <= v.reach + m.radius + 50);
  // a tower tanked by a big own wave is the better target than its last defenders (the caller keeps last hits first)
  const firstTower = (['top', 'mid', 'bot'] as const)
    .map((l) => ctx.map.sides[1 - ctx.team]!.towers[l].map((p) => v.enemyTowers.find((e) => dst(e, p) < 200)).find((t) => !!t))
    .find((t) => !!t && dst(v.self, t) <= v.reach + t.radius && t.atkTarget !== v.me.eid && v.ownMinions.filter((m) => dst(m, t) < 850).length >= 4);
  if (firstTower) return firstTower.id;
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
      // tanked by own minions, or a group siege: at least two allies at the tower and not more enemies defending
      const tanked = v.ownMinions.filter((m) => dst(m, t) < 850).length >= 2;
      const siege = t.atkTarget !== v.me.eid && v.ownMinions.some((m) => dst(m, t) < 900) && v.allies.filter((a) => dst(a, t) < 1100).length >= 2 && v.enemies.filter((e) => dst(e, t) < 1200).length <= v.allies.filter((a) => dst(a, t) < 1100).length;
      if (dst(v.self, t) <= v.reach + t.radius + 300 && (tanked || siege)) {
        return t.id;
      }
      break; // later towers of this lane are protected
    }
  }
  // base structures (inhibitors, nexus towers, nexus): the nearest one in reach while minions tank or allies siege
  // (a still protected one rejects the attack in the sim; the next decision picks again)
  const laneTower = (t: SnapEntity): boolean => (['top', 'mid', 'bot'] as const).some((l) => ctx.map.sides[1 - ctx.team]!.towers[l].some((p) => dst(p, t) < 200));
  const base = [...v.enemyStructures, ...v.enemyTowers.filter((t) => !laneTower(t))]
    .filter((t) => dst(v.self, t) <= v.reach + t.radius + 300)
    .filter((t) => v.ownMinions.filter((m) => dst(m, t) < 850).length >= 2 || (t.atkTarget !== v.me.eid && v.allies.filter((a) => dst(a, t) < 1100).length >= 2))
    .sort((a, b) => dst(v.self, a) - dst(v.self, b));
  return base[0]?.id ?? -1;
}

/** Static camp timers (game knowledge, src/sim/systems/jungle.ts): first spawn and respawn in seconds. */
const campTimer = (id: string): { first: number; respawn: number } => (CAMPS as Record<string, { first: number; respawn: number }>)[id] ?? { first: 90, respawn: 135 };
/** Seconds the jungler waits at a camp that is about to spawn rather than leaving for a gank / lane. */
const CAMP_WAIT_S = 15;
/** From this game time a jungler without a camp up soon farms a lane meanwhile (no lane CS stolen in laning). */
const LANE_FARM_FROM_S = 14 * 60;

/**
 * Jungle clear over the own camps with camp timers: a camp counts as cleared when the bot stands at it and sees no
 * monster there (it just killed it, or someone else did); it is back after its respawn time. Next camp = the
 * nearest one that is up (or up within CAMP_WAIT_S). Returns 'roam' when nothing is up soon (gank / lane time).
 * Epic monsters are never pulled by the clear (objective desires take them).
 */
export function jungle(v: View, ctx: BotStatic, mem: BotMemory): BotAction | Pt | 'wait' | 'roam' {
  if (v.monsters.length) {
    mem.monstersSeen = true;
    mem.noMonsters = false;
  }
  if (mem.noMonsters) return 'roam';
  const epic = (x: SnapEntity): boolean => Object.values(ctx.map.objectives).some((o) => !Array.isArray(o) && dst(o as Pt, x) < 800);
  const m = v.monsters.filter((x) => dst(x, v.self) < 900 && !epic(x)).sort((a, b) => a.hp - b.hp)[0];
  if (m) {
    // smite (true damage 450-900 by level) as a finisher
    const smite = [4, 5].find((i) => v.me.abilities[i]?.id === 'bannen' && v.me.abilities[i]!.cdLeft <= 0);
    const smiteDmg = 450 + (450 * (v.me.level - 1)) / 17;
    if (smite !== undefined && m.hp <= smiteDmg && dst(v.self, m) <= 500 + m.radius + v.self.radius) {
      return { cmd: { t: 'spell', slot: (smite - 4) as 0 | 1, x: m.x, y: m.y, target: m.id } };
    }
    return v.self.atkTarget === m.id ? 'wait' : { cmd: { t: 'attack', target: m.id } };
  }
  const camps = ctx.map.sides[ctx.team].camps;
  const upAt = (c: { id: string }): number => {
    const t = campTimer(c.id);
    const cleared = mem.campCleared.get(c.id);
    return cleared === undefined ? t.first * 30 : cleared + t.respawn * 30;
  };
  for (const c of camps) {
    // standing at a camp that should be up but shows no monster: it is cleared (by us or by an invader)
    if (dst(v.self, c) < 450 && v.tick >= upAt(c) && !v.monsters.some((x) => dst(x, c) < 700)) {
      mem.campCleared.set(c.id, v.tick);
      if (!mem.monstersSeen && v.time > campTimer(c.id).first + 5) mem.noMonsters = true;
    }
  }
  let best: { c: Pt; cost: number; up: number } | null = null;
  for (const c of camps) {
    const up = upAt(c);
    const travel = (dst(v.self, c) / Math.max(200, v.me.stats.ms)) * 30;
    // early game the jungler waits for its next camp (ganks run before this leaf); later it may farm a lane meanwhile
    if (up > v.tick + travel + CAMP_WAIT_S * 30 && v.time >= LANE_FARM_FROM_S) continue;
    const cost = Math.max(travel, up - v.tick) - (c.buff ? 60 : 0);
    if (!best || cost < best.cost) best = { c, cost, up };
  }
  if (!best) return 'roam';
  if (dst(v.self, best.c) < 350) return 'wait'; // at the camp, it spawns soon
  return { x: best.c.x, y: best.c.y };
}
