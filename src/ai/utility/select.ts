// Utility selector (docs/BRAIN-REWORK.md §5): scores every candidate intent in gold per second, picks the best and
// runs its subtree. score = (benefit - cost) / horizon x style factor; the running intent (within its horizon)
// gets + hysteresis x |score| (profile: Gold 0.25 .. Challenger 0.10); rank noise N(0, sigma x |score|) with sigma =
// exchangeNoise(skill) (Iron 0.40, Gold 0.20, Challenger 0.07). Every evaluation logs all candidate scores.
// Commitments (no re-scoring while they hold): a running trade / all-in (until its abort rules end it), a running
// roam / gank, the walk home of a recall, a teamfight (re-evaluated every commitReevalS; left only below
// commitLeaveWin or through survive, §6.3). An intent whose subtree has nothing to do falls through to the next
// candidate in the same decision (an ended all-in re-evaluates at once, §6.2). Idle only when every candidate is
// <= 0 (chosen 'none', logged with all scores) - any other stand-still is logged as 'wait' with the reason.

import type { NodeCtx, NodeResult } from '../bt/types';
import { exchangeNoise } from '../exchange';
import { teamfightNear } from '../bot/teamfight';
import { roamActive } from '../roams/roam';
import { gankActive } from '../ganks/jungle';
import { VALUES, styleFactor } from './values';
import { buildWorld } from './world';
import { CANDIDATES } from './value';
import { runIntent } from './intents';
import type { IntentId, Scored, UtilityState } from './types';

const C = VALUES.combat;
const states = new WeakMap<object, UtilityState>();

export function utilityState(mem: object): UtilityState {
  let s = states.get(mem);
  if (!s) states.set(mem, (s = { intent: 'none', since: 0, until: 0, evalAt: -1e9, last: [], hist: {}, switches: 0, lastTick: -1 }));
  return s;
}

const r2 = (x: number): number => Math.round(x * 100) / 100;

/** Score all candidates (fixed candidate order; random draws in that order: deterministic). Best first. */
export function scoreCandidates(n: NodeCtx, st: UtilityState): Scored[] {
  const w = buildWorld(n);
  const sigma = exchangeNoise(n.ctx.params.skill);
  const h = n.p.hysteresis;
  const out: Scored[] = [];
  for (const c of CANDIDATES) {
    const value = c.value(w);
    if (!value) continue;
    const raw = ((value.benefit - value.cost) / Math.max(1, value.horizonS)) * styleFactor(c.id, n.p);
    // running intent bonus; a trade answering the enemy (harass -> trade, §6.1) switches without the penalty
    const running = c.id === st.intent && n.v.tick < st.until;
    const answer = c.id === 'trade' && value.data?.trigger === 'retaliate' && (st.intent === 'poke' || st.intent === 'farm');
    const hyst = running || answer ? h * Math.abs(raw) : 0;
    const noise = n.rng.normal() * sigma * Math.abs(raw);
    out.push({ id: c.id, raw, score: raw + hyst + noise, value });
  }
  // stable: ties keep the candidate order
  return out.map((s, i) => [s, i] as const).sort((a, b) => b[0].score - a[0].score || a[1] - b[1]).map(([s]) => s);
}

/** The intent that holds without re-scoring right now (commitments), or null. */
function committed(n: NodeCtx, st: UtilityState): IntentId | null {
  if (n.mem.ext.trade) return 'trade';
  if (roamActive(n)) return 'roam';
  if (gankActive(n)) return 'gank';
  if (st.intent === 'recall' && (n.mem.mode === 'recall' || n.mem.mode === 'home')) return 'recall';
  if (st.intent === 'fight' && teamfightNear(n) && n.v.tick - st.evalAt < C.commitReevalS * 30) return 'fight';
  return null;
}

function enter(n: NodeCtx, st: UtilityState, id: IntentId | 'none', horizonS: number): void {
  const t = n.v.tick;
  if (st.lastTick >= 0) st.hist[st.intent] = (st.hist[st.intent] ?? 0) + (t - st.lastTick);
  st.lastTick = t;
  if (id !== st.intent) {
    st.switches++;
    st.intent = id;
    st.since = t;
    st.until = t + Math.round(horizonS * 30);
  } else if (t >= st.until) st.until = t + Math.round(horizonS * 30);
}

/** Tree leaf (flag-gated by the caller): one utility decision. Never 'failure' (idle is a logged choice). */
export function utilitySelect(n: NodeCtx): NodeResult {
  const st = utilityState(n.mem);
  // lane-shaped team desires are weights now (§7.6): the group / catch-lane intents set the override when chosen
  n.mem.ext.laneOverride = null;
  n.mem.ext.splitting = false;
  const hold = committed(n, st);
  if (hold) {
    const r = runIntent(n, hold, undefined);
    if (r !== 'failure') {
      enter(n, st, hold, 0);
      return r;
    }
  }
  const scored = scoreCandidates(n, st);
  st.evalAt = n.v.tick;
  st.last = scored;
  const scores: Record<string, number> = {};
  for (const s of scored) scores[s.id] = r2(s.score);
  // teamfight commit (§6.3): stay unless the fight estimate dropped below commitLeaveWin
  const fight = scored.find((s) => s.id === 'fight');
  const keepFight = st.intent === 'fight' && !!fight && fight.value.terms.near === 1 && (fight.value.terms.win ?? 0) >= C.commitLeaveWin;
  const order = keepFight ? [fight!, ...scored.filter((s) => s !== fight)] : scored;
  const skipped: string[] = [];
  for (const s of order) {
    if (s.score <= 0 && !(keepFight && s === fight)) break;
    const r = runIntent(n, s.id, s.value.data);
    if (r === 'failure') {
      skipped.push(s.id);
      continue;
    }
    const inputs: Record<string, number | string | boolean> = { horizonS: r2(s.value.horizonS), benefit: r2(s.value.benefit), cost: r2(s.value.cost) };
    for (const [k, v] of Object.entries(s.value.terms)) inputs[`t_${k}`] = r2(v);
    if (skipped.length) inputs.skipped = skipped.join(',');
    n.log('utility', s.id, keepFight && s === fight ? 'teamfight commit' : skipped.length ? 'best runnable' : 'best', inputs, scores);
    enter(n, st, s.id, s.value.horizonS);
    return r;
  }
  // nothing positive and runnable: idle, with every score in the log (test 7). 'none' = all candidates <= 0;
  // 'wait' = a positive candidate had nothing to do (e.g. farm waiting for the wave) - listed in `skipped`
  const allNeg = scored.every((s) => s.score <= 0);
  n.log('utility', allNeg ? 'none' : 'wait', allNeg ? 'all candidates <= 0' : 'no runnable intent', skipped.length ? { skipped: skipped.join(',') } : {}, scores);
  enter(n, st, 'none', 0);
  runIntent(n, 'none', undefined);
  return 'running';
}

/** F9 overlay / tests: current intent, top-3 candidates with score, ticks per intent, switches. */
export function utilityDebug(mem: object): { intent: string; top: { id: string; score: number }[]; hist: UtilityState['hist']; switches: number } | null {
  const s = states.get(mem);
  if (!s) return null;
  return { intent: s.intent, top: s.last.slice(0, 3).map((x) => ({ id: x.id, score: r2(x.score) })), hist: s.hist, switches: s.switches };
}
