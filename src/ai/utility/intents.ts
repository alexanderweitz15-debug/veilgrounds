// Intent executors: the JSON subtrees of src/ai/utility/intents.json compiled against the tree's leaf registry plus
// the utility leaves below. The selector hands the chosen candidate's data (target, lane, roam evaluation ...) to the
// leaves through `intentData` for the duration of one subtree tick.

import intentsJson from './intents.json';
import { compile, type BtNode } from '../bt/runtime';
import { registry } from '../bt/leaves';
import type { NodeCtx, NodeDef, NodeResult, Registry } from '../bt/types';
import { castSlot } from '../bot/combat';
import { startTrade, tradeRunCore } from '../bot/trade';
import { laneLeaf } from '../bot/brain';
import { recall } from '../bot/macro';
import { near } from '../bot/perception';
import { cancelOrbwalk, moveCmd } from '../bot/kite';
import { VALUES } from './values';
import { dst } from '../bot/geo';
import { startRoam, type RoamEval } from '../roams/roam';
import { startGank, type GankEval } from '../ganks/jungle';
import type { IntentData, IntentId } from './types';

const current = new WeakMap<object, IntentData | undefined>();
/** Shove-before-recall episode per bot: first and latest tick the recall intent shoved. */
const shoving = new WeakMap<object, { from: number; last: number }>();
const dataOf = (n: NodeCtx): IntentData => current.get(n.mem) ?? {};

/** Keep the wave state on crash while an intent pushes (chooseWave keeps a state for 3 s; refreshed each decision). */
function crashWave(n: NodeCtx, reason: string): void {
  n.mem.ext.wave = { state: 'crash', at: n.v.tick, reason };
}

/** Poke: one damaging ability on the enemy champion (§4.3 / §5 harass-poke). */
function uPoke(n: NodeCtx): NodeResult {
  const d = dataOf(n);
  const t = d.target ? n.v.enemies.find((e) => e.id === d.target!.id) : undefined;
  if (!t || d.slot === undefined) return 'failure';
  const a = castSlot(n.v, n.ctx, n.rng, t, d.slot);
  if (!a) return 'failure';
  n.out.push(a);
  n.log('poke', `cast${d.slot}`, 'utility: poke', { target: t.slot });
  return 'success';
}

/** Trade / all-in: continue the running one, or start it on the candidate's target (§6.1). */
function uTrade(n: NodeCtx): NodeResult {
  if (n.mem.ext.trade) return tradeRunCore(n);
  const d = dataOf(n);
  const t = d.target ? n.v.enemies.find((e) => e.id === d.target!.id) : undefined;
  if (!t || !d.ex || !d.exK) return 'failure';
  return startTrade(n, t, d.kind ?? 'trade', d.trigger ?? 'value', d.ex, d.exK, 0);
}

/** Push / plates: crash the wave and hit the structure (laning leaf in crash state, §7.1). */
function uPush(n: NodeCtx): NodeResult {
  const d = dataOf(n);
  if (d.lane) n.mem.ext.laneOverride = d.lane; // jungler plate after a gank: play that lane
  crashWave(n, 'utility: push');
  return laneLeaf(n);
}

const uRoam = (n: NodeCtx): NodeResult => startRoam(n, dataOf(n).roam as RoamEval | undefined);
const uGank = (n: NodeCtx): NodeResult => startGank(n, dataOf(n).gank as GankEval | undefined);

/** Recall: Silver+ shove the wave first (§4.6 shove-and-recall), then recall (walk home when unsafe). */
function uRecall(n: NodeCtx): NodeResult {
  const d = dataOf(n);
  // home already (fountain area): nothing to recall for; the fountain leaf shops, then the next intent plays
  if (dst(n.v.self, n.ctx.map.sides[n.ctx.team].fountain) < VALUES.recall.homeRange) {
    if (n.mem.mode === 'recall' || n.mem.mode === 'home') n.mem.mode = 'lane';
    return 'failure';
  }
  // shove-first is capped (§4.6: the wave should crash "in the next 20 s"): after recall.shoveMaxS of shoving the
  // bot recalls on the wave it has (a wave that does not crash would otherwise keep it in lane forever)
  const sh = shoving.get(n.mem);
  const t = n.v.tick;
  if (!sh || t - sh.last > VALUES.recall.shoveGapTicks) shoving.set(n.mem, { from: t, last: t });
  else sh.last = t;
  const shovedS = (t - shoving.get(n.mem)!.from) / 30;
  if (d.shoveFirst && shovedS > VALUES.recall.shoveMaxS) n.log('recall', 'shove_timeout', 'wave did not crash in time: recall now', { shovedS: Math.round(shovedS) });
  if (d.shoveFirst && shovedS <= VALUES.recall.shoveMaxS) {
    crashWave(n, 'utility: shove before recall');
    let r = laneLeaf(n);
    if (r === 'failure' && n.v.self.atkPhase === 0) {
      // the laning leaf waits for last hits out of reach: walk up and hit the closest enemy lane minion instead
      const m = d.target ?? n.v.enemyMinions.slice().sort((a, b) => dst(a, n.v.self) - dst(b, n.v.self))[0];
      if (m && dst(m, n.v.self) < VALUES.lane.farmRadius) {
        n.out.push({ cmd: { t: 'attack', target: m.id } });
        n.mem.lastMove = null;
        r = 'running';
      }
    }
    n.log('recall', 'shove_first', r === 'failure' ? 'nothing to shove: recall' : 'crash the wave before recalling', { lane: n.ctx.lane ?? '' });
    if (r !== 'failure') return r;
  }
  // a camp still hitting the bot breaks the channel: walk off first (the classic recall leaf checks champions and
  // minions only)
  if (near(n.v.monsters, n.v.self, VALUES.recall.monsterClearRange).some((m) => m.atkTarget === n.v.self.id)) {
    cancelOrbwalk(n);
    n.mem.mode = 'home';
    n.out.push(moveCmd(n.ctx.map.sides[n.ctx.team].fountain));
    return 'running';
  }
  return recall(n);
}

/** Group / siege / defend: play the desire's lane (side effect only; the lane leaf executes). */
function uGroup(n: NodeCtx): NodeResult {
  const d = dataOf(n);
  if (!d.lane) return 'success';
  n.mem.ext.laneOverride = d.lane;
  n.mem.ext.splitting = d.desire === 'split_push';
  if (d.crash) crashWave(n, `utility: ${d.desire ?? 'group'}`);
  return 'failure';
}

/** Fight join by Teleport (top laner's unlocked TP, B4): channel onto the chosen own unit near the fight. */
function uTeleportJoin(n: NodeCtx): NodeResult {
  const tp = dataOf(n).tp;
  if (!tp || (n.v.me.teleportLeft ?? 0) > 0) return 'failure';
  n.out.push({ cmd: { t: 'spell', slot: tp.slot, x: tp.x, y: tp.y, target: tp.id } });
  n.mem.lastMove = null;
  n.mem.busyFrom = n.v.tick;
  n.mem.busyUntil = n.v.tick + Math.round(VALUES.teleport.channelS * 30) + 2;
  n.mem.busySlot = -1;
  n.log('joinFight', 'teleport', 'teleport into the fight', { landSrc: 'ally', landX: Math.round(tp.x), landY: Math.round(tp.y) });
  return 'running';
}

/** Jungler catches an abandoned wave (§4.6): play that lane meanwhile. */
function uCatchLane(n: NodeCtx): NodeResult {
  const d = dataOf(n);
  if (!d.lane) return 'failure';
  n.mem.ext.laneOverride = d.lane;
  return 'success';
}

let compiled: Partial<Record<IntentId | 'none', BtNode>> | null = null;

function trees(): Partial<Record<IntentId | 'none', BtNode>> {
  if (compiled) return compiled;
  const base = registry();
  const reg: Registry = { ...base, actions: { ...base.actions, uPoke, uTrade, uPush, uRoam, uGank, uRecall, uGroup, uCatchLane, uTeleportJoin } };
  const out: Partial<Record<IntentId | 'none', BtNode>> = {};
  for (const [id, def] of Object.entries(intentsJson.intents)) out[id as IntentId] = compile(def as NodeDef, reg, new Set(), `u.${id}`);
  return (compiled = out);
}

/** Run the subtree of an intent with its candidate data. */
export function runIntent(n: NodeCtx, id: IntentId | 'none', data: IntentData | undefined): NodeResult {
  const t = trees()[id];
  if (!t) return 'failure';
  current.set(n.mem, data);
  try {
    return t.tick(n);
  } finally {
    current.delete(n.mem);
  }
}
