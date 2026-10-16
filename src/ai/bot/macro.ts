// Per-bot macro (docs/spec-bots.md §8): recall score, wave state, team-AI desires (objectives, push/defend, group,
// split push), vision (wards with the vision axis).

import { Kind } from '../../sim/types';
import type { LaneName, Pt } from '../../sim/map';
import type { NodeCtx, NodeResult } from '../bt/types';
import type { BotAction, SnapEntity } from './types';
import type { WaveChoice } from '../bt/state';
import type { Desire } from './teamai';
import { dst, laneProgress } from './geo';
import { near, towerCovering } from './perception';
import { nextItemPrice, spendable } from './shop';
import { rankIdx, rollError } from '../bt/deps';
import { cancelOrbwalk, moveCmd, orbwalkAttack } from './kite';
import { decisionInterval, summonerReady } from './trade';
import { emitPing, say } from './social';
import treeData from '../../data/bots/tree.json';
import wardSpotsJson from '../../data/bots/wardSpots.json';

const RECALL = treeData.params.recall;
const WARD_EVERY = treeData.params.wardEveryS as Record<'support' | 'jungle' | 'laner', number>;

const SILVER = rankIdx('silver');
const DIAMOND = rankIdx('diamond');

/** Own lane right now: team-AI override, role lane, or the jungler's current side. */
export function laneOf(n: NodeCtx): LaneName {
  return n.mem.ext.laneOverride ?? n.ctx.lane ?? 'mid';
}

/** Own vs enemy minions in the lane near the bot (snapshot-based wave estimate). */
export function waveEstimate(n: NodeCtx, lane: LaneName): { own: number; enemy: number; front: number; crashed: boolean; atOwnTower: boolean } {
  const pts = n.ctx.map.sides[n.ctx.team].lanes[lane];
  const inLane = (p: Pt): boolean => laneProgress(pts, p).off < 900;
  const own = n.v.ownMinions.filter((m) => inLane(m) && dst(m, n.v.self) < 1600);
  const enemy = n.v.enemyMinions.filter((m) => inLane(m) && dst(m, n.v.self) < 1600);
  const front = own.length ? Math.max(...own.map((m) => laneProgress(pts, m).s)) : 0;
  const crashed = own.length > 0 && enemy.length === 0 && own.some((m) => towerCovering(n.v, m));
  const atOwnTower = n.v.enemyMinions.filter((m) => n.v.ownTowers.some((t) => dst(t, m) < 900)).length >= 3;
  return { own: own.length, enemy: enemy.length, front, crashed, atOwnTower };
}

/**
 * Wave state choice (§8, Silver+ deliberately with profile waveStateDeliberatePct): freeze when the enemy laner is
 * behind and the own jungler not near, slow-push before recall/roam/objective, crash before recall or when the
 * enemy laner is absent, hold on gank danger. Tempo slow -> freeze, roam high -> slow-push/crash.
 */
/** Own minions around the bot that make a wave 'big' (crash it into the tower). */
const BIG_WAVE = 7;

export function chooseWave(n: NodeCtx, lane: LaneName): WaveChoice {
  const ext = n.mem.ext;
  if (n.v.tick - ext.wave.at < 90) return ext.wave;
  const set = (state: WaveChoice['state'], reason: string): WaveChoice => {
    if (state !== ext.wave.state) n.log('wave', state, reason, { lane });
    ext.wave = { state, at: n.v.tick, reason };
    return ext.wave;
  };
  const b = n.ctx.profile.behavior;
  // a big own wave (stacked minions) is taken to the tower by every rank: crash it and hit the tower
  const own = near(n.v.ownMinions, n.v.self, 1500).length;
  const foe = near(n.v.enemyMinions, n.v.self, 1500).length;
  if (own >= BIG_WAVE && foe * 2 <= own && (n.pv.gankRisk[lane] ?? 0) < 0.5) return set('crash', `big wave (${own} vs ${foe})`);
  if (rankIdx(n.ctx.profile.rank) < SILVER || !n.rng.chance(b.waveStateDeliberatePct / 100)) return set('default', 'no deliberate wave state');
  const risk = n.pv.gankRisk[lane] ?? 0;
  if (risk >= 0.4) return set('hold', `gank risk ${risk.toFixed(2)}`);
  const d = n.ctx.teamAI.desireFor(n.ctx.slot, n.v.tick);
  if (d && (d.kind === 'push_lane' || d.kind === 'split_push')) return set('crash', d.reason);
  if (recallWanted(n) >= RECALL.threshold + n.p.knobs.recallThresholdShift - 0.15) return set('crash', 'shove before recall');
  const laner = n.ctx.players.find((p) => p.team !== n.ctx.team && n.ctx.lane && (p.role === n.ctx.role || (n.ctx.role === 'support' && p.role === 'adc')));
  const laneFoe = laner ? n.v.enemies.find((e) => e.slot === laner.slot) : undefined;
  if (laner && n.snap.players.find((r) => r.slot === laner.slot)?.dead) return set('crash', 'enemy laner absent');
  const objSoon = (['leviathan', 'schleierwaechter'] as const).some((o) => {
    const left = (n.ctx.teamAI.aliveFrom[o] - n.v.tick) / 30;
    return left > 0 && left < 60;
  });
  if (objSoon || n.p.playstyle.roam >= 2) return set('slowPush', objSoon ? 'objective soon' : 'roam style');
  const ownJg = n.ctx.players.find((p) => p.team === n.ctx.team && p.role === 'jungle');
  const jgNear = !!n.v.allies.find((a) => a.slot === ownJg?.slot && dst(a, n.v.self) < 2500);
  if (laneFoe && laneFoe.level < n.v.me.level && !jgNear && n.p.playstyle.tempo <= 0) return set('freeze', 'enemy behind, freeze');
  if (n.p.playstyle.tempo <= -2) return set('freeze', 'slow tempo');
  return set('default', 'neutral');
}

/**
 * Recall score (§8, evaluated every 5 s). Terms: gold for the next item +0.4, HP < 35 % +0.4, mana < 15 % +0.2,
 * wave crashed +0.3, wave running into the own tower -0.4, gank risk > 0.5 +0.2, objective in 60-90 s +0.2
 * (< 45 s -0.3); threshold 0.6 + recallThresholdShift (tempo +-0.1, farm +0.1 per step over +2).
 */
export function recallWanted(n: NodeCtx): number {
  const v = n.v;
  const b = n.ctx.profile.behavior;
  let s = 0;
  const gold = spendable(v.me, n.mem);
  if (b.recallGoldThreshold !== null && gold >= Math.max(b.recallGoldThreshold, nextItemPrice(n.ctx, n.mem))) s += 0.4;
  if (v.hpPct < 0.35) s += 0.4;
  if (v.self.maxMana > 0 && v.self.mana / v.self.maxMana < 0.15) s += 0.2;
  const lane = laneOf(n);
  const w = waveEstimate(n, lane);
  if (w.crashed) s += 0.3;
  if (w.atOwnTower) s -= 0.4;
  if ((n.pv.gankRisk[lane] ?? 0) > 0.5) s += 0.2;
  for (const o of ['leviathan', 'schleierwaechter'] as const) {
    const left = (n.ctx.teamAI.aliveFrom[o] - v.tick) / 30;
    if (left >= 60 && left <= 90) s += 0.2;
    else if (left > 0 && left < 45) s -= 0.3;
  }
  return s;
}

/** Condition: recall now (Iron: only below 25 % HP or late_recall randomness). */
export function recallScore(n: NodeCtx): boolean {
  const v = n.v;
  if (v.me.recallLeft > 0 || n.mem.ext.trade) return false;
  const fountain = n.ctx.map.sides[n.ctx.team].fountain;
  if (dst(v.self, fountain) < 3000) return false;
  const ri = rankIdx(n.ctx.profile.rank);
  if (ri === 0) {
    const go = v.hpPct < 0.25 || n.rng.chance(0.03);
    if (go) n.log('recall', 'recall', v.hpPct < 0.25 ? 'iron: hp < 25 %' : 'iron: random recall', { hp: v.hpPct }, {}, 'late_recall');
    return go;
  }
  const s = recallWanted(n);
  const thr = RECALL.threshold + n.p.knobs.recallThresholdShift; // tempo +-0.1, farm above +2 raises it (K's knob)
  const lane = laneOf(n);
  const w = waveEstimate(n, lane);
  // Diamond+: shove first (crash the wave), then recall; cheater recall on wave 2-3 with enough gold for a part
  if (ri >= DIAMOND && n.ctx.lane && v.time > 140 && v.time < 210 && w.crashed && spendable(v.me, n.mem) >= 400 && n.rng.chance(n.ctx.profile.behavior.shoveAndRecallPct / 100)) {
    n.log('recall', 'cheater_recall', 'wave 2-3 crashed, buy a component', { gold: spendable(v.me, n.mem) }, { score: s });
    return true;
  }
  if (s >= thr && ri >= DIAMOND && !w.crashed && w.own > 0 && !w.atOwnTower && v.hpPct > 0.35 && n.rng.chance(n.ctx.profile.behavior.shoveAndRecallPct / 100)) {
    n.mem.ext.wave = { state: 'crash', at: v.tick, reason: 'shove and recall' };
    n.log('recall', 'shove_first', 'shove and recall', {}, { score: s });
    return false;
  }
  // Gold: shoves and then stands in the river (idle_after_shove 40 %)
  if (w.crashed && v.tick >= n.mem.ext.idleUntil + 600 && rollError('idle_after_shove', n.p, n.rng)) {
    n.mem.ext.idleUntil = v.tick + 6 * 30;
    n.log('recall', 'idle', 'stands around after the shove', {}, { score: s }, 'idle_after_shove');
    return false;
  }
  if (s >= thr) n.log('recall', 'recall', 'recall score', { gold: Math.round(spendable(v.me, n.mem)), hp: Math.round(v.hpPct * 100) / 100 }, { score: s, threshold: thr });
  return s >= thr;
}

/** Recall when safe; otherwise walk toward the own fountain side until it is. */
export function recall(n: NodeCtx): NodeResult {
  const v = n.v;
  const fountain = n.ctx.map.sides[n.ctx.team].fountain;
  const safe = near([...v.enemies, ...v.unnoticed], v.self, 1600).length === 0 && near(v.enemyMinions, v.self, 650).length === 0;
  cancelOrbwalk(n);
  if (safe) {
    n.mem.mode = 'recall';
    n.mem.lastMove = null;
    n.out.push({ cmd: { t: 'recall' } });
    return 'success';
  }
  n.mem.mode = 'home';
  n.out.push(moveCmd(fountain));
  n.mem.lastMove = { x: fountain.x, y: fountain.y, tick: v.tick };
  return 'running';
}

/** Gold idle_after_shove: stands still in the river for a few seconds. */
export function idleAfterShove(n: NodeCtx): NodeResult {
  if (n.v.tick >= n.mem.ext.idleUntil) return 'failure';
  if (n.v.enemies.some((e) => dst(e, n.v.self) < 1200)) {
    n.mem.ext.idleUntil = 0;
    return 'failure';
  }
  return 'running';
}

// ------------------------------------------------------------------ team-AI desires

export function hasObjectiveDesire(n: NodeCtx): boolean {
  const d = n.ctx.teamAI.desireFor(n.ctx.slot, n.v.tick);
  const ext = n.mem.ext;
  // lane-shaped desires steer laning (lane override) instead of a separate behaviour
  if (d && (d.kind === 'push_lane' || d.kind === 'defend_lane' || d.kind === 'group_mid' || d.kind === 'split_push') && d.lane) {
    ext.laneOverride = d.lane;
    ext.splitting = d.kind === 'split_push';
    if (d.kind === 'push_lane' || d.kind === 'split_push' || d.kind === 'group_mid') ext.wave = { state: 'crash', at: n.v.tick, reason: d.reason };
    return false;
  }
  ext.laneOverride = null;
  ext.splitting = false;
  return !!d;
}

const smiteDmg = (level: number): number => 450 + (450 * (level - 1)) / 17;

/** Execute the bot's objective-type desire: take/contest an objective, set vision, chase, idle, recall window. */
export function objective(n: NodeCtx): NodeResult {
  const d = n.ctx.teamAI.desireFor(n.ctx.slot, n.v.tick);
  if (!d) return 'failure';
  const v = n.v;
  const logOnce = (chosen: string, reason: string): void => {
    if (n.mem.ext.lastMode !== `obj:${d.kind}`) n.log('objective', chosen, reason, { kind: d.kind, obj: d.obj ?? '' });
    n.mem.ext.lastMode = `obj:${d.kind}`;
  };
  switch (d.kind) {
    case 'idle':
      logOnce('idle', d.reason);
      return 'running';
    case 'recall_window':
      logOnce('recall', d.reason);
      return recall(n);
    case 'chase': {
      logOnce('chase', d.reason);
      const e = v.enemies.sort((a, b) => dst(a, v.self) - dst(b, v.self))[0];
      if (e) return orbwalkAttack(n, e, decisionInterval(n)) ? 'running' : 'failure';
      const last = [...n.mem.aware.values()].sort((a, b) => b.lastSeen - a.lastSeen)[0];
      if (!last) return 'failure';
      return go(n, last);
    }
    case 'set_vision': {
      logOnce('set_vision', d.reason);
      return wardNear(n, d) ?? 'failure';
    }
    case 'take_objective':
    case 'contest_objective':
      return takeObjective(n, d, logOnce);
    default:
      return 'failure';
  }
}

function go(n: NodeCtx, p: Pt): NodeResult {
  if (dst(n.v.self, p) < 120) return 'success';
  if (n.mem.lastMove && dst(n.mem.lastMove, p) < 150 && n.v.self.moving && n.v.tick - n.mem.lastMove.tick < 150) return 'running';
  n.mem.lastMove = { x: p.x, y: p.y, tick: n.v.tick };
  n.out.push(moveCmd(p));
  return 'running';
}

/**
 * Smite on an epic monster (secure or steal, spec §8): the bot predicts the HP at the moment its smite lands from
 * the HP drop since its last look (team damage) and smites when that is within smite damage. Timing error: a
 * normal jitter with the profile's lastHitJitterMs (Iron smites late/early, Challenger on the dot).
 */
export function smiteCheck(n: NodeCtx, mon: SnapEntity, why: 'secure' | 'steal', obj: string): boolean {
  const v = n.v;
  const memo = n.mem.bt.get('_smiteHp') as { id?: number; hp?: number; tick?: number } | undefined;
  const rate = memo && memo.id === mon.id && memo.tick! < v.tick ? Math.max(0, (memo.hp! - mon.hp) / (v.tick - memo.tick!)) : 0;
  n.mem.bt.set('_smiteHp', { id: mon.id, hp: mon.hp, tick: v.tick } as never);
  const smite = summonerReady(n, 'bannen');
  if (smite < 0 || dst(v.self, mon) > 500 + mon.radius + v.self.radius) return false;
  const jitter = (n.rng.normal() * n.ctx.profile.behavior.lastHitJitterMs * 30) / 1000;
  // the bot looks again only after its decision interval: smite now if the HP will be in range before then
  // (the timing error shifts that moment: too early = smite does not kill, too late = the team takes it)
  const lead = Math.max(0, decisionInterval(n) + jitter);
  const hpAt = mon.hp - rate * lead;
  if (hpAt > smiteDmg(v.me.level)) return false;
  n.out.push({ cmd: { t: 'spell', slot: smite as 0 | 1, x: mon.x, y: mon.y, target: mon.id } });
  n.log('objective', 'smite', why, { obj, hp: Math.round(mon.hp), dps: Math.round(rate * 30) });
  return true;
}

function takeObjective(n: NodeCtx, d: Desire, logOnce: (c: string, r: string) => void): NodeResult {
  const v = n.v;
  const p = { x: d.x, y: d.y };
  // epic pit monsters (the pits hold nothing else; Kesselbrut's three are smaller than the others)
  const mon = v.monsters.filter((m) => dst(m, p) < 700 && m.radius >= 100).sort((a, b) => a.hp - b.hp)[0];
  // group up first: start only with >= 3 of the assigned bots at the pit (or after 20 s); a lone bot tanks the
  // monster, retreats and the monster resets
  const here = [v.self, ...v.allies].filter((a) => d.slots.includes(a.slot) && dst(a, p) < 1300).length;
  // the baron needs the team: four of the assigned bots (spec §8 baron decisions with team grouping)
  const need = Math.min(d.obj === 'schleierwaechter' ? 4 : 3, d.slots.length);
  if (d.kind === 'take_objective' && here < need && v.tick - d.from < 20 * 30 && !(mon && mon.hp < mon.maxHp * 0.9)) {
    logOnce('gather', `waiting for ${need - here} more at ${d.obj}`);
    const fountain = n.ctx.map.sides[n.ctx.team].fountain;
    const k = 750 / Math.max(1, dst(p, fountain));
    return go(n, { x: p.x + (fountain.x - p.x) * k, y: p.y + (fountain.y - p.y) * k });
  }
  if (!mon) {
    if (dst(v.self, p) < 500 && !n.ctx.teamAI.objectiveAlive(d.obj!, v.tick)) return 'failure';
    // at the pit without the monster in sight for a while: belief wrong (taken in the fog) -> give up
    if (dst(v.self, p) < 450) {
      const st = n.mem.bt.get('_pitWait') ?? { since: v.tick };
      n.mem.bt.set('_pitWait', st);
      if (v.tick - (st.since ?? v.tick) > 8 * 30) {
        n.ctx.teamAI.aliveFrom[d.obj!] = v.tick + 60 * 30;
        n.mem.bt.delete('_pitWait');
        n.log('objective', 'give_up', 'monster not at the pit', { obj: d.obj! });
        return 'failure';
      }
    }
    logOnce(d.kind === 'contest_objective' ? 'contest' : 'go', d.reason);
    return go(n, p);
  }
  n.mem.bt.delete('_pitWait');
  if (smiteCheck(n, mon, d.kind === 'contest_objective' ? 'steal' : 'secure', d.obj!)) return 'running';
  if (d.kind === 'contest_objective') {
    // wait at the pit edge for the smite window
    logOnce('contest', d.reason);
    return go(n, { x: mon.x + (v.self.x - mon.x) * 0.3, y: mon.y + (v.self.y - mon.y) * 0.3 });
  }
  logOnce('attack', d.reason);
  if (v.self.atkTarget !== mon.id) {
    n.out.push({ cmd: { t: 'attack', target: mon.id } });
    n.mem.lastMove = null;
  }
  if (n.mem.ext.pingAt < v.tick - 20 * 30) emitPing(n, 'objective', mon.x, mon.y, mon.id, 'taking objective', { src: 'static' });
  return 'running';
}

// ------------------------------------------------------------------ split push

/** Split push lane (team AI split_push): farm/push the side lane; retreat when 2+ enemies approach (Platinum+). */
export function splitPush(n: NodeCtx): NodeResult {
  if (!n.mem.ext.splitting) return 'failure';
  const v = n.v;
  const ri = rankIdx(n.ctx.profile.rank);
  const close = v.enemies.filter((e) => dst(e, v.self) < 2500).length;
  if (close >= 2 && ri >= rankIdx('platinum')) {
    const tower = v.ownTowers.sort((a, b) => dst(a, v.self) - dst(b, v.self))[0];
    if (tower) {
      if (n.mem.ext.lastMode !== 'split_retreat') {
        n.log('splitPush', 'retreat', `${close} enemies approaching`, { close });
        if (ri >= rankIdx('challenger')) say(n, 'macro', 'zieht zwei');
      }
      n.mem.ext.lastMode = 'split_retreat';
      return go(n, tower);
    }
  }
  return 'failure'; // laning executes the push in the override lane
}

// ------------------------------------------------------------------ vision

/** Ward a nearby unwarded bush (or the objective area) when due: interval by role x wardIntervalMult (vision axis). */
/** A ward is due (charge, interval by role x wardIntervalMult, safe) or a ward trip is running: laning yields. */
export function wardDue(n: NodeCtx): boolean {
  const v = n.v;
  const tr = v.me.trinket;
  const base = n.ctx.role === 'support' ? WARD_EVERY.support : n.ctx.role === 'jungle' ? WARD_EVERY.jungle : WARD_EVERY.laner;
  if (!tr || tr.id !== 'schleierward' || tr.charges <= 0 || v.time < 75) return false;
  if (n.mem.wardTrip >= 0 && v.tick - n.mem.wardTrip < 8 * 30) return true;
  if (v.tick - n.mem.wardAt < base * n.p.knobs.wardIntervalMult * 30) return false;
  if (n.ctx.role !== 'support' && n.ctx.role !== 'jungle' && n.p.playstyle.vision < 0) return false; // "wardet nur erzwungen"
  return !v.enemies.some((e) => dst(e, v.self) < 1200);
}

export function vision(n: NodeCtx): NodeResult {
  if (!wardDue(n)) return 'failure';
  const r = wardNear(n, null);
  if (!r) n.mem.wardAt = n.v.tick - 20 * 30; // no spot nearby: look again in a while
  return r ?? 'failure';
}

interface WardSpot extends Pt {
  kind: 'river' | 'objective' | 'jungle' | 'deep' | 'bush';
  roles: string[];
  obj?: string;
}
const SPOTS = (wardSpotsJson.spots as (Pt & { kind: WardSpot['kind']; roles: string[]; obj?: string })[]);

/**
 * Ward spots of the bot's team frame plus the map bushes (any role). Red reflects the data spots across the river
 * diagonal, (x, y) -> (size - y, size - x): that keeps lane and objective identity (blue's top river spot becomes
 * red's top river spot, the Leviathan pit spots stay at the Leviathan). The former point mirror (size - x, size - y)
 * sent red's top laner to the bot river and red's objective wards to the other pit (side bias).
 */
export function wardSpots(n: NodeCtx): WardSpot[] {
  const size = n.ctx.map.size;
  const mirror = n.ctx.team === 1;
  const data = SPOTS.map((q) => ({ ...q, x: mirror ? size - q.y : q.x, y: mirror ? size - q.x : q.y }));
  return [...data, ...n.ctx.map.bushes.map((b) => ({ x: b.x, y: b.y, kind: 'bush' as const, roles: ['top', 'jungle', 'mid', 'adc', 'support'] }))];
}

/** Value of a spot for this bot (lower = better): distance, minus a bonus for its role's spots and the objective. */
function spotCost(n: NodeCtx, q: WardSpot, center: Pt, d: Desire | null): number {
  let c = dst(q, center);
  if (q.roles.includes(n.ctx.role)) c -= 500;
  if (d?.obj && q.obj === d.obj) c -= 1500;
  if (q.kind === 'deep' && rankIdx(n.ctx.profile.rank) < rankIdx('platinum')) c += 1e6; // deep wards: Platinum+
  return c;
}

function wardNear(n: NodeCtx, d: Desire | null): NodeResult | null {
  const v = n.v;
  const tr = v.me.trinket;
  if (!tr || tr.id !== 'schleierward' || tr.charges <= 0) return d ? go(n, { x: d.x, y: d.y }) : null;
  const spot = pickSpot(n, d);
  const center = d ? { x: d.x, y: d.y } : v.self;
  if (!spot) return d ? go(n, center) : null;
  if (dst(spot, v.self) <= 550) {
    n.mem.wardAt = v.tick;
    n.mem.wardTrip = -1;
    n.out.push({ cmd: { t: 'ward', x: Math.round(spot.x), y: Math.round(spot.y) } });
    n.log('vision', 'ward', d ? `vision for ${d.obj ?? d.kind}` : `ward due (${spot.kind})`, { wardX: Math.round(spot.x), wardY: Math.round(spot.y), wardSrc: 'static' });
    return 'success';
  }
  if (n.mem.wardTrip < 0) n.mem.wardTrip = v.tick;
  else if (v.tick - n.mem.wardTrip > 8 * 30) {
    n.mem.wardAt = v.tick;
    n.mem.wardTrip = -1;
    return null;
  }
  return go(n, spot);
}

/** Best unwarded spot within the role's walking budget (support/jungle roam further), none in enemy tower range. */
function pickSpot(n: NodeCtx, d: Desire | null, kinds?: WardSpot['kind'][]): WardSpot | null {
  const v = n.v;
  const own = n.snap.entities.filter((e) => e.kind === Kind.Ward && e.ward && e.team === n.ctx.team && (e.vision ?? 1) > 0);
  const fountain = n.ctx.map.sides[n.ctx.team].fountain;
  const center = d ? { x: d.x, y: d.y } : v.self;
  const maxD = d ? 1600 : n.ctx.role === 'support' || n.ctx.role === 'jungle' ? 2500 : 1300;
  let spot: WardSpot | null = null;
  let best = Infinity;
  for (const q of wardSpots(n)) {
    if (kinds && !kinds.includes(q.kind)) continue;
    if (dst(q, center) > maxD || dst(q, fountain) < 4000 || towerCovering(v, q)) continue;
    if (own.some((w) => dst(w, q) < 900)) continue;
    const c = spotCost(n, q, center, d);
    if (c < best) (best = c), (spot = q);
  }
  return spot;
}

/**
 * Seal ward (Siegelward, consumable): placed on an objective / river spot near the bot when it carries one and no
 * own seal ward of its team stands within 1500 (sim: one per player; a refused placement is retried after 20 s).
 */
export function sealWard(n: NodeCtx): boolean {
  const v = n.v;
  const slot = v.me.items.findIndex((id, i) => i < 6 && id === 'siegelward');
  if (slot < 0 || v.tick - n.mem.ext.sealTryAt < 20 * 30 || v.enemies.some((e) => dst(e, v.self) < 1200)) return false;
  const seals = n.snap.entities.filter((e) => e.kind === Kind.Ward && e.ward === 'seal' && e.team === n.ctx.team);
  const q = pickSpot(n, null, ['objective', 'river', 'jungle', 'deep']);
  if (!q || dst(q, v.self) > 600 || seals.some((w) => dst(w, q) < 1500)) return false;
  n.mem.ext.sealTryAt = v.tick;
  n.out.push({ cmd: { t: 'item', slot, x: Math.round(q.x), y: Math.round(q.y) } });
  n.log('vision', 'seal_ward', `seal ward at ${q.kind}`, { wardX: Math.round(q.x), wardY: Math.round(q.y), wardSrc: 'static' });
  return true;
}

/** Suchfeuer (sweeper trinket): sweep a river/objective spot the bot passes (enemy wards there are cleared). */
export function sweep(n: NodeCtx): boolean {
  const v = n.v;
  const tr = v.me.trinket;
  if (!tr || tr.id !== 'suchfeuer' || tr.charges <= 0 || v.enemies.some((e) => dst(e, v.self) < 1200)) return false;
  const q = wardSpots(n).filter((s) => s.kind === 'objective' || s.kind === 'river' || s.kind === 'bush').find((s) => dst(s, v.self) < 500 && !towerCovering(v, s));
  if (!q) return false;
  n.out.push({ cmd: { t: 'ward', x: Math.round(q.x), y: Math.round(q.y) } });
  n.log('vision', 'sweep', `sweeper at ${q.kind}`, { wardX: Math.round(q.x), wardY: Math.round(q.y), wardSrc: 'static' });
  return true;
}

/** Seal-ward price (data/items.json 'siegelward'). */
const SEAL_COST = 75;
const SEAL_GOLD_ROLE: Record<string, number> = { support: 0.2, jungle: 0.5, top: 1, mid: 1, adc: 1 };

/**
 * Vision purchases on a fountain visit (after the build items): a Siegelward when the bot has none, gold to spare
 * (knob controlWardBuyGold x role) and passes the rank's control-ward rate (Table A controlWards per game / 3 per
 * visit); support and jungle swap to the Suchfeuer from level 9 when the vision axis uses the sweeper (Gold+).
 */
export function visionShop(n: NodeCtx, goldLeft: number): BotAction[] {
  const v = n.v;
  const out: BotAction[] = [];
  const tg = n.ctx.profile.targets;
  const perGame = n.ctx.role === 'support' ? tg.controlWardsSupport : tg.controlWardsLaner;
  const has = v.me.items.some((id, i) => i < 6 && id === 'siegelward');
  const free = v.me.items.some((id, i) => i < 6 && !id);
  if (!has && free && goldLeft >= SEAL_COST + n.p.knobs.controlWardBuyGold * (SEAL_GOLD_ROLE[n.ctx.role] ?? 1) && n.rng.chance(Math.min(1, perGame / 3))) {
    out.push({ cmd: { t: 'buy', item: 'siegelward' }, delay: 7 });
    n.log('vision', 'buy_seal_ward', 'control ward on the fountain visit', { gold: Math.round(goldLeft) });
  }
  const tr = v.me.trinket;
  if (tr && tr.canSwap === 'suchfeuer' && n.p.knobs.useSweeper && (n.ctx.role === 'support' || n.ctx.role === 'jungle') && rankIdx(n.ctx.profile.rank) >= rankIdx('gold')) {
    out.push({ cmd: { t: 'trinket', id: 'suchfeuer' } });
    n.log('vision', 'swap_sweeper', 'level 9: sweeper trinket', {});
  }
  return out;
}

export const isDiamondPlus = (n: NodeCtx): boolean => rankIdx(n.ctx.profile.rank) >= DIAMOND;
