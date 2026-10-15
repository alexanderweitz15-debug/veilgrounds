// §4.2 "Als Gegankter: Gank läuft" -- escape leaf. Trigger: the enemy jungler / a roaming laner noticed in near
// range, or a heard cast from a bush near the bot. Steps (each decision while the episode runs):
//   1 assess (enemies, their known CC, own HP, tower distance, Flash, own jungler ETA, wave)
//   2 fight or flight: ExchangeEstimate (own jungler within 8 s counts) > knobs.escapeFightThreshold -> fight
//     (returns 'failure' so the tree's fight branch takes over); Iron-Silver flip a coin
//   3 route: path to an own tower / jungle point with the minimal ThreatMap integral; jukes every 0.4-0.8 s
//     against skillshot users (Gold+; Challenger right after a seen cast wind-up)
//   4 resources: Ghost / dashes before Flash; Flash only when (a) a CC cast starts that would hit, or (b) the safe
//     point is not reachable in time, or danger >= knobs.flashDangerThreshold (resourceUse +5: 0.5, -5: never).
//     Iron/Bronze cannot read wind-ups: they flash late (after the CC, errors.ts flash_wrong_direction) or into
//     terrain (flash_into_wall); Diamond+ flash over a wall when that beats the walking path.
//   5 Heal / own shield / Zeitglas at HP < 35 % under burst (Zeitglas Platinum+, ally within 6 s)
//   6 tower as a weapon: under the own tower with tower aggro on a chaser -> turn (fight)
//   7 pings: "danger" at first contact, "help" when fighting (rank ping chance)
// After the gank: survived -> tactics.recallReeval; died -> tactics.tilt +1 and (Gold+) missing ping on the jungler.

import type { NodeCtx, NodeResult } from '../bt/types';
import type { Pt } from '../../sim/map';
import { lineWalkable, walkable } from '../../sim/map';
import { Kind, type Command } from '../../sim/types';
import type { SnapEntity } from '../../sim/snapshot';
import type { ErrorId } from '../contract';
import { dst } from '../bot/geo';
import { maybeInject } from '../errors';
import { estimateExchange } from '../bt/deps';
import { sampleReactionMs } from '../profiles';
import { NEAR_RANGE, isCC } from '../perception/perceive';
import { atLeast, coinFlipFights } from '../perception/rankModel';
import { pathThreat } from '../perception/threat';
import { logTrack, trackPos } from '../perception/logInputs';
import type { BotPerception, TrackMem } from '../perception/types';
import { champOf, dpsOf, hpFrac, laneOfRole, log, lv, move, ownMs, pathTo, ping, readySummoner, tac, type Inputs } from './common';

const FLASH_RANGE = 400;
const BUSH_AUDIO_R = 900;

export interface EscapeState {
  active: boolean;
  since: number;
  mode: 'escape' | 'fight';
  route: Pt[] | null;
  routeAt: number;
  goal: Pt | null;
  nextJuke: number;
  jukeSide: number;
  ccHit: boolean;
  lateFlashRolled: boolean;
  threats: number;
  pingedDanger: boolean;
  /** Own scoreboard deaths at episode start (the tree does not tick while dead). */
  deaths: number;
}

const newState = (): EscapeState => ({ active: false, since: 0, mode: 'escape', route: null, routeAt: -1e9, goal: null, nextJuke: 0, jukeSide: 1, ccHit: false, lateFlashRolled: false, threats: 0, pingedDanger: false, deaths: 0 });

/** Enemy champions that make this a gank for the bot (not its own lane opponents). */
export function gankers(n: NodeCtx, pv: BotPerception): { e: SnapEntity; t: TrackMem }[] {
  const myLane = laneOfRole(n.ctx.role);
  const out: { e: SnapEntity; t: TrackMem }[] = [];
  if (!pv.self) return out;
  for (const e of pv.visibleEnemies) {
    if (dst(e, pv.self) > NEAR_RANGE) continue;
    const t = pv.enemies.get(e.slot);
    if (!t) continue;
    out.push({ e, t });
  }
  if (n.ctx.role === 'jungle') return out.length >= 2 ? out : [];
  // the lane opponent(s) alone are laning, not a gank
  return out.some(({ t }) => laneOfRole(t.role) !== myLane) ? out : [];
}

/** Escape trigger (condition leaf). */
export function gankIncoming(n: NodeCtx): boolean {
  const pv = lv(n);
  if (!pv?.self) return false;
  if (gankers(n, pv).length) return true;
  return bushAudio(n, pv) !== null;
}

function bushAudio(n: NodeCtx, pv: BotPerception): Pt | null {
  if (!pv.self) return null;
  for (const a of pv.audio) {
    if (dst(a, pv.self) > BUSH_AUDIO_R) continue;
    if (n.ctx.map.bushes.some((b) => dst(b, a) < b.r + 200)) return a;
  }
  return null;
}

export function escape(n: NodeCtx): NodeResult {
  const pv = lv(n);
  if (!pv) return 'failure';
  const st = tac(pv, 'escape', newState);
  const tick = n.snap.tick;
  const deaths = n.snap.players.find((r) => r.slot === n.ctx.slot)?.deaths ?? 0;
  if (st.active && deaths > st.deaths) afterDeath(n, pv, st);
  if (!pv.self) return 'failure';
  const self = pv.self;
  const foes = gankers(n, pv);
  const heard = foes.length ? null : bushAudio(n, pv);
  if (!foes.length && !heard) {
    if (!st.active) return 'failure';
    st.active = false;
    pv.mem.tactics.recallReeval = true;
    log(n, pv, 'escape', 'end', 'no chasers perceived: survived, re-evaluate recall', { hp: +hpFrac(self).toFixed(2) });
    return 'success';
  }
  const me = n.snap.me!;
  const hp = hpFrac(self);
  const ownTowers = n.snap.entities.filter((e) => e.kind === Kind.Tower && e.team === n.ctx.team && e.alive);
  const tower = ownTowers.slice().sort((a, b) => dst(a, self) - dst(b, self))[0] ?? null;
  const allyJg = n.ctx.players.find((p) => p.team === n.ctx.team && p.role === 'jungle' && p.slot !== n.ctx.slot);
  const jgE = allyJg ? pv.allies.find((a) => a.slot === allyJg.slot) : undefined;
  const jgEtaS = jgE ? dst(jgE, self) / 350 : Infinity;
  const flash = readySummoner(n, 'sprung');
  const inputs: Inputs = { hp: +hp.toFixed(2), foes: foes.length, towerDist: tower ? Math.round(dst(tower, self)) : -1, flash: flash >= 0, jgEtaS: Number.isFinite(jgEtaS) ? +jgEtaS.toFixed(1) : -1 };
  foes.slice(0, 3).forEach(({ t }, i) => logTrack(inputs, `foe${i}`, t));

  // ---- 1 + 2: assess, fight or flight (once per episode and when the number of chasers changes)
  const first = !st.active;
  if (first) {
    Object.assign(st, newState(), { active: true, since: tick, deaths });
    if (ping(n, pv, 'danger', self)) st.pingedDanger = true;
  }
  if (foes.length && (first || foes.length !== st.threats)) {
    st.threats = foes.length;
    const target = foes.slice().sort((a, b) => dst(a.e, self) - dst(b.e, self))[0]!.e;
    const ex = estimateExchange(n.v, n.ctx, target, 3, n.rng, { extraAllyDps: jgEtaS <= 8 ? dpsOf(n.ctx.champ, me.level) : 0 });
    let fight = ex.winProb > n.p.knobs.escapeFightThreshold;
    let reason = `winProb ${ex.winProb.toFixed(2)} vs ${n.p.knobs.escapeFightThreshold.toFixed(2)}`;
    if (coinFlipFights(n.p)) {
      fight = n.rng.chance(0.5);
      reason = 'coin flip (Iron-Silver)';
    }
    st.mode = fight ? 'fight' : 'escape';
    log(n, pv, 'escape', st.mode, reason, inputs, { winProb: ex.winProb, killProb: ex.killProb, deathProb: ex.deathProb });
  }
  // ---- 6: tower as a weapon
  if (st.mode === 'escape' && tower && dst(tower, self) < 750 && foes.some(({ e }) => tower.atkTarget === e.id)) {
    st.mode = 'fight';
    log(n, pv, 'escape', 'towerTurn', 'own tower has aggro on a chaser: turn and fight', inputs);
  }
  if (st.mode === 'fight') {
    ping(n, pv, 'help', self);
    return 'failure';
  }

  // ---- 5: heal / shield / Zeitglas
  if (hp < 0.35 && pv.burst1s > 0.12) {
    const heal = readySummoner(n, 'heilen');
    if (heal !== -1) {
      n.out.push({ cmd: { t: 'spell', slot: heal, x: self.x, y: self.y } });
      log(n, pv, 'escape', 'heal', `HP ${hp.toFixed(2)} under burst ${pv.burst1s.toFixed(2)}`, inputs);
    } else {
      const sh = selfShield(n);
      if (sh >= 0) {
        n.out.push({ cmd: { t: 'cast', slot: sh as 0 | 1 | 2 | 3, x: self.x, y: self.y } });
        log(n, pv, 'escape', 'shield', 'own shield under burst', inputs);
      } else if (atLeast(n.p, 'platinum')) {
        const slot = me.items.indexOf('zeitglas');
        const allyNear = pv.allies.some((a) => dst(a, self) < 6 * 350);
        if (slot >= 0 && (me.itemCds[slot]?.left ?? 1) <= 0 && allyNear && hp < 0.2) {
          n.out.push({ cmd: { t: 'item', slot } });
          log(n, pv, 'escape', 'stasis', 'Zeitglas: ally arrives within 6 s', inputs);
          return 'running';
        }
      }
    }
  }

  // ---- 3: route with minimal threat integral (recomputed every second)
  if (!st.route || tick - st.routeAt >= 30) {
    const goals: Pt[] = ownTowers.map((t) => ({ x: t.x, y: t.y }));
    for (const c of n.ctx.map.sides[n.ctx.team as 0 | 1].camps) goals.push({ x: c.x, y: c.y });
    goals.sort((a, b) => dst(a, self) - dst(b, self));
    let best: { path: Pt[]; cost: number; goal: Pt } | null = null;
    for (const g of goals.slice(0, 5)) {
      const { path, length } = pathTo(n, self, g);
      const { integral } = pathThreat(pv.threat, self, path);
      // towers protect: their own threat inside the integral is the enemy's; add a small tower bonus
      const isTower = ownTowers.some((t) => dst(t, g) < 10);
      const cost = integral + length * 0.3 - (isTower ? 400 : 0);
      if (!best || cost < best.cost) best = { path, cost, goal: g };
    }
    if (best) {
      st.route = best.path;
      st.goal = best.goal;
      st.routeAt = tick;
    }
  }
  const goal = st.goal ?? n.ctx.map.sides[n.ctx.team as 0 | 1].fountain;
  const route = st.route ?? [goal];
  let next = route.find((p) => dst(p, self) > 120) ?? goal;
  let routeLen = 0;
  {
    let a: Pt = self;
    for (const p of route) (routeLen += dst(a, p)), (a = p);
  }

  // ---- 4: resources
  const ms = ownMs(n);
  const tSafe = routeLen / ms;
  const enemyDps = foes.reduce((a, { t }) => a + dpsOf(champOf(t.champ), t.level), 0);
  // chasers of equal speed connect only part of their damage while the bot runs
  const tDeath = enemyDps > 0 ? (self.hp + self.shield) / (enemyDps * 0.4) : Infinity;
  const danger = Math.min(1, tSafe / Math.max(0.5, tDeath));
  inputs.danger = +danger.toFixed(2);
  const cc = pv.incoming.find((c) => c.cc && c.onMe && c.hitTick >= tick);
  if (me.cc !== undefined && me.cc >= 3) st.ccHit = true;
  const readsCasts = atLeast(n.p, 'silver');
  let flashWhy: string | null = null;
  let err: ErrorId | undefined;
  if (flash >= 0) {
    if (readsCasts) {
      if (cc) flashWhy = 'a: CC cast starts on me';
      else if (tSafe > tDeath) flashWhy = 'b: safe point not reachable in time';
      else if (danger >= n.p.knobs.flashDangerThreshold) flashWhy = `danger ${danger.toFixed(2)} >= ${n.p.knobs.flashDangerThreshold.toFixed(2)}`;
    } else if (st.ccHit && (me.cc ?? 0) < 3 && !st.lateFlashRolled) {
      // Iron/Bronze: no wind-up reading; after eating the CC a late (often wrong) Flash
      st.lateFlashRolled = true;
      err = maybeInject(n.p, 'flash_wrong_direction', n.rng);
      if (err) flashWhy = 'late flash after the CC';
    } else if (hp < 0.15) flashWhy = 'panic flash';
  }
  // movement buffs / dashes first (not when the CC case needs the instant Flash)
  if (!flashWhy || !flashWhy.startsWith('a')) {
    const ghost = readySummoner(n, 'geist');
    if (ghost !== -1 && danger >= 0.35) {
      n.out.push({ cmd: { t: 'spell', slot: ghost, x: self.x, y: self.y } });
      log(n, pv, 'escape', 'ghost', 'movement buff before Flash', inputs);
      if (flashWhy && !flashWhy.startsWith('b')) flashWhy = null;
    } else {
      const dash = ownDash(n);
      if (dash >= 0 && (danger >= 0.3 || flashWhy)) {
        n.out.push({ cmd: { t: 'cast', slot: dash as 0 | 1 | 2 | 3, x: Math.round(next.x), y: Math.round(next.y) } });
        log(n, pv, 'escape', 'dash', 'dash along the escape route before Flash', inputs);
        if (flashWhy && !flashWhy.startsWith('b')) flashWhy = null;
      }
    }
  }
  if (flashWhy && flash !== -1) {
    let dir = unitTo(self, next);
    if (cc) {
      // sidestep out of the line, biased toward the route
      const side = cc.dx * (self.y - cc.oy) - cc.dy * (self.x - cc.ox) >= 0 ? 1 : -1;
      dir = norm({ x: -cc.dy * side + dir.x * 0.5, y: cc.dx * side + dir.y * 0.5 });
    }
    if (atLeast(n.p, 'diamond')) dir = wallFlash(n, self, goal, routeLen) ?? dir;
    if (!err && !atLeast(n.p, 'silver')) err = maybeInject(n.p, 'flash_into_wall', n.rng);
    if (err === 'flash_wrong_direction') dir = rotate(dir, Math.PI * (0.5 + n.rng.next()));
    else if (err === 'flash_into_wall') dir = towardWall(n, self) ?? dir;
    // reaction: the decision is now, the key press after the reaction time unless a prediction was made
    const castTick = cc ? cc.tick : tick;
    const predicted = !!cc && n.rng.chance(n.p.behavior.predictiveDodgePct / 100);
    const delay = predicted ? 0 : Math.max(0, castTick + Math.round((sampleReactionMs(n.p.behavior, n.rng) * 30) / 1000) - tick);
    const p = { x: self.x + dir.x * FLASH_RANGE, y: self.y + dir.y * FLASH_RANGE };
    const cmd: Command = { t: 'spell', slot: flash, x: Math.round(p.x), y: Math.round(p.y) };
    n.out.push(delay > 0 ? { cmd, delay } : { cmd });
    log(n, pv, 'escape', 'flash', flashWhy + (predicted ? ' (predicted)' : ''), { ...inputs, tSafe: +tSafe.toFixed(1), tDeath: +tDeath.toFixed(1), delay }, { danger }, err);
    return 'running';
  }

  // ---- 3b: jukes against skillshot chasers (Gold+), Challenger right after a seen cast
  const skillshots = foes.some(({ t }) => champOf(t.champ)?.abilities.some((a) => a.type === 'skillshot_line'));
  if (skillshots && atLeast(n.p, 'gold')) {
    const castSeen = pv.incoming.some((c) => c.onMe);
    const chall = atLeast(n.p, 'challenger');
    if ((chall && castSeen) || (!chall && tick >= st.nextJuke)) {
      st.nextJuke = tick + Math.round((0.4 + 0.4 * n.rng.next()) * 30);
      st.jukeSide = -st.jukeSide;
      const u = unitTo(self, next);
      const cand = { x: self.x + u.x * 250 - u.y * 160 * st.jukeSide, y: self.y + u.y * 250 + u.x * 160 * st.jukeSide };
      if (walkable(n.ctx.map.nav, cand.x, cand.y)) next = cand;
    }
  }
  if (first) log(n, pv, 'escape', 'run', 'flee along min-threat route', { ...inputs, tSafe: +tSafe.toFixed(1), tDeath: +tDeath.toFixed(1) });
  // already at the safe point (tower / camp): nothing to run to, the tree's fight / laning leaves take over
  return move(n, pv, next) || move(n, pv, goal) ? 'running' : 'failure';
}

function afterDeath(n: NodeCtx, pv: BotPerception, st: EscapeState): void {
  st.active = false;
  pv.mem.tactics.tilt = ((pv.mem.tactics.tilt as number | undefined) ?? 0) + 1;
  const inputs: Inputs = {};
  const jg = [...pv.enemies.values()].find((t) => t.role === 'jungle');
  if (jg) logTrack(inputs, 'jg', jg);
  log(n, pv, 'escape', 'died', 'died in the gank: tilt +1', inputs);
  const pos = jg ? trackPos(jg) : null;
  if (pos && atLeast(n.p, 'gold')) ping(n, pv, 'missing', pos, true);
}

/** Own non-ult ability that shields/heals self and is ready, else -1. */
function selfShield(n: NodeCtx): number {
  const me = n.snap.me!;
  for (let s = 0; s < 4; s++) {
    const a = n.ctx.champ.abilities[s]!;
    const h = me.abilities[s];
    if (!h || h.rank <= 0 || h.cdLeft > 0) continue;
    if (a.effects.some((e) => (e.kind === 'shield' || e.kind === 'heal') && (e.target === 'self' || e.target === 'allies'))) return s;
  }
  return -1;
}

/** Own ready dash/blink (not a CC engage), else -1. */
function ownDash(n: NodeCtx): number {
  const me = n.snap.me!;
  for (let s = 0; s < 4; s++) {
    const a = n.ctx.champ.abilities[s]!;
    const h = me.abilities[s];
    if (!h || h.rank <= 0 || h.cdLeft > 0) continue;
    if ((a.type === 'dash' || a.type === 'blink') && !isCC(a) && !a.flags?.includes('ally_target')) return s;
  }
  return -1;
}

const norm = (v: Pt): Pt => {
  const l = Math.hypot(v.x, v.y);
  return l > 0 ? { x: v.x / l, y: v.y / l } : { x: 1, y: 0 };
};
const unitTo = (a: Pt, b: Pt): Pt => norm({ x: b.x - a.x, y: b.y - a.y });
const rotate = (v: Pt, ang: number): Pt => ({ x: v.x * Math.cos(ang) - v.y * Math.sin(ang), y: v.x * Math.sin(ang) + v.y * Math.cos(ang) });

/** Diamond+: a Flash over a wall that saves walking distance to the goal (wall closer than the tower). */
function wallFlash(n: NodeCtx, self: Pt, goal: Pt, routeLen: number): Pt | null {
  const nav = n.ctx.map.nav;
  let best: Pt | null = null;
  let bestLen = routeLen - 500;
  for (let k = 0; k < 16; k++) {
    const d = { x: Math.cos((k * Math.PI) / 8), y: Math.sin((k * Math.PI) / 8) };
    const p = { x: self.x + d.x * FLASH_RANGE, y: self.y + d.y * FLASH_RANGE };
    if (!walkable(nav, p.x, p.y) || lineWalkable(nav, self.x, self.y, p.x, p.y)) continue; // only over walls
    const len = pathTo(n, p, goal).length;
    if (len < bestLen) (bestLen = len), (best = d);
  }
  return best;
}

/** Direction toward the nearest wall within Flash range (flash_into_wall), or null. */
function towardWall(n: NodeCtx, self: Pt): Pt | null {
  for (let r = 100; r <= FLASH_RANGE; r += 100) {
    for (let k = 0; k < 16; k++) {
      const d = { x: Math.cos((k * Math.PI) / 8), y: Math.sin((k * Math.PI) / 8) };
      if (!walkable(n.ctx.map.nav, self.x + d.x * r, self.y + d.y * r)) return d;
    }
  }
  return null;
}
