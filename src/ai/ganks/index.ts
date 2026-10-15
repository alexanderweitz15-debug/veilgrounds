// Agent L tree leaves (spec-bots §4 ganks, §5 roams) for M's behaviour tree registry (src/ai/bt/types.ts).
// They need NodeCtx.pv to be L's BotPerception (src/ai/perception: perceive() per decision); with a stub pv they
// return 'failure' / 0 / false. Suggested tree order (high to low priority):
//   escape (guarded by condition gankIncoming) > counterGank > jungleGank > enemyRoamReaction > roam > laning,
//   with gankRiskReaction ticked every decision before laning/trades (parallel 'always'); M's laning and trade
//   leaves read tactics.laningSafety (see laningSafety()) and tactics.focus ({slot, eid, until}: engage target).
import type { ActionFn, ConditionFn, ScoreFn } from '../bt/types';
import { escape, gankIncoming } from './escape';
import { gankRiskReaction } from './risk';
import { counterGank, jungleGank, jungleGankScore } from './jungle';
import { bestRoamScore, roam } from '../roams/roam';
import { enemyRoamReaction } from '../roams/enemyRoam';
import { lv } from './common';

export { laningSafety, type LaningSafety } from './risk';
export { gankScore, gankThreshold } from './jungle';
export { roamScore, roamPrerequisite } from '../roams/roam';
export { missingOpponents } from '../roams/enemyRoam';
export { gankers } from './escape';

/** Action leaves (n) => 'success' | 'failure' | 'running'. */
export const nodes: Record<string, ActionFn> = { escape, gankRiskReaction, jungleGank, counterGank, roam, enemyRoamReaction };

/** Condition leaves. */
export const lConditions: Record<string, ConditionFn> = {
  gankIncoming,
  /** Own lane GankRisk above the tier-2 threshold (incl. aggression shift). */
  gankRiskHigh: (n) => {
    const pv = lv(n);
    return !!pv && !!n.ctx.lane && pv.gankRisk[n.ctx.lane] > 0.4 + n.p.knobs.gankRiskShift;
  },
};

/** Score leaves (0..1) for gates. */
export const lScores: Record<string, ScoreFn> = {
  jungleGankScore,
  roamScore: bestRoamScore,
  ownGankRisk: (n) => {
    const pv = lv(n);
    return pv && n.ctx.lane ? pv.gankRisk[n.ctx.lane] : 0;
  },
};
