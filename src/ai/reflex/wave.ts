// Wave states as a target picture (docs/BRAIN-REWORK.md §4.5), reflex path only. Each state names where the wave
// should be and which filler targets the attack scheduler may use - never "do nothing":
//   push      wave toward the enemy tower: champion, every minion, structures
//   neutral   wave in the middle: champion, minions only while the own wave is not bigger than the enemy's
//   slowPush  only the enemy melee minions die (casters live): champion, enemy melee minions
//   freeze    wave 300-600 in front of the own tower, 2-3 enemy minions surplus: champion, enemy minions that hit own
//             minions (only while the surplus stays above the corridor)
//   hold      like neutral, stand point 200 further back; champion only without advancing
// Decided at the decision rate, switched at most every 10 s (except for gank risk), every switch logged with reason.
// Rank: waveStateDeliberatePct (Iron never chooses: push). Gank risk >= 0.4 is hold, never freeze (§4.5).

import type { LaneName } from '../../sim/map';
import type { NodeCtx } from '../bt/types';
import { near } from '../bot/perception';
import { dst } from '../bot/geo';
import { recallWanted } from '../bot/macro';
import treeData from '../../data/bots/tree.json';
import type { LaneIntent } from './state';
import { reflexState } from './state';

export type WaveState = LaneIntent['wave'];

/** Minimum time between two state switches (ticks, §4.5 hysteresis 10 s). */
const SWITCH_TICKS = 10 * 30;
/** Gank-risk band of the hold state (§4.5: 0.4-0.7; above it the safety tier moves the bot back further). */
const HOLD_RISK = 0.4;
/** A freeze lasts at most this long before it is re-decided (§4.5 "Dauer begrenzt"). */
const FREEZE_MAX_TICKS = 60 * 30;
/** Objective timing windows (s): push before an objective, slow-push 60-90 s before it (§4.5). */
const OBJ_PUSH_S = 60;
const OBJ_SLOW_S = 90;
/** Own wave this much bigger than the enemy's: push it (minion advantage). */
const ADVANTAGE = 3;
/** Own jungler within this distance: no freeze (it would rather use the pushed wave). */
const JUNGLER_NEAR = 2500;
/** How long one deliberate / not deliberate roll of the rank holds (ticks). */
const DELIBERATE_TICKS = 60 * 30;
const RECALL_THRESHOLD = (treeData.params.recall as { threshold: number }).threshold;

export function chooseWaveState(n: NodeCtx, lane: LaneName): { state: WaveState; reason: string } {
  const st = reflexState(n.mem);
  const T = n.v.tick;
  const cur = st.waveState;
  const risk = n.pv.gankRisk[lane] ?? 0;
  const set = (state: WaveState, reason: string): { state: WaveState; reason: string } => {
    if (!cur || cur.state !== state) {
      n.log('wave', state, reason, { lane, risk: Math.round(risk * 100) / 100 });
      st.waveState = { state, reason, at: T };
    }
    return st.waveState!;
  };
  if (st.waveOverride) return set(st.waveOverride, 'override'); // tests / trainer
  // gank risk switches at once (safety), everything else respects the hysteresis
  if (risk >= HOLD_RISK) return set('hold', `gank risk ${risk.toFixed(2)}`);
  if (cur && cur.state === 'freeze' && T - cur.at > FREEZE_MAX_TICKS) st.waveState = { ...cur, at: T - SWITCH_TICKS };
  if (cur && T - cur.at < SWITCH_TICKS && cur.state !== 'hold') return cur;
  const b = n.ctx.profile.behavior;
  const own = near(n.v.ownMinions, n.v.self, 1500).length;
  const foe = near(n.v.enemyMinions, n.v.self, 1500).length;
  // not a deliberate choice this time (rank): just push (Iron "nein (Push)", §4.7)
  // the rank decides per minute whether it plays the wave deliberately (rolled per minute, not per decision: a
  // per-decision roll flips push/neutral every 10 s)
  if (T >= st.deliberateUntil) {
    st.deliberate = n.rng.chance(b.waveStateDeliberatePct / 100);
    st.deliberateUntil = T + DELIBERATE_TICKS;
  }
  if (!st.deliberate) return set('push', 'no deliberate wave state');
  const d = n.ctx.teamAI.desireFor(n.ctx.slot, T);
  if (d && (d.kind === 'push_lane' || d.kind === 'split_push')) return set('push', d.reason);
  if (recallWanted(n) >= RECALL_THRESHOLD + n.p.knobs.recallThresholdShift - 0.15) return set('push', 'shove before recall');
  const laner = n.ctx.players.find((p) => p.team !== n.ctx.team && n.ctx.lane && (p.role === n.ctx.role || (n.ctx.role === 'support' && p.role === 'adc')));
  if (laner && n.snap.players.find((r) => r.slot === laner.slot)?.dead) return set('push', 'enemy laner absent');
  let objLeft = Infinity;
  for (const o of ['leviathan', 'schleierwaechter'] as const) {
    const left = (n.ctx.teamAI.aliveFrom[o] - T) / 30;
    if (left > 0) objLeft = Math.min(objLeft, left);
  }
  if (objLeft < OBJ_PUSH_S) return set('push', 'objective soon');
  if (objLeft <= OBJ_SLOW_S) return set('slowPush', 'objective in 60-90 s');
  if (own >= foe + ADVANTAGE) return set('push', `minion advantage ${own} vs ${foe}`);
  // freeze: the enemy laner is behind, own jungler not near, no objective in 90 s; slow tempo raises the chance
  const laneFoe = laner ? n.v.enemies.find((e) => e.slot === laner.slot) : undefined;
  const ownJg = n.ctx.players.find((p) => p.team === n.ctx.team && p.role === 'jungle');
  const jgNear = !!n.v.allies.find((a) => a.slot === ownJg?.slot && dst(a, n.v.self) < JUNGLER_NEAR);
  const behind = !!laneFoe && laneFoe.level < n.v.me.level;
  if (!jgNear && objLeft > OBJ_SLOW_S && (behind || (n.p.playstyle.tempo <= -2 && n.rng.chance(0.5)))) return set('freeze', behind ? 'enemy behind' : 'slow tempo');
  return set('neutral', `even wave ${own} vs ${foe}`);
}
