// Generic ability use from champion data (type, range, width, speed, effects) + a rough trade evaluator.
// ponytail: one heuristic for all 26 champions; recast/channel/summon specifics and combos come with Phase 3
// behavior trees (per-archetype combos from ChampionData.combos).

import { rotate } from '../../sim/vec';
import type { AbilityData } from '../../sim/champions/schema';
import type { Rng } from '../../sim/rng';
import type { BotAction, BotStatic, SnapEntity } from './types';
import { towerCovering, near, type View } from './perception';
import { dst, unit } from './geo';
import { utilityOn } from '../utility/flag';
import { sevUltAllowed } from '../utility/sev';
import { microOn } from '../combat/flag';
import { hintsOf } from '../../data/bots/hints';
import { aimCircle, aimLine, type AimMode } from '../combat/cast';

const rv = (v: number | number[] | undefined, rank: number): number =>
  v === undefined ? 0 : typeof v === 'number' ? v : v[Math.max(0, Math.min(v.length - 1, rank - 1))] ?? 0;

export const hpPct = (e: SnapEntity): number => (e.maxHp > 0 ? (e.hp + e.shield) / e.maxHp : 0);

/** Slot is levelled, off cooldown and affordable. */
export function ready(v: View, ctx: BotStatic, slot: number): boolean {
  const h = v.me.abilities[slot];
  if (!h || h.rank <= 0 || h.cdLeft > 0) return false;
  const ab = ctx.champ.abilities[slot];
  if (!ab) return false;
  if (ab.costType === 'mana' || ab.costType === 'energy') return v.self.mana >= h.cost;
  if (ab.costType === 'hp') return v.self.hp > h.cost * 2;
  return true;
}

const rangeOf = (v: View, ab: AbilityData, slot: number): number => rv(ab.range, v.me.abilities[slot]?.rank ?? 1);
const has = (ab: AbilityData, kind: string, target?: string): boolean =>
  ab.effects.some((e) => e.kind === kind && (target === undefined || ('target' in e && e.target === target)));
const supportive = (ab: AbilityData): boolean =>
  !!ab.flags?.includes('ally_target') || ab.effects.some((e) => (e.kind === 'heal' || e.kind === 'shield' || e.kind === 'buff') && 'target' in e && (e.target === 'ally' || e.target === 'allies'));
const offensive = (ab: AbilityData): boolean => ab.effects.some((e) => e.kind !== 'heal' && e.kind !== 'shield' && !(e.kind === 'buff' && e.target !== 'hit'));

/** Lead-predicted position of a unit after `t` seconds (velocity from the snapshot's previous position). */
export const predict = (e: SnapEntity, t: number): { x: number; y: number } => ({ x: e.x + (e.x - e.px) * 30 * t, y: e.y + (e.y - e.py) * 30 * t });

/** Rotate the aim point around the caster by a normal error (profile aimErrorDeg). */
function aimed(v: View, ctx: BotStatic, rng: Rng, p: { x: number; y: number }, maxR: number): { x: number; y: number } {
  const d = Math.min(maxR, dst(v.self, p));
  const [dx, dy] = unit(v.self, p);
  const [ex, ey] = rotate(dx, dy, rng.normal() * ctx.profile.behavior.aimErrorDeg);
  return { x: v.self.x + ex * d, y: v.self.y + ey * d };
}

/**
 * Does the bot lead a moving target with this skillshot (aim at where it will be)? Profile skillshotHitPct + 15
 * points (Iron 45 %, Gold 63 %, Challenger 97 %); otherwise it throws at the current position, which a moving target
 * walks out of - the rank's mechanical gap in landing skillshots (on top of aimErrorDeg).
 */
const leads = (ctx: BotStatic, rng: Rng): boolean => rng.chance(Math.min(1, ctx.profile.behavior.skillshotHitPct / 100 + 0.15));

/** True if an enemy non-champion unit sits on the segment (blocks minion-blocked skillshots). */
function blocked(v: View, to: { x: number; y: number }, width: number): boolean {
  const ax = v.self.x;
  const ay = v.self.y;
  const bx = to.x - ax;
  const by = to.y - ay;
  const len2 = bx * bx + by * by || 1;
  for (const m of [...v.enemyMinions, ...v.monsters]) {
    let t = ((m.x - ax) * bx + (m.y - ay) * by) / len2;
    if (t <= 0 || t >= 1) continue;
    t = Math.max(0, Math.min(1, t));
    const dx = m.x - (ax + bx * t);
    const dy = m.y - (ay + by * t);
    if (dx * dx + dy * dy < (m.radius + width / 2) * (m.radius + width / 2)) return true;
  }
  return false;
}

/** One offensive cast against `t` if any slot fits; null otherwise. Order: Q W E, R last with a kill/teamfight gate. */
export function offensiveCast(v: View, ctx: BotStatic, rng: Rng, t: SnapEntity): BotAction | null {
  for (const slot of [0, 1, 2, 3] as const) {
    if (slot === 3 && hpPct(t) > 0.65 && near(v.enemies, t, 800).length < 2) continue;
    const a = castSlot(v, ctx, rng, t, slot);
    if (a) return a;
  }
  return null;
}

/**
 * Cast `slot` at `t` if it is ready, offensive and `t` is in its reach (combo execution, Agent M); null otherwise.
 * `mode` only matters for the beta brain's micro layer (src/ai/combat/cast.ts): 'poke' holds a spell that is unlikely
 * to land, 'fight' (default) throws unless the shot is hopeless.
 */
export function castSlot(v: View, ctx: BotStatic, rng: Rng, t: SnapEntity, slot: 0 | 1 | 2 | 3, mode: AimMode = 'fight'): BotAction | null {
  const d = dst(v.self, t);
  if (!ready(v, ctx, slot)) return null;
  // Sev's Tsukuyomi roots Sev while it suppresses: only with an ally near or on a low target (utility flag)
  if (slot === 3 && utilityOn(ctx) && !sevUltAllowed(v, ctx, t)) return null;
  const ab = ctx.champ.abilities[slot];
  if (!offensive(ab) && !(ab.type === 'self' && !supportive(ab))) return null;
  // A13: free harassment never spends the engage, the ultimate or the peel CC (hints: holdFor)
  if (mode === 'poke' && microOn(ctx, 'aim') && hintsOf(ctx.champ).abilities[slot]!.holdFor !== 'none') return null;
  const range = rangeOf(v, ab, slot);
  const reachT = range + t.radius + v.self.radius;
  const cast = (x: number, y: number, target?: number): BotAction => ({ cmd: { t: 'cast', slot, x, y, ...(target !== undefined ? { target } : {}) } });
  switch (ab.type) {
    case 'skillshot_line': {
      if (microOn(ctx, 'aim')) {
        const m = aimLine(v, ctx, rng, t, ab, range, mode);
        return m ? cast(m.x, m.y) : null;
      }
      if (d > Math.min(range, 1500) + t.radius) break;
      const p = predict(t, leads(ctx, rng) ? ab.castTime + d / (ab.speed ?? 1500) : 0);
      if (ab.flags?.includes('blocked_by_minions') && blocked(v, p, ab.width ?? 60)) break;
      const a = aimed(v, ctx, rng, p, range);
      return cast(a.x, a.y);
    }
    case 'skillshot_circle':
    case 'zone':
    case 'summon': {
      if (microOn(ctx, 'aim') && ab.type !== 'summon') {
        const m = aimCircle(v, ctx, rng, t, ab, range, mode);
        return m ? cast(m.x, m.y) : null;
      }
      if (d > Math.min(range, 1500) + (ab.radius ?? 0) * 0.5) break;
      const p = aimed(v, ctx, rng, predict(t, leads(ctx, rng) ? ab.castTime + (ab.delay ?? 0) : 0), range);
      return cast(p.x, p.y);
    }
    case 'cone':
      if (d <= range + t.radius) return cast(t.x, t.y);
      break;
    case 'targeted':
      if (!ab.flags?.includes('ally_target') && d <= reachT) return cast(t.x, t.y, t.id);
      break;
    case 'self': {
      const r = ab.radius ? ab.radius : v.reach + 150;
      if (d <= r + t.radius) return cast(t.x, t.y);
      break;
    }
    case 'dash':
    case 'blink': {
      const dist = ab.distance ?? range;
      if (dist <= 0 || d <= v.reach + t.radius + 50 || d > dist + v.reach) break;
      if (towerCovering(v, t) || (!offensive(ab) && hpPct(t) > 0.4)) break;
      return cast(t.x, t.y);
    }
  }
  return null;
}

/** Effective cast reach of an ability slot against a unit (combo range checks). */
export function slotReach(v: View, ctx: BotStatic, slot: number): number {
  const ab = ctx.champ.abilities[slot];
  if (!ab) return 0;
  const r = rangeOf(v, ab, slot);
  if (ab.type === 'dash' || ab.type === 'blink') return (ab.distance ?? r) + v.reach;
  if (ab.type === 'self') return ab.radius ? ab.radius : v.reach + 150;
  return Math.min(r, 1500);
}

/** Heal / shield / buff an ally (or self-centred group heal). Supports first, everyone may use it. */
export function supportCast(v: View, ctx: BotStatic, fighting: boolean): BotAction | null {
  const hurt = [...v.allies, v.self].filter((a) => hpPct(a) < 0.6 && v.enemies.some((e) => dst(e, a) < 1200));
  for (const slot of [0, 1, 2, 3] as const) {
    if (!ready(v, ctx, slot)) continue;
    const ab = ctx.champ.abilities[slot];
    if (!supportive(ab)) continue;
    const range = rangeOf(v, ab, slot);
    const heals = has(ab, 'heal') || has(ab, 'shield');
    const cast = (x: number, y: number, target?: number): BotAction => ({ cmd: { t: 'cast', slot, x, y, ...(target !== undefined ? { target } : {}) } });
    if (ab.type === 'targeted' && ab.flags?.includes('ally_target')) {
      // heal/shield the most hurt ally in range; pure buffs go on an ally that is fighting
      const pool = heals ? hurt : fighting ? v.allies.filter((a) => v.enemies.some((e) => dst(e, a) < 700)) : [];
      const a = pool.filter((x) => x.id !== v.self.id && dst(x, v.self) <= range + x.radius + v.self.radius).sort((p, q) => hpPct(p) - hpPct(q))[0];
      if (a) return cast(a.x, a.y, a.id);
    } else if (ab.type === 'self' || ab.type === 'zone') {
      const r = ab.type === 'self' ? ab.radius || 600 : range;
      const a = hurt.find((x) => dst(x, v.self) <= r);
      if (a && (heals || fighting)) return cast(a.x, a.y);
    }
  }
  return null;
}

/** Dash/blink away from danger toward `to`. */
export function escapeCast(v: View, ctx: BotStatic, to: { x: number; y: number }): BotAction | null {
  for (const slot of [0, 1, 2, 3] as const) {
    if (!ready(v, ctx, slot)) continue;
    const ab = ctx.champ.abilities[slot];
    if (ab.type !== 'dash' && ab.type !== 'blink') continue;
    if ((ab.distance ?? rangeOf(v, ab, slot)) <= 0) continue;
    const [dx, dy] = unit(v.self, to);
    return { cmd: { t: 'cast', slot, x: v.self.x + dx * 600, y: v.self.y + dy * 600 } };
  }
  return null;
}

/**
 * Trade score against `t` (> 0 = take the fight). Rough: HP ratio, ready abilities, level, numbers, tower.
 * Diving under an enemy tower only when the target is below the profile's diveHpTolerancePct.
 */
export function tradeScore(v: View, ctx: BotStatic, t: SnapEntity): number {
  const b = ctx.profile.behavior;
  let readyCount = 0;
  for (let s = 0; s < 4; s++) if (ready(v, ctx, s)) readyCount++;
  const allies = near(v.allies, t, 1100).length;
  const foes = near(v.enemies, t, 1100).length; // includes t
  let score = hpPct(v.self) - hpPct(t) + 0.08 * readyCount + 0.08 * (v.me.level - t.level) + 0.3 * (allies + 1 - foes);
  if (towerCovering(v, t) || towerCovering(v, v.self)) {
    const dive = hpPct(t) * 100 <= b.diveHpTolerancePct && hpPct(v.self) > 0.45;
    if (!dive) score -= 1;
  }
  if (v.me.level < 3 && near(v.enemyMinions, v.self, 500).length >= 4) score -= 0.2; // minion aggro early
  return score;
}
