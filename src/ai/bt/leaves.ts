// Leaf registry of the bot behaviour tree and the per-decision entry point. The tree itself is data
// (src/data/bots/tree.json); every leaf name used there must be registered here (compile() throws otherwise).

import treeData from '../../data/bots/tree.json';
import type { Rng } from '../../sim/rng';
import type { BotAction, BotMemory, BotStatic, Snapshot } from '../bot/types';
import { perceive } from '../bot/perception';
import { settleBuys } from '../bot/shop';
import { compile, type BtNode } from './runtime';
import type { NodeCtx, NodeDef, NodeResult, Registry } from './types';
import { perceive as perceiveL } from '../perception';
import { attachTracks } from './deps';
import * as brain from '../bot/brain';
import { attackedByChampion, diveDefence, disengage, pokeReact, tradeRun, tradeStart, tradeWindowScore } from '../bot/trade';
import { holdTrades, followUp, pingRetreat, pingsIn, socialTick } from '../bot/social';
import { joinFight, teamfight, teamfightNear } from '../bot/teamfight';
import { hasObjectiveDesire, idleAfterShove, objective, recall, recallScore, splitPush, vision } from '../bot/macro';
import { plants } from '../bot/plants';
import { dst } from '../bot/geo';
import { MAX_TILT, withTilt } from '../params';
import { attentionOn } from '../humanize/attention';

import { escape } from '../ganks/escape';
import { gankRiskReaction } from '../ganks/risk';
import { counterGank, jungleGank } from '../ganks/jungle';
import { roam } from '../roams/roam';
import { enemyRoamReaction } from '../roams/enemyRoam';
import { utilityOn } from '../utility/flag';
import { utilitySelect } from '../utility/select';

/** Leaf registry (a function: brain.ts and this module import each other, so build it on first use). */
export const registry = (): Registry => ({
  actions: {
    levelUp: (n) => {
      const a = brain.levelUp(n.v.me, n.ctx);
      if (a) n.out.push(a);
      return 'success';
    },
    bookkeeping,
    teamAI: (n) => (n.ctx.teamAI.update(n), 'success'),
    pingsIn,
    utilitySpells: brain.utilitySpells,
    dead: brain.dead,
    arena: brain.arena,
    // brain rework §5: utility selector (flag off -> failure at once, no rng / memory / log)
    utilitySelect: (n) => (utilityOn(n.ctx) ? utilitySelect(n) : 'failure'),
    recallChannel: brain.recallChannel,
    fountain: brain.fountain,
    plants,
    escape,
    pingRetreat,
    diveDefence,
    retreat: brain.retreat,
    dodge: brain.dodge,
    peel: brain.peel,
    pokeReact,
    tradeRun,
    disengage,
    tradeStart,
    teamfight,
    followUp,
    joinFight,
    objective,
    recall,
    idleAfterShove,
    gankRiskReaction,
    gank: jungleGank,
    counterGank,
    roam,
    enemyRoamReaction,
    splitPush,
    jungle: brain.jungleLeaf,
    lane: brain.laneLeaf,
    vision,
    idle: brain.idle,
  },
  conditions: {
    teamfightNear,
    attackedByChampion,
    hasObjectiveDesire,
    recallScore,
  },
  scores: {
    tradeWindow: (n) => (holdTrades(n) ? 0 : tradeWindowScore(n)),
  },
});

let compiled: BtNode | null = null;
/** The compiled tree (shared by all bots; node state lives in BotMemory.bt). */
export const botTree = (): BtNode => (compiled ??= compile(treeData.root as NodeDef, registry()));

/** Per-decision bookkeeping: buys, own attack timer, level-up spikes, enemy casts (punish windows), CS windows, kills. */
function bookkeeping(n: NodeCtx): NodeResult {
  const { v, mem, snap } = n;
  const me = v.me;
  if (me.dead) {
    if (mem.ext.trade) mem.ext.trade = null;
    mem.ext.killStreak = 0;
    return 'success';
  }
  settleBuys(me, mem);
  const as = Math.max(0.1, me.stats.as);
  if (v.self.atkPhase === 1 && v.tick - mem.atkStart > 30 / as - 3) mem.atkStart = v.tick;
  else if (v.self.atkPhase === 2 && v.tick - mem.atkStart > 30 / as) mem.atkStart = v.tick - Math.round((30 * n.ctx.champ.base.windup) / as);
  const ext = mem.ext;
  if (me.level > ext.level) {
    if (ext.level > 0) ext.levelUpAt = v.tick;
    ext.level = me.level;
  }
  snap.events.forEach((ev, i) => {
    if (ev.e !== 'cast' || ev.slot > 2) return;
    const e = v.enemies.find((x) => x.id === ev.src);
    if (e) ext.enemyCastAt.set(e.serial, snap.eventTicks?.[i] ?? v.tick);
  });
  for (const e of v.enemies) {
    if (v.ownMinions.some((m) => m.hp < m.maxHp * 0.25 && dst(m, e) < 250)) ext.csWindowAt.set(e.serial, v.tick);
  }
  const row = snap.players.find((r) => r.slot === n.ctx.slot);
  let killed = false;
  if (row && row.kills > ext.ownKills) {
    ext.killStreak += row.kills - ext.ownKills;
    ext.lastKillAt = v.tick;
    killed = true;
  }
  if (row) ext.ownKills = row.kills;
  const died = mem.wasDead;
  mem.wasDead = false;
  updateTilt(n, killed, died);
  socialTick(n, killed, died);
  return 'success';
}

/** Tilt decays by one stack per this many seconds alive without a new death. */
const TILT_DECAY_S = 120;

/** Tilt counter (applied to the params of the next decisions via withTilt in runTree); every change is logged. */
function updateTilt(n: NodeCtx, killed: boolean, died: boolean): void {
  const ext = n.mem.ext;
  const before = ext.tilt;
  let why = '';
  if (died) (ext.tilt = Math.min(MAX_TILT, ext.tilt + 1)), (why = 'died');
  else if (killed && ext.tilt > 0) (ext.tilt--, (why = 'got a kill'));
  else if (ext.tilt > 0 && n.v.tick - ext.tiltAt > TILT_DECAY_S * 30) (ext.tilt--, (why = 'calmed down'));
  if (ext.tilt === before) return;
  ext.tiltAt = n.v.tick;
  const drop = (n.ctx.params.behavior.tiltPerformanceDropPct * ext.tilt) / MAX_TILT;
  n.log('tilt', `tilt${ext.tilt}`, why, { stacks: ext.tilt }, { performanceDropPct: Math.round(drop) });
}

/**
 * Safety net ("bots keep playing"): the bot stood still for 4 s without attacking, recalling or ordering anything
 * -> shuffle (idle leaf) and log the branch that held it, so stuck leaves show up in the decision log.
 */
function watchdog(n: NodeCtx): void {
  const { v, mem } = n;
  const ext = mem.ext;
  const active = v.self.moving || v.self.atkPhase !== 0 || v.self.atkTarget >= 0 || v.me.recallLeft > 0 || v.me.inFountain || (v.me.teleportLeft ?? 0) > 0 || v.tick < mem.busyUntil;
  if (active || n.out.some((a) => a.cmd.t === 'move' || a.cmd.t === 'attack' || a.cmd.t === 'cast' || a.cmd.t === 'recall')) {
    ext.stillSince = -1;
    return;
  }
  if (ext.stillSince < 0) ext.stillSince = v.tick;
  if (v.tick - ext.stillSince < 120) return;
  const main = mem.bt.get('main')?.running ?? 'none';
  const sub = main === 'role' || main === 'combat' || main === 'survive' ? `/${mem.bt.get(main)?.running ?? ''}` : '';
  n.log('watchdog', 'shuffle', `still 4 s in ${main}${sub}`, { branch: `${main}${sub}` });
  mem.lastMove = null;
  brain.idle(n);
  ext.stillSince = -1;
}

/** One decision: perceive, tick the tree, return the commands. */
export function runTree(snap: Snapshot, ctx: BotStatic, mem: BotMemory, rng: Rng): BotAction[] {
  const me = snap.me;
  if (!me) return [];
  if (me.dead) {
    mem.wasDead = true;
    mem.mode = 'dead';
    mem.lastMove = null;
    mem.trail = [];
    mem.ext.trade = null;
    const lv = brain.levelUp(me, ctx);
    return lv ? [lv] : [];
  }
  const v = perceive(snap, ctx, mem, rng);
  if (!v) return [];
  // mem only with the §9 attention model (new brain): reaction penalty + no_flash_tracking episode in perception
  const pv = perceiveL(mem.ext.perception, snap, ctx, ctx.params, rng, attentionOn(mem) ? mem : undefined);
  attachTracks(v, pv.enemies);
  const n: NodeCtx = {
    snap,
    v,
    ctx,
    mem,
    rng,
    // §9 new brain (attention model running): tilt = longer distraction windows + aggression only
    p: mem.ext.tilt > 0 ? withTilt(ctx.params, mem.ext.tilt, attentionOn(mem) ? 'attention' : 'legacy') : ctx.params,
    pv,
    out: [],
    log(node, chosen, reason, inputs = {}, scores, err) {
      ctx.log.push({ tick: snap.tick, bot: ctx.slot, node, inputs, ...(scores ? { scores } : {}), chosen, reason, ...(err ? { injectedError: err } : {}), perceptionAgeMs: Math.round(pv.ageMs) });
      return snap.tick;
    },
  };
  botTree().tick(n);
  watchdog(n);
  // a move issued outside brain.moveTo (roam/gank/kite/ward walks) replaces the walk goal moveTo remembers: forget
  // it, or moveTo's throttle ("same goal, still moving") would leave the bot walking to the other leaf's point
  const lm = mem.lastMove;
  if (lm && n.out.some((a) => a.cmd.t === 'move' && !a.delay && (a.cmd.x !== lm.x || a.cmd.y !== lm.y))) mem.lastMove = null;
  return n.out;
}

