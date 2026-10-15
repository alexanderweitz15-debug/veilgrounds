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
import { diveDefence, disengage, tradeRun, tradeStart, tradeWindowScore } from '../bot/trade';
import { holdTrades, followUp, pingRetreat, pingsIn, socialTick } from '../bot/social';
import { joinFight, teamfight, teamfightNear } from '../bot/teamfight';
import { hasObjectiveDesire, idleAfterShove, objective, recall, recallScore, splitPush, vision } from '../bot/macro';
import { dst } from '../bot/geo';

import { escape } from '../ganks/escape';
import { gankRiskReaction } from '../ganks/risk';
import { counterGank, jungleGank } from '../ganks/jungle';
import { roam } from '../roams/roam';
import { enemyRoamReaction } from '../roams/enemyRoam';

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
    recallChannel: brain.recallChannel,
    fountain: brain.fountain,
    escape,
    pingRetreat,
    diveDefence,
    retreat: brain.retreat,
    dodge: brain.dodge,
    peel: brain.peel,
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
  socialTick(n, killed, died);
  return 'success';
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
  const pv = perceiveL(mem.ext.perception, snap, ctx, ctx.params, rng);
  attachTracks(v, pv.enemies);
  const n: NodeCtx = {
    snap,
    v,
    ctx,
    mem,
    rng,
    p: ctx.params,
    pv,
    out: [],
    log(node, chosen, reason, inputs = {}, scores, err) {
      ctx.log.push({ tick: snap.tick, bot: ctx.slot, node, inputs, ...(scores ? { scores } : {}), chosen, reason, ...(err ? { injectedError: err } : {}), perceptionAgeMs: Math.round(pv.ageMs) });
      return snap.tick;
    },
  };
  botTree().tick(n);
  watchdog(n);
  return n.out;
}

