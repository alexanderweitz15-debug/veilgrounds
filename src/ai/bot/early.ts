// Level-1 behaviour (values.json "early", TeamAI.earlyPlan): before early.endS the squad of an invade / guard plan
// walks to the plan's point and waits there; afterwards (and for everybody else) the normal lane / jungle leaves run.

import type { NodeCtx, NodeResult } from '../bt/types';
import { VALUES } from '../utility/values';
import { dst } from './geo';
import { moveCmd } from './kite';

/** Action leaf: hold the level-1 plan point. 'failure' = nothing to do (plan over, not in the squad, normal plan). */
export function earlyPlan(n: NodeCtx): NodeResult {
  if (n.v.tick >= VALUES.early.endS * 30 || n.v.me.dead) return 'failure';
  const plan = n.ctx.teamAI.earlyPlan();
  if (plan.kind === 'normal' || !plan.point || !plan.squad.has(n.ctx.slot)) return 'failure';
  // an enemy champion in sight is the fight logic's business
  if (n.v.enemies.some((e) => dst(e, n.v.self) < 1100)) return 'failure';
  if (dst(n.v.self, plan.point) < 120) return 'running';
  n.out.push(moveCmd(plan.point));
  n.mem.lastMove = { x: plan.point.x, y: plan.point.y, tick: n.v.tick };
  return 'running';
}
