// Player interaction (docs/spec-bots.md §9): reactions to team pings (player and bots), own pings (rank rate
// Iron 10 % .. Diamond+ 90 % of the moments that call for one), follow-up on player engages within 800, chat lines
// (src/data/bots/chat.json via chatLine) that reference the decision-log tick.

import type { PingKind } from '../../sim/types';
import { Kind } from '../../sim/types';
import type { NodeCtx, NodeResult } from '../bt/types';
import type { SnapEntity } from './types';
import { chatLine } from '../humanize/names';
import { dst, unit } from './geo';
import { estimateExchange, rankIdx } from '../bt/deps';
import { OBJECTIVES } from './teamai';
import { cancelOrbwalk, moveCmd, orbwalkAttack } from './kite';
import { castSlot } from './combat';
import { decisionInterval } from './trade';

const SILVER = rankIdx('silver');
const DIAMOND = rankIdx('diamond');
const CHALLENGER = rankIdx('challenger');

/** Chance that the bot pings when a situation calls for it: Iron 10 % .. Diamond+ 90 %. */
export const pingChance = (skill: number): number => Math.max(0.1, Math.min(0.9, 0.1 + (0.8 * (skill - 5)) / 75));

/** Emit a team ping (rank rate, 4 s own throttle); logged with the reason. */
export function emitPing(n: NodeCtx, kind: PingKind, x: number, y: number, target: number | undefined, reason: string, src: { src: 'seen' | 'self' | 'ally' | 'static'; slot?: number } = { src: 'self' }): boolean {
  if (n.v.tick - n.mem.ext.pingAt < 4 * 30 || !n.rng.chance(pingChance(n.ctx.profile.skill))) return false;
  n.mem.ext.pingAt = n.v.tick;
  n.out.push({ cmd: { t: 'ping', kind, x, y, ...(target !== undefined && target >= 0 ? { target } : {}) } });
  n.log('ping', kind, reason, { pingX: Math.round(x), pingY: Math.round(y), pingSrc: src.src, ...(src.slot !== undefined ? { pingSlot: src.slot } : {}) });
  return true;
}

/** Team chat line of a category (rank band), at most one per 45 s; refers to the log entry it explains. */
export function say(n: NodeCtx, cat: string, reason: string, vars: Record<string, string> = {}): void {
  if (n.v.tick - n.mem.ext.chatAt < 45 * 30) return;
  const text = chatLine(n.rng, cat, n.ctx.profile.rank, true, vars);
  if (!text) return;
  n.mem.ext.chatAt = n.v.tick;
  const ref = n.log('chat', cat, reason, { text });
  n.out.push({ cmd: { t: 'chat', text, ref } });
}

const humanSlots = (n: NodeCtx): Set<number> => new Set(n.ctx.players.filter((p) => p.isHuman).map((p) => p.slot));

/** Housekeeping: take in team pings since the last decision and react (obedience by team axis and rank). */
export function pingsIn(n: NodeCtx): NodeResult {
  const ext = n.mem.ext;
  ext.pings = ext.pings.filter((p) => p.until > n.v.tick);
  if (!n.snap.me || n.snap.me.dead) return 'success';
  const ri = rankIdx(n.ctx.profile.rank);
  const humans = humanSlots(n);
  for (const ev of n.snap.events) {
    if (ev.e !== 'ping' || ev.team !== n.ctx.team || ev.slot === n.ctx.slot) continue;
    // Iron ignores 60 % of pings; everyone else obeys by the team axis (pingObedience 0.3 .. 0.95)
    const obey = n.p.knobs.pingObedience * (ri === 0 ? 0.4 : 1);
    const fromPlayer = humans.has(ev.slot);
    const heed = n.rng.chance(obey);
    const near = dst(ev, n.v.self);
    n.log('pingIn', heed ? ev.kind : 'ignore', `${fromPlayer ? 'player' : 'bot'} ping`, { kind: ev.kind, from: ev.slot, dist: Math.round(near) }, { obedience: obey });
    if (!heed) continue;
    const memo = { kind: ev.kind, x: ev.x, y: ev.y, target: ev.target, slot: ev.slot, until: n.v.tick + 10 * 30 };
    switch (ev.kind) {
      case 'danger':
      case 'back': {
        if (near > 2500) break;
        const reason = n.v.enemies.some((e) => dst(e, ev) < 1500);
        // Challenger checks the call: nothing visible and low gank risk -> "all ok" counter ping
        const risk = n.ctx.lane ? n.pv.gankRisk[n.ctx.lane] ?? 0 : 0;
        if (ri >= CHALLENGER && !reason && risk < 0.3) {
          emitPing(n, 'ok', n.v.self.x, n.v.self.y, undefined, 'danger ping without visible reason');
          break;
        }
        ext.pings.push({ ...memo, until: n.v.tick + 6 * 30 });
        break;
      }
      case 'onMyWay':
        if (near < 3000) {
          ext.pings.push({ ...memo, until: n.v.tick + 15 * 30 });
          ext.wave = { state: 'hold', at: n.v.tick, reason: 'ally on the way' };
        }
        break;
      case 'missing':
        ext.pings.push({ ...memo, until: n.v.tick + 20 * 30 });
        break;
      case 'help':
        if (near < 5000) ext.pings.push({ ...memo, until: n.v.tick + 10 * 30 });
        break;
      case 'objective': {
        const o = OBJECTIVES.find((x) => dst(n.ctx.map.objectives[x], ev) < 1500);
        if (o) n.ctx.teamAI.objectivePing = { obj: o, until: n.v.tick + 30 * 30 };
        break;
      }
      case 'focus': {
        const t = n.snap.entities.find((e) => e.id === ev.target && e.kind === Kind.Champion);
        if (t) ext.pings.push({ ...memo, target: t.serial, until: n.v.tick + 8 * 30 });
        break;
      }
      case 'group':
        n.ctx.teamAI.groupPingUntil = n.v.tick + 60 * 30;
        break;
      default:
        break;
    }
  }
  return 'success';
}

/** Serial of the enemy a teammate asked to focus (or -1). */
export const focusSerial = (n: NodeCtx): number => n.mem.ext.pings.find((p) => p.kind === 'focus' && p.until > n.v.tick)?.target ?? -1;

/** Danger/back ping obeyed: leave the zone for a few seconds. */
export function pingRetreat(n: NodeCtx): NodeResult {
  const p = n.mem.ext.pings.find((x) => (x.kind === 'danger' || x.kind === 'back') && x.until > n.v.tick && dst(x, n.v.self) < 1800);
  if (!p) return 'failure';
  const [ux, uy] = unit(p, n.v.self);
  const to = { x: n.v.self.x + ux * 600, y: n.v.self.y + uy * 600 };
  if (n.mem.ext.lastMode !== 'pingRetreat') n.log('pingRetreat', 'leave', `${p.kind} ping`, { from: p.slot });
  n.mem.ext.lastMode = 'pingRetreat';
  cancelOrbwalk(n);
  n.mem.ext.trade = null;
  n.out.push(moveCmd(to));
  n.mem.lastMove = { ...to, tick: n.v.tick };
  return 'running';
}

/** On-my-way ping from an ally to this lane: no trades before the ally arrives. */
export const holdTrades = (n: NodeCtx): boolean => n.mem.ext.pings.some((p) => p.kind === 'onMyWay' && p.until > n.v.tick && dst(p, n.v.self) < 2500);

/**
 * Follow-up on a player engage (§9): the human ally casts / dashes into an enemy within 800 of the bot -> the bot
 * re-evaluates with the player's contribution and follows above fightJoinThreshold. Iron follows 50 % at random;
 * Challenger follows every good engage and pings "back" before a bad one.
 */
export function followUp(n: NodeCtx): NodeResult {
  const ext = n.mem.ext;
  const v = n.v;
  if (ext.followUntil > v.tick) {
    const t = v.enemies.find((e) => e.id === ext.followTarget);
    if (!t) {
      ext.followUntil = 0;
      return 'failure';
    }
    for (const s of [0, 1, 2, 3] as const) {
      const a = castSlot(v, n.ctx, n.rng, t, s);
      if (a && (s !== 3 || t.hp / t.maxHp < 0.5)) {
        n.out.push(a);
        return 'running';
      }
    }
    orbwalkAttack(n, t, decisionInterval(n));
    return 'running';
  }
  const humans = humanSlots(n);
  if (!humans.size) return 'failure';
  for (const ev of n.snap.events) {
    if (ev.e !== 'cast') continue;
    const pl = v.allies.find((a) => a.id === ev.src && humans.has(a.slot));
    if (!pl || dst(pl, v.self) > 800) continue;
    const target = v.enemies.filter((e) => dst(e, ev) < 300 || dst(e, pl) < 350).sort((a, b) => dst(a, ev) - dst(b, ev))[0];
    if (!target) continue;
    const ex = estimateExchange(v, n.ctx, target, 6, n.rng, { extraAllyDps: 60 });
    const ri = rankIdx(n.ctx.profile.rank);
    const good = ex.winProb > n.p.knobs.fightJoinThreshold;
    const follow = ri === 0 ? n.rng.chance(0.5) : good;
    n.log('followUp', follow ? 'follow' : 'stay', 'player engage', { target: target.slot }, { win: ex.winProb, threshold: n.p.knobs.fightJoinThreshold });
    if (!follow) {
      if (ri >= CHALLENGER) emitPing(n, 'back', pl.x, pl.y, undefined, 'bad player engage', { src: 'ally' });
      continue;
    }
    ext.followUntil = v.tick + 5 * 30;
    ext.followTarget = target.id;
    return 'running';
  }
  return 'failure';
}

/** Situational own pings/chat (danger on a seen jungler near the own lane, kills, deaths). */
export function socialTick(n: NodeCtx, killed: boolean, died: boolean): void {
  const ri = rankIdx(n.ctx.profile.rank);
  if (killed) say(n, ri >= DIAMOND ? 'plan' : 'kill', 'kill');
  if (died) say(n, ri <= SILVER ? 'flame' : 'death', 'died');
  ragePings(n);
  const jg = n.ctx.players.find((p) => p.team !== n.ctx.team && p.role === 'jungle');
  const e: SnapEntity | undefined = jg ? n.v.enemies.find((x) => x.slot === jg.slot) : undefined;
  if (e && n.ctx.lane && ri >= SILVER) {
    const lanePts = n.ctx.map.sides[n.ctx.team].lanes[n.ctx.lane];
    if (Math.min(...lanePts.map((q) => dst(q, e))) < 2000 && n.mem.ext.pingAt < n.v.tick - 15 * 30) emitPing(n, 'danger', e.x, e.y, e.id, 'enemy jungler near own lane', { src: 'seen', slot: e.slot });
  }
}

/**
 * Rage (user request): allies spam "?" on the human player's position when the player plays badly - dies,
 * especially repeatedly. Low ranks rage more; high ranks rarely. Off when toxicity is disabled.
 */
function ragePings(n: NodeCtx): void {
  if (!n.ctx.toxic) return;
  const ext = n.mem.ext;
  const humans = humanSlots(n);
  for (const ev of n.snap.events) {
    if (ev.e !== 'death' || ev.kind !== Kind.Champion || ev.team !== n.ctx.team) continue;
    const victim = n.snap.entities.find((e) => e.id === ev.eid);
    if (!victim || !humans.has(victim.slot)) continue;
    ext.rageDeaths = ext.rageDeaths.filter((t) => n.v.tick - t < 300 * 30);
    ext.rageDeaths.push(n.v.tick);
    if (n.v.tick - ext.rageAt < 20 * 30) continue; // one burst per bot per 20 s
    const ri = rankIdx(n.ctx.profile.rank);
    // base chance by rank band, more after repeated deaths (feeding)
    const base = ri <= SILVER ? 0.45 : ri < DIAMOND ? 0.25 : 0.1;
    const chance = Math.min(0.95, base * ext.rageDeaths.length);
    if (!n.rng.chance(chance)) continue;
    ext.rageAt = n.v.tick;
    const count = Math.min(4, 1 + Math.floor(n.rng.next() * ext.rageDeaths.length * (ri <= SILVER ? 2 : 1)));
    for (let i = 0; i < count; i++) n.out.push({ cmd: { t: 'ping', kind: 'question', x: ev.x, y: ev.y }, delay: i * 6 + n.rng.int(4) });
    n.log('rage', `?x${count}`, 'human ally died', { deaths: ext.rageDeaths.length, pingX: Math.round(ev.x), pingY: Math.round(ev.y), pingSrc: 'ally', pingSlot: victim.slot });
  }
}
