// Teamfights (docs/spec-bots.md §7 positioning, §8 joining).
//   Roles: carry stands behind the frontline at spacing range (Gold: carry_too_far, 150 too far forward), frontline
//   engages over ExchangeEstimate 5v5 6 s, assassin waits on a flank until the fight runs 2 s (aggression -5 waits
//   4 s, +5 jumps at once), support peels for the carry. Focus target: killProb x threat x reach (+0.3 focus ping).
//   Joining: arrival before the estimated fight end and exchange > fightJoinThreshold, after a rank latency
//   (Gold 5 s .. Challenger 2 s) x fightJoinLatencyMult; Challenger leaves hopeless fights.

import type { NodeCtx, NodeResult } from '../bt/types';
import { championData } from '../../sim/champions';
import type { SnapEntity } from './types';
import { dst } from './geo';
import { offensiveCast } from './combat';
import { estimateExchange, rankIdx } from '../bt/deps';
import { errorActive, rollErrorUntil } from '../errors';
import { attentionOn } from '../humanize/attention';
import { exchangeNoise } from '../exchange';
import { carrySpot, fightRole, focusScore, moveCmd, orbwalkAttack, peelSpot } from './kite';
import { decisionInterval, executes } from './trade';
import { focusSerial } from './social';
import { utilityOn } from '../utility/flag';
import { VALUES } from '../utility/values';
import { microOn } from '../combat/flag';
import { microPeel } from '../combat/peel';

/** Current teamfight focus target per bot (enemy serial), utility flag only. */
const focusOf = new WeakMap<object, number>();

const CHALLENGER = rankIdx('challenger');

function fightUnits(n: NodeCtx): { enemies: SnapEntity[]; allies: SnapEntity[] } {
  const enemies = n.v.enemies.filter((e) => dst(e, n.v.self) < 1600);
  const allies = n.v.allies.filter((a) => dst(a, n.v.self) < 1600);
  return { enemies, allies };
}

/** Teamfight: >= 2 enemies and >= 1 ally near, and somebody already in contact. */
export function teamfightNear(n: NodeCtx): boolean {
  const { enemies, allies } = fightUnits(n);
  if (enemies.length < 2 || allies.length < 1) return false;
  return enemies.some((e) => dst(e, n.v.self) < 900 || allies.some((a) => dst(a, e) < 800));
}

export function teamfight(n: NodeCtx): NodeResult {
  const { enemies } = fightUnits(n);
  if (!enemies.length) return 'failure';
  const st = n.mem.bt.get('_tf') ?? {};
  if (st.since === undefined || n.v.tick - (st.until ?? 0) > 60) {
    st.since = n.v.tick;
    st.err = {};
  }
  st.until = n.v.tick;
  n.mem.bt.set('_tf', st);
  const running = (n.v.tick - st.since!) / 30;
  const focus = focusSerial(n);
  // focus quality by rank: the score is read with an error (Iron +-60 %, Gold +-30 %, Challenger +-10 %), rolled
  // once per fight and enemy, so low ranks spread damage over the wrong targets while high ranks focus the kill
  const noise = 1.5 * exchangeNoise(n.ctx.params.skill);
  const err = (st.err ??= {});
  // §6.3 focus hysteresis (utility flag): switching away from the current focus costs focusHysteresis (no flicker)
  const prev = utilityOn(n.ctx) ? focusOf.get(n.mem) : undefined;
  const keep = (e: (typeof enemies)[number]): number => (prev !== undefined && e.serial === prev ? 1 + VALUES.combat.focusHysteresis : 1);
  const scored = (e: (typeof enemies)[number]): number => focusScore(n, e, focus) * (1 + (err[e.serial] ??= noise * (n.rng.next() * 2 - 1))) * keep(e);
  const t = enemies.reduce((a, e) => (scored(e) > scored(a) ? e : a));
  if (utilityOn(n.ctx)) {
    if (prev !== undefined && prev !== t.serial) n.log('teamfight', 'focus_switch', 'new focus beats the old one by more than the hysteresis', { target: t.slot });
    focusOf.set(n.mem, t.serial);
  }
  const role = fightRole(n);
  const ri = rankIdx(n.ctx.profile.rank);
  const ex = estimateExchange(n.v, n.ctx, t, 6, n.rng);
  if (running < 0.1) n.log('teamfight', role, 'teamfight', { target: t.slot, enemies: enemies.length }, { win: ex.winProb, focus: focusScore(n, t, focus) });
  n.mem.mode = 'fight';
  // classic: Challenger leaves hopeless fights; with the utility flag the commit rule (§6.3, utility/select.ts) decides
  if (!utilityOn(n.ctx) && ri >= CHALLENGER && ex.winProb < 0.2 && ex.deathProb > 0.6) {
    n.log('teamfight', 'leave', 'hopeless fight', {}, { win: ex.winProb });
    return 'failure';
  }
  const attack = (target: SnapEntity): NodeResult => {
    const cast = executes(n) ? offensiveCast(n.v, n.ctx, n.rng, target) : null;
    if (cast) n.out.push(cast);
    else orbwalkAttack(n, target, decisionInterval(n));
    return 'running';
  };
  const go = (p: { x: number; y: number }): NodeResult => {
    if (dst(n.v.self, p) > 120 && !(n.mem.lastMove && dst(n.mem.lastMove, p) < 100 && n.v.self.moving)) {
      n.out.push(moveCmd(p));
      n.mem.lastMove = { x: p.x, y: p.y, tick: n.v.tick };
    }
    return 'running';
  };
  switch (role) {
    case 'carry': {
      let tooFar = 0;
      if (st.on === undefined) {
        st.on = rollErrorUntil(n.mem, n.ctx, n.p, 'carry_too_far', n.v.tick, n.rng) >= 0;
        if (st.on) n.log('teamfight', 'position', 'stands 150 too far forward', {}, {}, 'carry_too_far');
      }
      // §9 new brain: the bot notices after the episode (errors.json durS) and steps back for the rest of the fight
      if (st.on && attentionOn(n.mem) && !errorActive(n.mem, 'carry_too_far', n.v.tick)) st.on = false;
      if (st.on) tooFar = 150;
      if (dst(n.v.self, t) <= n.v.reach + t.radius + 30) return attack(t);
      return go(carrySpot(n, enemies, t, tooFar));
    }
    case 'frontline': {
      const peel = microOn(n.ctx, 'peel') ? microPeel(n, enemies) : null; // A13: CC on whoever reaches the carry
      if (peel) return n.out.push(peel), 'running';
      if (ex.winProb > 0.5 || running > 1) return attack(enemies.reduce((a, e) => (dst(e, n.v.self) < dst(a, n.v.self) ? e : a)));
      return go(carrySpot(n, enemies, t, -100));
    }
    case 'assassin': {
      const wait = Math.max(0, 2 - 0.4 * n.p.playstyle.aggression);
      if (running < wait) {
        const flank = { x: t.x + (n.v.self.x - t.x) * 0.6 + (t.y - n.v.self.y) * 0.3, y: t.y + (n.v.self.y - t.y) * 0.6 - (t.x - n.v.self.x) * 0.3 };
        return go(flank);
      }
      const back = enemies.filter((e) => /mage|marksman/.test(championData(e.champ ?? '').archetype)).sort((a, b) => a.hp - b.hp)[0] ?? t;
      return attack(back);
    }
    case 'support': {
      const peelCast = microOn(n.ctx, 'peel') ? microPeel(n, enemies) : null;
      if (peelCast) return n.out.push(peelCast), 'running';
      const peel = peelSpot(n, enemies);
      const diver = enemies.find((e) => n.v.allies.some((a) => dst(a, e) < 400));
      if (diver && dst(diver, n.v.self) < 700) return attack(diver);
      return peel ? go(peel) : attack(t);
    }
  }
}

/** Latency before joining a fight: Gold 5 s .. Challenger 2 s (Iron..Silver 6-7 s) x fightJoinLatencyMult. */
export const joinLatencyS = (skill: number, mult: number): number => (skill <= 45 ? 7 - (2 * Math.max(0, skill - 5)) / 40 : 5 - (3 * (skill - 45)) / 55) * mult;

export function joinFight(n: NodeCtx): NodeResult {
  const v = n.v;
  const ext = n.mem.ext;
  let best: { a: SnapEntity; e: SnapEntity; d: number } | null = null;
  for (const a of v.allies) {
    const d = dst(a, v.self);
    if (d < 1300 || d > 5000) continue;
    const e = v.enemies.find((x) => dst(x, a) < 800);
    if (e && (!best || d < best.d)) best = { a, e, d };
  }
  const help = ext.pings.find((p) => p.kind === 'help' && p.until > v.tick);
  if (!best) {
    ext.joinSeenAt = -1;
    return 'failure';
  }
  const arrival = best.d / Math.max(200, v.me.stats.ms);
  const fightS = 8;
  const ex = estimateExchange(v, n.ctx, best.e, fightS, n.rng);
  const score = ex.winProb + (help && dst(help, best.a) < 1500 ? 0.15 : 0);
  const ri = rankIdx(n.ctx.profile.rank);
  // Silver and below run to fights they cannot reach in time (deliberately)
  if ((arrival > fightS && ri > rankIdx('silver')) || score < n.p.knobs.fightJoinThreshold) {
    ext.joinSeenAt = -1;
    return 'failure';
  }
  if (ext.joinSeenAt < 0) {
    ext.joinSeenAt = v.tick;
    n.log('joinFight', 'noticed', 'ally fighting', { ally: best.a.slot, dist: Math.round(best.d) }, { win: ex.winProb, arrival });
  }
  if (v.tick - ext.joinSeenAt < joinLatencyS(n.ctx.profile.skill, n.p.knobs.fightJoinLatencyMult) * 30) return 'failure';
  if (n.mem.ext.lastMode !== 'joinFight') n.log('joinFight', 'join', 'joining fight', { ally: best.a.slot }, { score });
  n.mem.ext.lastMode = 'joinFight';
  if (!(n.mem.lastMove && dst(n.mem.lastMove, best.e) < 300 && v.self.moving)) {
    n.out.push(moveCmd(best.e));
    n.mem.lastMove = { x: best.e.x, y: best.e.y, tick: v.tick };
  }
  return 'running';
}
