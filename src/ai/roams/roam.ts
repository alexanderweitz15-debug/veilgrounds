// §5.1 own roam (Mid, Support, Top from 20:00). Evaluated when the own wave allows it: crashed into the enemy tower
// or frozen on the own side (roam >= +4 skips this; Iron-Silver also roam off a pushing wave: roam_from_push 30 %).
// Score per target lane with the spec terms, threshold knobs.roamThreshold (roam +-0.2, tempo +-0.1) and the
// roam desire base. "On my way" ping (Silver+), engage via tactics.focus, abort when the target backs off before
// 1200 (ward, return), return per wave state (own tower -> back; enemy tower -> recall at the gold threshold).

import type { NodeCtx, NodeResult } from '../bt/types';
import type { LaneName, Pt } from '../../sim/map';
import { dst, lanePoint } from '../bot/geo';
import { maybeInject } from '../errors';
import { atLeast } from '../perception/rankModel';
import { estimateStyle } from '../perception/enemyStyle';
import { laneLength, lanePos } from '../perception/waves';
import { logTrack, trackPos } from '../perception/logInputs';
import type { BotPerception, TrackMem } from '../perception/types';
import type { ErrorId } from '../contract';
import { allyOfRole, canWard, champOf, hasCC, laneEnemies, LANE_ROLES, log, lv, move, objectiveSpawnIn, ownMs, pathTo, pathWarded, ping, tac, type Inputs } from '../ganks/common';

export interface RoamEval {
  lane: LaneName;
  target: TrackMem;
  score: number;
  terms: Record<string, number>;
}

interface RoamState {
  nextEval: number;
  active: { lane: LaneName; slot: number; since: number; startT: number; reached: boolean; home: LaneName } | null;
}

/** Target sighting age limit for a roam start (ticks). */
const ROAM_FRESH_TICKS = 60;
/** No new roam evaluation for this long after a roam ended (ticks): no start/abort flicker, back to the wave. */
export const ROAM_COOLDOWN_TICKS = 30 * 30;

const ROAM_TARGETS: Record<string, LaneName[]> = { mid: ['top', 'bot'], support: ['mid'], top: ['mid', 'bot'] };

/** Own lane wave allows a roam (§5.1 prerequisite). */
export function roamPrerequisite(n: NodeCtx, pv: BotPerception): { ok: boolean; why: string; err?: ErrorId } {
  const lane = n.ctx.lane;
  if (!lane) return { ok: false, why: 'no lane' };
  const w = pv.waves[lane];
  if (n.p.playstyle.roam >= 4) return { ok: true, why: 'roam axis >= +4' };
  if (w.crashed) return { ok: true, why: 'wave crashed into the enemy tower' };
  if (w.visible && w.pos < 0.45 && w.enemyCount >= w.ownCount) return { ok: true, why: 'wave frozen on the own side' };
  if (w.visible && (w.pushing || w.pos >= 0.45) && !atLeast(n.p, 'gold')) {
    const err = maybeInject(n.p, 'roam_from_push', n.rng);
    if (err) return { ok: true, why: 'roams off a pushing wave', err };
  }
  return { ok: false, why: w.visible ? 'wave not crashed / frozen' : 'wave not visible' };
}

/** Roam score for one target lane. */
export function roamScore(n: NodeCtx, pv: BotPerception, lane: LaneName): RoamEval | null {
  const self = pv.self;
  if (!self) return null;
  const tick = n.snap.tick;
  const map = n.ctx.map;
  const team = n.ctx.team as 0 | 1;
  // a target must be fresh: runRoam aborts once it is unseen for 5 s, so a stale one would start and abort at once
  const cands = laneEnemies(pv, lane).filter((t) => !t.dead && t.known && tick - t.lastTick <= ROAM_FRESH_TICKS);
  if (!cands.length) return null;
  const target = cands.sort((a, b) => a.hpFrac - b.hpFrac)[0]!;
  const pos = trackPos(target)!;
  const terms: Record<string, number> = { desire: n.p.knobs.roamDesireBase - 0.4 };
  if (lanePos(map, team, lane, pos).t < 0.5) terms.pastMid = 0.3;
  if (target.hpFrac < 0.5) terms.hp = 0.25;
  const ally = LANE_ROLES[lane].map((r) => allyOfRole(n, pv, r)).find((e) => !!e);
  if (ally && hasCC(champOf(n.ctx.players.find((p) => p.slot === ally.slot)?.champion ?? ''))) terms.allyCC = 0.15;
  if ((target.cds.flashReadyAt ?? -1) > tick) terms.flashDown = 0.2;
  const jg = allyOfRole(n, pv, 'jungle');
  if (jg && dst(jg, pos) < 3500) terms.ownJungler = 0.25;
  const { path, length } = pathTo(n, self, pos);
  if (length / ownMs(n) > 15) terms.far = -0.3;
  if (pathWarded(n, self, path)) terms.warded = atLeast(n.p, 'diamond') ? -0.1 : -0.25; // Diamond+ path behind wards
  // costs
  const opp = n.ctx.lane ? laneEnemies(pv, n.ctx.lane).find((t) => t.role === n.ctx.role) : undefined;
  if (opp && !opp.dead && opp.visibleNow) terms.oppFollows = -0.15;
  if (n.ctx.lane && pv.waves[n.ctx.lane].atOwnTower) terms.ownTowerPressure = -0.2;
  for (const obj of ['leviathan', 'schleierwaechter'] as const) {
    const inS = objectiveSpawnIn(pv, obj);
    if (inS > 0 && inS < 90 && dst(map.objectives[obj], pos) > 6000) terms.objectiveOtherSide = -0.3;
  }
  const style = estimateStyle(pv.mem.styleObs.get(target.slot), n.p, tick);
  if (style?.aggression !== undefined && style.aggression >= 3) terms.styleAggro = 0.1;
  const score = Math.max(0, Math.min(1, Object.values(terms).reduce((a, b) => a + b, 0)));
  return { lane, target, score, terms };
}

/** Score leaf: best roam score now (0 if the role/wave does not allow a roam). */
export function bestRoamScore(n: NodeCtx): number {
  const pv = lv(n);
  if (!pv) return 0;
  const targets = roamTargets(n);
  return Math.max(0, ...targets.map((l) => roamScore(n, pv, l)?.score ?? 0));
}

function roamTargets(n: NodeCtx): LaneName[] {
  if (n.ctx.role === 'top' && n.snap.time < 20 * 60) return [];
  return ROAM_TARGETS[n.ctx.role] ?? [];
}

/** Action leaf: §5.1 roam decision + execution. */
export function roam(n: NodeCtx): NodeResult {
  const pv = lv(n);
  if (!pv?.self || !n.ctx.lane) return 'failure';
  const st = tac<RoamState>(pv, 'roam', () => ({ nextEval: 0, active: null }));
  const tick = n.snap.tick;
  if (st.active) return runRoam(n, pv, st);
  if (tick < st.nextEval) return 'failure';
  st.nextEval = tick + 90;
  const targets = roamTargets(n);
  if (!targets.length) return 'failure';
  const pre = roamPrerequisite(n, pv);
  if (!pre.ok) return 'failure';
  const inputs: Inputs = { lane: n.ctx.lane, prerequisite: pre.why };
  // support: only when the ADC is safe and bound to it by the roam axis (-5: 90 %)
  if (n.ctx.role === 'support') {
    if (pv.gankRisk.bot >= 0.3) return 'failure';
    if (pv.waves.bot.siege) return 'failure'; // ponytail: "no siege wave within 20 s" read as no siege minion now
    if (n.rng.chance(n.p.knobs.supportAdcBinding)) return 'failure';
  }
  const evals = targets.map((l) => roamScore(n, pv, l)).filter((e): e is RoamEval => !!e);
  if (!evals.length) return 'failure';
  const best = evals.sort((a, b) => b.score - a.score)[0]!;
  const thr = n.p.knobs.roamThreshold;
  const go = best.score > thr;
  logTrack(inputs, 'target', best.target);
  for (const [k, v] of Object.entries(best.terms)) inputs[`t_${k}`] = +v.toFixed(2);
  log(n, pv, 'roam', go ? `roam_${best.lane}` : 'stay', `score ${best.score.toFixed(2)} vs ${thr.toFixed(2)}`, inputs, Object.fromEntries(evals.map((e) => [e.lane, +e.score.toFixed(3)])), pre.err);
  if (!go) return 'failure';
  const startT = lanePos(n.ctx.map, n.ctx.team, best.lane, trackPos(best.target)!).t;
  st.active = { lane: best.lane, slot: best.target.slot, since: tick, startT, reached: false, home: n.ctx.lane };
  if (atLeast(n.p, 'silver')) ping(n, pv, 'onMyWay', trackPos(best.target)!);
  return runRoam(n, pv, st);
}

function runRoam(n: NodeCtx, pv: BotPerception, st: RoamState): NodeResult {
  const a = st.active!;
  const tick = n.snap.tick;
  const self = pv.self!;
  const target = pv.enemies.get(a.slot);
  const pos = target ? trackPos(target) : null;
  const finish = (chosen: string, reason: string, ok: boolean): NodeResult => {
    const inputs: Inputs = { lane: a.lane, durS: +((tick - a.since) / 30).toFixed(1) };
    if (target) logTrack(inputs, 'target', target);
    // return plan (§5.1): own wave at the own tower -> back to lane; at the enemy tower -> recall when rich
    const w = pv.waves[a.home];
    const thr = n.p.behavior.recallGoldThreshold;
    const back = w.atOwnTower ? 'lane' : w.crashed && thr !== null && (n.snap.me?.gold ?? 0) >= thr ? 'recall' : 'jungleBack';
    pv.mem.tactics.roamReturn = back;
    log(n, pv, 'roam', chosen, `${reason}; return: ${back}`, inputs);
    st.active = null;
    st.nextEval = tick + ROAM_COOLDOWN_TICKS;
    pv.mem.tactics.focus = null;
    if (back === 'recall') n.out.push({ cmd: { t: 'recall' } });
    else {
      const pts = n.ctx.map.sides[n.ctx.team as 0 | 1].lanes[a.home];
      move(n, pv, lanePoint(pts, laneLength(pts) * 0.4));
    }
    return ok ? 'success' : 'failure';
  };
  if (!target || !pos || target.dead) return finish('done', target?.dead ? 'target died' : 'target lost', !!target?.dead);
  if (tick - a.since > 30 * 30) return finish('abort', 'roam took too long', false);
  const d = dst(self, pos);
  if (!a.reached && d <= 1200) a.reached = true;
  if (!a.reached) {
    // target backs off before we arrive: ward the spot, go back
    const t = lanePos(n.ctx.map, n.ctx.team, a.lane, pos).t;
    if (t > a.startT + 0.06 || (!target.visibleNow && tick - target.lastTick > 5 * 30)) {
      if (canWard(n)) {
        const spot = n.ctx.map.bushes.slice().sort((x, y) => dst(x, self) - dst(y, self))[0];
        if (spot && dst(spot, self) < 900) n.out.push({ cmd: { t: 'ward', x: Math.round(spot.x), y: Math.round(spot.y) } });
      }
      return finish('abort', 'target retreated before 1200', false);
    }
    if (move(n, pv, pos as Pt)) return 'running';
    a.reached = true;
  }
  if (!target.visibleNow) {
    if (tick - target.lastTick > 3 * 30) return finish('done', 'target gone after the engage', true);
    if (move(n, pv, pos as Pt)) return 'running';
    return finish('done', 'arrived, target not in sight', false);
  }
  pv.mem.tactics.focus = { slot: target.slot, eid: target.eid, until: tick + 90 };
  n.out.push({ cmd: { t: 'attack', target: target.eid } });
  return 'running';
}
