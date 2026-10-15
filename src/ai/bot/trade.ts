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
import { estimateExchange, laningSafety, rankIdx, rollError, tacticsFocus } from '../bt/deps';
import { cancelOrbwalk, kitePoint, orbwalkAttack, moveCmd } from './kite';
import { towerCovering } from './perception';
import type { TradeState } from '../bt/state';
import type { ExchangeResult } from '../contract';

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
function comboReach(n: NodeCtx, combo: string[]): number {
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
  failed: string[];
}

/** Evaluate the trade window against the closest enemy (spec §6). Cached per decision tick. */
const windowCache = new WeakMap<object, { tick: number; w: Window | null }>();
export function tradeWindow(n: NodeCtx): Window | null {
  const c = windowCache.get(n.mem);
  if (c && c.tick === n.v.tick) return c.w;
  const w = evalWindow(n);
  windowCache.set(n.mem, { tick: n.v.tick, w });
  return w;
}

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
    if (!rollError('fight_in_enemy_wave', n.p, n.rng)) failed.push('minionAggro');
    else waveErr = true;
  }
  // triggers (one is enough)
  let trigger = '';
  const ex = estimateExchange(n.v, n.ctx, t, 3, n.rng, { orbwalk: 0.7 + 0.3 * k.orbwalkChance });
  if (focus && focus.eid === t.id) trigger = 'gank_focus';
  else if (t.atkTarget === n.v.self.id) trigger = 'retaliate';
  else if (ri >= DIAMOND && (ext.csWindowAt.get(t.serial) ?? -1e9) > n.v.tick - 30) trigger = 'cs_window';
  else if (ri >= GOLD && (ext.enemyCastAt.get(t.serial) ?? -1e9) > n.v.tick - 7 * 30) trigger = 'punish';
  else if (ext.levelUpAt > n.v.tick - 150 && [2, 3, 6].includes(n.v.me.level) && n.v.me.level > t.level) trigger = 'power_spike';
  else if (hpPct(t) < 0.5 && ex.killProb > 0.3) trigger = 'low_hp';
  let injected: 'trade_on_cooldown' | 'fight_in_enemy_wave' | undefined = waveErr ? 'fight_in_enemy_wave' : undefined;
  if (!trigger) {
    const allReady = [0, 1, 2].every((s) => (n.v.me.abilities[s]?.rank ?? 0) === 0 || (n.v.me.abilities[s]?.cdLeft ?? 1) <= 0);
    if (allReady && rollError('trade_on_cooldown', n.p, n.rng)) (trigger = 'cooldowns_ready'), (injected = 'trade_on_cooldown');
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
  if (safety?.allowTrade === 'killOnly' && ex.killProb <= 0.9) failed.push('gankRisk');
  // passive bots still take near-certain kills
  let score = failed.length ? 0 : 0.5 * (ex.winProb / thr) * k.fightWeight;
  if (ex.killProb > 0.8 && failed.every((f) => f === 'winProb' || f === 'trigger')) score = Math.max(score, 0.6);
  if (injected && score > 0) n.log('tradeWindow', 'error', injected, { target: t.slot }, {}, injected);
  return { target: t, score, trigger: trigger || 'loosened', ex, failed };
}

export const tradeWindowScore = (n: NodeCtx): number => (n.mem.ext.trade || n.v.tick < n.mem.ext.disengageUntil || n.v.tick - n.mem.ext.lastTradeEnd < 45 ? 0 : tradeWindow(n)?.score ?? 0);

/** Start a trade on the window's target. */
export function tradeStart(n: NodeCtx): NodeResult {
  if (n.mem.ext.trade) return 'failure';
  const w = tradeWindow(n);
  if (!w || w.score <= 0) return 'failure';
  const allIn = isAllIn(n, w.ex);
  const kind = allIn ? 'allin' : 'trade';
  const combo = chooseCombo(n, kind, n.rng);
  n.mem.ext.trade = { serial: w.target.serial, id: w.target.id, kind, start: n.v.tick, trigger: w.trigger, combo, step: 0, stepAt: n.v.tick, comboDone: false, flash: false, ignite: false, win: w.ex.winProb };
  n.mem.mode = 'fight';
  n.mem.fightTarget = w.target.serial;
  n.log('trade', kind, `trigger ${w.trigger}`, { target: w.target.slot, combo: combo.join('-') }, { win: w.ex.winProb, kill: w.ex.killProb, death: w.ex.deathProb, score: w.score });
  return tradeRun(n);
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

/** Continue the running trade / all-in (combo, then autos + casts), or abort it. */
export function tradeRun(n: NodeCtx): NodeResult {
  const tr = n.mem.ext.trade;
  if (!tr) return 'failure';
  const t = n.v.enemies.find((e) => e.serial === tr.serial);
  if (!t) {
    // vanished: chase into fog by profile chaseIntoFogPct + aggression shift (rolled once)
    const last = n.mem.aware.get(tr.serial);
    const chance = (n.ctx.profile.behavior.chaseIntoFogPct + n.p.knobs.chaseChanceShift) / 100;
    const chase = !!last && n.v.hpPct > 0.4 && n.rng.chance(Math.max(0, Math.min(1, chance)));
    endTrade(n, tr, chase ? 'target lost, chasing into fog' : 'target lost', false);
    if (chase && last) {
      n.out.push(moveCmd(last));
      n.mem.lastMove = { x: last.x, y: last.y, tick: n.v.tick };
    }
    return chase ? 'success' : 'failure';
  }
  const ex = estimateExchange(n.v, n.ctx, t, tr.kind === 'allin' ? 8 : 3, n.rng);
  const elapsed = (n.v.tick - tr.start) / 30;
  // escalate to all-in
  if (tr.kind === 'trade' && isAllIn(n, ex)) {
    tr.kind = 'allin';
    n.log('trade', 'allin', 'kill window', { target: t.slot }, { kill: ex.killProb, death: ex.deathProb });
  }
  if (tr.kind === 'allin') {
    if (ex.deathProb > 0.6 && ex.killProb < 0.5) return endTrade(n, tr, 'all-in lost', true), 'failure';
    if (elapsed > 12) return endTrade(n, tr, 'all-in timeout', true), 'failure';
    // do not chase under the enemy tower unless the dive is allowed (aggression knob + profile tolerance)
    const tol = n.ctx.profile.behavior.diveHpTolerancePct + n.p.knobs.diveTolerancePctShift;
    if (towerCovering(n.v, t) && !(n.p.knobs.towerDive && hpPct(t) * 100 <= tol)) return endTrade(n, tr, 'target under tower', true), 'failure';
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

function execute(n: NodeCtx, tr: TradeState, t: SnapEntity, ex: ExchangeResult): void {
  const interval = decisionInterval(n);
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
    if (rollError('flash_in_dive', n.p, n.rng)) return flashOut('flash instead of tower dance', 'flash_in_dive');
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
