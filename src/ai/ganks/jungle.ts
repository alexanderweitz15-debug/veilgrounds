// §4.3 jungler gank decision + §4.4 counter-gank / help radius / shadowing.
// Gank score per lane every knobs.gankEvalIntervalS (tempo-scaled), terms exactly as the spec lists them; gank at
// score > knobs.gankThreshold + rank shift (Iron 0.3 and random, Challenger 0.6). Execution: approach through a
// bush near the target (Silver+), engage when in reach (target = highest kill chance; tactics.focus for M's combo
// leaves), abort when the target flashed and kill chance < 0.3 (Iron chases anyway). Partial success is logged.

import type { NodeCtx, NodeResult } from '../bt/types';
import type { LaneName, Pt } from '../../sim/map';
import { dst } from '../bot/geo';
import { estimateExchange } from '../bt/deps';
import { atLeast, gankThresholdRankShift, helpLatencyS, junglerInputs, rankIdx } from '../perception/rankModel';
import { estimateStyle } from '../perception/enemyStyle';
import { frontTower, lanePos } from '../perception/waves';
import { logPos, logTrack, trackPos } from '../perception/logInputs';
import type { BotPerception, TrackMem } from '../perception/types';
import { allyOfRole, champOf, enemyJunglerSlot, dpsOf, hasCC, hpFrac, laneEnemies, LANE_ROLES, log, lv, move, objectiveSpawnIn, ownMs, pathTo, pathWarded, tac, type Inputs } from './common';

export interface GankEval {
  lane: LaneName;
  target: TrackMem;
  score: number;
  terms: Record<string, number>;
  inputs: Inputs;
}

const LANES: LaneName[] = ['top', 'mid', 'bot'];

/** Gank score (0..1) for one lane from the jungler's perception. Null when no target is known well enough. */
export function gankScore(n: NodeCtx, pv: BotPerception, lane: LaneName, seenWithinS = 3): GankEval | null {
  const self = pv.self;
  if (!self) return null;
  const tick = n.snap.tick;
  const map = n.ctx.map;
  const team = n.ctx.team as 0 | 1;
  // target: the lane enemy with the best kill chance among those seen just now (a real window, not a memory)
  const cands = laneEnemies(pv, lane).filter((t) => !t.dead && t.known && tick - t.lastTick <= seenWithinS * 30);
  if (!cands.length) return null;
  const target = cands.sort((a, b) => a.hpFrac - b.hpFrac)[0]!;
  const pos = trackPos(target)!;
  const terms: Record<string, number> = {};
  const wave = pv.waves[lane];
  // wave pushed toward the jungler's side (enemy-pushed) or the target past the lane middle; a clash right at the
  // middle is no window (margins 0.05 / 0.08 of the lane)
  const pastMid = lanePos(map, team, lane, pos).t < 0.45;
  if ((wave.visible && wave.pos < 0.42) || pastMid) terms.overextended = 0.3;
  const et = frontTower(map, n.snap, 1 - team, lane);
  if (et && dst(et, pos) < 950) terms.underTower = -0.3;
  if (target.hpFrac < 0.35) terms.hp = 0.35;
  else if (target.hpFrac < 0.6) terms.hp = 0.2;
  if (target.cds.flashReadyAt !== undefined && target.cds.flashReadyAt > tick) terms.flashDown = 0.25;
  const tc = champOf(target.champ);
  const escSlot = tc ? tc.abilities.findIndex((a, i) => i < 3 && (a.type === 'dash' || a.type === 'blink')) : -1;
  if (escSlot >= 0 && (target.abilityReadyAt[escSlot] ?? 0) > tick) terms.escapeDown = 0.15;
  if (hasCC(n.ctx.champ)) terms.ownCC = 0.15;
  const laner = LANE_ROLES[lane].map((r) => allyOfRole(n, pv, r)).find((e) => !!e) ?? null;
  if (laner) {
    const lp = n.ctx.players.find((p) => p.slot === laner.slot);
    if (lp && hasCC(champOf(lp.champion))) terms.lanerCC = 0.15;
    if (hpFrac(laner) > 0.5) terms.lanerHp = 0.1;
  }
  const { path, length } = pathTo(n, self, pos);
  const etaS = length / ownMs(n);
  if (etaS > 12) terms.far = -0.3;
  if (pathWarded(n, self, path)) terms.warded = -0.25;
  const ej = pv.junglerEstimate;
  if (ej && ej.weight > 0.3 && ej.src !== 'prior') {
    if (dst(ej, pos) < 4000) terms.enemyJgSameSide = -0.2;
    else if (ej.src === 'seen' || (ej.tick >= 0 && tick - ej.tick < 300)) terms.enemyJgOtherSide = 0.15;
  }
  if (atLeast(n.p, 'gold')) {
    const obj = dst(pos, map.objectives.leviathan) < dst(pos, map.objectives.schleierwaechter) ? 'leviathan' : 'schleierwaechter';
    const inS = objectiveSpawnIn(pv, obj);
    if (inS > -5 && inS < 60 && lane !== 'mid') terms.objective = 0.2;
  }
  // §5.3: an estimated aggressive target overextends more (Platinum+ estimates)
  const style = estimateStyle(pv.mem.styleObs.get(target.slot), n.p, tick);
  if (style?.aggression !== undefined && style.aggression >= 3) terms.styleAggro = 0.1;
  // ponytail: "laner reacted to pings recently +0.1" needs the ping-response memory of M's ping handling; 0 here
  const score = Math.max(0, Math.min(1, Object.values(terms).reduce((a, b) => a + b, 0)));
  const inputs: Inputs = { lane, etaS: +etaS.toFixed(1), targetHp: +target.hpFrac.toFixed(2) };
  logTrack(inputs, 'target', target);
  return { lane, target, score, terms, inputs };
}

/** Gank threshold for this bot: knob (aggression) + rank shift (Iron 0.3 .. Challenger 0.6). */
/** Seconds without a new gank evaluation after a gank ended (clear camps in between). */
export const GANK_COOLDOWN_S = 30;

export const gankThreshold =(n: NodeCtx): number => n.p.knobs.gankThreshold + gankThresholdRankShift(n.p);

interface GankState {
  nextEval: number;
  active: { lane: LaneName; slot: number; since: number; flashSeenAt: number; recheck: number } | null;
}

/** Score leaf: best lane gank score (for gates). */
export function jungleGankScore(n: NodeCtx): number {
  const pv = lv(n);
  if (!pv || n.ctx.role !== 'jungle') return 0;
  return Math.max(0, ...LANES.map((l) => gankScore(n, pv, l)?.score ?? 0));
}

/** Action leaf: §4.3 decision every eval interval + execution of a running gank. */
export function jungleGank(n: NodeCtx): NodeResult {
  const pv = lv(n);
  if (!pv?.self || n.ctx.role !== 'jungle') return 'failure';
  const st = tac<GankState>(pv, 'gank', () => ({ nextEval: 0, active: null }));
  const tick = n.snap.tick;
  if (!st.active) {
    if (tick < st.nextEval) return 'failure';
    st.nextEval = tick + Math.round(n.p.knobs.gankEvalIntervalS * 30);
    const evals = LANES.map((l) => gankScore(n, pv, l)).filter((e): e is GankEval => !!e);
    if (!evals.length) return 'failure';
    const best = evals.sort((a, b) => b.score - a.score)[0]!;
    const thr = gankThreshold(n);
    let go = best.score > thr;
    let reason = `score ${best.score.toFixed(2)} vs ${thr.toFixed(2)}`;
    if (rankIdx(n.p.rank) === 0 && go) {
      go = n.rng.chance(0.5); // Iron: also random
      reason += go ? ' (Iron roll yes)' : ' (Iron roll no)';
    }
    const scores = Object.fromEntries(evals.map((e) => [e.lane, +e.score.toFixed(3)]));
    log(n, pv, 'jungleGank', go ? `gank_${best.lane}` : 'farm', reason, { ...best.inputs, ...prefixed(best.terms) }, scores);
    if (!go) return 'failure';
    st.active = { lane: best.lane, slot: best.target.slot, since: tick, flashSeenAt: best.target.cds.flashReadyAt ?? -1, recheck: tick + 60 };
  }
  return runGank(n, pv, st);
}

const prefixed = (t: Record<string, number>): Inputs => Object.fromEntries(Object.entries(t).map(([k, v]) => [`t_${k}`, v]));

function runGank(n: NodeCtx, pv: BotPerception, st: GankState): NodeResult {
  const a = st.active!;
  const tick = n.snap.tick;
  const self = pv.self!;
  const target = pv.enemies.get(a.slot);
  const end = (chosen: string, reason: string, ok: boolean): NodeResult => {
    const inputs: Inputs = { lane: a.lane, durS: +((tick - a.since) / 30).toFixed(1) };
    logTrack(inputs, 'target', target);
    log(n, pv, 'jungleGank', chosen, reason, inputs);
    st.active = null;
    pv.mem.tactics.focus = null;
    // back to clearing camps for a while: ganks are occasional windows, farming is the default
    st.nextEval = tick + GANK_COOLDOWN_S * 30;
    return ok ? 'success' : 'failure';
  };
  if (!target || target.dead) return end('done', target?.dead ? 'target died' : 'target unknown', true);
  if (tick - a.since > 20 * 30) return end('abort', 'gank took too long', false);
  const pos = trackPos(target);
  // a laner steps out of sight often (bush, fog behind its wave): the jungler keeps coming for 7 s (was 4 s: most
  // ganks ended as "target lost" before the jungler arrived)
  if (!pos || (!target.visibleNow && tick - target.lastTick > 7 * 30 && !target.cloud)) {
    // another enemy of that lane in sight right now (the support, a laner back from base): gank that one instead
    const alt = laneEnemies(pv, a.lane).filter((t) => !t.dead && t.visibleNow && t.slot !== a.slot).sort((x, y) => x.hpFrac - y.hpFrac)[0];
    if (!alt || tick - a.since > 12 * 30) return end('abort', 'target lost', false);
    a.slot = alt.slot;
    log(n, pv, 'jungleGank', 'retarget', 'target lost, another lane enemy in sight', { lane: a.lane, slot: alt.slot });
    return 'running';
  }
  // Flash of the target during the gank: partial success; abort when the kill is unlikely (Iron chases on)
  const flashNow = (target.cds.flashReadyAt ?? -1) > tick && target.cds.flashReadyAt !== a.flashSeenAt;
  if (flashNow) {
    a.flashSeenAt = target.cds.flashReadyAt!;
    const e = n.snap.entities.find((x) => x.id === target.eid);
    const kp = e ? estimateExchange(n.v, n.ctx, e, 3, n.rng).killProb : 0;
    const inputs: Inputs = { killProb: +kp.toFixed(2) };
    logTrack(inputs, 'target', target);
    log(n, pv, 'jungleGank', 'partial', 'target forced to Flash', inputs);
    if (kp < 0.3 && rankIdx(n.p.rank) > 0) return end('abort', `flash forced, killProb ${kp.toFixed(2)} < 0.3`, false);
  }
  // the window must stay open: re-score every 2 s (the target may sit in fog up to 6 s while we approach)
  if (tick >= a.recheck) {
    a.recheck = tick + 60;
    const ev = gankScore(n, pv, a.lane, 6);
    const thr = gankThreshold(n) - 0.1;
    // an unseen target is the lost-target check's business (cloud horizon); only a closed window aborts here
    if (ev && ev.score < thr && rankIdx(n.p.rank) > 0) return end('abort', `window closed (score ${(ev?.score ?? 0).toFixed(2)} < ${thr.toFixed(2)})`, false);
  }
  const d = dst(self, pos);
  if (target.visibleNow && d < 900) {
    // engage: focus for M's combo leaves; a plain attack order as fallback
    pv.mem.tactics.focus = { slot: target.slot, eid: target.eid, until: tick + 90 };
    n.out.push({ cmd: { t: 'attack', target: target.eid } });
    return 'running';
  }
  // approach: through a bush near the target on the own side of it (Silver+), else straight
  let goal: Pt = pos;
  if (atLeast(n.p, 'silver') && d > 1500) {
    const bush = n.ctx.map.bushes.filter((b) => dst(b, pos) < 1800 && dst(b, self) < d).sort((x, y) => dst(x, pos) - dst(y, pos))[0];
    if (bush) goal = bush;
  }
  if (move(n, pv, goal) || move(n, pv, pos)) return 'running';
  return end('abort', 'arrived, no target in reach', false);
}

// ------------------------------------------------------------------ §4.4 counter-gank / help / shadowing

interface HelpState {
  seen: Map<number, number>;
  going: number;
}

/** Action leaf for jungler and mid: join an ally's fight within the help radius, or shadow (Challenger jungler). */
export function counterGank(n: NodeCtx): NodeResult {
  const pv = lv(n);
  if (!pv?.self || (n.ctx.role !== 'jungle' && n.ctx.role !== 'mid')) return 'failure';
  const st = tac<HelpState>(pv, 'help', () => ({ seen: new Map(), going: -1 }));
  const tick = n.snap.tick;
  const self = pv.self;
  const radiusS = n.ctx.role === 'jungle' ? 20 : 12;
  const ms = ownMs(n);
  let best: { ally: (typeof pv.allies)[number]; foes: TrackMem[]; eta: number; win: number; life: number } | null = null;
  for (const ally of pv.allies) {
    const foes = pv.visibleEnemies.filter((e) => dst(e, ally) < 1000).map((e) => pv.enemies.get(e.slot)!);
    if (!foes.length) {
      st.seen.delete(ally.slot);
      continue;
    }
    if (!st.seen.has(ally.slot)) st.seen.set(ally.slot, tick);
    const eta = pathTo(n, self, ally).length / ms;
    if (eta > radiusS) continue;
    const target = n.snap.entities.find((e) => e.id === foes[0]!.eid);
    if (!target) continue;
    const win = estimateExchange(n.v, n.ctx, target, 6, n.rng, { extraAllyDps: dpsOf(n.ctx.champ, n.snap.me?.level ?? 1) }).winProb;
    const dps = foes.reduce((a, t) => a + dpsOf(champOf(t.champ), t.level), 0);
    const life = (ally.hp + ally.shield) / Math.max(1, dps * 0.6);
    if (!best || win > best.win) best = { ally, foes, eta, win, life };
  }
  if (best) {
    const thr = 0.5 + (n.p.knobs.fightJoinThreshold - 0.45);
    const waited = (tick - (st.seen.get(best.ally.slot) ?? tick)) / 30 >= helpLatencyS(n.p) * n.p.knobs.fightJoinLatencyMult;
    const decided = best.eta > best.life + 1 && atLeast(n.p, 'gold'); // Silver and below run anyway
    const inputs: Inputs = { ally: best.ally.slot, etaS: +best.eta.toFixed(1), lifeS: +best.life.toFixed(1), foes: best.foes.length };
    best.foes.slice(0, 3).forEach((t, i) => logTrack(inputs, `foe${i}`, t));
    if (best.win > thr && waited && !decided) {
      if (st.going !== best.ally.slot) log(n, pv, 'counterGank', 'help', `exchange ${best.win.toFixed(2)} > ${thr.toFixed(2)}`, inputs, { win: best.win });
      st.going = best.ally.slot;
      if (move(n, pv, best.ally)) return 'running';
      return 'failure'; // arrived: the fight leaves take over
    }
    if (st.going === best.ally.slot) log(n, pv, 'counterGank', 'stay', decided ? 'fight decided before arrival' : `exchange ${best.win.toFixed(2)} <= ${thr.toFixed(2)}`, inputs, { win: best.win });
    st.going = -1;
    return 'failure';
  }
  st.going = -1;
  // Challenger shadowing: stand on the side of the enemy jungler cloud when the own laner there has pushed
  const ej = pv.junglerEstimate;
  if (n.ctx.role === 'jungle' && junglerInputs(n.p).csCounting && ej && ej.weight > 0.3) {
    const lane = (['top', 'bot'] as const).find((l) => lanePos(n.ctx.map, n.ctx.team, l, ej).off < 3500 && pv.waves[l].enemySide);
    if (lane) {
      const laner = LANE_ROLES[lane].map((r) => allyOfRole(n, pv, r)).find((e) => !!e);
      if (laner && dst(laner, ej) < 5000) {
        const p = { x: (laner.x * 2 + ej.x) / 3, y: (laner.y * 2 + ej.y) / 3 };
        const inputs: Inputs = { lane };
        logPos(inputs, 'jg', ej, enemyJunglerSlot(pv));
        if (tac(pv, 'shadowLane', () => '') !== lane) log(n, pv, 'counterGank', 'shadow', 'enemy jungler cloud on the pushed side', inputs);
        pv.mem.tactics.shadowLane = lane;
        if (move(n, pv, p)) return 'running';
      }
    }
  }
  pv.mem.tactics.shadowLane = '';
  return 'failure';
}

