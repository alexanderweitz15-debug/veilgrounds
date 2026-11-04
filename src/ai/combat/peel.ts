// Peel of the micro layer (A13): a support or frontliner protects the allied carry with its crowd control. The CC /
// disengage abilities come from the hints (roles 'cc' / 'disengage'); they are held until an enemy actually reaches
// the carry (or a low ally) and then thrown at that attacker - the "hold the peel until he is on the carry" rule of
// docs/BRAIN-REWORK.md §6.3. Only snapshot data (who attacks whom, positions, HP) is read.

import { championData } from '../../sim/champions';
import type { NodeCtx } from '../bt/types';
import type { BotAction, SnapEntity } from '../bot/types';
import { castSlot } from '../bot/combat';
import { dst } from '../bot/geo';
import { hintsOf } from '../../data/bots/hints';

/** An enemy this close to an ally who needs protection is "on" him. */
const ON_ALLY_R = 450;
/** The ally is low below this HP share. */
const LOW_HP = 0.5;

/** The CC / disengage cast at an attacker of a carry or a low ally, or null. */
export function microPeel(n: NodeCtx, enemies: readonly SnapEntity[]): BotAction | null {
  const v = n.v;
  const h = hintsOf(n.ctx.champ);
  const slots = h.abilities.map((a, i) => ({ a, i })).filter(({ a }) => a.roles.includes('cc') || a.roles.includes('disengage'));
  if (!slots.length) return null;
  const needy = v.allies.filter((a) => a.hp / Math.max(1, a.maxHp) < LOW_HP || hintsOf(championData(a.champ ?? '')).roleHints.fightRole === 'carry');
  let best: { e: SnapEntity; w: number } | null = null;
  for (const e of enemies) {
    for (const a of needy) {
      if (dst(e, a) > ON_ALLY_R && e.atkTarget !== a.id) continue;
      const w = 1 + (e.atkTarget === a.id ? 1 : 0) + (a.hp < a.maxHp * LOW_HP ? 0.5 : 0);
      if (!best || w > best.w) best = { e, w };
    }
  }
  if (!best) return null;
  for (const { i } of slots) {
    const c = castSlot(v, n.ctx, n.rng, best.e, i as 0 | 1 | 2 | 3, 'fight');
    if (c) return c;
  }
  return null;
}
