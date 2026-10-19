// Bot brain: the behaviour tree in src/data/bots/tree.json (runtime src/ai/bt), evaluated at the profile's decision
// rate. This module keeps the brain entry (cast busy guard) and the prototype leaves that the tree reuses:
// level-ups, recall channel / fountain (shop, heal, teleport), retreat, line-skillshot dodge, ally heals, jungle
// route, laning (last hits, wave state, positioning), unstick. New behaviour (trades, kiting, macro, team AI,
// player interaction) lives in trade.ts, kite.ts, teamfight.ts, macro.ts, teamai.ts, social.ts.
// Rank parameters come only from ctx.profile (src/data/bots/profiles/*.json), style only from ctx.params.

import type { LaneName, Pt } from '../../sim/map';
import { sampleReactionMs } from '../profiles';
import type { BotAction, BotMemory, BotStatic, Brain, PlayerHud, SnapEntity } from './types';
import { near, ticksOfMs, towerCovering, type View } from './perception';
import { escapeCast, hpPct, offensiveCast, supportCast } from './combat';
import { jungle, laneSpot, pushTarget, incomingDps, structureToHit } from './laning';
import { reflexState, setIntent, type LaneIntent } from '../reflex/state';
import { planLastHit } from './lasthit';
import { shop, spendable } from './shop';
import { dst, laneProgress, lanePoint } from './geo';
import { laneLength } from '../perception/waves';
import { cleanseStep, exhaustStep, teleportStep } from './spells';
import { runTree } from '../bt/leaves';
import { ARENA_CENTRE } from '../../sim/trainer/arena';
import type { NodeCtx, NodeResult } from '../bt/types';
import { cancelOrbwalk, attackTicks } from './kite';
import { chooseWave, laneOf, sealWard, sweep, visionShop, wardDue } from './macro';
import { laningSafety, rankIdx, rollError } from '../bt/deps';
import { utilityOn } from '../utility/flag';

/** Decision interval in ticks for this bot (profile microHz). */
export const decisionTicks = (ctx: BotStatic): number => Math.max(1, Math.round(30 / ctx.profile.behavior.microHz));

export const think: Brain = (snap, ctx, mem, rng) => {
  // casting wind-up or channel in progress: any move/attack would break it, so only level up meanwhile
  // (a rejected cast leaves the ability off cooldown: then the bot is not busy after all)
  const castFailed = mem.busySlot >= 0 && snap.tick > mem.busyFrom + 2 && (snap.me?.abilities[mem.busySlot]?.cdLeft ?? 0) <= 0;
  if (snap.tick < mem.busyUntil && !castFailed) {
    const lv = snap.me && !snap.me.dead ? levelUp(snap.me, ctx) : null;
    return lv ? [lv] : [];
  }
  const out = runTree(snap, ctx, mem, rng);
  for (const a of out) {
    if (a.cmd.t !== 'cast') continue;
    const ab = ctx.champ.abilities[a.cmd.slot];
    // B2: wind-ups of movesWhileCasting abilities do not stop the champion: the bot may keep moving/deciding
    if (ab.movesWhileCasting && !ab.flags?.includes('channel')) continue;
    const rank = snap.me?.abilities[a.cmd.slot]?.rank ?? 1;
    const dur = ab.duration === undefined ? 0 : typeof ab.duration === 'number' ? ab.duration : ab.duration[Math.max(0, rank - 1)] ?? 0;
    const busy = ab.castTime + (ab.flags?.includes('channel') ? dur : 0);
    mem.busyFrom = snap.tick + (a.delay ?? 0);
    mem.busySlot = a.cmd.slot;
    mem.busyUntil = mem.busyFrom + Math.ceil(busy * 30) + 1;
  }
  return out;
};

// ------------------------------------------------------------------ helpers

/** Move with throttling: every move runs A* in the sim, so only re-issue for a new goal or when stopped. */
/**
 * A move goal inside a tower / inhibitor / nexus footprint cannot be reached: the unit pushes against the structure
 * and jitters in place (stuck seconds in the pathing metric; lane stand points before the first wave sit right at the
 * own tower). Push such a goal radially out of the footprint.
 */
export function clearOfStructures(v: View, p: Pt): Pt {
  for (const s of [...v.ownTowers, ...v.enemyTowers, ...v.enemyStructures]) {
    const need = s.radius + v.self.radius + 15;
    const d = dst(s, p);
    if (d >= need) continue;
    const ux = d > 1 ? (p.x - s.x) / d : (v.self.x - s.x) / (dst(s, v.self) || 1);
    const uy = d > 1 ? (p.y - s.y) / d : (v.self.y - s.y) / (dst(s, v.self) || 1);
    return { x: s.x + ux * need, y: s.y + uy * need };
  }
  return p;
}

export function moveTo(v: View, mem: BotMemory, goal: Pt): BotAction | null {
  const p = clearOfStructures(v, goal);
  // < 120: close enough (smaller corrections are the stop-and-go creep the pathing metrics flag)
  if (dst(v.self, p) < 120 || v.tick < mem.holdUntil) return null;
  if (mem.lastMove && dst(mem.lastMove, p) < 200 && v.self.moving && v.tick - mem.lastMove.tick < 300) return null;
  mem.lastMove = { x: p.x, y: p.y, tick: v.tick };
  return { cmd: { t: 'move', x: p.x, y: p.y } };
}

const push = (n: NodeCtx, a: BotAction | null): boolean => {
  if (a) n.out.push(a);
  return !!a;
};


export function levelUp(me: PlayerHud, ctx: BotStatic): BotAction | null {
  const can = (s: number): boolean => !!me.abilities[s]?.canLevel;
  const order = ctx.champ.maxOrder.map((k) => 'QWE'.indexOf(k)) as (0 | 1 | 2)[];
  let slot: 0 | 1 | 2 | 3 | -1 = -1;
  if (can(3)) slot = 3;
  else slot = order.find((s) => can(s) && me.abilities[s]!.rank === 0) ?? order.find((s) => can(s)) ?? -1;
  return slot === -1 ? null : { cmd: { t: 'levelUp', slot } };
}

/** Drink a Trank below 50 % HP outside the fountain, one at a time (it heals over 15 s). */
function drinkPotion(v: View, me: PlayerHud, mem: BotMemory): BotAction | null {
  if (v.hpPct > 0.5 || v.tick - mem.potionAt < 450) return null;
  const slot = me.items.findIndex((id, i) => i < 6 && id === 'trank');
  if (slot < 0) return null;
  mem.potionAt = v.tick;
  return { cmd: { t: 'item', slot } };
}

const fountainOf = (n: NodeCtx): { x: number; y: number; r: number } => n.ctx.map.sides[n.ctx.team].fountain;
const inFountain = (n: NodeCtx): boolean => dst(n.v.self, fountainOf(n)) < fountainOf(n).r;

// ------------------------------------------------------------------ leaves (registered in src/ai/bt/leaves.ts)

/** Summoners/items that do not replace the rest of the decision (Agent J: spells.ts) + potions. */
export function utilitySpells(n: NodeCtx): NodeResult {
  if (n.v.me.dead || n.v.me.recallLeft > 0) return 'success';
  push(n, cleanseStep(n.v, n.ctx, n.rng));
  push(n, exhaustStep(n.v));
  if (!inFountain(n)) {
    push(n, drinkPotion(n.v, n.v.me, n.mem));
    // seal ward / sweeper on spots the bot walks past (item and trinket use do not stop the walk)
    if (!sealWard(n)) sweep(n);
  }
  return 'success';
}

export function dead(n: NodeCtx): NodeResult {
  if (!n.v.me.dead) return 'failure';
  n.mem.wasDead = true;
  n.mem.mode = 'dead';
  n.mem.lastMove = null;
  n.mem.trail = [];
  return 'success';
}

/**
 * Teamfight arena (trainer mode 'arena'): no lanes, no recall, no retreat home — fight the enemy champion most worth
 * hitting (low HP, close) with abilities and autos. Dodges and peel still run before this leaf.
 */
export function arena(n: NodeCtx): NodeResult {
  const { v, ctx, mem, rng } = n;
  if (ctx.mode !== 'arena') return 'failure';
  const foes = [...v.enemies, ...v.unnoticed];
  if (!foes.length) {
    // nobody in sight (an idle player out of range): search where it was last seen, else the arena centre
    const last = [...mem.aware.values()].sort((a, b) => b.lastSeen - a.lastSeen)[0];
    const goal = last ?? ARENA_CENTRE;
    if (mem.mode !== 'search') n.log('arena', 'search', last ? 'enemy out of sight: last seen spot' : 'enemy out of sight: arena centre', {});
    mem.mode = 'search';
    if (dst(v.self, goal) > 150) push(n, moveTo(v, mem, goal));
    else push(n, moveTo(v, mem, { x: 2 * ARENA_CENTRE.x - v.self.x + (n.rng.next() - 0.5) * 400, y: 2 * ARENA_CENTRE.y - v.self.y + (n.rng.next() - 0.5) * 400 }));
    return 'running';
  }
  const score = (e: SnapEntity): number => hpPct(e) * 1000 + dst(e, v.self);
  const t = foes.sort((a, b) => score(a) - score(b))[0]!;
  if (mem.mode !== 'fight') n.log('arena', 'fight', 'arena round: engage', { targetSlot: t.slot, targetX: Math.round(t.x), targetY: Math.round(t.y), targetSrc: 'seen' });
  mem.mode = 'fight';
  mem.lastMove = null;
  if (v.self.atkPhase === 1) return 'running';
  const c = v.enemies.includes(t) ? offensiveCast(v, ctx, rng, t) : null;
  if (c) n.out.push(c);
  else if (v.self.atkTarget !== t.id) n.out.push({ cmd: { t: 'attack', target: t.id } });
  return 'running';
}

/** Recall channel: keep still unless an enemy shows up. */
export function recallChannel(n: NodeCtx): NodeResult {
  if (n.v.me.recallLeft <= 0) return 'failure';
  if (near(n.v.enemies, n.v.self, 1100).length === 0) return 'running';
  n.mem.lastMove = null;
  push(n, moveTo(n.v, n.mem, fountainOf(n)));
  n.log('recall', 'cancel', 'enemy near during recall', {});
  return 'running';
}

/** Fountain: shop once per visit, heal up, teleport back to lane. */
export function fountain(n: NodeCtx): NodeResult {
  if (!inFountain(n)) {
    n.mem.shopVisitDone = false;
    return 'failure';
  }
  const firstLook = !n.mem.shopVisitDone;
  const buys = shop(n.v.me, n.ctx, n.mem);
  n.out.push(...buys);
  if (firstLook) n.out.push(...visionShop(n, spendable(n.v.me, n.mem) - (n.mem.pendingBuy?.cost ?? 0)));
  const manaOk = n.v.self.maxMana <= 0 || n.v.self.mana / n.v.self.maxMana > 0.6;
  if (n.v.hpPct < 0.9 || !manaOk) {
    n.mem.mode = 'heal';
    return 'running';
  }
  return push(n, teleportStep(n.v, n.ctx, n.mem)) ? 'running' : 'failure';
}

/** Retreat (prototype survive): low HP / outnumbered / tower aggro -> run home with summoners and escape casts. */
export function retreat(n: NodeCtx): NodeResult {
  const { v, ctx, mem } = n;
  if (inFountain(n) || ctx.mode === 'arena') return 'failure'; // arena: no way home, fight it out
  if (mem.ext.trade && v.tick < mem.ext.overcommitUntil) return 'failure'; // overcommit_after_kill: no retreat
  // a committed all-in that is winning (kill likely, own death unlikely, target lower than the bot) is not dropped for
  // low HP or tower aggro: the trade leaf's own exits (lost / stalled / under tower without a lethal dive) end it
  const tr = mem.ext.trade;
  if (tr?.kind === 'allin' && (tr.kill ?? 0) > 0.6 && (tr.death ?? 1) < 0.5 && v.hpPct > 0.08) {
    const t = v.enemies.find((e) => e.serial === tr.serial);
    if (t && hpPct(t) < v.hpPct + 0.15) return 'failure';
  }
  const home = fountainOf(n);
  const foes = near(v.enemies, v.self, 1200);
  const friends = near(v.allies, v.self, 1200);
  const towerOnMe = v.enemyTowers.some((t) => t.atkTarget === v.me.eid);
  // retreat line by skill (Iron 18 % .. Gold 23 % .. Challenger 30 %: low ranks stay too long and die), aggressive
  // bots stay longer (was 25 % for every rank)
  const lowHp = 0.17 + 0.13 * Math.min(1, Math.max(0, n.ctx.params.skill / 100)) - n.p.playstyle.aggression * 0.016;
  const low = v.hpPct < lowHp && foes.length > 0;
  const outnumbered = v.hpPct < 0.55 && foes.length >= friends.length + 2;
  // after a retreat: keep away from enemies below 45 % HP, walk home (recall) below 40 % (was 60 % / 60 %: every
  // tower-aggro retreat at 55 % HP cost a full recall trip - LoL laners stay in lane at half HP)
  const stillUnsafe = mem.mode === 'retreat' && v.hpPct < 0.45 && foes.length > 0;
  if (low || outnumbered || stillUnsafe || towerOnMe) {
    if (mem.mode !== 'retreat') n.log('retreat', 'retreat', towerOnMe ? 'tower aggro' : low ? 'low hp' : outnumbered ? 'outnumbered' : 'still unsafe', { foes: foes.length, friends: friends.length }, { hp: v.hpPct });
    mem.mode = 'retreat';
    if (mem.ext.trade) mem.ext.trade = null;
    cancelOrbwalk(n);
    const closest = Math.min(...foes.map((e) => dst(e, v.self)), Infinity);
    const sums = [4, 5].map((i) => v.me.abilities[i]);
    if (v.hpPct < 0.18 && closest < 650) {
      const heal = sums.findIndex((s) => s?.id === 'heilen' && s.rank > 0 && s.cdLeft <= 0);
      const flash = sums.findIndex((s) => s?.id === 'sprung' && s.rank > 0 && s.cdLeft <= 0);
      if (heal >= 0) n.out.push({ cmd: { t: 'spell', slot: heal as 0 | 1, x: v.self.x, y: v.self.y } });
      else if (flash >= 0 && closest < 450) n.out.push({ cmd: { t: 'spell', slot: flash as 0 | 1, x: home.x, y: home.y } });
    }
    if (closest < 500) push(n, escapeCast(v, ctx, home));
    push(n, moveTo(v, mem, home));
    return 'running';
  }
  // low HP (or after a retreat): walk / recall home. Gold-driven recalls are the macro recall score's job.
  const safe = near([...v.enemies, ...v.unnoticed], v.self, 1600).length === 0 && near(v.monsters, v.self, 800).length === 0;
  // brain rework §4.6 heal path: with the utility model the walk home is the recall candidate's decision (stay-death
  // > 0.3 or an item, src/ai/utility/value.ts recallValue); retreat only flees
  const util = utilityOn(ctx);
  const goHome = !util && (v.hpPct < lowHp || (mem.mode === 'retreat' && v.hpPct < 0.4) || mem.mode === 'home');
  if (goHome) {
    // a recall broken by damage (DoT, unseen attacker) is retried only after 6 s of walking home: no recall spam
    if (safe && dst(v.self, home) > 2500 && near(v.enemyMinions, v.self, 650).length === 0 && v.tick - mem.ext.recallTryAt > 6 * 30) {
      mem.ext.recallTryAt = v.tick;
      mem.mode = 'recall';
      mem.lastMove = null;
      n.out.push({ cmd: { t: 'recall' } });
      n.log('recall', 'recall', 'low hp', {}, { hp: v.hpPct });
      return 'success';
    }
    mem.mode = 'home';
    push(n, moveTo(v, mem, home));
    return 'running';
  }
  if (mem.mode === 'retreat' || (mem.mode === 'home' && !util)) mem.mode = 'lane';
  return 'failure';
}

/**
 * Step out of a visible enemy line skillshot heading at the bot (profile dodge rate + reaction delay). Dodge beats
 * orbwalk (§7): queued orbwalk orders are dropped; an own auto wind-up is only cancelled when the projectile hits
 * in < 0.4 s, otherwise the dodge waits for the hit point.
 */
export function dodge(n: NodeCtx): NodeResult {
  const { v, ctx, mem, rng } = n;
  const live = new Set<number>();
  let res: BotAction | null = null;
  for (const p of v.snap.projectiles) {
    live.add(p.id);
    if (p.team === ctx.team || p.kind !== 1 || mem.projSeen.has(p.id)) continue;
    const rx = v.self.x - p.x;
    const ry = v.self.y - p.y;
    const along = rx * p.dx + ry * p.dy;
    if (along <= 0 || along > 1300) continue;
    const perp = rx * p.dy - ry * p.dx;
    const half = p.width / 2 + v.self.radius;
    if (Math.abs(perp) > half + 20) continue;
    mem.projSeen.set(p.id, v.tick);
    if (res || !rng.chance(ctx.profile.behavior.dodgeRateLine900Pct / 100)) continue;
    const vx = (p.x - p.px) * 30;
    const vy = (p.y - p.py) * 30;
    const speed = Math.sqrt(vx * vx + vy * vy) || 1500;
    const react = ticksOfMs(sampleReactionMs(ctx.profile.behavior, rng));
    const impact = (along / speed) * 30;
    if (react >= impact - 2) continue; // too late to react
    let delay = react;
    if (v.self.atkPhase === 1 && impact - react > 12) delay = Math.max(react, Math.min(impact - 6, attackTicks(n).windup)); // finish the auto first
    let nx = rx - along * p.dx;
    let ny = ry - along * p.dy;
    const nl = Math.sqrt(nx * nx + ny * ny);
    if (nl > 1) (nx /= nl), (ny /= nl);
    else (nx = -p.dy), (ny = p.dx);
    const step = half + 60 - Math.abs(perp) + 40;
    mem.lastMove = null;
    res = { cmd: { t: 'move', x: v.self.x + nx * step, y: v.self.y + ny * step }, delay };
  }
  for (const id of mem.projSeen.keys()) if (!live.has(id)) mem.projSeen.delete(id);
  if (!res) return 'failure';
  cancelOrbwalk(n);
  n.out.push(res);
  n.log('dodge', 'dodge', 'line skillshot', { delay: res.delay ?? 0 });
  return 'success';
}

/** Heal / shield allies (supports mostly; anyone with such a spell). */
export function peel(n: NodeCtx): NodeResult {
  if (n.v.self.atkPhase === 1) return 'failure';
  return push(n, supportCast(n.v, n.ctx, n.mem.mode === 'fight')) ? 'success' : 'failure';
}

/** Jungle: prototype route + gank on hurt enemies in reach (L's gank node takes over when it exists). */
export function jungleLeaf(n: NodeCtx): NodeResult {
  const { v, ctx, mem } = n;
  if (ctx.role !== 'jungle' || mem.ext.laneOverride) return 'failure';
  if (mem.mode !== 'fight') mem.mode = 'jungle';
  const roamRange = 2000 + 300 * (n.p.playstyle.roam + 5);
  const prey = v.enemies.find((e) => hpPct(e) < 0.45 && dst(e, v.self) < roamRange && !v.enemyTowers.some((t) => dst(t, e) < 900));
  if (prey) return push(n, moveTo(v, mem, prey)) || v.self.moving ? 'running' : 'failure';
  const j = jungle(v, ctx, mem);
  if (j === 'wait') return 'running';
  if (j === 'roam') return 'failure'; // fall through to laning (jungle rotation lane)
  if ('cmd' in j) {
    mem.lastMove = null;
    n.out.push(j);
    return 'running';
  }
  push(n, moveTo(v, mem, j));
  stuckCheck(n);
  return 'running';
}

/** Lane for this bot right now: team-AI override, role lane, or the jungle rotation lane. */
function currentLane(n: NodeCtx): LaneName {
  const b = n.ctx.profile.behavior;
  return n.mem.ext.laneOverride ?? n.ctx.lane ?? (['top', 'mid', 'bot'] as const)[Math.floor(n.v.time / (2 * b.macroIntervalS)) % 3]!;
}

/** Reflex wave label of the tree's wave state (rework §4.5 names; Phase 2 replaces chooseWave). */
const REFLEX_WAVE: Record<string, LaneIntent['wave']> = { crash: 'push', default: 'neutral', slowPush: 'slowPush', freeze: 'freeze', hold: 'hold' };

/**
 * Laning decision (rework §3/§4): wave state, gank-risk tier, stand distance and the support's side point become
 * the lane intent; the reflex layer (src/ai/reflex) executes it every tick: last hits as plans, every free attack
 * period filled, stand point per tick, orbwalk. No last-hit timing, no attack-timer holding and no move/stop to
 * free the timer here any more. Returns failure only when a ward is due (vision runs).
 */
export function laneLeaf(n: NodeCtx): NodeResult {
  if (!reflexState(n.mem).enabled) return laneLeafLegacy(n);
  const { v, ctx, mem, rng } = n;
  if (mem.mode !== 'fight') mem.mode = 'lane';
  const melee = ctx.champ.attackType === 'melee';
  let behind = melee ? 220 : Math.max(250, v.me.stats.range * 0.75);
  const lane = currentLane(n);
  let wave: { state: string } = ctx.lane || mem.ext.laneOverride ? chooseWave(n, lane) : { state: 'default' };
  if (wave.state === 'freeze' || wave.state === 'hold') behind += 200;
  // L's §4.1 gank-risk tier: shift back, no push, Diamond+ crash first, stay in Flash reach of the tower
  const safety = laningSafety(mem);
  behind += safety?.targetShift ?? 0;
  if (safety?.crashFirst) wave = { state: 'crash' };
  const pushOk = (safety?.allowPush ?? true) && wave.state !== 'freeze' && wave.state !== 'hold';
  let farm = true;
  if (v.enemyMinions.filter((m) => m.atkTarget === v.me.eid).length >= 2) behind += 350;
  let spot = laneSpot(v, ctx, lane, behind);
  let side: Pt | undefined;
  // stay in Flash reach of the tower only while the stand point is on the enemy half (on the own half the bot is
  // close enough anyway; clamping there pulls it out of last-hit range of a wave in the middle)
  const half = (pts: Pt[]): boolean => laneProgress(pts, spot).s > laneLength(pts) * 0.5;
  if (safety?.stayNearTower && half(ctx.map.sides[ctx.team].lanes[lane])) {
    const tower = v.ownTowers.filter((t) => ctx.map.sides[ctx.team].towers[lane].some((p) => dst(p, t) < 200)).sort((a, b) => dst(a, spot) - dst(b, spot))[0];
    const d = tower ? dst(tower, spot) : 0;
    if (tower && d > 1150) side = spot = { x: tower.x + ((spot.x - tower.x) * 1150) / d, y: tower.y + ((spot.y - tower.y) * 1150) / d };
  }
  if (ctx.role === 'support' && !mem.ext.laneOverride) {
    const adcSlot = ctx.players.find((p) => p.team === ctx.team && p.role === 'adc')?.slot;
    const adc = v.allies.find((a) => a.slot === adcSlot);
    const home = fountainOf(n);
    // ponytail: the roam axis loosens this binding in L's roam node (knob supportAdcBinding)
    if (adc && dst(adc, home) > 2500) {
      farm = false; // leave the CS to the ADC
      const pts = ctx.map.sides[ctx.team].lanes[lane];
      // beside and a little behind the ADC, not on its line: a point straight behind it is walked into (units block
      // each other) and reads as the support glued to the ADC's back
      const along = Math.max(0, laneProgress(pts, adc).s - 120);
      const at = lanePoint(pts, along);
      const ahead = lanePoint(pts, along + 50);
      const dl = dst(at, ahead) || 1;
      const sgn = 1; // same sign for both teams: the lane geometry is point-mirrored, so the offset mirrors too
      side = spot = { x: at.x - ((ahead.y - at.y) / dl) * 170 * sgn, y: at.y + ((ahead.x - at.x) / dl) * 170 * sgn };
    }
  }
  // a ward is due: yield to the vision node (no lane intent, the reflex layer stays out of the ward walk)
  if (wardDue(n)) return 'failure';
  const wardWalk = mem.wardTrip >= 0 && v.tick - mem.wardTrip < 8 * 30;
  const slowPushOk = wave.state !== 'slowPush' || v.ownMinions.filter((m) => dst(m, spot) < 1200).length - v.enemyMinions.filter((m) => dst(m, spot) < 1200).length >= 2;
  const intent: LaneIntent = {
    kind: 'laneFarm',
    lane,
    wave: REFLEX_WAVE[wave.state] ?? 'neutral',
    farm: farm && !wardWalk,
    pushMinions: farm && !wardWalk && pushOk && slowPushOk,
    hitStructures: true,
    harass: false, // Phase 2 (§4.3)
    behind,
    ...(side ? { side } : {}),
    setTick: v.tick,
  };
  setIntent(mem, intent);
  n.log('lane', 'intent', `wave ${intent.wave}`, { farm: intent.farm, push: intent.pushMinions, behind: Math.round(behind) });
  // §6 ignore_minion_aggro (Iron-Silver): auto-attacks the enemy champion while standing in the enemy wave
  // (minions switch to the bot); rolled at most every 10 s while the situation lasts
  if (!mem.ext.trade && v.self.atkPhase !== 1 && v.tick - mem.ext.aggroRollAt > 10 * 30) {
    const champ = v.enemies.find((e) => dst(e, v.self) <= v.reach + e.radius);
    if (champ && near(v.enemyMinions, v.self, 500).length >= 2) {
      mem.ext.aggroRollAt = v.tick;
      if (rollError('ignore_minion_aggro', n.p, rng)) {
        n.log('lane', 'harass', 'attacks the champion inside the enemy wave', { target: champ.slot }, { minions: near(v.enemyMinions, v.self, 500).length }, 'ignore_minion_aggro');
        mem.lastMove = null;
        n.out.push({ cmd: { t: 'attack', target: champ.id } });
        return 'running';
      }
    }
  }
  if (v.self.moving) stuckCheck(n);
  return 'running';
}

/** Enemy champion close enough to punish a last hit (§7 last-hitting under pressure). */
function pressure(n: NodeCtx, lane: LaneName): SnapEntity | null {
  if ((n.pv.gankRisk[lane] ?? 0) >= 0.4) return n.v.self;
  return n.v.enemies.find((e) => dst(e, n.v.self) < n.v.me.stats.range + 450) ?? null;
}

/** Attack an enemy structure that is safe to hit (laning.ts structureToHit); `wait`: a last-hit window is due. */
function hitStructure(n: NodeCtx, wait: boolean): boolean {
  if (wait || n.v.self.atkPhase === 1) return false;
  const s = structureToHit(n.v, n.ctx);
  if (s < 0) return false;
  n.mem.lastMove = null;
  if (n.v.self.atkTarget !== s) n.out.push({ cmd: { t: 'attack', target: s } });
  n.log('lane', 'hit_structure', 'wave at the structure, no defenders', { target: s });
  return true;
}

/**
 * Laning: last hits (with pressure rules), wave state (freeze/hold = last hits only and further back, crash =
 * push everything, slow-push = push while ahead), support follows the ADC. Returns failure when there is nothing
 * to do right now (the tree then runs vision / idle).
 */
/** Pre-rework laning (reflex layer off: RunnerOptions.reflex false, the default until the Phase 1 gate is met). */
function laneLeafLegacy(n: NodeCtx): NodeResult {
  const { v, ctx, mem, rng } = n;
  if (mem.mode !== 'fight') mem.mode = 'lane';
  const melee = ctx.champ.attackType === 'melee';
  let behind = melee ? 220 : Math.max(250, v.me.stats.range * 0.75);
  const lane = currentLane(n);
  let wave: { state: string } = ctx.lane || mem.ext.laneOverride ? chooseWave(n, lane) : { state: 'default' };
  if (wave.state === 'freeze' || wave.state === 'hold') behind += 200;
  // L's §4.1 gank-risk tier: shift back, no push, Diamond+ crash first, stay in Flash reach of the tower
  const safety = laningSafety(mem);
  behind += safety?.targetShift ?? 0;
  if (safety?.crashFirst) wave = { state: 'crash' };
  const pushOk = (safety?.allowPush ?? true) && wave.state !== 'freeze' && wave.state !== 'hold';
  let farm = true;
  if (v.enemyMinions.filter((m) => m.atkTarget === v.me.eid).length >= 2) behind += 350;
  let spot = laneSpot(v, ctx, lane, behind);
  // stay in Flash reach of the tower only while the stand point is on the enemy half (on the own half the bot is
  // close enough anyway; clamping there pulls it out of last-hit range of a wave in the middle)
  const half = (pts: Pt[]): boolean => laneProgress(pts, spot).s > laneLength(pts) * 0.5;
  if (safety?.stayNearTower && half(ctx.map.sides[ctx.team].lanes[lane])) {
    const tower = v.ownTowers.filter((t) => ctx.map.sides[ctx.team].towers[lane].some((p) => dst(p, t) < 200)).sort((a, b) => dst(a, spot) - dst(b, spot))[0];
    const d = tower ? dst(tower, spot) : 0;
    if (tower && d > 1150) spot = { x: tower.x + ((spot.x - tower.x) * 1150) / d, y: tower.y + ((spot.y - tower.y) * 1150) / d };
  }
  if (ctx.role === 'support' && !mem.ext.laneOverride) {
    const adcSlot = ctx.players.find((p) => p.team === ctx.team && p.role === 'adc')?.slot;
    const adc = v.allies.find((a) => a.slot === adcSlot);
    const home = fountainOf(n);
    // ponytail: the roam axis loosens this binding in L's roam node (knob supportAdcBinding)
    if (adc && dst(adc, home) > 2500) {
      farm = false; // leave the CS to the ADC
      const pts = ctx.map.sides[ctx.team].lanes[lane];
      // beside and a little behind the ADC, not on its line: a point straight behind it is walked into (units block
      // each other) and reads as the support glued to the ADC's back
      const along = Math.max(0, laneProgress(pts, adc).s - 120);
      const at = lanePoint(pts, along);
      const ahead = lanePoint(pts, along + 50);
      const dl = dst(at, ahead) || 1;
      const side = 1; // same sign for both teams: the lane geometry is point-mirrored, so the offset mirrors too
      spot = { x: at.x - ((ahead.y - at.y) / dl) * 170 * side, y: at.y + ((ahead.x - at.x) / dl) * 170 * side };
      behind += 150;
    }
  }
  // stand-point hysteresis: the wave contact point jitters by a minion step every second; a player holds a spot and
  // re-positions in steps. Keep the held point while the new one is within 250 of it (for up to 6 s), so the bot
  // does not creep forward and back in 80-unit stop-and-go moves (pathing metric: reversals/min, moves/min)
  const held = mem.ext.standAt;
  if (held && held.lane === lane && dst(held, spot) < 250 && v.tick - held.tick < 180) spot = { x: held.x, y: held.y };
  else mem.ext.standAt = { x: spot.x, y: spot.y, lane, tick: v.tick };
  if (v.self.atkPhase === 1) return 'running'; // never cancel own wind-up
  // §6 ignore_minion_aggro (Iron-Silver): auto-attacks the enemy champion while standing in the enemy wave
  // (minions switch to the bot); rolled at most every 10 s while the situation lasts
  if (!mem.ext.trade && v.tick - mem.ext.aggroRollAt > 10 * 30) {
    const champ = v.enemies.find((e) => dst(e, v.self) <= v.reach + e.radius);
    if (champ && near(v.enemyMinions, v.self, 500).length >= 2) {
      mem.ext.aggroRollAt = v.tick;
      if (rollError('ignore_minion_aggro', n.p, rng)) {
        n.log('lane', 'harass', 'attacks the champion inside the enemy wave', { target: champ.slot }, { minions: near(v.enemyMinions, v.self, 500).length }, 'ignore_minion_aggro');
        mem.lastMove = null;
        n.out.push({ cmd: { t: 'attack', target: champ.id } });
        return 'running';
      }
    }
  }
  let holdTimer = false;
  if (farm && !(mem.wardTrip >= 0 && v.tick - mem.wardTrip < 8 * 30)) {
    // re-plan every decision: drop a last hit queued by the previous decision (the plan below replaces it)
    mem.cancelTags.add('lh');
    const plan = planLastHit(v, ctx, mem.ext.lh, rng, decisionTicks(ctx), n.p.behavior); // tilt-adjusted
    // keep the attack timer free for an upcoming kill window (no push auto that would still be cooling down)
    holdTimer = plan.nextWindow < v.tick + plan.period + plan.windup + 4;
    const lh = plan.action;
    if (lh) {
      // under pressure (gank risk / enemy in trade range), Diamond+ does not walk up for a last hit while the enemy
      // has a poke ready (spec §7); Gold always takes them ("verwundbar beim Last-Hitten"); farm +5 always
      const pr = pressure(n, lane);
      const target = v.enemyMinions.find((m) => m.id === (lh.cmd as { target: number }).target);
      const walkUp = target ? dst(v.self, target) > v.reach + target.radius + 250 : false;
      // only a real enemy champion in poke range counts (gank risk alone already moves the stand point back; skipping
      // every walk-up last hit on it cost Diamond+ more CS than Gold)
      const pokeReady = pr && pr !== v.self ? (mem.ext.enemyCastAt.get(pr.serial) ?? -1e9) < v.tick - 6 * 30 : false;
      if (pr && rankIdx(ctx.profile.rank) >= rankIdx('diamond') && n.p.playstyle.farmPriority < 5 && walkUp && pokeReady) {
        n.log('lane', 'skip_last_hit', 'last hit under pressure', { minionHp: Math.round(target?.hp ?? 0) });
      } else {
        mem.lastMove = null;
        if (lh.delay || v.self.atkTarget !== (lh.cmd as { target: number }).target) n.out.push(lh);
        return 'running';
      }
    } else if (plan.approach && v.self.atkPhase === 0) {
      // a kill window opens soon on a minion out of reach: step up to it now (not into an enemy tower's shots)
      const m = plan.approach;
      const d = dst(v.self, m);
      const r = v.reach + m.radius - 30;
      const p = { x: m.x + ((v.self.x - m.x) * r) / d, y: m.y + ((v.self.y - m.y) * r) / d };
      if (!towerCovering(v, p) && push(n, moveTo(v, mem, p))) return 'running';
    }
    // wave at an enemy structure, defenders missing: hit it (plates, towers, base) unless a last hit is due now
    if (hitStructure(n, holdTimer && near(v.enemyMinions, v.self, 800).length > 0)) return 'running';
  } else if (!farm && hitStructure(n, false)) {
    return 'running';
  }
  if (farm && !(mem.wardTrip >= 0 && v.tick - mem.wardTrip < 8 * 30)) {
    if (dst(v.self, spot) < 700 && pushOk) {
      const ahead = v.ownMinions.filter((m) => dst(m, spot) < 1200).length - v.enemyMinions.filter((m) => dst(m, spot) < 1200).length;
      let want = -1;
      if (wave.state === 'crash') {
        const inReach = v.enemyMinions.filter((m) => dst(v.self, m) <= v.reach + m.radius + 50).sort((a, b) => a.hp - b.hp);
        const pt = pushTarget(v, ctx);
        want = v.enemyTowers.some((t) => t.id === pt) ? pt : inReach[0]?.id ?? pt;
      } else if (wave.state !== 'slowPush' || ahead >= 2) want = pushTarget(v, ctx);
      if (holdTimer && wave.state !== 'crash') want = -1;
      if (want >= 0) {
        mem.lastMove = null;
        if (v.self.atkTarget !== want) n.out.push({ cmd: { t: 'attack', target: want } });
        return 'running';
      }
    }
  }
  // a ward is due: yield to the vision node (spec order: laning > vision; laning has nothing urgent here)
  if (wardDue(n)) return 'failure';
  // drop a lingering auto target (minion: keeps the attack timer free for the next last hit; champion: no chase)
  if (v.self.atkTarget >= 0) {
    mem.lastMove = null;
    n.out.push(moveTo(v, mem, spot) ?? { cmd: { t: 'stop' } });
    return 'running';
  }
  if (push(n, moveTo(v, mem, spot))) {
    stuckCheck(n);
    return 'running';
  }
  if (v.self.moving) {
    stuckCheck(n);
    return 'running';
  }
  return 'failure';
}

/** Movement/idle: shuffle around the lane spot like a player does (no 10 s statues), unstick. */
export function idle(n: NodeCtx): NodeResult {
  const { v, mem, rng } = n;
  // a small step every 4-7 s (was +-150 every 3 s: read as jitter)
  if (v.tick - (mem.lastMove?.tick ?? 0) > 120 + Math.floor(rng.next() * 90)) {
    const base = mem.lastMove ?? v.self;
    const p = clearOfStructures(v, { x: base.x + (rng.next() * 2 - 1) * 100, y: base.y + (rng.next() * 2 - 1) * 100 });
    mem.lastMove = { ...p, tick: v.tick };
    n.out.push({ cmd: { t: 'move', x: p.x, y: p.y } });
  }
  stuckCheck(n);
  return 'success';
}

/** No progress toward the move goal for 10 s: re-path via a random nearby point. */
export function stuckCheck(n: NodeCtx): void {
  const { v, mem, rng } = n;
  mem.trail.push({ x: v.self.x, y: v.self.y, tick: v.tick });
  while (mem.trail.length && v.tick - mem.trail[0]!.tick > 330) mem.trail.shift();
  // blocked by a unit standing in the way (no progress for 1.5 s while the goal is still away): side-step around it
  // at once instead of pushing against it until the 10-s unstick below
  const recent = mem.trail.find((t) => v.tick - t.tick <= 45);
  if (recent && v.tick - recent.tick >= 40 && mem.lastMove && v.self.atkPhase === 0 && dst(v.self, mem.lastMove) > 150 && dst(recent, v.self) < 20) {
    const d = dst(v.self, mem.lastMove) || 1;
    const ux = (mem.lastMove.x - v.self.x) / d;
    const uy = (mem.lastMove.y - v.self.y) / d;
    const sgn = rng.next() < 0.5 ? -1 : 1;
    const p = clearOfStructures(v, { x: v.self.x + ux * 60 - uy * 180 * sgn, y: v.self.y + uy * 60 + ux * 180 * sgn });
    n.out.push({ cmd: { t: 'move', x: p.x, y: p.y } });
    mem.lastMove = null;
    mem.holdUntil = v.tick + 20;
    mem.trail = [];
    return;
  }
  const old = mem.trail[0];
  if (!old || !mem.lastMove || v.tick - old.tick < 300) return;
  if (dst(v.self, mem.lastMove) > 300 && dst(old, v.self) < 80) {
    const a = rng.next() * 2 - 1;
    const b = rng.next() * 2 - 1;
    n.out.push({ cmd: { t: 'move', x: v.self.x + a * 500, y: v.self.y + b * 500 } });
    mem.lastMove = null;
    mem.holdUntil = v.tick + 45;
    mem.trail = [];
  }
}

export { incomingDps, laneOf };
