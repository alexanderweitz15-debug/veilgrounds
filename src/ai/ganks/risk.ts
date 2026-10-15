// §4.1 "Als Gegankter: Gefahr erkennen": GankRisk tiers -> laning modifiers for M's laning/trade leaves.
//   tier 0 (< 0.2)    normal laning, push allowed
//   tier 1 (0.2-0.4)  no new long trades; stand 200 toward own side; ward if a charge and the spot is unwarded
//   tier 2 (0.4-0.7)  no pushing (freeze/hold); trades only at kill certainty > 0.9; stay in Flash reach of the
//                     tower; missing ping when the jungler cloud is near
//   tier 3 (> 0.7)    back under the tower, last hits only under tower, recall if the wave is on the enemy side
// Thresholds shift with knobs.gankRiskShift (aggression +5: +0.15). Rank: Iron/Bronze have no GankRisk (always 0);
// Silver reacts 8-15 s late (perception); Gold stays with 60 % when the wave is "good" (own siege minion);
// Diamond+ crash the wave first when the warning comes early (shove-and-back).

import type { BotParams } from '../contract';
import type { NodeCtx, NodeResult } from '../bt/types';
import type { LaneName, Pt } from '../../sim/map';
import { dst } from '../bot/geo';
import { atLeast } from '../perception/rankModel';
import { frontTower } from '../perception/waves';
import { logPoint, logPos } from '../perception/logInputs';
import type { BotPerception } from '../perception/types';
import { canWard, enemyJunglerSlot, log, lv, move, ping, tac, type Inputs } from './common';

export interface LaningSafety {
  risk: number;
  tier: 0 | 1 | 2 | 3;
  /** Shift of the laning stand position toward the own side (units). */
  targetShift: number;
  allowPush: boolean;
  /** 'any' trades, 'short' (no new long trades), 'killOnly' (> 0.9 kill certainty), 'none'. */
  allowTrade: 'any' | 'short' | 'killOnly' | 'none';
  /** Stay within Flash reach (~ 400 + 750) of the own tower. */
  stayNearTower: boolean;
  /** Retreat under the own tower; last hits only there. */
  retreat: boolean;
  /** Recall now if the wave is on the enemy side. */
  recallIfWaveAhead: boolean;
  /** Diamond+: crash the wave before backing off (early warning). */
  crashFirst: boolean;
  wardSuggested: boolean;
  missingPing: boolean;
  reason: string;
}

/** Pure §4.1 reaction for a lane (default: the bot's lane). `rollStay` = Gold's 60 % "good wave" roll result. */
export function laningSafety(pv: BotPerception, params: BotParams, lane: LaneName | null, rollStay = false, prevTier = 0): LaningSafety {
  const risk = lane ? pv.gankRisk[lane] : 0;
  const s = params.knobs.gankRiskShift;
  const th = [0.2 + s, 0.4 + s, 0.7 + s];
  let tier = (risk > th[2]! ? 3 : risk > th[1]! ? 2 : risk > th[0]! ? 1 : 0) as LaningSafety['tier'];
  // hysteresis: a tier is left downward only 0.05 below its threshold (no flapping on a noisy risk)
  while (prevTier > tier && risk > th[tier]! - 0.05) tier = (tier + 1) as LaningSafety['tier'];
  const wave = lane ? pv.waves[lane] : null;
  let reason = `risk ${risk.toFixed(2)}`;
  // Gold: a "good" wave (own siege minion in reach) keeps the bot in lane with 60 %
  if (tier >= 2 && wave?.siege && atLeast(params, 'gold') && !atLeast(params, 'platinum') && rollStay) {
    tier = 1;
    reason += ', good wave (siege) -> stays';
  }
  const jg = pv.junglerEstimate;
  const jgEtaS = jg && pv.self ? Math.max(0, dst(jg, pv.self) - jg.r * 0.5) / 400 : Infinity;
  const crashFirst = tier >= 1 && tier <= 2 && atLeast(params, 'diamond') && jgEtaS >= 15 && !!wave?.visible && !wave.crashed;
  if (crashFirst) reason += ', early warning -> crash first';
  return {
    risk,
    tier,
    targetShift: tier >= 1 ? 200 : 0,
    allowPush: tier === 0 || crashFirst,
    allowTrade: tier === 0 ? 'any' : tier === 1 ? 'short' : tier === 2 ? 'killOnly' : 'none',
    stayNearTower: tier >= 2,
    retreat: tier === 3,
    recallIfWaveAhead: tier === 3 && !!wave?.enemySide,
    crashFirst,
    wardSuggested: tier >= 1 && (params.playstyle.vision >= -2 || tier >= 2),
    missingPing: tier >= 2 && !!jg && jg.weight > 0.3 && jgEtaS < 20,
    reason,
  };
}

/**
 * Tree leaf (action): evaluates §4.1 for the bot's lane, stores the result in tactics.laningSafety for M's laning
 * leaves, wards / pings as side effects, and takes control only at tier 3 (retreat under tower) -> 'running'.
 */
export function gankRiskReaction(n: NodeCtx): NodeResult {
  const pv = lv(n);
  if (!pv?.self || !n.ctx.lane) return 'failure';
  const st = tac(pv, 'risk', () => ({ tier: 0, stayRoll: false, rolledAt: -1, wardAt: -1e9, pingAt: -1e9 }));
  const lane = n.ctx.lane;
  // Gold's 60 % roll once per risk episode
  if (pv.gankRisk[lane] < 0.2) st.rolledAt = -1;
  else if (st.rolledAt < 0) (st.stayRoll = n.rng.chance(0.6)), (st.rolledAt = n.snap.tick);
  const s = laningSafety(pv, n.p, lane, st.stayRoll, st.tier);
  pv.mem.tactics.laningSafety = s;
  const inputs: Inputs = { risk: +s.risk.toFixed(3), lane, waveEnemySide: pv.waves[lane].enemySide, hp: +(pv.self.hp / pv.self.maxHp).toFixed(2) };
  if (pv.junglerEstimate) logPos(inputs, 'jg', pv.junglerEstimate, enemyJunglerSlot(pv));
  if (s.tier !== st.tier) log(n, pv, 'gankRisk', `tier${s.tier}`, s.reason, inputs, { risk: s.risk });
  st.tier = s.tier;
  // ward the lane-side river bush (tier >= 1, a charge, spot not covered by own wards)
  if (s.wardSuggested && canWard(n) && n.snap.tick - st.wardAt > 30 * 30) {
    const spot = wardSpot(n, pv, lane);
    if (spot) {
      st.wardAt = n.snap.tick;
      n.out.push({ cmd: { t: 'ward', x: Math.round(spot.x), y: Math.round(spot.y) } });
      log(n, pv, 'gankRisk', 'ward', 'gank risk: ward the river approach', logPoint({ ...inputs }, 'ward', spot, 'static'));
    }
  }
  if (s.missingPing && pv.junglerEstimate && n.snap.tick - st.pingAt > 20 * 30) {
    st.pingAt = n.snap.tick;
    if (ping(n, pv, 'missing', pv.junglerEstimate)) log(n, pv, 'gankRisk', 'pingMissing', 'jungler cloud near', inputs);
  }
  if (!s.retreat) return 'failure';
  const t = frontTower(n.ctx.map, n.snap, n.ctx.team, lane);
  if (!t) return 'failure';
  const fountain = n.ctx.map.sides[n.ctx.team as 0 | 1].fountain;
  // stand behind the tower (toward the own base), last hits there are M's
  const d = dst(t, fountain) || 1;
  const p = { x: t.x + ((fountain.x - t.x) / d) * 250, y: t.y + ((fountain.y - t.y) / d) * 250 };
  if (dst(pv.self, p) > 350) {
    move(n, pv, p);
    return 'running';
  }
  return 'failure';
}

/** Nearest bush on the lane's river side not covered by an own ward (vision > 0). */
function wardSpot(n: NodeCtx, pv: BotPerception, lane: LaneName): Pt | null {
  const self = pv.self!;
  const wards = n.snap.entities.filter((e) => e.team === n.ctx.team && e.ward && (e.vision ?? 0) > 0);
  let best: Pt | null = null;
  let bd = 1600;
  for (const b of n.ctx.map.bushes) {
    const d = dst(b, self);
    if (d >= bd || d < 300) continue;
    if (wards.some((w) => dst(w, b) < 700)) continue;
    // river side: the bush is closer to the map's anti-diagonal (river) than the bot
    const river = (p: Pt): number => Math.abs(p.x + p.y - n.ctx.map.size) / Math.SQRT2;
    if (river(b) > river(self) + 200 && lane !== 'mid') continue;
    bd = d;
    best = b;
  }
  return best;
}
