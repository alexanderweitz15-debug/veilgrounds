// Value functions of the utility candidates (docs/BRAIN-REWORK.md §5 table, §4.6, §7). Each returns benefit and
// cost in gold over the candidate's horizon (the selector divides by the horizon: gold per second), or null when the
// precondition does not hold. Every number comes from values.json, the rank profile, the knobs or public game rules.

import { PLATE_COUNT, PLATE_HP, PLATES_FALL_TICK } from '../../sim/systems/towers';
import { deathTimerTicks } from '../../sim/systems/economy';
import type { LaneName, Pt } from '../../sim/map';
import type { NodeCtx } from '../bt/types';
import type { SnapEntity } from '../bot/types';
import { dst, laneProgress } from '../bot/geo';
import { hpPct, ready, slotReach } from '../bot/combat';
import { near, towerCovering } from '../bot/perception';
import { allInWanted, closestEnemy, comboReach, lethalDive } from '../bot/trade';
import { teamfightNear } from '../bot/teamfight';
import { wardDue } from '../bot/macro';
import { teleportSlot } from '../bot/spells';
import { nextItemPrice, spendable } from '../bot/shop';
import { estimateExchange, tacticsFocus } from '../bt/deps';
import { abilityDamage, fighterFromSnapshot } from '../exchange';
import { roamActive, roamOptions } from '../roams/roam';
import { gankActive, gankLane, gankOptions } from '../ganks/jungle';
import { frontTower } from '../perception/waves';
import { laneEnemies, LANE_ROLES } from '../ganks/common';
import { VALUES, rankCurve } from './values';
import { absenceLoss, hpGold, killGold, laneRateOf, laneTripLength } from './world';
import type { CandidateDef, CandidateValue, IntentData, World } from './types';

const G = VALUES.gold;
const H = VALUES.horizons;
const W = VALUES.weights;
const logit = (p: number): number => Math.log(Math.max(1e-4, p) / Math.max(1e-4, 1 - p));
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const LANES: LaneName[] = ['top', 'mid', 'bot'];

/** Seconds to walk to a point (straight line; the cost terms only need the order of magnitude). */
const walkS = (n: NodeCtx, p: Pt): number => dst(n.v.self, p) / Math.max(200, n.v.me.stats.ms);

/** Value of the farm the bot would miss over `s` seconds (minions about to die near it). */
function farmWithin(w: World, s: number): number {
  let g = 0;
  for (const x of w.minions) if (x.dieS <= s) g += x.gold;
  return g;
}

/** The lane opponent(s) of the bot: not visible / dead / low = absent or pushed back (§5 push precondition). */
function laneOpponentAway(w: World, lane: LaneName | null = w.lane): boolean {
  if (!w.pv || !lane) return false;
  const opps = laneEnemies(w.pv, lane).filter((t) => LANE_ROLES[lane].includes(t.role));
  if (!opps.length) return true;
  return opps.every((t) => t.dead || !t.visibleNow || t.hpFrac < 0.35);
}

// ------------------------------------------------------------------ farm (always a candidate)

export function farmValue(w: World): CandidateValue | null {
  const n = w.n;
  const h = H.farm;
  if (n.ctx.role === 'jungle' && !w.lane) {
    // jungle clear: camp income (value of the next camps over the horizon)
    return { benefit: VALUES.jungle.campGoldPerS * h, cost: 0, horizonS: h, terms: { camps: VALUES.jungle.campGoldPerS * h } };
  }
  if (!w.lane) return null;
  const near = farmWithin(w, h);
  // away from the lane (walking back after a recall / death): lane presence value, discounted by the walk
  const pts = n.ctx.map.sides[n.ctx.team].lanes[w.lane];
  const off = laneProgress(pts, n.v.self).off;
  const anchor = w.minions[0]?.m ?? n.v.ownMinions.find((m) => laneProgress(pts, m).off < VALUES.lane.laneWidth) ?? null;
  const travel = anchor ? walkS(n, anchor) : off / Math.max(200, n.v.me.stats.ms);
  const presence = w.laneRate * h * (h / (h + travel));
  const benefit = Math.max(near, presence);
  const risk = w.gankRisk * w.deathCost * W.farmRisk;
  // staying in contact at low HP (minions, tower, a poke): the death the bot risks by not going home (§4.6)
  const exposure = stayDeathProb(w) * w.deathCost * W.exposureFarm;
  return { benefit, cost: risk + exposure, horizonS: h, terms: { minions: near, presence, travelS: travel, gankRisk: w.gankRisk, risk, exposure } };
}

// ------------------------------------------------------------------ poke (ability harass, §4.3 / §5)

export function pokeValue(w: World): CandidateValue | null {
  const n = w.n;
  const v = n.v;
  const t = closestEnemy(n, 1300);
  if (!t || n.mem.ext.trade) return null;
  let best: { slot: 0 | 1 | 2; dmg: number; cost: number } | null = null;
  const me = fighterFromSnapshot(n.snap, v.self, true);
  const foe = fighterFromSnapshot(n.snap, t, false);
  for (const slot of [0, 1, 2] as const) {
    if (!ready(v, n.ctx, slot)) continue;
    const ab = n.ctx.champ.abilities[slot];
    if (!ab || ab.type === 'dash' || ab.type === 'blink') continue;
    if (dst(v.self, t) > slotReach(v, n.ctx, slot) + t.radius) continue;
    const hit = ab.type.startsWith('skillshot') ? clamp01(n.ctx.profile.behavior.skillshotHitPct / 100) : 1;
    const dmg = abilityDamage(me, slot, foe) * hit;
    if (dmg <= 0) continue;
    const mana = v.me.abilities[slot]?.cost ?? 0;
    if (!best || dmg - mana * G.manaPerPoint > best.dmg - best.cost) best = { slot, dmg, cost: mana * G.manaPerPoint };
  }
  if (!best) return null;
  const hpAfter = (t.hp - best.dmg) / Math.max(1, t.maxHp);
  const dmgGold = hpGold(best.dmg, hpPct(t));
  // forcing the opponent home: it loses its wave for a recall trip (§5 "Gegner-Recall erzwingen")
  const force = hpAfter < 0.3 && w.lane ? laneRateOf(w.time, 1, false) * laneTripLength(n, w.lane) / Math.max(200, n.v.me.stats.ms) * VALUES.lane.absenceLossFrac.neutral * W.pokeRecallForce : 0;
  const aggro = near(v.enemyMinions, v.self, 500).length * W.pokeAggroPerMinion;
  return {
    benefit: dmgGold + force,
    cost: best.cost + aggro,
    horizonS: H.poke,
    terms: { dmg: best.dmg, dmgGold, force, mana: best.cost, aggro },
    data: { target: t, slot: best.slot },
  };
}

// ------------------------------------------------------------------ trade / all-in (§5, §6.1)

export function tradeValue(w: World): CandidateValue | null {
  const n = w.n;
  const v = n.v;
  const running = n.mem.ext.trade;
  const focus = tacticsFocus(n.mem, v.tick);
  const t = running ? v.enemies.find((e) => e.serial === running.serial) ?? null : (focus ? v.enemies.find((e) => e.id === focus.eid) : null) ?? closestEnemy(n, 1300);
  if (!t) return null;
  const combo = n.ctx.champ.combos[0]?.sequence ?? ['AA'];
  if (!running && dst(v.self, t) > comboReach(n, combo) + v.me.stats.ms * 0.5) return null;
  const k = n.p.knobs;
  const ex = estimateExchange(v, n.ctx, t, H.trade, n.rng, { orbwalk: 0.7 + 0.3 * k.orbwalkChance });
  const exK = estimateExchange(v, n.ctx, t, H.allin, n.rng, { orbwalk: 0.7 + 0.3 * k.orbwalkChance });
  // no new trade on a target under its tower unless the dive is allowed (the trade leaf's own rule: aggression
  // knob + tolerance, or a lethal dive) - otherwise the trade ends at once and is re-chosen next decision (tower deaths)
  const tol = n.ctx.profile.behavior.diveHpTolerancePct + k.diveTolerancePctShift;
  if (!running && towerCovering(v, t) && !(k.towerDive && hpPct(t) * 100 <= tol) && !lethalDive(n, t, exK)) return null;
  const allin = running ? running.kind === 'allin' : allInWanted(n, exK);
  const e = allin ? exK : ex;
  const h = allin ? H.allin : H.trade;
  // HP lead after the exchange from winProb = sig(5 x (allyHpAfter - enemyHpAfter)) (exchange.ts)
  const hpLead = (logit(ex.winProb) / 5) * t.maxHp;
  const kill = e.killProb * killGold();
  const lead = Math.max(0, hpLead);
  const benefit = kill + hpGold(lead, hpPct(t));
  const death = e.deathProb * w.deathCost;
  const behind = hpGold(Math.max(0, -hpLead), v.hpPct);
  const missed = farmWithin(w, h) * W.tradeMissedFarm;
  const aggro = near(v.enemyMinions, v.self, 500).length * W.tradeAggroPerMinion * h;
  const gank = w.gankRisk * w.deathCost * W.tradeGankRisk;
  const trigger = focus && focus.eid === t.id ? 'gank_focus' : t.atkTarget === v.self.id ? 'retaliate' : e.killProb > VALUES.combat.killWindowFromFarm ? 'kill_window' : 'value';
  return {
    benefit,
    cost: death + behind + missed + aggro + gank,
    horizonS: h,
    terms: { win: ex.winProb, kill: e.killProb, death: e.deathProb, hpLead, killGold: kill, deathGold: death, missed, aggro, gank },
    data: { target: t, kind: allin ? 'allin' : 'trade', trigger, ex, exK },
  };
}

// ------------------------------------------------------------------ fight: teamfight / skirmish / join (§6.3)

export function fightValue(w: World): CandidateValue | null {
  const n = w.n;
  const v = n.v;
  const h = H.fight;
  if (teamfightNear(n)) {
    const enemies = v.enemies.filter((e) => dst(e, v.self) < 1600);
    const t = enemies.sort((a, b) => dst(a, v.self) - dst(b, v.self))[0];
    if (!t) return null;
    const ex = estimateExchange(v, n.ctx, t, 6, n.rng);
    const benefit = ex.winProb * enemies.length * killGold() * W.fightWinGold + ex.killProb * killGold();
    const cost = ex.deathProb * w.deathCost;
    return { benefit, cost, horizonS: h, terms: { win: ex.winProb, kill: ex.killProb, death: ex.deathProb, enemies: enemies.length, near: 1 } };
  }
  // an ally fighting within reach (joinFight) or the player's engage (followUp)
  if (n.mem.ext.followUntil > v.tick) return { benefit: killGold() * W.fightWinGold, cost: 0, horizonS: h, terms: { followUp: 1 } };
  let best: { a: SnapEntity; e: SnapEntity; d: number } | null = null;
  for (const a of v.allies) {
    const d = dst(a, v.self);
    if (d < 1300 || d > 5000) continue;
    const e = v.enemies.find((x) => dst(x, a) < 800);
    if (e && (!best || d < best.d)) best = { a, e, d };
  }
  if (!best) return null;
  let arrival = best.d / Math.max(200, v.me.stats.ms);
  // Teleport join (B4 issue: the top laner's unlocked Teleport, from Gold by rank curve, from 10:00 onto an own
  // minion / ward / tower near the fight, only when the team is not behind on the scoreboard)
  const T = VALUES.teleport;
  let tp: IntentData['tp'];
  const slot = teleportSlot(v, n.ctx);
  if (slot !== -1 && best.d > T.minJoinDist && v.time >= T.fromS && rankCurve(T.joinRank, n.ctx.params.skill) >= 0.5 && teamItemLead(n) >= T.minTeamItemLead) {
    const spot = [...v.ownMinions, ...n.snap.entities.filter((e) => e.ward && e.team === n.ctx.team), ...v.ownTowers].filter((e) => dst(e, best!.e) < T.landRange).sort((a, b) => dst(a, best!.e) - dst(b, best!.e))[0];
    if (spot) {
      tp = { slot, id: spot.id, x: spot.x, y: spot.y };
      arrival = T.channelS + dst(spot, best.e) / Math.max(200, v.me.stats.ms);
    }
  }
  const ex = estimateExchange(v, n.ctx, best.e, h, n.rng);
  const benefit = ex.winProb * killGold() * W.fightWinGold;
  const cost = ex.deathProb * w.deathCost * 0.5 + absenceLoss(w, arrival * 2);
  return { benefit, cost, horizonS: h + arrival, terms: { win: ex.winProb, death: ex.deathProb, arrivalS: arrival, join: 1, teleport: tp ? 1 : 0 }, ...(tp ? { data: { tp } } : {}) };
}

/** Own team's item value minus the enemy's (public scoreboard). */
function teamItemLead(n: NodeCtx): number {
  let d = 0;
  for (const r of n.snap.players) d += r.team === n.ctx.team ? r.itemValue : -r.itemValue;
  return d;
}

// ------------------------------------------------------------------ push / plates (§5, §7.1)

/** Per bot: the latest running gank (lane, target slot, last tick seen running) for the plate after a gank. */
const lastGank = new WeakMap<object, { lane: LaneName; slot: number; tick: number }>();

/** Remember the running gank's lane and target (called every decision while a gank runs). */
export function noteRunningGank(n: NodeCtx): void {
  const g = gankLane(n);
  if (g) lastGank.set(n.mem, { ...g, tick: n.v.tick });
}

/**
 * §7.1 jungler plate after a successful gank (target dead or its Flash used), from Gold (rank curve): the lane of a
 * gank that ended within plateAfterGankS, own wave at the tower; Challenger also checks the enemy jungler's cloud.
 */
function postGankLane(w: World): LaneName | null {
  const n = w.n;
  const g = lastGank.get(n.mem);
  const J = VALUES.jungle;
  if (!g || !w.pv || w.tick - g.tick > J.plateAfterGankS * 30 || rankCurve(J.plateAfterGank, n.ctx.params.skill) < 0.5) return null;
  const t = w.pv.enemies.get(g.slot);
  const success = !!t && (t.dead || (t.cds.flashReadyAt ?? -1) > w.tick);
  if (!success) return null;
  const jg = w.pv.junglerEstimate;
  const tower = frontTower(n.ctx.map, n.snap, 1 - n.ctx.team, g.lane);
  if (jg && tower && rankCurve(J.plateCloudCheck, n.ctx.params.skill) >= 0.5 && jg.weight > 0.3 && dst(jg, tower) < J.plateCloudRange) return null;
  return g.lane;
}

export function pushValue(w: World): CandidateValue | null {
  const n = w.n;
  const v = n.v;
  const jungler = n.ctx.role === 'jungle';
  const lane = jungler ? postGankLane(w) : w.lane;
  if (!lane || !w.pv) return null;
  const wave = w.pv.waves[lane];
  if (!wave.visible || wave.ownCount < 2) return null;
  if (!laneOpponentAway(w, lane) && !wave.crashed) return null;
  const h = H.push;
  const tower = frontTower(n.ctx.map, n.snap, 1 - n.ctx.team, lane);
  if (jungler && (!tower || v.ownMinions.filter((m) => dst(m, tower) < 800).length < 2)) return null;
  let structure = 0;
  let plates = 0;
  if (tower) {
    const tank = v.ownMinions.filter((m) => dst(m, tower) < 800).length;
    const reachS = Math.max(0, dst(v.self, tower) - 800) / Math.max(200, v.me.stats.ms);
    // plates only while >= 2 own minions tank the tower and it does not shoot the bot (no shove into tower range)
    if (tank >= W.plateMinTank && tower.atkTarget !== v.self.id) {
      const grubs = 1 + 0.04 * (n.snap.kesselbrut ?? 0);
      const dps = v.me.stats.ad * Math.max(0.1, v.me.stats.as) * VALUES.push.towerMitigation * grubs;
      const dmg = dps * Math.max(0, h - reachS);
      const outer = n.ctx.map.sides[1 - n.ctx.team]!.towers[lane][0]!;
      if (v.tick < PLATES_FALL_TICK && dst(tower, outer) < 200) {
        let left = 0;
        for (let i = 1; i <= PLATE_COUNT; i++) if (tower.hp > tower.maxHp - i * PLATE_HP) left++;
        // §7.1 plates are worth more than their gold before 14:00 (tower progress, first tower 12-16 min)
        plates = Math.min(left, dmg / PLATE_HP) * G.plate * W.platePriority;
      }
      structure = (dmg / Math.max(1, tower.maxHp)) * (G.tower.local + G.tower.team);
    }
  }
  const wavePush = farmWithin(w, h);
  const benefit = plates + structure + wavePush;
  const risk = w.gankRisk * w.deathCost * W.pushGankRisk;
  const ret = laneOpponentAway(w, lane) ? 0 : w.deathCost * W.pushEnemyReturn * 0.1;
  // pushing walks into the enemy wave / tower: low HP costs more here than when farming behind the wave
  const exposure = stayDeathProb(w) * w.deathCost * W.exposurePush;
  return { benefit, cost: risk + ret + exposure, horizonS: h, terms: { plates, structure, wave: wavePush, risk, enemyReturn: ret, exposure, afterGank: jungler ? 1 : 0 }, ...(jungler ? { data: { lane } } : {}) };
}

// ------------------------------------------------------------------ roam (§5, §7.3)

/**
 * Gold a successful roam / gank kill is worth to the team: bounty + the assist share of the ally that helps, plus
 * the wave the dead opponent loses while respawning (public death timer x lane rate).
 */
function roamPrize(w: World, targetLevel: number): number {
  const k = G.kill;
  const respawnS = deathTimerTicks(Math.max(1, targetLevel), w.tick) / 30;
  return killGold() * (1 + k.assistShare) + w.laneRate * respawnS * VALUES.lane.absenceLossFrac.neutral;
}

interface RoamCache {
  at: number;
  opts: ReturnType<typeof roamOptions>;
}
const roamCache = new WeakMap<object, RoamCache>();

export function roamValue(w: World): CandidateValue | null {
  const n = w.n;
  const active = roamActive(n);
  let c = roamCache.get(n.mem);
  if (!active && (!c || w.tick - c.at >= 90)) roamCache.set(n.mem, (c = { at: w.tick, opts: roamOptions(n) }));
  const ev = c?.opts?.evals[0];
  if (!active && !ev) return null;
  const travel = ev && w.pv ? walkS(n, { x: ev.target.lastX, y: ev.target.lastY }) : 0;
  const h = travel + H.roamExtra;
  const support = n.ctx.role === 'support' ? 1 - n.p.knobs.supportAdcBinding : 1;
  const prize = roamPrize(w, ev?.target.level ?? n.v.me.level);
  const benefit = (active ? 1 : ev?.score ?? 0) * prize * W.roamKillConversion * support;
  const plateRisk = w.waveAtOwnTower ? G.plate * W.roamPlateRisk : 0;
  const cost = absenceLoss(w, travel * 2 + H.roamExtra) + plateRisk;
  return { benefit, cost, horizonS: Math.max(1, h), terms: { score: ev?.score ?? 1, prize, travelS: travel, wave: absenceLoss(w, travel * 2 + H.roamExtra), plateRisk, active: active ? 1 : 0 }, data: { roam: ev } };
}

// ------------------------------------------------------------------ jungle gank (§4.3 with the utility's costs)

interface GankCache {
  at: number;
  opts: ReturnType<typeof gankOptions>;
}
const gankCache = new WeakMap<object, GankCache>();

export function gankValue(w: World): CandidateValue | null {
  const n = w.n;
  if (n.ctx.role !== 'jungle') return null;
  const active = gankActive(n);
  noteRunningGank(n);
  let c = gankCache.get(n.mem);
  if (!active && (!c || w.tick - c.at >= Math.round(n.p.knobs.gankEvalIntervalS * 30))) gankCache.set(n.mem, (c = { at: w.tick, opts: gankOptions(n) }));
  const ev = c?.opts?.[0];
  if (!active && !ev) return null;
  const travel = ev ? walkS(n, { x: ev.target.lastX, y: ev.target.lastY }) : 0;
  const h = travel + H.roamExtra;
  const prize = roamPrize(w, ev?.target.level ?? n.v.me.level);
  const benefit = (active ? 1 : ev?.score ?? 0) * prize * W.roamKillConversion;
  const cost = VALUES.jungle.campGoldPerS * h * 0.5;
  return { benefit, cost, horizonS: Math.max(1, h), terms: { score: ev?.score ?? 1, prize, travelS: travel, camps: cost, active: active ? 1 : 0 }, data: { gank: ev } };
}

// ------------------------------------------------------------------ recall (§4.6, §7.2)

/** Probability of dying when staying in lane at the current HP (§4.6 heal path: home only above 0.3). */
export function stayDeathProb(w: World): number {
  const v = w.n.v;
  const sd = VALUES.recall.stayDeath;
  const missing = 1 - v.hpPct;
  const foe = closestEnemy(w.n, 1400);
  return clamp01(sd.hpBase * missing * missing + w.gankRisk * sd.gankRiskWeight * missing + (foe ? sd.enemyNearWeight * missing : 0));
}

export function recallValue(w: World): CandidateValue | null {
  const n = w.n;
  const v = n.v;
  const fountain = n.ctx.map.sides[n.ctx.team].fountain;
  if (dst(v.self, fountain) < VALUES.recall.homeRange || n.mem.ext.trade || v.me.recallLeft > 0) return null;
  const gold = spendable(v.me, n.mem);
  const price = nextItemPrice(n.ctx, n.mem);
  // item term (spec-bots §8): gold for the next item and at least the profile's recall gold threshold (null: Iron
  // ignores gold)
  const thr = n.ctx.profile.behavior.recallGoldThreshold;
  const item = thr !== null && gold >= Math.max(thr, price) ? gold * VALUES.recall.itemValuePerGold : 0;
  const stay = stayDeathProb(w);
  const hp = stay > W.recallStayDeathThreshold ? stay * w.deathCost * W.recallHpValue : 0;
  const manaLow = v.self.maxMana > 0 && v.self.mana / v.self.maxMana < VALUES.recall.manaLowFrac;
  const mana = manaLow ? (v.self.maxMana - v.self.mana) * G.manaPerPoint : 0;
  const trip = w.recallTripS;
  const wave = absenceLoss(w, trip);
  const plates = w.waveAtOwnTower ? G.plate * W.roamPlateRisk : 0;
  // §7.1: a crashed wave tanking the enemy tower is plate time - recalling now gives those plates up
  const p = n.ctx.role !== 'jungle' ? pushValue(w) : null;
  const forgone = p ? (p.terms.plates! + p.terms.structure!) * W.recallForgoesPlates : 0;
  // shove-and-recall (§4.6): Silver+ crash the wave first unless it is crashed (or crashes on its own)
  const crashing = !!w.pv && !!w.lane && w.pv.waves[w.lane].pushing && w.pv.waves[w.lane].pos > 0.55;
  const shoveFirst = rankCurve(VALUES.recall.shoveFirst, n.ctx.params.skill) >= 0.5 && !w.waveCrashed && !crashing && !!w.lane && w.minions.length > 0;
  return {
    benefit: item + hp + mana,
    cost: wave + plates + forgone,
    horizonS: trip,
    terms: { gold, price: Number.isFinite(price) ? price : -1, item, stayDeath: stay, hp, mana, tripS: trip, wave, plates, forgonePlates: forgone },
    data: { shoveFirst },
  };
}

// ------------------------------------------------------------------ objective (team-AI desire as a weight, §5/§7.6)

const OBJECTIVE_KINDS = new Set(['take_objective', 'contest_objective', 'set_vision', 'recall_window', 'chase', 'idle']);

export function objectiveValue(w: World): CandidateValue | null {
  const n = w.n;
  const d = n.ctx.teamAI?.desireFor(n.ctx.slot, w.tick);
  if (!d || !OBJECTIVE_KINDS.has(d.kind)) return null;
  const h = H.objective;
  const o = d.obj ? (G.objectives as Record<string, Record<string, number>>)[d.obj] : undefined;
  const objGold = !o ? 0 : d.obj === 'schleierwaechter' ? o.goldPerChamp! * o.champs! + o.buff! : d.obj === 'kesselbrut' ? 3 * (o.goldPerLarva! + o.stackStructureValue!) : o.gold! * 5 + o.buff!;
  let benefit = 0;
  switch (d.kind) {
    case 'take_objective':
      benefit = objGold * Math.min(1, d.score);
      break;
    case 'contest_objective':
      benefit = objGold * 0.3;
      break;
    case 'set_vision':
      benefit = G.ward.visionMax * 2;
      break;
    default:
      // rank-typical non-conversion after a won fight (chase / idle / recall window, team AI): a team call followed
      benefit = killGold() * W.fightWinGold;
  }
  // §7.4 objective conversion after a won fight is a team call with a short window: weighted up (values.json)
  if (d.reason.startsWith('won skirmish') && d.kind === 'take_objective') benefit *= W.conversionCall;
  const away = d.kind === 'idle' || d.kind === 'recall_window' ? 0 : absenceLoss(w, Math.min(h, walkS(n, d) + 10));
  const fight = d.kind === 'take_objective' ? (1 - Math.min(1, d.score)) * w.deathCost * W.objectiveFightRisk : 0;
  return { benefit, cost: away + fight, horizonS: h, terms: { obj: objGold, desire: d.score, away, fight }, data: { desire: d.kind } };
}

// ------------------------------------------------------------------ ward (§5)

export function wardValue(w: World): CandidateValue | null {
  const n = w.n;
  if (!wardDue(n)) return null;
  const tg = G.ward;
  const soon = (['leviathan', 'schleierwaechter'] as const).some((o) => {
    const at = n.ctx.teamAI?.aliveFrom[o];
    const left = at === undefined ? -1e9 : (at - w.tick) / 30;
    return left > -30 && left < tg.objectiveLeadS;
  });
  const vision = soon ? tg.visionMax : tg.visionMin;
  const missed = farmWithin(w, H.ward) * W.wardMissedFarm;
  return { benefit: vision, cost: missed, horizonS: H.ward, terms: { vision, missed, objectiveSoon: soon ? 1 : 0 } };
}

// ------------------------------------------------------------------ group / siege / defend (§5, §7.5)

const GROUP_KINDS = new Set(['group_mid', 'push_lane', 'split_push', 'defend_lane']);

function structureGold(depth: number): number {
  if (depth <= 2) return G.tower.local + G.tower.team;
  if (depth === 3) return G.inhibitor;
  return G.nexusTower;
}

export function groupValue(w: World): CandidateValue | null {
  const n = w.n;
  const d = n.ctx.teamAI?.desireFor(n.ctx.slot, w.tick);
  if (!d || !GROUP_KINDS.has(d.kind) || !d.lane) return null;
  const h = H.group;
  const target = { x: d.x, y: d.y };
  const depth = d.kind === 'defend_lane' ? 0 : n.ctx.teamAI.nextStructure(n, d.lane).depth;
  let benefit = d.score * structureGold(depth) * (d.reason.startsWith('won skirmish') ? W.conversionCall : 1);
  // in the own lane the laning leaf farms on the way (punish-absence / siege of the own lane): no worse than farm
  if (d.lane === w.lane) benefit += farmWithin(w, h);
  // §7.5: a side laner keeps farming until the group actually hits the structure
  const allies = n.v.allies.filter((a) => dst(a, target) < 1500).length;
  const side = d.kind === 'group_mid' && (n.ctx.role === 'top' || n.ctx.role === 'adc') && d.lane !== w.lane;
  if (side && allies < W.groupNeedsAlliesAtTarget) benefit = 0;
  const other = d.lane !== n.ctx.lane;
  const cost = other ? absenceLoss(w, Math.min(h, walkS(n, target) + 10)) : 0;
  return { benefit, cost, horizonS: h, terms: { desire: d.score, structure: structureGold(depth), alliesAtTarget: allies, wave: cost }, data: { lane: d.lane, desire: d.kind, crash: d.kind !== 'defend_lane' } };
}

// ------------------------------------------------------------------ jungler catches an abandoned lane (§4.6)

export function catchLaneValue(w: World): CandidateValue | null {
  const n = w.n;
  if (n.ctx.role !== 'jungle' || !w.pv || rankCurve(VALUES.jungle.catchLane, n.ctx.params.skill) < 0.5) return null;
  let best: { lane: LaneName; value: number; travel: number } | null = null;
  for (const lane of LANES) {
    const wave = w.pv.waves[lane];
    if (!wave.visible || wave.enemyCount < VALUES.jungle.catchLaneMinOwnTowerWave || !wave.atOwnTower) continue;
    const laners = n.ctx.players.filter((p) => p.team === n.ctx.team && LANE_ROLES[lane].includes(p.role));
    const pts = n.ctx.map.sides[n.ctx.team].lanes[lane];
    const away = laners.every((p) => {
      const row = n.snap.players.find((r) => r.slot === p.slot);
      if (row?.dead) return true;
      const a = n.v.allies.find((x) => x.slot === p.slot);
      return !a || laneProgress(pts, a).off > 2500 || dst(a, n.ctx.map.sides[n.ctx.team].fountain) < 3000;
    });
    if (!away) continue;
    const tower = n.v.ownTowers.filter((t) => n.ctx.map.sides[n.ctx.team].towers[lane].some((q) => dst(q, t) < 200)).sort((a, b) => dst(a, n.v.self) - dst(b, n.v.self))[0];
    const travel = tower ? walkS(n, tower) : 30;
    const value = laneRateOf(w.time, rankCurve(VALUES.lane.csShare, n.ctx.params.skill), false) * H.catchLane;
    if (!best || value - travel > best.value - best.travel) best = { lane, value, travel };
  }
  if (!best) return null;
  const cost = VALUES.jungle.campGoldPerS * (H.catchLane + best.travel) * 0.5;
  return { benefit: best.value, cost, horizonS: H.catchLane + best.travel, terms: { travelS: best.travel, camps: cost }, data: { lane: best.lane } };
}

/** All candidates in a fixed order (ties resolve by this order: deterministic). */
export const CANDIDATES: CandidateDef[] = [
  { id: 'farm', value: farmValue },
  { id: 'poke', value: pokeValue },
  { id: 'trade', value: tradeValue },
  { id: 'fight', value: fightValue },
  { id: 'push', value: pushValue },
  { id: 'roam', value: roamValue },
  { id: 'gank', value: gankValue },
  { id: 'recall', value: recallValue },
  { id: 'objective', value: objectiveValue },
  { id: 'ward', value: wardValue },
  { id: 'group', value: groupValue },
  { id: 'catchLane', value: catchLaneValue },
];

