// Reflex layer (docs/BRAIN-REWORK.md §3, §4.1, §4.2, §4.4; contract docs/agents/plan-api.md). Runs every sim tick
// for every bot, all ranks alike. It forms no intention: it executes the lane intent of the latest decision
// (src/ai/reflex/state.ts LaneIntent) with
//   - the last-hit planner every tick (lasthit.ts predictions, one plan for the next minion, timing error rolled per
//     plan and kept while validating),
//   - the attack scheduler: every free attack period is filled (filler targets, §4.1), except the one the next
//     last hit needs; follow-up windows of all minions in reach (not only the planned one) bound the filler,
//   - the stand point every tick with spatial hysteresis only, and the orbwalk move in the backswing.
// Never a move/stop while the own wind-up runs (except the orbwalk timing error of the rank).
// Rank differences come only from profile values (lastHitJitterMs, planHorizonS, windowPrepPct, standHysteresis,
// orbwalkPct): src/data/bots/profiles/*.json. Nothing here reads the Sim.

import type { Rng } from '../../sim/rng';
import { MINION_STATS } from '../../sim/systems/minions';
import { Kind } from '../../sim/types';
import type { BotAction, BotMemory, BotStatic, Snapshot } from '../bot/types';
import type { View } from '../bot/perception';
import { towerCovering } from '../bot/perception';
import { dst } from '../bot/geo';
import { laneSpot, structureToHit } from '../bot/laning';
import { clearOfStructures } from '../bot/brain';
import { rollError } from '../bt/deps';
import { championData } from '../../sim/champions';
import { ORBWALK } from '../bot/kite';
import { type LastHitMem, entityIndex, observeAttacks, ownAttack, predictWindows, prehitFits, prehitRoll, spellLastHitFor, windowAfterHit, type MinionWindow, type OwnAttack } from '../bot/lasthit';
import { FARM_KINDS, insertPlan, type CancelReason, type Plan } from '../plan';
import { reflexState, UTIL_WINDOW, type ReflexState } from './state';
import { reflexView } from './view';

/** Rank parameters of the reflex layer (profile §4.7 fields + playstyle knobs; no values in code). */
export interface ReflexParams {
  horizon: number;
  prep: number;
  hyst: number;
  orbwalk: number;
  jitterMs: number;
}

export function reflexParams(ctx: BotStatic): ReflexParams {
  const b = ctx.params.behavior;
  // orbwalk: rank base at kiting 0 (profile) shifted by the kiting axis (knob orbwalkChance is 0.5 at axis 0)
  const orb = Math.max(0, Math.min(1, b.orbwalkPct / 100 + (ctx.params.knobs.orbwalkChance - 0.5)));
  return { horizon: Math.round(b.planHorizonS * 30), prep: b.windowPrepPct / 100, hyst: b.standHysteresis, orbwalk: orb, jitterMs: b.lastHitJitterMs };
}

export interface ReflexIO {
  /** The decision of this tick issued commands itself: reflex issues nothing this tick. */
  thinkIssued: boolean;
  /** Cancel tags the decision of this tick set (dodge / retreat drop 'orb' and 'lh' plans). */
  cancelled: ReadonlySet<string>;
  /** Measurement scenario "autos only" (last-hit trainer): no spell last hits. */
  noSpells?: boolean;
}

/** Aim this many ticks into a kill window (never its last tick: same-tick hits are a coin flip). */
const margin = (a: number, b: number): number => (b === Infinity ? 1 : Math.max(0, Math.min(AIM_MAX, Math.floor((b - a - 1) / 2))));
/** Aim at most this many ticks into a kill window (the middle of narrow windows): more slack for the timing error. */
const AIM_MAX = 4;

const isWindup = (v: View): boolean => v.self.atkPhase === 1;
/** A filler minion may need at most this walk (ticks): melee stand points sit a step behind the wave contact. */
const FILLER_WALK_TICKS = 15;
/** A filler keeps this many ticks of slack before every protected window closes (prediction error of the closing hit). */
const PROTECT_SAFETY = 3;
/** Pre-hits are considered for minions whose killing hit lands within this many ticks. */
const PREHIT_LOOKAHEAD = 75;
/** Minions counted for the wave comparison of the neutral / hold / freeze states. */
const WAVE_COUNT_R = 1200;
/** Freeze corridor: keep 2-3 enemy minions surplus (§4.5); hit enemy minions only above 2. */
const FREEZE_SURPLUS_MAX = 2;
/** Push state: hit the structure before the minions when this many own minions tank it (within TOWER_TANK_R). */
const PLATE_TANKS = 3;
const TOWER_TANK_R = 800;
/** Own minion within this distance of an enemy minion = the enemy minion has another target than the bot. */
const TANK_R = 700;
/** Extra distance kept to the reach of untanked enemy minions (stand point) - a step of the minion. */
const AGGRO_MARGIN = 100;

export function reflex(snap: Snapshot, ctx: BotStatic, mem: BotMemory, rng: Rng, io: ReflexIO): BotAction[] {
  const st = reflexState(mem);
  const v = reflexView(snap, ctx, mem);
  if (!v) return [];
  const T = v.tick;
  const lh = mem.ext.lh;
  observeAttacks(v, lh); // this tick's events only (the runner hands reflex exactly one tick of events)
  // harass budget counts thrown autos on enemy champions (not choices: a walk-in is chosen on several ticks)
  for (const ev of snap.events) if (ev.e === 'attack' && ev.src === v.me.eid && v.enemies.some((e) => e.id === ev.dst) && !mem.ext.trade) reflexState(mem).harass.autos.push(snap.tick);
  recordUtil(st, T, v.self.atkPhase !== 0 && v.self.alive);
  if (st.issued.length && st.issued[0]!.tick < T - 30) st.issued = st.issued.filter((i) => i.tick >= T - 30);
  const out: BotAction[] = [];
  const log = (chosen: string, reason: string, inputs: Record<string, number | string | boolean> = {}): void =>
    ctx.log.push({ tick: T, bot: ctx.slot, node: 'reflex', inputs, chosen, reason });
  const cancel = (p: Plan, why: CancelReason): void => {
    st.plans = st.plans.filter((q) => q !== p);
    st.stats.cancels[why] = (st.stats.cancels[why] ?? 0) + 1;
    // one entry per plan lifecycle; identical chosen+reason within 5 s are throttled by the decision log
    if (p.kind !== 'orbwalkMove') log('lh_cancel', why, { plan: p.id, kind: p.kind, target: p.targetId, executeAt: p.executeAtTick, a: p.window?.a ?? -1, b: p.window?.b ?? -1 });
  };
  for (const p of [...st.plans]) if (p.cancelTags.some((t) => io.cancelled.has(t))) cancel(p, 'overridden_by_dodge');
  const intent = st.intent;
  if (v.me.dead || v.me.recallLeft > 0 || !intent) {
    for (const p of [...st.plans]) cancel(p, 'intent_changed');
    st.filler = -1;
    st.fillerChamp = false;
    return out;
  }
  // an issued last hit walks in / waits for the timer: nothing else until it is thrown (or lost)
  if (st.inflight) {
    const f = st.inflight;
    const alive = !!entityIndex(snap.entities).get(f.target)?.alive;
    if (!alive || lh.ownStart > f.tick || T - f.tick > 60 || (v.self.atkTarget !== f.target && T > f.tick + 1)) st.inflight = null;
    else return out;
  }
  const P = reflexParams(ctx);
  const own = ownAttack(v, ctx, lh);
  // the reflex layer's own attack command shows as a wind-up one tick later: until then the timer counts as taken
  if (st.attackCmd && st.attackCmd.tick >= T - 1 && v.self.atkPhase === 0) own.ready = Math.max(own.ready, st.attackCmd.tick + 1 + Math.floor(own.period));
  const busy = T < mem.busyUntil && T >= mem.busyFrom - 1;
  const distracted = st.attention?.(T)?.distracted ?? false;
  const windows = intent.farm ? predictWindows(v, lh, own) : [];
  st.last = { tick: T, windows, ready: own.ready, period: own.period };
  const byId = new Map<number, MinionWindow>();
  for (const w of windows) byId.set(w.m.id, w);
  const canIssue = !io.thinkIssued && !busy;

  // ---- 1. validate plans (every tick)
  for (const p of [...st.plans]) {
    if (p.kind === 'orbwalkMove') continue;
    if (!intent.farm) {
      cancel(p, 'intent_changed');
      continue;
    }
    const w = byId.get(p.targetId);
    if (!w) {
      const e = entityIndex(snap.entities).get(p.targetId);
      cancel(p, !e || !e.alive ? 'minion_died' : 'out_of_range');
      continue;
    }
    if (p.kind === 'lastHit') {
      if (w.a === Infinity || w.a >= w.b) {
        cancel(p, 'prediction_drift');
        continue;
      }
      // re-aim with the kept timing error: the plan follows the prediction, the error stays
      const a = w.a + p.biasTicks;
      const b = w.b + p.biasTicks;
      const start = Math.max(own.ready, T + 1, Math.ceil(a + margin(a, b) - w.lead));
      p.window = { a: Math.round(a), b: b === Infinity ? -1 : Math.round(b) };
      if (start + w.lead >= b) {
        // out_of_range only when the walk is what makes the window unreachable (standing in reach it would fit)
        const noWalk = Math.max(own.ready, T + 1, Math.ceil(a + margin(a, b) - (w.lead - w.walk))) + w.lead - w.walk < b;
        cancel(p, w.walk > 0 && noWalk ? 'out_of_range' : 'prediction_drift');
        continue;
      }
      p.executeAtTick = start - 1;
    } else if (p.kind === 'prehit') {
      const start = Math.max(own.ready, T + 1);
      if (!prehitFits(w, start + w.lead, own.period, p.biasTicks, T)) {
        cancel(p, 'prediction_drift');
        continue;
      }
      p.executeAtTick = start - 1;
    }
    if (distracted && p.executeAtTick <= T) cancel(p, 'distracted');
  }
  st.plans.sort((p, q) => p.executeAtTick - q.executeAtTick || p.id - q.id);

  // ---- 2. plan the next last hit (every tick, rank horizon)
  let farmPlan = st.plans.find((p) => FARM_KINDS.includes(p.kind)) ?? null;
  const protectedWins = windows.filter((w) => w.a !== Infinity && w.a < w.b && w.a - T <= P.horizon && feasible(w, 0, T + 1, own));
  if (intent.farm && !distracted && (!farmPlan || farmPlan.kind === 'lastHit')) {
    const cands: { w: MinionWindow; start: number }[] = [];
    let spell: { w: MinionWindow; act: BotAction } | null = null;
    let pre: MinionWindow | null = null;
    for (const w of windows) {
      if (w.a === Infinity || w.a >= w.b) {
        if (!spell && w.b - T < 40) {
          const act = spellLastHitFor(v, ctx, w, 0);
          if (act) spell = { w, act };
        }
        if (!pre && w.b - T < 75 && w.walk === 0 && prehitRoll(lh, w.m, ctx.params.skill, rng) && prehitFits(w, Math.max(own.ready, T + 1) + w.lead, own.period, 0, T)) pre = w;
        continue;
      }
      if (w.a - T > P.horizon) continue;
      const start = Math.max(own.ready, T + 1, Math.ceil(w.a + margin(w.a, w.b) - w.lead));
      if (start + w.lead >= w.b) {
        if (!spell && w.b - T < 40) {
          const act = spellLastHitFor(v, ctx, w, 0);
          if (act) spell = { w, act };
        }
        continue;
      }
      if (!attackSpotSafe(v, w.m)) continue;
      cands.push({ w, start });
    }
    const best = pickNext(cands, own);
    // a window that the planned order would lose but the other order keeps: re-plan (rolls a new timing error)
    if (farmPlan && best && best.w.m.id !== farmPlan.targetId) {
      const pw = byId.get(farmPlan.targetId);
      const per = Math.floor(own.period);
      const gold = (w: MinionWindow): number => MINION_STATS[w.m.kind]?.gold ?? 0;
      if (pw && best.start <= farmPlan.executeAtTick + 1 + per) {
        const lose = serveAt(best.w.a, best.w.b, best.w.lead, farmPlan.executeAtTick + 1 + per) === Infinity;
        const keep = serveAt(pw.a + farmPlan.biasTicks, pw.b + farmPlan.biasTicks, pw.lead, best.start + per) !== Infinity;
        if (lose && (keep || gold(best.w) > gold(pw))) {
          cancel(farmPlan, 'reordered');
          farmPlan = null;
        }
      }
    }
    if (farmPlan) {
      // keep the plan
    } else if (spell && !io.noSpells && (!best || best.start > T + 1) && canIssue) {
      out.push(spell.act);
      markCast(ctx, mem, spell.act, T);
      st.stats.executed++;
      log('lh_spell', 'auto cannot make the window', { target: spell.w.m.id });
      return out;
    } else if (best) {
      // §4.2: the timing error is rolled when the plan is made and kept while validating
      let bias = (rng.normal() * P.jitterMs * 30) / 1000;
      // a believed window that closes before the bot can land at all (early error + timer/walk) is not given up at
      // once: the error is clipped so the plan lands on its last believed tick (the human hurries, he does not skip)
      if (best.w.b !== Infinity) bias = Math.max(bias, best.start + best.w.lead + 1 - best.w.b);
      const a = best.w.a + bias;
      const b = best.w.b + bias;
      const start = Math.max(own.ready, T + 1, Math.ceil(a + margin(a, b) - best.w.lead));
      farmPlan = newPlan(st, 'lastHit', best.w.m.id, start - 1, T, bias, { a: Math.round(a), b: b === Infinity ? -1 : Math.round(b) });
    } else if (pre) {
      farmPlan = newPlan(st, 'prehit', pre.m.id, Math.max(own.ready, T + 1) - 1, T, 0);
    }
  }

  // ---- 3. execute a due plan
  if (farmPlan && farmPlan.executeAtTick <= T && canIssue && !isWindup(v) && !distracted) {
    out.push({ cmd: { t: 'attack', target: farmPlan.targetId } });
    st.plans = st.plans.filter((p) => p !== farmPlan);
    st.issued.push({ plan: farmPlan, tick: T });
    st.attackCmd = { target: farmPlan.targetId, tick: T };
    st.inflight = { target: farmPlan.targetId, tick: T };
    st.filler = -1;
    st.fillerChamp = false;
    st.stats.executed++;
    return out;
  }

  // ---- stand point (every tick)
  // stand point: computed on first use in this tick (most wind-up ticks need none)
  let standAt: { x: number; y: number } | null = null;
  const standNow = (): { x: number; y: number } => (standAt ??= st.stand = standPoint(v, ctx, intent, farmPlan, byId));

  // ---- 5a. orbwalk: a move after the hit point when the stand point is away (kiting chance + rank timing jitter)
  if (v.self.atkPhase === 1 && v.self.atkStart !== undefined && v.self.atkEnd !== undefined && st.orbHandled !== v.self.atkStart) {
    st.orbHandled = v.self.atkStart;
    const stand = standNow();
    if (dst(v.self, stand) > P.hyst && rng.chance(P.orbwalk)) {
      const off = ORBWALK.marginMs + rng.normal() * P.jitterMs;
      // the hit fires in the step after atkEnd's snapshot: a move issued at atkEnd + 1 or later keeps the auto
      const at = v.self.atkEnd + 1 + Math.floor(off / (1000 / 30));
      const p = clearOfStructures(v, stand);
      insertPlan(st.plans, { id: st.nextPlanId++, kind: 'orbwalkMove', targetId: -1, executeAtTick: at, validUntilTick: at + 6, preconditions: [], cancelTags: ['orb'], cmd: { t: 'move', x: p.x, y: p.y }, createdTick: T, biasTicks: 0 });
    }
  }
  const orb = st.plans.find((p) => p.kind === 'orbwalkMove');
  if (orb && orb.executeAtTick <= T) {
    st.plans = st.plans.filter((p) => p !== orb);
    if (canIssue && T <= orb.validUntilTick) {
      if (isWindup(v)) {
        st.stats.orbEarly++; // rank timing error: the move lands before the hit point and cancels the auto
        log('orbwalk', 'early', { at: orb.executeAtTick, hit: v.self.atkEnd ?? -1 });
      }
      out.push({ cmd: orb.cmd });
      st.standMove = { x: (orb.cmd as { x: number }).x, y: (orb.cmd as { y: number }).y };
      st.filler = -1;
    st.fillerChamp = false;
      return out;
    }
  }
  if (!canIssue || isWindup(v)) return out;

  // ---- 4. attack scheduler: fill the free attack period
  // a harass walk-in in progress is not re-decided every tick (the walk changes every lead; re-deciding flip-flops
  // between harass and hold): it runs until the wind-up, a due last hit or HARASS_WALK_TICKS
  const harassWalk = st.fillerChamp && st.filler >= 0 && v.self.atkTarget === st.filler && v.self.atkPhase === 0 && T - st.fillerAt < HARASS_WALK_TICKS;
  if (harassWalk && !(farmPlan && farmPlan.executeAtTick <= T + 2) && timerFree(protectedWins, farmPlan, own, T)) return out;
  if (own.ready <= T + 1) {
    const choice = chooseFiller(v, ctx, st, intent, windows, protectedWins, farmPlan, own, P, rng, T, lh);
    if (choice) {
      if (st.filler !== choice.target) st.fillerAt = T;
      st.filler = choice.target;
      st.fillerChamp = choice.kind === 'harass';
      if (v.self.atkTarget !== choice.target) {
        out.push({ cmd: { t: 'attack', target: choice.target } });
        st.attackCmd = { target: choice.target, tick: T };
      }
      st.stats.fillers++;
      if (choice.kind === 'prepare') st.stats.prepares++;
      log('filler', choice.kind, { target: choice.target });
      return out;
    }
    // hold the timer for the next last hit (or nothing to hit): no auto-repeat on the old target
    st.filler = -1;
    st.fillerChamp = false;
    if (v.self.atkTarget >= 0 && v.self.atkTarget !== farmPlan?.targetId) {
      const stand = standNow();
      const far = dst(v.self, stand) > P.hyst;
      const p = clearOfStructures(v, stand);
      out.push(far ? { cmd: { t: 'move', x: p.x, y: p.y } } : { cmd: { t: 'stop' } });
      if (far) (st.standMove = p), (mem.lastMove = { x: p.x, y: p.y, tick: T });
      log('hold', farmPlan ? 'timer kept for the next last hit' : 'no filler allowed', { target: farmPlan?.targetId ?? -1 });
      return out;
    }
  }

  // ---- 5b. stand point move (spatial hysteresis only)
  if (st.filler >= 0 && v.self.atkTarget === st.filler) return out;
  const stand = standNow();
  const d = dst(v.self, stand);
  // hard rule §4.4: the next planned last hit must be reachable without a walk, hysteresis or not
  const pw = farmPlan ? byId.get(farmPlan.targetId) : undefined;
  const mustMove = !!pw && pw.walk > 0 && d > 30;
  if ((d > P.hyst || mustMove) && !(v.self.moving && st.standMove && dst(st.standMove, stand) < Math.min(P.hyst / 2, mustMove ? 40 : Infinity))) {
    const p = clearOfStructures(v, stand);
    out.push({ cmd: { t: 'move', x: p.x, y: p.y } });
    st.standMove = p;
    mem.lastMove = { x: p.x, y: p.y, tick: T };
  }
  return out;
}

function recordUtil(st: ReflexState, T: number, attacking: boolean): void {
  if (st.utilTick === T) return;
  st.utilTick = T;
  const i = st.utilIdx;
  st.utilSum += (attacking ? 1 : 0) - st.util[i]!;
  st.util[i] = attacking ? 1 : 0;
  st.utilIdx = (i + 1) % UTIL_WINDOW;
}

function newPlan(st: ReflexState, kind: Plan['kind'], target: number, executeAt: number, T: number, bias: number, window?: { a: number; b: number }): Plan {
  const p: Plan = {
    id: st.nextPlanId++,
    kind,
    targetId: target,
    executeAtTick: executeAt,
    validUntilTick: executeAt + 90,
    preconditions: ['targetVisible', 'targetAlive', 'inWindow', 'reachable', 'intentFarm'],
    cancelTags: ['lh', 'orb'], // dodge / retreat (cancelOrbwalk) drop farm plans too
    cmd: { t: 'attack', target },
    createdTick: T,
    biasTicks: bias,
    ...(window ? { window } : {}),
  };
  insertPlan(st.plans, p);
  return p;
}

/** Can window w (with timing error `bias`) still be served by an auto starting no earlier than `startMin`? */
function feasible(w: MinionWindow, bias: number, startMin: number, own: OwnAttack, safety = 0): boolean {
  void own;
  const a = w.a + bias;
  const b = w.b + bias;
  const s = Math.max(startMin, Math.ceil(a + margin(a, b) - w.lead));
  return s + w.lead < b - safety;
}

/** The protected windows stay servable with the attack timer taken by an auto starting at T + 1 (filler rule). */
function timerFree(protectedWins: MinionWindow[], plan: Plan | null, own: OwnAttack, T: number): boolean {
  const next = T + 1 + Math.floor(own.period);
  const bias = (w: MinionWindow): number => (plan && plan.targetId === w.m.id ? plan.biasTicks : 0);
  for (const w of protectedWins) if (!feasible(w, bias(w), next, own, PROTECT_SAFETY)) return false;
  return protectedWins.length < 2 || serveCount(protectedWins, bias, next, own.period) >= serveCount(protectedWins, bias, T + 1, own.period);
}

/** How many of the windows one auto per period serves from startMin on, earliest deadline first (with slack). */
function serveCount(wins: MinionWindow[], bias: (w: MinionWindow) => number, startMin: number, period: number): number {
  const order = [...wins].sort((p, q) => p.b + bias(p) - (q.b + bias(q)) || p.m.id - q.m.id);
  let t = startMin;
  let n = 0;
  for (const w of order) {
    const a = w.a + bias(w);
    const b = w.b + bias(w);
    const s = Math.max(t, Math.ceil(a + margin(a, b) - w.lead));
    if (s + w.lead >= b - PROTECT_SAFETY) continue;
    n++;
    t = s + Math.floor(period);
  }
  return n;
}

/** Start tick of the earliest auto serving w no earlier than startMin (Infinity: not servable). */
function serveAt(a: number, b: number, lead: number, startMin: number): number {
  const s = Math.max(startMin, Math.ceil(a + margin(a, b) - lead));
  return s + lead < b ? s : Infinity;
}

/**
 * Next last hit among servable windows: the earliest start, unless serving it first loses another window that
 * closes earlier while the other order keeps both (then that one first). If the two cannot both be served, the
 * bigger gold wins (caster sacrificed before melee / siege, §4.2).
 */
function pickNext(cands: { w: MinionWindow; start: number }[], own: OwnAttack): { w: MinionWindow; start: number } | null {
  if (!cands.length) return null;
  cands.sort((p, q) => p.start - q.start || p.w.b - q.w.b || p.w.m.id - q.w.m.id);
  let best = cands[0]!;
  const gold = (w: MinionWindow): number => MINION_STATS[w.m.kind]?.gold ?? 0;
  const per = Math.floor(own.period);
  for (const c of cands.slice(1, 4)) {
    if (c.w.b >= best.w.b) continue;
    const afterBest = serveAt(c.w.a, c.w.b, c.w.lead, best.start + per);
    if (afterBest !== Infinity) continue; // both in the planned order
    const bestAfter = serveAt(best.w.a, best.w.b, best.w.lead, c.start + per);
    if (bestAfter !== Infinity || gold(c.w) > gold(best.w)) best = c;
  }
  return best;
}

/**
 * The spot an auto on `m` is thrown from must not be under an enemy tower unless own minions tank it (>= 2 within
 * 800 of that tower; same rule as structureToHit): walking in for a minion under the tower draws the tower's aggro.
 */
function attackSpotSafe(v: View, m: { x: number; y: number; radius: number }): boolean {
  const d = dst(v.self, m);
  const r = v.reach + m.radius;
  const q = d <= r ? v.self : { x: m.x + ((v.self.x - m.x) * r) / d, y: m.y + ((v.self.y - m.y) * r) / d };
  const t = towerCovering(v, q);
  if (!t) return true;
  return v.ownMinions.filter((o) => dst(o, t) < 800).length >= 2;
}

/** An enemy minion busy with something else than the bot: an own minion near it, or it hits an own minion / tower. */
function tanked(v: View, m: View['enemyMinions'][number]): boolean {
  if (m.atkTarget >= 0 && m.atkTarget !== v.me.eid && (v.ownTowers.some((t) => t.id === m.atkTarget) || v.ownMinions.some((o) => o.id === m.atkTarget))) return true;
  return v.ownMinions.some((o) => dst(o, m) < TANK_R);
}

/** Enemy minions with no own minion near them (they would target the bot). */
function untankedMinions(v: View): View['enemyMinions'] {
  return v.enemyMinions.filter((m) => dst(m, v.self) < 1200 && !tanked(v, m));
}

/** Harass budget shift per aggression axis step (autos/min; §4.3: aggression axis +-3 at +-5). */
const HARASS_PER_AGGRESSION = 0.6;
/** Step-up: an enemy champion this far beyond auto reach is still harassed (the bot walks in, hits, the stand point
 *  pulls it back). §4.3 says one step (<= 150); both laners stand ~400 behind the wave contact, so with 150 the enemy
 *  was in reach only when it walked up for a last hit (2-4 harass autos per laner in 12 min). Deviation, see a1.md. */
const HARASS_STEP = 400;
/** A harass walk-in is given this long (ticks) before the scheduler decides again. */
const HARASS_WALK_TICKS = 45;
/** "In the enemy wave" (§4.3): enemy minions this close to the bot's attack spot. Minions further back still answer
 *  the call for help (sim CALL_RANGE 1000), but a bot outside the wave can step back out of their reach. */
const AGGRO_R = 350;

/**
 * Harass target (§4.3) or -1. Budget: profile harassPerMin + aggression axis, counted over the last 60 s (autos the
 * reflex layer threw at champions). Minion aggro: more than one enemy minion near the attack spot is "in the enemy
 * wave" unless the bot is ranged and the enemy melee; Iron-Bronze sometimes ignore it (named error
 * ignore_minion_aggro, rolled at most every 10 s). Diamond+ prefer the enemy's CS window (its wind-up on a minion).
 */
function harassTarget(v: View, ctx: BotStatic, st: ReflexState, rng: Rng, T: number, step: number): number {
  const b = ctx.params.behavior;
  const autos = st.harass.autos;
  while (autos.length && autos[0]! < T - 60 * 30) autos.shift();
  const budget = b.harassPerMin + HARASS_PER_AGGRESSION * ctx.params.playstyle.aggression;
  const block = (why: string): number => ((st.stats.harassBlock[why] = (st.stats.harassBlock[why] ?? 0) + 1), -1);
  if (autos.length + 1 > budget) return block('budget');
  const me = v.self;
  let best: View['enemies'][number] | null = null;
  for (const e of v.enemies) {
    const reach = v.reach + e.radius;
    const d = dst(me, e);
    if (d > reach + step || (best && d >= dst(me, best))) continue;
    // attacking a champion inside the enemy tower's range draws the tower, tanked or not
    const q = d <= reach ? me : { x: e.x + ((me.x - e.x) * reach) / d, y: e.y + ((me.y - e.y) * reach) / d };
    if (towerCovering(v, q)) continue;
    best = e;
  }
  if (!best) return block(v.enemies.length ? (v.enemies.some((e) => dst(me, e) <= v.reach + e.radius + step) ? 'tower' : 'distance') : 'no_enemy');
  const d = dst(me, best);
  const r = v.reach + best.radius;
  const spot = d <= r ? me : { x: best.x + ((me.x - best.x) * r) / d, y: best.y + ((me.y - best.y) * r) / d };
  const waveNear = v.enemyMinions.filter((m) => dst(m, spot) < AGGRO_R).length;
  const ranged = ctx.champ.attackType === 'ranged' && championMelee(best);
  if (waveNear > 1 && !ranged) {
    if (T >= st.aggroErrUntil && T - st.aggroRollAt >= 10 * 30) {
      st.aggroRollAt = T;
      if (rollError('ignore_minion_aggro', ctx.params, rng)) {
        st.aggroErrUntil = T + 3 * 30;
        ctx.log.push({ tick: T, bot: ctx.slot, node: 'reflex', inputs: { target: best.slot, minions: waveNear }, chosen: 'harass', reason: 'attacks the champion inside the enemy wave', injectedError: 'ignore_minion_aggro' });
      }
    }
    if (T >= st.aggroErrUntil) return block('enemy_wave');
  }
  // Diamond+: wait for the enemy's CS window (it winds up on a minion and cannot answer without losing it)
  const tgt = best.atkTarget;
  const csWindow = best.atkPhase === 1 && tgt >= 0 && v.ownMinions.some((m) => m.id === tgt);
  if (!csWindow && b.harassCsWindowPct > 0 && rng.chance(b.harassCsWindowPct / 100)) return block('cs_window_wait');
  st.stats.harassBlock.ok = (st.stats.harassBlock.ok ?? 0) + 1;
  return best.id;
}

const championMelee = (e: { champ: string | null }): boolean => championData(e.champ ?? '').attackType === 'melee';

/** Busy time of a reflex cast (same rule as brain.think for decision casts). */
function markCast(ctx: BotStatic, mem: BotMemory, a: BotAction, T: number): void {
  if (a.cmd.t !== 'cast') return;
  const ab = ctx.champ.abilities[a.cmd.slot];
  if (ab.movesWhileCasting && !ab.flags?.includes('channel')) return; // B2: the champion keeps moving
  mem.busyFrom = T;
  mem.busySlot = a.cmd.slot;
  mem.busyUntil = T + Math.ceil(ab.castTime * 30) + 1;
}

/**
 * Stand point (§4.4): every tick from the live wave, `behind` units behind the contact point (laneSpot), the
 * support's side point if the decision gave one; the next planned last hit must be reachable from it without a walk.
 */
function standPoint(v: View, ctx: BotStatic, intent: NonNullable<ReflexState['intent']>, plan: Plan | null, byId: Map<number, MinionWindow>): { x: number; y: number } {
  let p = intent.side ?? laneSpot(v, ctx, intent.lane, intent.behind);
  // no own minions at the enemy wave: its minions target the bot (minion aggro). Stand outside their reach
  // (+ a step), unless a planned last hit needs the walk-in (below)
  const untanked = untankedMinions(v);
  if (untanked.length) {
    for (let i = 0; i < 3; i++) {
      let pushed = false;
      for (const m of untanked) {
        const keep = (MINION_STATS[m.kind]?.range ?? 0) + m.radius + v.self.radius + AGGRO_MARGIN;
        const d = dst(p, m);
        if (d >= keep) continue;
        const dx = d > 1 ? (p.x - m.x) / d : (v.self.x - m.x) / (dst(v.self, m) || 1);
        const dy = d > 1 ? (p.y - m.y) / d : (v.self.y - m.y) / (dst(v.self, m) || 1);
        p = { x: m.x + dx * keep, y: m.y + dy * keep };
        pushed = true;
      }
      if (!pushed) break;
    }
  }
  const w = plan ? byId.get(plan.targetId) : undefined;
  if (w) {
    const r = v.reach + w.m.radius - 30;
    const d = dst(p, w.m);
    if (d > r) {
      const q = { x: w.m.x + ((p.x - w.m.x) * r) / d, y: w.m.y + ((p.y - w.m.y) * r) / d };
      if (!towerCovering(v, q)) p = q;
    }
  }
  return p;
}

/**
 * Filler target (§4.1) for an auto starting at T + 1, or null when the timer must be kept. Order: (1) champion -
 * Phase 2; window preparation (Platinum+: pull two colliding windows apart); (2) the healthiest minion that is not the
 * next last hit and whose hit does not open a window the bot cannot serve; (3) freeze filler - Phase 2;
 * (4) a structure when no minion is in reach. Every protected window (all minions in reach within the planning
 * horizon, not only the planned one) must stay servable after the filler's attack period.
 */
function chooseFiller(
  v: View,
  ctx: BotStatic,
  st: ReflexState,
  intent: NonNullable<ReflexState['intent']>,
  windows: MinionWindow[],
  protectedWins: MinionWindow[],
  plan: Plan | null,
  own: OwnAttack,
  P: ReflexParams,
  rng: Rng,
  T: number,
  lh: LastHitMem,
): { target: number; kind: 'minion' | 'structure' | 'prepare' | 'prehit' | 'harass' } | null {
  const next = T + 1 + Math.floor(own.period);
  const bias = (w: MinionWindow): number => (plan && plan.targetId === w.m.id ? plan.biasTicks : 0);
  // window preparation: the next two windows collide (one auto cannot serve both): hit one now so its window
  // opens earlier and both become servable (rolled once per pair with windowPrepPct)
  if (intent.farm && protectedWins.length >= 2) {
    const [c1, c2] = protectedWins as [MinionWindow, MinionWindow];
    const s1 = serveAt(c1.a, c1.b, c1.lead, T + 1);
    const both = s1 !== Infinity && serveAt(c2.a, c2.b, c2.lead, s1 + Math.floor(own.period)) !== Infinity;
    if (!both) {
      const key = `${c1.m.id}:${c2.m.id}`;
      let roll = st.prepRolls.get(key);
      if (roll === undefined) {
        roll = P.prep > 0 && rng.chance(P.prep);
        st.prepRolls.set(key, roll);
        if (st.prepRolls.size > 64) st.prepRolls.delete(st.prepRolls.keys().next().value!);
      }
      if (roll) {
        for (const [x, y] of [[c2, c1], [c1, c2]] as [MinionWindow, MinionWindow][]) {
          if (x.walk > 0) continue;
          const land = T + 1 + x.lead;
          const nx = windowAfterHit(x, land, T);
          if (nx.b <= land) continue; // the hit kills it: that is a last hit, not a preparation
          const per = Math.floor(own.period);
          // order A: the prepared minion first, then the other; order B: the other at the next auto, then the prepared
          const sx = serveAt(nx.a, nx.b, x.lead, next);
          const okA = sx !== Infinity && serveAt(y.a, y.b, y.lead, sx + per) !== Infinity;
          const sy = serveAt(y.a, y.b, y.lead, next);
          const okB = sy !== Infinity && serveAt(nx.a, nx.b, x.lead, sy + per) !== Infinity;
          if (!okA && !okB) continue;
          return { target: x.m.id, kind: 'prepare' };
        }
      }
    }
  }
  // every protected window must stay servable with the timer taken until `next`
  for (const w of protectedWins) if (!feasible(w, bias(w), next, own, PROTECT_SAFETY)) return null;
  // jointly: the protected windows served one auto per period (earliest deadline first) must not lose one that the
  // free timer would have served (two wide windows each servable alone can still collide after a filler)
  if (protectedWins.length >= 2 && serveCount(protectedWins, bias, next, own.period) < serveCount(protectedWins, bias, T + 1, own.period)) return null;
  // pre-hit: a minion whose next incoming hit jumps over the own damage (no kill window) gets an auto now, so the
  // next auto lands inside the window that opens (tower shots, stacked minion hits); chance by skill per minion
  if (intent.farm) {
    for (const w of windows) {
      if (w.walk > FILLER_WALK_TICKS || !(w.a === Infinity || w.a >= w.b) || w.b === Infinity || w.b - T >= PREHIT_LOOKAHEAD) continue;
      if (!attackSpotSafe(v, w.m) || !prehitFits(w, T + 1 + w.lead, own.period, 0, T)) continue;
      if (!prehitRoll(lh, w.m, ctx.params.skill, rng)) continue;
      return { target: w.m.id, kind: 'prehit' };
    }
  }
  // (1) harass (§4.3): the enemy laner in reach (or one step), no last-hit window lost (checked above), within the
  // rank's harass budget, not inside the enemy wave (minion aggro; Iron-Bronze ignore it via ignore_minion_aggro)
  if (intent.harass) {
    const h = harassTarget(v, ctx, st, rng, T, intent.wave === 'hold' ? 0 : HARASS_STEP);
    if (h >= 0) return { target: h, kind: 'harass' };
  }
  // §4.5: which minions the wave state lets the bot hit (target picture, never "nothing")
  const ownN = v.ownMinions.filter((m) => dst(m, v.self) < WAVE_COUNT_R).length;
  const foeN = v.enemyMinions.filter((m) => dst(m, v.self) < WAVE_COUNT_R).length;
  const minionOk = (m: MinionWindow['m']): boolean => {
    switch (intent.wave) {
      case 'push':
        return true;
      case 'neutral':
      case 'hold':
        return ownN <= foeN;
      case 'slowPush':
        return m.kind === Kind.MinionMelee;
      case 'freeze':
        // only enemy minions that hit own minions or the own tower, and only while the enemy surplus stays above the
        // corridor (the wave stays where it is)
        return foeN - ownN > FREEZE_SURPLUS_MAX && (v.ownMinions.some((o) => o.id === m.atkTarget) || v.ownTowers.some((t) => t.id === m.atkTarget));
    }
  };
  // plates (push state): a structure that a big own wave tanks beats the last enemy minions (they die to the wave)
  if (intent.hitStructures && intent.wave === 'push') {
    const s = structureToHit(v, ctx);
    const t = s >= 0 ? entityIndex(v.snap.entities).get(s) : undefined;
    if (t && v.ownMinions.filter((m) => dst(m, t) < TOWER_TANK_R).length >= PLATE_TANKS) return { target: s, kind: 'structure' };
  }
  if (intent.pushMinions) {
    let best: MinionWindow | null = null;
    for (const w of windows) {
      if (!minionOk(w.m)) continue;
      // a short step in (melee behind the wave) is fine; the attack order walks it
      if (w.walk > FILLER_WALK_TICKS || (plan && plan.targetId === w.m.id)) continue;
      if (protectedWins.includes(w) || !attackSpotSafe(v, w.m)) continue;
      // no own minion at it: hitting it draws the whole enemy wave onto the bot (minion aggro)
      if (!tanked(v, w.m)) continue;
      const land = T + 1 + w.lead;
      const nw = windowAfterHit(w, land, T);
      if (nw.b <= land) continue; // would be a kill: the planner handles kills
      // rule 2: after the hit, its window must not open before the bot can serve it, and must be servable then
      if (nw.a !== Infinity && nw.a < nw.b) {
        // §4.1 rule 2: the hit must not bring the minion into kill range before the next own auto can land there
        if (nw.a < next + w.lead - 1 || serveAt(nw.a, nw.b, w.lead, next) === Infinity) continue;
        if (plan) {
          const pw = protectedWins.find((x) => x.m.id === plan.targetId);
          if (pw && Math.abs(nw.a - (plan.executeAtTick + 1 + pw.lead)) < own.period) continue;
        }
      }
      if (!best || w.m.hp > best.m.hp || (w.m.hp === best.m.hp && w.m.id < best.m.id)) best = w;
    }
    if (best) return { target: best.m.id, kind: 'minion' };
  }
  // structures: not while freezing or holding the wave (they move it / advance the bot); plates after a crash
  if (intent.hitStructures && intent.wave !== 'freeze' && intent.wave !== 'hold' && !windows.some((w) => w.walk === 0)) {
    const s = structureToHit(v, ctx);
    if (s >= 0) return { target: s, kind: 'structure' };
  }
  return null;
}
