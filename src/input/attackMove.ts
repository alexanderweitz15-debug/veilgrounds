// Client-side prediction of the attack-move (A + left click) target, so the HUD can highlight the unit that will be
// hit before the click (C8). Mirrors the sim (src/sim/systems/attack.ts `acquire` + `inAttackRange`, not imported to
// keep the sim out of the UI bundle): enemies and neutral monsters within attack range + radii + ACQUIRE_EXTRA of the
// champion, nearest to the click (setting attackMoveNearCursor) or to the champion. A unit directly under the cursor
// wins outright: the controller sends a plain attack on it (LoL: A-click on a unit attacks that unit).
import type { SnapEntity } from '../sim/snapshot';
import { Kind } from '../sim/types';

/** src/sim/systems/attack.ts ACQUIRE_EXTRA. */
export const SIM_ACQUIRE_EXTRA = 200;

export interface AttackMoveCtx {
  entities: readonly SnapEntity[];
  myTeam: number;
  me: SnapEntity;
  /** Own attack range (snapshot me.stats.range). */
  range: number;
  /** Click point on the ground (sim coords). */
  gx: number;
  gy: number;
  /** true = nearest to the click (default), false = nearest to the champion. */
  nearCursor: boolean;
  /** Hostile unit under the cursor (the picker's hover), if any. */
  hover: SnapEntity | null;
}

const attackable = (e: SnapEntity, myTeam: number): boolean =>
  e.alive && e.team !== myTeam && e.maxHp > 0 && e.kind !== Kind.Plant && e.kind !== Kind.Projectile;

/** Unit that A + left click at (gx, gy) attacks first, or null (the champion only walks there). */
export function attackMoveTarget(c: AttackMoveCtx): SnapEntity | null {
  if (c.hover && attackable(c.hover, c.myTeam)) return c.hover;
  const ox = c.nearCursor ? c.gx : c.me.x;
  const oy = c.nearCursor ? c.gy : c.me.y;
  let best: SnapEntity | null = null;
  let bestD = Infinity;
  for (const e of c.entities) {
    if (!attackable(e, c.myTeam)) continue;
    const reach = c.range + c.me.radius + e.radius + SIM_ACQUIRE_EXTRA;
    if ((e.x - c.me.x) ** 2 + (e.y - c.me.y) ** 2 > reach * reach) continue;
    const d = (e.x - ox) ** 2 + (e.y - oy) ** 2;
    // sim tie-break: the older unit (lower serial)
    if (d < bestD || (d === bestD && best && e.serial < best.serial)) {
      bestD = d;
      best = e;
    }
  }
  return best;
}
