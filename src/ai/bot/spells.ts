// Rough bot use of the Phase 2 summoners and trinket wards (Agent J). Same commands a player issues; only
// snapshot data. ponytail: fixed rules; Phase 3 team AI decides warding/teleports with desires + influence map.
//   Reinigen: rooted/stunned (HUD cc >= 3) with an enemy champion close, after the reaction delay.
//   Erschöpfen: the enemy champion closest to a low (< 50 % HP) bot or ally within 650 - the diver.
//   Barriere: hp under a rank-scaled line (Iron 16 % .. Challenger 30 %) with an enemy champion / tower on the bot.
//   Geist: chase a fleeing low-HP enemy champion (skill >= 40), or run when in retreat mode with a foe close.
//   Teleport: in the fountain, full HP, back to the own lane's furthest tower.
//   Wards: supports and junglers drop a Schleierward in a nearby unwarded bush (lane/tri/river), every ~25 s at most.

import type { Rng } from '../../sim/rng';
import { Kind } from '../../sim/types';
import { sampleReactionMs } from '../profiles';
import type { BotAction, BotMemory, BotStatic, SnapEntity } from './types';
import { ticksOfMs, towerCovering, type View } from './perception';
import { hpPct } from './combat';
import { dst } from './geo';
import { utilityOn } from '../utility/flag';

/** Summoner slot (0/1) with this id that is ready, else -1. */
function sumReady(v: View, id: string): 0 | 1 | -1 {
  for (const i of [0, 1] as const) {
    const s = v.me.abilities[4 + i];
    if (s?.id === id && s.rank > 0 && s.cdLeft <= 0) return i;
  }
  return -1;
}

export function cleanseStep(v: View, ctx: BotStatic, rng: Rng, penaltyMs = 0): BotAction | null {
  if ((v.me.cc ?? 0) < 3 || (v.me.cc ?? 0) >= 5) return null;
  const slot = sumReady(v, 'reinigen');
  if (slot === -1 || !v.enemies.some((e) => dst(e, v.self) < 1000)) return null;
  return { cmd: { t: 'spell', slot, x: v.self.x, y: v.self.y }, delay: ticksOfMs(sampleReactionMs(ctx.profile.behavior, rng) + penaltyMs) };
}

export function exhaustStep(v: View): BotAction | null {
  const slot = sumReady(v, 'erschoepfen');
  if (slot === -1) return null;
  const protect: SnapEntity[] = [v.self, ...v.allies].filter((a) => hpPct(a) < 0.5 && dst(a, v.self) < 900);
  let best: SnapEntity | null = null;
  let bestD = Infinity;
  for (const a of protect) {
    for (const e of v.enemies) {
      const dToMe = dst(e, v.self);
      if (dToMe > 650 + e.radius + v.self.radius) continue;
      const d = dst(e, a);
      // the one that is hitting the protected unit right now (the diver) wins over a merely close one
      const score = d - (e.atkTarget === a.id ? 300 : 0);
      if (d < 500 && score < bestD) (bestD = score), (best = e);
    }
  }
  return best ? { cmd: { t: 'spell', slot, x: best.x, y: best.y, target: best.id } } : null;
}

/**
 * Barrier before the burst lands. The bot has no damage history, so "lethal" is approximated by a HP line that grows
 * with skill (low ranks fire late or never get the timing) while an enemy champion is close or a tower has aggro on it.
 */
export function barrierStep(v: View, ctx: BotStatic, rng: Rng, penaltyMs = 0): BotAction | null {
  const slot = sumReady(v, 'barriere');
  if (slot === -1 || v.self.shield > 0) return null;
  const line = 0.16 + 0.14 * Math.min(1, Math.max(0, ctx.params.skill / 100));
  if (v.hpPct >= line) return null;
  const threat = v.enemies.some((e) => dst(e, v.self) < 700) || v.enemyTowers.some((t) => t.atkTarget === v.me.eid);
  if (!threat) return null;
  return { cmd: { t: 'spell', slot, x: v.self.x, y: v.self.y }, delay: ticksOfMs(sampleReactionMs(ctx.profile.behavior, rng) + penaltyMs) };
}

/** Ghost: run down a fleeing enemy below 35 % HP (fight mode, skill >= 40) or get away in retreat mode. */
export function ghostStep(v: View, ctx: BotStatic, mem: BotMemory): BotAction | null {
  const slot = sumReady(v, 'geist');
  if (slot === -1 || ctx.params.skill < 40) return null;
  const go = { cmd: { t: 'spell' as const, slot, x: v.self.x, y: v.self.y } };
  if (mem.mode === 'retreat') {
    return v.hpPct < 0.3 && v.enemies.some((e) => dst(e, v.self) < 800) ? go : null;
  }
  if (mem.mode !== 'fight' || v.hpPct < 0.35 || v.enemies.length > 2) return null;
  for (const e of v.enemies) {
    const d = dst(e, v.self);
    const out = d > v.reach + e.radius + 100 && d < 1000;
    const fleeing = out && Math.hypot(e.px - v.self.x, e.py - v.self.y) < d - 5;
    if (hpPct(e) < 0.35 && fleeing) return go;
  }
  return null;
}

/** In the fountain with full HP: Teleport to the own lane's furthest alive tower. */
/**
 * Ready Teleport slot for the spell command: summoner 0/1, or (utility flag only) the top laner's unlocked third
 * summoner (PlayerHud.abilities[6], command slot 2; sim B4). -1 = none.
 */
export function teleportSlot(v: View, ctx: BotStatic): 0 | 1 | 2 | -1 {
  const s = sumReady(v, 'teleport');
  if (s !== -1 || !utilityOn(ctx)) return s;
  const t = v.me.abilities[6];
  return t?.id === 'teleport' && t.rank > 0 && t.cdLeft <= 0 ? 2 : -1;
}

export function teleportStep(v: View, ctx: BotStatic, mem: BotMemory): BotAction | null {
  if (!ctx.lane || v.hpPct < 0.9 || (v.me.teleportLeft ?? 0) > 0) return null;
  const slot = teleportSlot(v, ctx);
  if (slot === -1) return null;
  const fountain = ctx.map.sides[ctx.team].fountain;
  const spots = ctx.map.sides[ctx.team].towers[ctx.lane];
  let best: SnapEntity | null = null;
  for (const t of v.ownTowers) {
    if (!spots.some((p) => dst(p, t) < 200)) continue;
    if (!best || dst(t, fountain) > dst(best, fountain)) best = t;
  }
  if (!best || dst(best, fountain) < 5000) return null;
  mem.lastMove = null;
  mem.busyUntil = v.tick + 4 * 30 + 2; // channel: nothing else meanwhile
  mem.busyFrom = v.tick;
  mem.busySlot = -1;
  return { cmd: { t: 'spell', slot, x: best.x, y: best.y, target: best.id } };
}

const WARD_RANGE = 550;
const WARD_EVERY = 25 * 30;

/** Supports/junglers: a Schleierward in a nearby bush nobody of the team covers yet. Walks a short way to it. */
export function wardStep(v: View, ctx: BotStatic, mem: BotMemory): BotAction | null {
  if (ctx.role !== 'support' && ctx.role !== 'jungle') return null;
  const tr = v.me.trinket;
  if (!tr || tr.id !== 'schleierward' || tr.charges <= 0 || v.time < 75 || v.tick - mem.wardAt < WARD_EVERY) return null;
  if (v.enemies.some((e) => dst(e, v.self) < 1200)) return null;
  const own = v.snap.entities.filter((e) => e.kind === Kind.Ward && e.ward && e.team === ctx.team);
  const fountain = ctx.map.sides[ctx.team].fountain;
  let spot: { x: number; y: number } | null = null;
  let bestD = 2200;
  for (const b of ctx.map.bushes) {
    const d = dst(b, v.self);
    if (d >= bestD || dst(b, fountain) < 4000 || towerCovering(v, b)) continue;
    if (own.some((w) => dst(w, b) < 900)) continue;
    bestD = d;
    spot = b;
  }
  if (!spot) return null;
  if (bestD <= WARD_RANGE) {
    mem.wardAt = v.tick;
    mem.wardTrip = -1;
    return { cmd: { t: 'ward', x: spot.x, y: spot.y } };
  }
  // short detour only: give up after 8 s of walking
  if (mem.wardTrip < 0) mem.wardTrip = v.tick;
  else if (v.tick - mem.wardTrip > 8 * 30) {
    mem.wardAt = v.tick;
    mem.wardTrip = -1;
    return null;
  }
  mem.lastMove = { x: spot.x, y: spot.y, tick: v.tick };
  return { cmd: { t: 'move', x: spot.x, y: spot.y } };
}
