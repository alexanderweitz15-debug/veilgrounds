// §5.2 reaction to an enemy roam. Trigger: the lane opponent vanishes from near range (perceived before, not seen
// for 2 s, alive) or an ally pings "missing" on it.
//   1 own missing ping: Iron never, Silver after 10 s, Gold 5 s, Diamond+ at once with a direction ping (unless
//     the enemy's wave runs into the own tower: probably a recall)
//   2 the cloud (perception) already weighs mid-roam / side-roam / recall / invade
//   3 per role: mid follows (way < 8 s, HP > 60 %, direction known; team axis) or punishes (crash wave, plates; farm
//     axis; Gold+ default when unclear), Iron/Bronze only ping; side laners get the GankRisk rise from perception
//     (Gold ignores missing pings 40 %, there); jungler counter-ganks toward an own lane or invades; support vs a
//     roaming support crashes the wave (Gold+) and wards the river.

import type { NodeCtx, NodeResult } from '../bt/types';
import type { Pt } from '../../sim/map';
import { dst } from '../bot/geo';
import { isMinion } from '../../sim/types';
import { atLeast, missingPingDelayS } from '../perception/rankModel';
import { frontTower, laneOf } from '../perception/waves';
import { logTrack, trackPos } from '../perception/logInputs';
import type { BotPerception, TrackMem } from '../perception/types';
import { canWard, laneEnemies, log, lv, move, ownMs, pathTo, ping, tac, type Inputs } from '../ganks/common';

interface MissState {
  /** slot -> tick the opponent went missing; pinged flag. */
  missing: Map<number, { since: number; pinged: boolean; reaction: string | null; until: number }>;
}

/** Lane opponents currently missing (perceived in near range before, now unseen >= 2 s, alive). */
export function missingOpponents(n: NodeCtx, pv: BotPerception): TrackMem[] {
  const tick = n.snap.tick;
  // junglers watch the usual roamers (mid, support); laners their own lane opponents
  const opp = n.ctx.role === 'jungle' ? [...pv.enemies.values()].filter((t) => t.role === 'mid' || t.role === 'support') : n.ctx.lane ? laneEnemies(pv, n.ctx.lane) : [];
  // "vanished from near range": seen close to the bot shortly before, now unseen for 4 s (or pinged missing)
  const self = pv.self;
  return opp.filter((t) => t.known && !t.dead && !t.visibleNow && ((tick - t.lastTick >= 120 && tick - t.lastTick < 60 * 30 && !!self && Math.hypot(t.lastX - self.x, t.lastY - self.y) < 2500) || t.missingPingTick >= t.lastTick));
}

export function enemyRoamReaction(n: NodeCtx): NodeResult {
  const pv = lv(n);
  if (!pv?.self) return 'failure';
  const st = tac<MissState>(pv, 'missing', () => ({ missing: new Map() }));
  const tick = n.snap.tick;
  const gone = missingOpponents(n, pv);
  for (const s of [...st.missing.keys()]) if (!gone.some((t) => t.slot === s)) st.missing.delete(s);
  if (!gone.length) return 'failure';
  let result: NodeResult = 'failure';
  for (const t of gone) {
    let m = st.missing.get(t.slot);
    if (!m) st.missing.set(t.slot, (m = { since: t.lastTick, pinged: false, reaction: null, until: 0 }));
    const inputs: Inputs = { slot: t.slot, role: t.role, missingS: +((tick - m.since) / 30).toFixed(1) };
    logTrack(inputs, 'enemy', t);
    // 1: own missing ping
    const delay = missingPingDelayS(n.p);
    const lane = n.ctx.lane;
    const ownWave = lane ? pv.waves[lane] : null;
    const likelyRecall = !!ownWave?.atOwnTower && !ownWave.enemySide; // enemy wave runs into the own tower
    if (lane && !m.pinged && Number.isFinite(delay) && (tick - m.since) / 30 >= delay && !likelyRecall) {
      m.pinged = true;
      // Diamond+: direction ping (last position + last direction); others ping the lane spot
      const pos = trackPos(t);
      const p: Pt = atLeast(n.p, 'diamond') && pos ? { x: pos.x + t.dirX * 800, y: pos.y + t.dirY * 800 } : pv.self;
      if (ping(n, pv, 'missing', p, true)) log(n, pv, 'enemyRoam', 'pingMissing', `missing for ${((tick - m.since) / 30).toFixed(1)} s`, inputs);
    }
    // 3: role reaction (decided once per disappearance, executed for a limited time while it makes progress)
    if (m.reaction === null) {
      m.reaction = decide(n, pv, t, inputs);
      m.until = tick + (m.reaction === 'follow' ? 10 : m.reaction === 'punish' || m.reaction === 'crash' ? 15 : 20) * 30;
    }
    if (tick > m.until) m.reaction = 'done';
    const r = m.reaction;
    let progress = false;
    if (r === 'follow') {
      const pos = trackPos(t);
      progress = !!pos && move(n, pv, pos);
    } else if (r === 'punish' || r === 'crash') {
      // crash the wave: attack-move onto the visible enemy wave, or the tower once the own wave sits under it
      const w = lane ? pv.waves[lane] : null;
      const front = lane ? waveFront(n, pv) : null;
      const tw = lane ? frontTower(n.ctx.map, n.snap, 1 - n.ctx.team, lane) : null;
      const goal = front ?? (w?.crashed && tw ? tw : null);
      if (goal) {
        n.out.push({ cmd: { t: 'attackMove', x: Math.round(goal.x), y: Math.round(goal.y) } });
        progress = true;
      }
      if (r === 'crash' && canWard(n) && tac(pv, 'riverWardAt', () => -1e9) < tick - 60 * 30) {
        pv.mem.tactics.riverWardAt = tick;
        const river = riverPoint(n, pv);
        n.out.push({ cmd: { t: 'ward', x: Math.round(river.x), y: Math.round(river.y) } });
      }
    } else if (r === 'counterGank' || r === 'invade') {
      const goal = r === 'invade' ? invadeCamp(n, pv) : laneTargetOf(n, pv, t);
      progress = !!goal && move(n, pv, goal);
    }
    // arrived / nothing to do: done for this disappearance, fall through to laning
    if (!progress && r !== 'none' && r !== 'done') m.reaction = 'done';
    if (progress) result = 'running';
  }
  return result;
}

function decide(n: NodeCtx, pv: BotPerception, t: TrackMem, inputs: Inputs): string {
  const self = pv.self!;
  const role = n.ctx.role;
  const hp = self.maxHp > 0 ? self.hp / self.maxHp : 0;
  let chosen = 'none';
  let reason = '';
  if (role === 'mid' && t.role === 'mid') {
    const pos = trackPos(t);
    const dirKnown = (t.dirX !== 0 || t.dirY !== 0) && n.snap.tick - t.lastTick < 3 * 30;
    const eta = pos ? pathTo(n, self, pos).length / ownMs(n) : Infinity;
    const teamBias = n.p.playstyle.teamplay - n.p.playstyle.farmPriority; // team -> follow, farm -> punish
    if (!atLeast(n.p, 'silver')) (chosen = 'none'), (reason = 'Iron/Bronze: ping only');
    else if (atLeast(n.p, 'challenger') && !dirKnown) (chosen = 'punish'), (reason = 'Challenger: direction unsure -> punish');
    else if (eta < 8 && hp > 0.6 && dirKnown && teamBias >= -2) (chosen = 'follow'), (reason = `follow (eta ${eta.toFixed(1)} s)`);
    else if (atLeast(n.p, 'gold') || teamBias < 0) (chosen = 'punish'), (reason = 'way too long / side unclear -> punish');
    else (chosen = 'follow'), (reason = 'Silver follows');
  } else if (role === 'jungle') {
    const lane = t.cloud ? laneOf(n.ctx.map, n.ctx.team, t.cloud) : null;
    if (lane) (chosen = 'counterGank'), (reason = `roam toward own ${lane}`);
    else if (n.p.playstyle.objectiveRisk >= 0) (chosen = 'invade'), (reason = 'roam away: invade free camps');
  } else if (role === 'support' && t.role === 'support') {
    if (atLeast(n.p, 'gold')) (chosen = 'crash'), (reason = '2v1 in lane: crash, plates, river vision');
  } else {
    chosen = 'none';
    reason = 'side laner: GankRisk rises (perception), laningSafety reacts';
  }
  log(n, pv, 'enemyRoam', chosen, reason, inputs);
  return chosen;
}

/** River point between the bot's lane and mid (support vision). */
function riverPoint(n: NodeCtx, pv: BotPerception): Pt {
  const s = n.ctx.map.size;
  const self = pv.self!;
  // project onto the river anti-diagonal x + y = size, 1500 toward the map centre
  const k = (self.x + self.y - s) / 2;
  const p = { x: self.x - k, y: self.y - k };
  const c = { x: s / 2, y: s / 2 };
  const d = dst(p, c) || 1;
  return { x: p.x + ((c.x - p.x) / d) * 1500, y: p.y + ((c.y - p.y) / d) * 1500 };
}

function laneTargetOf(n: NodeCtx, pv: BotPerception, t: TrackMem): Pt | null {
  const pos = trackPos(t);
  if (!pos) return null;
  // meet the roamer at its predicted lane: the own laner there
  const lane = laneOf(n.ctx.map, n.ctx.team, pos);
  const ally = lane ? pv.allies.find((a) => laneOf(n.ctx.map, n.ctx.team, a) === lane) : undefined;
  return ally ?? pos;
}

function invadeCamp(n: NodeCtx, pv: BotPerception): Pt | null {
  const enemy = (1 - n.ctx.team) as 0 | 1;
  const camps = n.ctx.map.sides[enemy].camps.filter((c) => {
    const k = pv.mem.campKilled.get(`${enemy}:${c.id}`);
    return k === undefined || n.snap.tick - k > 135 * 30;
  });
  return camps.sort((a, b) => dst(a, pv.self!) - dst(b, pv.self!))[0] ?? null;
}

/** Nearest visible enemy lane minion to the bot (the wave to crash), or null. */
function waveFront(n: NodeCtx, pv: BotPerception): Pt | null {
  let best: Pt | null = null;
  let bd = 2000;
  for (const e of n.snap.entities) {
    if (!e.alive || e.team === n.ctx.team || !isMinion(e.kind)) continue;
    const d = dst(e, pv.self!);
    if (d < bd) (bd = d), (best = e);
  }
  return best;
}
