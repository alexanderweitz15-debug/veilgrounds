// Spacing of the micro layer (A13): the distance a ranged bot keeps to an enemy champion, from the ENEMY's key
// ranges (hints) and from what the bot has seen of its cooldowns. Rank enters through the cooldown tracking of the
// perception layer (profile cooldownTracking: 'none' knows nothing, 'all' every cast it saw) - an unseen cast means
// "assume ready". No cooldown is read from the enemy without having seen the cast.

import { championData } from '../../sim/champions';
import type { NodeCtx } from '../bt/types';
import type { SnapEntity } from '../bot/types';
import { lv } from '../ganks/common';
import { hintsOf } from '../../data/bots/hints';

import { MICRO } from './params';

const { safeMargin: SAFE_MARGIN, punishInside: PUNISH_INSIDE, minRanged: MIN_RANGED_SPACING } = MICRO.spacing;

/** Is the enemy's ability believed on cooldown (the bot saw the cast and its cooldown has not run out)? */
export function believedDown(n: NodeCtx, t: SnapEntity, slot: number): boolean {
  const tr = lv(n)?.enemies.get(t.slot);
  return !!tr && (tr.abilityReadyAt[slot] ?? 0) > n.v.tick;
}

/** Desired distance (centre to centre) of a ranged bot to `t`; null = no opinion (melee bots, the legacy rule). */
export function microSpacing(n: NodeCtx, t: SnapEntity): number | null {
  if (n.ctx.champ.attackType !== 'ranged') return null;
  const range = n.v.me.stats.range + n.v.self.radius + t.radius;
  let want = range - n.p.knobs.spacingBuffer;
  const champ = championData(t.champ ?? '');
  const th = hintsOf(champ);
  const tAbs = th.abilities;
  // the enemy's abilities that hurt me: damage or hard CC (the ultimate is no lane concern)
  const offensive = [0, 1, 2].filter((s) => tAbs[s]!.damage || tAbs[s]!.cc >= 3);
  const allDown = offensive.length > 0 && offensive.every((s) => believedDown(n, t, s));
  if (allDown) return Math.max(MIN_RANGED_SPACING, range - PUNISH_INSIDE);
  // a ready gap closer / hook reaches over this distance: stay out of it as far as the own range allows
  const engage = [0, 1, 2].filter((s) => tAbs[s]!.roles.includes('engage') && !believedDown(n, t, s));
  const reach = engage.length ? Math.max(...engage.map((s) => tAbs[s]!.useRange[1])) : 0;
  if (reach > 0) want = Math.max(want, Math.min(range - 30, reach + SAFE_MARGIN));
  // out of a melee champion's auto reach
  if (champ.attackType === 'melee') want = Math.max(want, th.keyRanges.auto + t.radius + n.v.self.radius + SAFE_MARGIN);
  return Math.max(MIN_RANGED_SPACING, want);
}
