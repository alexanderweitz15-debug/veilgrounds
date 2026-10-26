// Trades and all-ins (docs/spec-bots.md §6) and dive defence.
//   Trade window: every condition must hold; aggression above +2 loosens one condition per step
//   (minion aggro, then gank risk, then the trigger):
//     in combo reach (or within 0.5 s), gank risk < 0.5, minion-aggro balance (Silver+), a trigger
//     (CS window Diamond+, punish window Gold+, power spike, low enemy HP, Iron/Bronze trade_on_cooldown, retaliation),
//     winProb > tradeWinThreshold x tradeWindowMult.
//   Execution: a signature combo from champion data (rank: situational vs standard), then autos + ready casts.
//   Abort by the trade-length axis (knobs tradeAbortS / tradeAbortHpRatio); all-in at killProb/deathProb knobs;
//   offensive flash (resourceUse >= 0, Gold+) only when it raises killProb by > 0.3; ignite at killProb > 0.7.
//   Disengage: orbwalk back behind the own wave toward the own tower.

import type { Rng } from '../../sim/rng';
import type { BotAction, SnapEntity } from './types';
import type { NodeCtx, NodeResult } from '../bt/types';
import { castSlot, hpPct, slotReach, offensiveCast } from './combat';
import { dst, unit } from './geo';
import { estimateExchange, laningSafety, rankIdx, tacticsFocus } from '../bt/deps';
import { rollErrorUntil } from '../errors';
import { cancelOrbwalk, kitePoint, orbwalkAttack, moveCmd } from './kite';
import { TOWER_DANGER, towerCovering } from './perception';
import { lv } from '../ganks/common';
import { VALUES, rankCurve } from '../utility/values';
import type { TradeState } from '../bt/state';
import type { ExchangeResult } from '../contract';
import { utilityOn } from '../utility/flag';

const SILVER = rankIdx('silver');
const GOLD = rankIdx('gold');
const DIAMOND = rankIdx('diamond');
const PLATINUM = rankIdx('platinum');

export const decisionInterval = (n: NodeCtx): number => Math.max(1, Math.round(30 / n.ctx.profile.behavior.microHz));

/** Summoner slot (0/1) with this id ready, else -1. */
export function summonerReady(n: NodeCtx, id: string): 0 | 1 | -1 {
  for (const i of [0, 1] as const) {
    const s = n.v.me.abilities[4 + i];
    if (s?.id === id && s.rank > 0 && s.cdLeft <= 0) return i;
  }
  return -1;
}

const SLOT: Record<string, 0 | 1 | 2 | 3> = { Q: 0, W: 1, E: 2, R: 3 };

/** Longest reach of the first ability token of a combo (or auto reach). */
export function comboReach(n: NodeCtx, combo: string[]): number {
  const first = combo.find((t) => t in SLOT);
  return Math.max(n.v.reach + 50, first ? slotReach(n.v, n.ctx, SLOT[first]!) : 0);
}

/** Combo choice: standard = the champion's first combo; situational (profile situationalAbilityPct) by situation. */
export function chooseCombo(n: NodeCtx, kind: 'trade' | 'allin', rng: Rng): string[] {
  const combos = n.ctx.champ.combos.map((c) => c.sequence);
  if (!combos.length) return ['AA'];
  if (!rng.chance(n.ctx.profile.behavior.situationalAbilityPct / 100)) return combos[0]!;
  const ready = (c: string[]): boolean => c.every((t) => !(t in SLOT) || (n.v.me.abilities[SLOT[t]!]?.rank ?? 0) > 0);
  const withR = combos.filter((c) => c.includes('R') && ready(c));
  const noR = combos.filter((c) => !c.includes('R') && ready(c) && c.some((t) => t !== 'E' || c.length > 1));
  if (kind === 'allin' && withR.length) return withR[0]!;
  return (noR.sort((a, b) => a.length - b.length)[0] ?? combos[0])!;
}

/** Visible, noticed enemy champion closest to the bot within `r`. */
export function closestEnemy(n: NodeCtx, r: number): SnapEntity | null {
  let best: SnapEntity | null = null;
  for (const e of n.v.enemies) if (dst(e, n.v.self) <= r && (!best || dst(e, n.v.self) < dst(best, n.v.self))) best = e;
  return best;
}

const laneRisk = (n: NodeCtx): number => (n.ctx.lane ? n.pv.gankRisk[n.ctx.lane] ?? 0 : 0);

interface Window {
  target: SnapEntity;
  score: number;
  trigger: string;
  ex: ExchangeResult;
  /** Kill estimate over ALLIN_HORIZON_S (all-in decision); the 3-s trade estimate almost never shows a kill. */
  exK: ExchangeResult;
  failed: string[];
}

/** Horizon (s) of the kill estimate behind all-in decisions: a committed all-in runs a few seconds (LoL 3-6 s). */
export const ALLIN_HORIZON_S = 6;
/** An all-in ends when the target's HP has not dropped by 5 points for this long, or after ALLIN_MAX_S. */
const ALLIN_STALL_S = 5;
const ALLIN_MAX_S = 20;
/**
 * Target out of sight during an all-in on a low target: follow its last seen heading this long (rank curve
 * deception.fogFollowS; Iron/Bronze give up at once). A target that stepped into a bush is guessed at for
 * fogFollowBushS more: a brush juke works on low ranks (docs/agents/brain-deception.md).
 */
const allinFollowS = (n: NodeCtx, p: { x: number; y: number }): number => {
  const D = VALUES.deception;
  const s = rankCurve(D.fogFollowS, n.ctx.params.skill);
  return s > 0 && n.ctx.map.bushes.some((b) => dst(b, p) < b.r) ? s + rankCurve(D.fogFollowBushS, n.ctx.params.skill) : s;
};

/** Evaluate the trade window against the closest enemy (spec §6). Cached per decision tick. */
const windowCache = new WeakMap<object, { tick: number; w: Window | null }>();
export function tradeWindow(n: NodeCtx): Window | null {
  const c = windowCache.get(n.mem);
  if (c && c.tick === n.v.tick) return c.w;
  const w = evalWindow(n);
  windowCache.set(n.mem, { tick: n.v.tick, w });
  if (w && w.score > 0) lastOpen.set(n.mem, { tick: n.v.tick, w });
  return w;
}

/** Last open window per bot: the gate opened on it; the reaction delay must not re-roll the decision away. */
const lastOpen = new WeakMap<object, { tick: number; w: Window }>();
const REACTION_HOLD_TICKS = 45;

function evalWindow(n: NodeCtx): Window | null {
  const focus = tacticsFocus(n.mem, n.v.tick);
  const t = (focus ? n.v.enemies.find((e) => e.id === focus.eid) : null) ?? closestEnemy(n, 1300);
  if (!t) return null;
  const ri = rankIdx(n.ctx.profile.rank);
  const k = n.p.knobs;
  const ext = n.mem.ext;
  const failed: string[] = [];
  const combo = n.ctx.champ.combos[0]?.sequence ?? ['AA'];
  const reach = comboReach(n, combo);
  if (dst(n.v.self, t) > reach + n.v.me.stats.ms * 0.5) failed.push('range');
  const safety = laningSafety(n.mem);
  if (laneRisk(n) >= 0.5 || safety?.allowTrade === 'none') failed.push('gankRisk');
  const enemyWave = n.v.enemyMinions.filter((m) => dst(m, n.v.self) < 500).length;
  const ownAround = n.v.ownMinions.filter((m) => dst(m, n.v.self) < 500).length;
  const inWave = enemyWave >= 3 && enemyWave > ownAround + 1;
  let waveErr = false;
  if (inWave) {
    if (rollErrorUntil(n.mem, n.ctx, n.p, 'fight_in_enemy_wave', n.v.tick, n.rng) < 0) failed.push('minionAggro'); // §9 episode with the new brain
    else waveErr = true;
  }
  // triggers (one is enough)
  let trigger = '';
  const ex = estimateExchange(n.v, n.ctx, t, 3, n.rng, { orbwalk: 0.7 + 0.3 * k.orbwalkChance });
  // kill estimate over the all-in horizon (only worth computing on a hurt target or a gank focus)
  const exK = hpPct(t) < 0.65 || focus ? estimateExchange(n.v, n.ctx, t, ALLIN_HORIZON_S, n.rng, { orbwalk: 0.7 + 0.3 * k.orbwalkChance }) : ex;
  if (focus && focus.eid === t.id) trigger = 'gank_focus';
  else if (t.atkTarget === n.v.self.id) trigger = 'retaliate';
  else if (ri >= DIAMOND && (ext.csWindowAt.get(t.serial) ?? -1e9) > n.v.tick - 30) trigger = 'cs_window';
  else if (ri >= GOLD && (ext.enemyCastAt.get(t.serial) ?? -1e9) > n.v.tick - 7 * 30) trigger = 'punish';
  else if (ext.levelUpAt > n.v.tick - 150 && [2, 3, 6].includes(n.v.me.level) && n.v.me.level > t.level) trigger = 'power_spike';
  else if (hpPct(t) < 0.5 && exK.killProb > 0.3) trigger = 'low_hp';
  // a clearly winning exchange (HP / level / cooldown lead) is a reason to trade at every rank; whether the bot reads
  // it right is the rank's exchange noise (Iron +-40 % .. Challenger +-7 %): low ranks take bad trades and miss good ones
  else if (ex.winProb > 0.62 && n.v.hpPct >= hpPct(t) - 0.05) trigger = 'advantage';

  let injected: 'trade_on_cooldown' | 'fight_in_enemy_wave' | undefined = waveErr ? 'fight_in_enemy_wave' : undefined;
  if (!trigger) {
    const allReady = [0, 1, 2].every((s) => (n.v.me.abilities[s]?.rank ?? 0) === 0 || (n.v.me.abilities[s]?.cdLeft ?? 1) <= 0);
    if (allReady && rollErrorUntil(n.mem, n.ctx, n.p, 'trade_on_cooldown', n.v.tick, n.rng) >= 0) (trigger = 'cooldowns_ready'), (injected = 'trade_on_cooldown');
  }
  if (!trigger) failed.push('trigger');
  // aggression above +2 loosens one condition per step
  let loosen = Math.max(0, n.p.playstyle.aggression - 2);
  for (const c of ['minionAggro', 'gankRisk', 'trigger']) {
    const i = failed.indexOf(c);
    if (loosen > 0 && i >= 0) failed.splice(i, 1), loosen--;
  }
  const thr = k.tradeWinThreshold * k.tradeWindowMult;
  if (ex.winProb <= thr) failed.push('winProb');
  if (safety?.allowTrade === 'killOnly' && exK.killProb <= 0.9) failed.push('gankRisk');
  // passive bots still take near-certain kills (all-in horizon; the enemy tower is in the estimate when it covers us)
  let score = failed.length ? 0 : 0.5 * (ex.winProb / thr) * k.fightWeight;
  if (exK.killProb > 0.8 && exK.deathProb < 0.5 && failed.every((f) => f === 'winProb' || f === 'trigger')) score = Math.max(score, 0.6);
  if (injected && score > 0) n.log('tradeWindow', 'error', injected, { target: t.slot }, {}, injected);
  return { target: t, score, trigger: trigger || 'loosened', ex, exK, failed };
}

export const tradeWindowScore = (n: NodeCtx): number => (n.mem.ext.trade || n.v.tick < n.mem.ext.disengageUntil || n.v.tick - n.mem.ext.lastTradeEnd < 45 ? 0 : tradeWindow(n)?.score ?? 0);

/** Start a trade on the window's target. */
export function tradeStart(n: NodeCtx): NodeResult {
  if (n.mem.ext.trade) return 'failure';
  let w = tradeWindow(n);
  if (!w || w.score <= 0) {
    // the decision was taken when the gate opened; the reaction delay only postpones it (target still in sight)
    const o = lastOpen.get(n.mem);
    const t = o && n.v.tick - o.tick <= REACTION_HOLD_TICKS ? n.v.enemies.find((e) => e.id === o.w.target.id) : undefined;
    if (!o || !t || dst(t, n.v.self) > 1300) return 'failure';
    w = { ...o.w, target: t };
  }
  return startTrade(n, w.target, isAllIn(n, w.exK) ? 'allin' : 'trade', w.trigger, w.ex, w.exK, w.score);
}

/** Start a trade / all-in on `target` (gated tradeStart above, or the utility model's trade intent) and run it. */
export function startTrade(n: NodeCtx, target: SnapEntity, kind: 'trade' | 'allin', trigger: string, ex: ExchangeResult, exK: ExchangeResult, score: number): NodeResult {
  const combo = chooseCombo(n, kind, n.rng);
  n.mem.ext.trade = { serial: target.serial, id: target.id, kind, start: n.v.tick, trigger, combo, step: 0, stepAt: n.v.tick, comboDone: false, flash: false, ignite: false, win: ex.winProb, kill: exK.killProb, death: exK.deathProb };
  n.mem.mode = 'fight';
  n.mem.fightTarget = target.serial;
  n.log('trade', kind, `trigger ${trigger}`, { target: target.slot, combo: combo.join('-') }, { win: ex.winProb, kill: exK.killProb, death: exK.deathProb, score });
  return tradeRunCore(n);
}

/** All-in decision of the kill estimate (knobs allInKillProb / allInDeathProb; long traders prefer all-in at 0.5). */
export const allInWanted = (n: NodeCtx, exK: ExchangeResult): boolean => isAllIn(n, exK);

/**
 * Lethal dive (Silver+): the kill is likely within the all-in horizon, the target is low and the bot healthy enough
 * to take a few tower shots (the estimate counts the tower once the bot is inside its reach). Iron/Bronze dive only
 * through the aggression knob / overcommit error.
 */
export function lethalDive(n: NodeCtx, t: SnapEntity, exK: ExchangeResult): boolean {
  if (rankIdx(n.ctx.profile.rank) < SILVER) return false;
  return exK.killProb > 0.75 && exK.deathProb < Math.max(0.35, n.p.knobs.allInDeathProb) && hpPct(t) < 0.35 && n.v.hpPct > Math.max(0.35, hpPct(t) + 0.1);
}

function isAllIn(n: NodeCtx, ex: ExchangeResult): boolean {
  const k = n.p.knobs;
  const killNeed = k.tradeAbortS >= 6 ? Math.min(k.allInKillProb, 0.5) : k.allInKillProb;
  return ex.killProb > killNeed && ex.deathProb < k.allInDeathProb;
}

function endTrade(n: NodeCtx, tr: TradeState, why: string, disengage: boolean): void {
  const dur = (n.v.tick - tr.start) / 30;
  n.mem.ext.trades.n++;
  n.mem.ext.trades.s += dur;
  n.log('trade', 'end', why, { kind: tr.kind, dur: Math.round(dur * 100) / 100, trigger: tr.trigger }, { duration: dur });
  n.mem.ext.trade = null;
  n.mem.ext.lastTradeEnd = n.v.tick;
  n.mem.mode = disengage ? 'disengage' : 'lane';
  if (disengage) n.mem.ext.disengageUntil = n.v.tick + 45;
  cancelOrbwalk(n);
}

/** Pure abort rule of the trade-length axis (spec §6), shared with the test-5 duel model. */
export function shouldAbort(
  knobs: { tradeAbortS: number; tradeAbortHpRatio: number },
  s: { elapsedS: number; comboDone: boolean; myHp: number; theirHp: number; winProb: number },
): string | null {
  if (knobs.tradeAbortS <= 3 && s.comboDone) return 'combo done (short trades)';
  if (s.elapsedS >= knobs.tradeAbortS) return 'time limit';
  // HP-ratio rule of the long side (+5: only below 0.8); short traders leave by combo end / time instead
  if (knobs.tradeAbortHpRatio < 1 && s.theirHp > 0 && s.myHp / s.theirHp < knobs.tradeAbortHpRatio) return 'hp ratio';
  if (knobs.tradeAbortS > 3 && knobs.tradeAbortS < 6 && (s.myHp < 0.4 || (s.elapsedS >= 1 && s.winProb < 0.5))) return 'losing';
  return null;
}

/** Classic trade leaf (combat selector). With the utility flag the 'utilitySelect' tree node runs before it. */
export const tradeRun = (n: NodeCtx): NodeResult => tradeRunCore(n);

/** Continue the running trade / all-in (combo, then autos + casts), or abort it. */
export function tradeRunCore(n: NodeCtx): NodeResult {
  const tr = n.mem.ext.trade;
  if (!tr) return 'failure';
  const t = n.v.enemies.find((e) => e.serial === tr.serial);
  if (!t && tr.kind === 'allin' && (tr.lowHp ?? 1) < 0.4 && n.v.hpPct > 0.25 && tr.lastX !== undefined && allinFollowS(n, { x: tr.lastX, y: tr.lastY! }) > 0) {
    // a low target slipped out of sight (bush, fog edge): follow its heading a moment instead of dropping the kill
    tr.lostAt ??= n.v.tick;
    const p = { x: tr.lastX, y: tr.lastY! };
    if (n.v.tick - tr.lostAt <= allinFollowS(n, p) * 30) {
      if (!(n.mem.lastMove && dst(n.mem.lastMove, p) < 100)) n.out.push(moveCmd(p));
      n.mem.lastMove = { ...p, tick: n.v.tick };
      return 'running';
    }
  }
  if (!t) {
    // vanished: chase into fog by profile chaseIntoFogPct + aggression shift (rolled once)
    const last = n.mem.aware.get(tr.serial);
    const chance = (n.ctx.profile.behavior.chaseIntoFogPct + n.p.knobs.chaseChanceShift) / 100;
    let chase = !!last && n.v.hpPct > 0.4 && n.rng.chance(Math.max(0, Math.min(1, chance)));
    // §6 chase_third_kill (Gold): two kills just now -> runs after the next one into the fog, whatever the HP
    const ext = n.mem.ext;
    if (!chase && last && ext.killStreak >= 2 && n.v.tick - ext.lastKillAt < 20 * 30 && rollErrorUntil(n.mem, n.ctx, n.p, 'chase_third_kill', n.v.tick, n.rng) >= 0) {
      chase = true;
      n.log('trade', 'chase', 'chases the third kill into the fog', { target: tr.id, kills: ext.killStreak }, { hp: n.v.hpPct }, 'chase_third_kill');
    }
    endTrade(n, tr, chase ? 'target lost, chasing into fog' : 'target lost', false);
    if (chase && last) {
      n.out.push(moveCmd(last));
      n.mem.lastMove = { x: last.x, y: last.y, tick: n.v.tick };
    }
    return chase ? 'success' : 'failure';
  }
  tr.lostAt = undefined;
  // heading for a short follow if the target slips out of sight (1 s lead on its current velocity)
  tr.lastX = t.x + (t.x - t.px) * 30;
  tr.lastY = t.y + (t.y - t.py) * 30;
  // kill estimate over the all-in horizon (escalation, dive, retreat override); trades keep the 3-s estimate
  const exK = estimateExchange(n.v, n.ctx, t, ALLIN_HORIZON_S, n.rng);
  const ex = tr.kind === 'allin' ? exK : estimateExchange(n.v, n.ctx, t, 3, n.rng);
  tr.kill = exK.killProb;
  tr.death = exK.deathProb;
  const elapsed = (n.v.tick - tr.start) / 30;
  // escalate to all-in
  if (tr.kind === 'trade' && isAllIn(n, exK)) {
    tr.kind = 'allin';
    tr.progressAt = n.v.tick;
    n.log('trade', 'allin', 'kill window', { target: t.slot }, { kill: exK.killProb, death: exK.deathProb });
  }
  if (tr.kind === 'allin') {
    const th = hpPct(t);
    if (tr.lowHp === undefined || th <= tr.lowHp - 0.05) {
      tr.lowHp = th;
      tr.progressAt = n.v.tick;
    }
    // §6 overcommit_after_kill (Iron): right after a kill the bot dives on, even at 20 % HP (rolled once per kill)
    const ext = n.mem.ext;
    if (ext.lastKillAt > ext.overcommitRolledFor && n.v.tick - ext.lastKillAt < 10 * 30) {
      ext.overcommitRolledFor = ext.lastKillAt;
      // §9 new brain: episode of errors.json durS instead of the fixed 10 s (one draw either way)
      const until = rollErrorUntil(n.mem, n.ctx, n.p, 'overcommit_after_kill', n.v.tick, n.rng, 10 * 30);
      if (until >= 0) {
        ext.overcommitUntil = until;
        n.log('trade', 'overcommit', 'keeps diving after the kill', { target: t.slot }, { hp: n.v.hpPct }, 'overcommit_after_kill');
      }
    }
    if (ex.deathProb > 0.6 && ex.killProb < 0.5 && n.v.tick >= ext.overcommitUntil) return endTrade(n, tr, 'all-in lost', true), 'failure';
    // a winning all-in does not time out: it ends when the target's HP stalls (5 s without -5 points) or after 20 s
    if (elapsed > ALLIN_MAX_S || n.v.tick - (tr.progressAt ?? tr.start) > ALLIN_STALL_S * 30) return endTrade(n, tr, 'all-in stalled', true), 'failure';
    // do not chase under the enemy tower unless the dive is allowed: aggression knob + profile tolerance, or (Silver+)
    // a lethal dive - a kill within the all-in horizon on a low target while the bot can take a few tower shots
    const tol = n.ctx.profile.behavior.diveHpTolerancePct + n.p.knobs.diveTolerancePctShift;
    const overcommit = n.v.tick < ext.overcommitUntil;
    if (!overcommit && towerCovering(n.v, t) && !(n.p.knobs.towerDive && hpPct(t) * 100 <= tol) && !lethalDive(n, t, exK)) return endTrade(n, tr, 'target under tower', true), 'failure';
    if (utilityOn(n.ctx) && !overcommit) {
      const why = chaseAbort(n, tr, t, exK);
      if (why) return endTrade(n, tr, why, true), 'failure';
      if (diveAggroSwap(n, tr)) return 'running';
    }
  } else {
    tr.win = 0.6 * tr.win + 0.4 * ex.winProb;
    const why = shouldAbort(n.p.knobs, { elapsedS: elapsed, comboDone: tr.comboDone, myHp: n.v.hpPct, theirHp: hpPct(t), winProb: tr.win });
    if (why) return endTrade(n, tr, why, true), 'failure';
    if (dst(n.v.self, t) > comboReach(n, tr.combo) + 500) return endTrade(n, tr, 'out of reach', true), 'failure';
  }
  summoners(n, tr, t, ex);
  execute(n, tr, t, ex);
  return 'running';
}

// ------------------------------------------------------------------ §6.2 rework (utility flag only)
// Rank enters only through the rolled rates (values.json combat.*.pct rank curves, rolled once per all-in).

const reworkRolls = new WeakMap<TradeState, { chaseAbort: boolean; aggroSwap: boolean }>();
function rollsOf(n: NodeCtx, tr: TradeState): { chaseAbort: boolean; aggroSwap: boolean } {
  let r = reworkRolls.get(tr);
  if (!r) {
    const c = VALUES.combat;
    r = { chaseAbort: n.rng.chance(rankCurve(c.chaseAbort.pct, n.ctx.params.skill) / 100), aggroSwap: n.rng.chance(rankCurve(c.diveAggroSwap.pct, n.ctx.params.skill) / 100) };
    reworkRolls.set(tr, r);
  }
  return r;
}

/** Summed weight of unseen enemies whose probability cloud touches the segment bot -> target (fog-safe tracks). */
export function cloudOnPath(n: NodeCtx, t: { x: number; y: number }): number {
  const pv = lv(n);
  if (!pv) return 0;
  const a = n.v.self;
  const bx = t.x - a.x;
  const by = t.y - a.y;
  const len2 = bx * bx + by * by || 1;
  let w = 0;
  for (const tr of pv.enemies.values()) {
    if (tr.dead || tr.visibleNow || !tr.cloud) continue;
    const c = tr.cloud;
    const k = Math.max(0, Math.min(1, ((c.x - a.x) * bx + (c.y - a.y) * by) / len2));
    if (dst(c, { x: a.x + bx * k, y: a.y + by * k }) <= c.r) w += c.weight;
  }
  return Math.min(1, w);
}

/**
 * §6.2 chase abort: the chase ends when the target reached its tower range + towerMargin while the kill estimate is
 * below killProbBelow, or when unknown enemies' clouds on the path weigh more than cloudOnPath. Iron chases anyway
 * (rank curve 0 %, the chase_third_kill behaviour).
 */
function chaseAbort(n: NodeCtx, tr: TradeState, t: SnapEntity, exK: ExchangeResult): string | null {
  const c = VALUES.combat.chaseAbort;
  if (!rollsOf(n, tr).chaseAbort) return null;
  if (exK.killProb < c.killProbBelow && n.v.enemyTowers.some((tw) => dst(tw, t) <= TOWER_DANGER + c.towerMargin)) return 'chase abort: target at its tower';
  const cloud = cloudOnPath(n, t);
  if (cloud > c.cloudOnPath) return 'chase abort: unknown enemies on the path';
  return null;
}

/**
 * §6.2 dive tower-aggro swap (Platinum+ by rank curve): while the enemy tower shoots the bot and an ally dives
 * with it, the bot steps out of the tower's reach so the tower re-targets the ally; it re-enters when the tower
 * shoots someone else.
 */
function diveAggroSwap(n: NodeCtx, tr: TradeState): boolean {
  const tower = towerCovering(n.v, n.v.self);
  if (!tower || tower.atkTarget !== n.v.me.eid || !rollsOf(n, tr).aggroSwap) return false;
  const partner = n.v.allies.some((a) => dst(a, tower) <= TOWER_DANGER);
  if (!partner) return false;
  const d = dst(tower, n.v.self) || 1;
  const r = TOWER_DANGER + VALUES.combat.diveAggroSwap.stepOutMargin;
  const p = { x: tower.x + ((n.v.self.x - tower.x) / d) * r, y: tower.y + ((n.v.self.y - tower.y) / d) * r };
  cancelOrbwalk(n);
  n.out.push(moveCmd(p));
  n.mem.lastMove = { ...p, tick: n.v.tick };
  if (n.mem.ext.lastMode !== 'aggroSwap') n.log('trade', 'aggro_swap', 'tower shoots me, ally diving: step out', { target: tr.id });
  n.mem.ext.lastMode = 'aggroSwap';
  return true;
}

function summoners(n: NodeCtx, tr: TradeState, t: SnapEntity, ex: ExchangeResult): void {
  const ri = rankIdx(n.ctx.profile.rank);
  // ignite: all-in at killProb > 0.7 (Iron: on the first trade)
  const ign = summonerReady(n, 'entflammen');
  if (ign >= 0 && !tr.ignite && dst(n.v.self, t) < 600 && ((tr.kind === 'allin' && ex.killProb > 0.7) || ri === 0)) {
    tr.ignite = true;
    n.out.push({ cmd: { t: 'spell', slot: ign as 0 | 1, x: t.x, y: t.y, target: t.id } });
    n.log('trade', 'ignite', ri === 0 ? 'iron: ignite on first trade' : 'all-in kill', { target: t.slot }, { kill: ex.killProb });
  }
  // offensive flash: resourceUse >= 0, Gold+, out of reach, raises killProb by > 0.3
  const fl = summonerReady(n, 'sprung');
  if (fl >= 0 && !tr.flash && tr.kind === 'allin' && n.p.knobs.flashOffensive && ri >= GOLD) {
    const d = dst(n.v.self, t);
    const gap = d - (n.v.reach + t.radius);
    if (gap > 80 && gap < 400) {
      const without = ex.killProb * Math.max(0.2, 1 - gap / 500);
      if (ex.killProb - without > 0.3) {
        tr.flash = true;
        const [ux, uy] = unit(n.v.self, t);
        n.out.push({ cmd: { t: 'spell', slot: fl as 0 | 1, x: n.v.self.x + ux * Math.min(400, gap + 50), y: n.v.self.y + uy * Math.min(400, gap + 50) } });
        n.log('trade', 'flash', 'offensive flash raises killProb', { target: t.slot }, { kill: ex.killProb, without });
      }
    }
  }
}

/**
 * Mechanical execution per decision in a fight (Iron 57 % .. Gold 75 % .. Diamond 91 % .. Challenger 100 %): a missed
 * decision casts nothing (late / fumbled combo step, ability held too long) and only keeps auto-attacking. With the
 * same champions the higher rank lands its damage sooner, which decides even fights.
 */
export const executes = (n: NodeCtx): boolean => n.rng.chance(0.55 + 0.45 * Math.min(1, Math.max(0, n.ctx.params.skill / 100)));

function execute(n: NodeCtx, tr: TradeState, t: SnapEntity, ex: ExchangeResult): void {
  const interval = decisionInterval(n);
  if (!executes(n)) {
    orbwalkAttack(n, t, interval);
    return;
  }
  while (!tr.comboDone) {
    const tok = tr.combo[tr.step];
    if (tok === undefined) {
      tr.comboDone = true;
      break;
    }
    if (tok === 'FLASH') {
      tr.step++;
      continue; // handled by summoners() under its own rule
    }
    if (tok === 'AA') {
      orbwalkAttack(n, t, interval);
      tr.step++;
      tr.stepAt = n.v.tick;
      return;
    }
    const slot = SLOT[tok];
    if (slot === undefined || (n.v.me.abilities[slot]?.rank ?? 0) <= 0 || (n.v.me.abilities[slot]?.cdLeft ?? 0) > 0) {
      tr.step++;
      tr.stepAt = n.v.tick;
      continue;
    }
    if (slot === 3 && ex.killProb < n.p.knobs.ultKillThreshold && n.v.enemies.filter((e) => dst(e, t) < 800).length < 2) {
      tr.step++;
      continue; // ult kept (ultKillThreshold)
    }
    const a = castSlot(n.v, n.ctx, n.rng, t, slot);
    if (a) {
      n.out.push(a);
      tr.step++;
      tr.stepAt = n.v.tick;
      return;
    }
    if (n.v.tick - tr.stepAt > 18) {
      tr.step++; // did not come up in 0.6 s
      tr.stepAt = n.v.tick;
      continue;
    }
    // close in for the token
    n.out.push({ cmd: { t: 'attack', target: t.id } });
    n.mem.lastMove = null;
    return;
  }
  // after the combo: ready casts (no ult unless the kill gate), autos with orbwalk
  const cast = offensiveCast(n.v, n.ctx, n.rng, t);
  if (cast && !(cast.cmd.t === 'cast' && cast.cmd.slot === 3 && ex.killProb < n.p.knobs.ultKillThreshold)) {
    n.out.push(cast);
    return;
  }
  orbwalkAttack(n, t, interval);
}

/** Disengage after a trade: orbwalk back behind the own wave toward the own tower (kiting axis = quality). */
export function disengage(n: NodeCtx): NodeResult {
  if (n.v.tick >= n.mem.ext.disengageUntil) return 'failure';
  const t = closestEnemy(n, 1000);
  if (!t) {
    n.mem.ext.disengageUntil = 0;
    return 'failure';
  }
  const lane = n.ctx.lane ?? 'mid';
  const towers = n.v.ownTowers.filter((tw) => n.ctx.map.sides[n.ctx.team].towers[lane].some((p) => dst(p, tw) < 200));
  const home = towers.sort((a, b) => dst(a, n.v.self) - dst(b, n.v.self))[0] ?? n.ctx.map.sides[n.ctx.team].fountain;
  const p = n.p.knobs.orbwalkChance > 0.3 && dst(n.v.self, t) < n.v.reach + t.radius ? kitePoint(n, t, 220) : (() => {
    const [ux, uy] = unit(n.v.self, home);
    return { x: n.v.self.x + ux * 300, y: n.v.self.y + uy * 300 };
  })();
  n.out.push(moveCmd(p));
  n.mem.lastMove = { ...p, tick: n.v.tick };
  return 'running';
}

/**
 * Dive defence (§6): enemies diving the bot under its own tower. 2 divers: tower dance (stay at the tower, hit the
 * diver the tower shoots) - Platinum+ correct, Gold flashes out instead (flash_in_dive 40 %); flash out only when
 * about to die.
 */
export function diveDefence(n: NodeCtx): NodeResult {
  const tower = n.v.ownTowers.find((tw) => dst(tw, n.v.self) < 800);
  if (!tower) return 'failure';
  const divers = n.v.enemies.filter((e) => dst(e, tower) < 900 && dst(e, n.v.self) < 700);
  if (divers.length < 2 && !(divers.length === 1 && n.v.hpPct < 0.5)) {
    n.mem.bt.delete('_diveRolled');
    return 'failure';
  }
  const ri = rankIdx(n.ctx.profile.rank);
  const fl = summonerReady(n, 'sprung');
  const fountain = n.ctx.map.sides[n.ctx.team].fountain;
  const flashOut = (why: string, err?: 'flash_in_dive'): NodeResult => {
    const [ux, uy] = unit(n.v.self, fountain);
    n.out.push({ cmd: { t: 'spell', slot: fl as 0 | 1, x: n.v.self.x + ux * 400, y: n.v.self.y + uy * 400 } });
    n.out.push(moveCmd(fountain));
    n.mem.lastMove = { x: fountain.x, y: fountain.y, tick: n.v.tick };
    cancelOrbwalk(n);
    n.log('diveDefence', 'flash', why, { divers: divers.length }, { hp: n.v.hpPct }, err);
    return 'running';
  };
  if (fl >= 0 && divers.length >= 2 && !n.mem.bt.get('_diveRolled')?.on) {
    n.mem.bt.set('_diveRolled', { on: true, since: n.v.tick });
    if (rollErrorUntil(n.mem, n.ctx, n.p, 'flash_in_dive', n.v.tick, n.rng) >= 0) return flashOut('flash instead of tower dance', 'flash_in_dive');
  }
  if (fl >= 0 && n.v.hpPct < 0.2 && ri >= PLATINUM) return flashOut('about to die under tower');
  // tower dance: hit the diver the tower shoots (or the lowest), stay within the tower's reach
  const aggro = divers.find((d) => tower.atkTarget === d.id) ?? divers.sort((a, b) => hpPct(a) - hpPct(b))[0]!;
  if (dst(n.v.self, tower) > 350) {
    const [ux, uy] = unit(n.v.self, tower);
    n.out.push(moveCmd({ x: n.v.self.x + ux * 250, y: n.v.self.y + uy * 250 }));
    n.mem.lastMove = null;
  } else {
    const cast = offensiveCast(n.v, n.ctx, n.rng, aggro);
    if (cast) n.out.push(cast);
    else orbwalkAttack(n, aggro, decisionInterval(n));
  }
  if (!n.mem.bt.get('_diveRolled')) n.mem.bt.set('_diveRolled', { on: true });
  if (n.mem.ext.lastMode !== 'diveDefence') n.log('diveDefence', 'towerDance', 'divers under own tower', { divers: divers.length }, { hp: n.v.hpPct });
  return 'running';
}

export type { BotAction };
