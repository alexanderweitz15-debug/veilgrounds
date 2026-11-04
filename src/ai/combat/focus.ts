// Teamfight focus of the micro layer (A13): which enemy champion the bot hits. Pure scoring from the snapshot
// (positions, HP, who attacks whom - public) and the static hints of the enemy champions; the rank enters through the
// focus-quality noise of src/ai/bot/teamfight.ts (exchangeNoise), as before.
//   kill      low (effective) HP relative to the other enemies in the fight
//   threat    damage / poke / CC potential of the champion (hints), carries and mages over tanks
//   access    in reach now, or reachable; a frontliner between the bot and the target protects it from everyone but
//             assassins / divers
//   retaliate the target is hitting an ally who is low or a carry (protect the team)

import { championData } from '../../sim/champions';
import type { NodeCtx } from '../bt/types';
import type { SnapEntity } from '../bot/types';
import { dst } from '../bot/geo';
import { hintsOf, type FightRole } from '../../data/bots/hints';
import { MICRO } from './params';

const MICRO_FOCUS = MICRO.focus;

const ehp = (e: SnapEntity): number => e.hp + e.shield;

/** Fight role of the bot's champion (hints); a support-lane bot with a non-engage kit is a support. */
export function microFightRole(n: NodeCtx): FightRole {
  const r = hintsOf(n.ctx.champ).roleHints.fightRole;
  return n.ctx.role === 'support' && r === 'carry' ? 'support' : r;
}

function threatOf(e: SnapEntity): number {
  const h = hintsOf(championData(e.champ ?? ''));
  const ccAbilities = h.abilities.filter((a) => a.cc >= 3).length;
  const base = MICRO_FOCUS.threatBase + MICRO_FOCUS.threatPerPower * (h.roleHints.burst + h.roleHints.poke + ccAbilities);
  const role = h.roleHints.fightRole;
  return base + (role === 'carry' || role === 'assassin' ? MICRO_FOCUS.carryBonus : role === 'frontline' ? -MICRO_FOCUS.frontlinePenalty : 0);
}

/** Is a unit of `blockers` standing between `from` and `to` (within MICRO_FOCUS.shieldWidth of the segment)? */
function shielded(from: SnapEntity, to: SnapEntity, blockers: readonly SnapEntity[]): boolean {
  const bx = to.x - from.x;
  const by = to.y - from.y;
  const len2 = bx * bx + by * by || 1;
  for (const b of blockers) {
    if (b === to || b === from) continue;
    const t = ((b.x - from.x) * bx + (b.y - from.y) * by) / len2;
    if (t <= 0.15 || t >= 0.95) continue;
    if (Math.hypot(b.x - (from.x + bx * t), b.y - (from.y + by * t)) <= MICRO_FOCUS.shieldWidth) return true;
  }
  return false;
}

/** Score of `e` as the focus target (higher = hit it); `fight` = the enemies in the fight. */
export function microFocusScore(n: NodeCtx, e: SnapEntity, fight: readonly SnapEntity[], focusSerial: number): number {
  const v = n.v;
  const total = fight.reduce((s, x) => s + ehp(x), 0) / Math.max(1, fight.length);
  const kill = Math.max(0.1, 1.3 - e.hp / Math.max(1, e.maxHp)) * (ehp(e) < total * MICRO_FOCUS.squishyShare ? MICRO_FOCUS.squishyBonus : 1);
  const myReach = v.reach + e.radius;
  const d = dst(v.self, e);
  let access = Math.max(MICRO_FOCUS.minAccess, 1 - Math.max(0, d - myReach) / MICRO_FOCUS.accessFalloff);
  const role = microFightRole(n);
  if (role !== 'assassin' && shielded(v.self, e, fight)) access *= MICRO_FOCUS.shieldedFactor;
  let score = kill * threatOf(e) * access;
  // the target is hitting a low or valuable ally: retaliate
  if (e.atkTarget >= 0) {
    const a = v.allies.find((x) => x.id === e.atkTarget);
    if (a && (a.hp / Math.max(1, a.maxHp) < MICRO_FOCUS.allyLowHp || hintsOf(championData(a.champ ?? '')).roleHints.fightRole === 'carry')) score += MICRO_FOCUS.retaliate;
  }
  return score + (e.serial === focusSerial ? MICRO_FOCUS.pingBonus * n.p.knobs.pingObedience : 0);
}
