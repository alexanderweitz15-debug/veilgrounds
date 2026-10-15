// Rough bot brain (Bot-Prototyp): a fixed priority selector, evaluated at the profile's decision rate.
//   1. level up      2. recall in progress / fountain (shop, heal)      3. survive (retreat, summoners, recall)
//   4. dodge line skillshots      5. heal/shield allies      6. fight (trade evaluator + generic casts)
//   7. role: jungle route / support follows ADC / laning (last hit, light push, positioning), stuck recovery
// Rank parameters come only from ctx.profile (src/data/bots/profiles/*.json).
// ponytail: priority list instead of behavior trees / utility AI with desires (Phase 3: team AI, BTs as JSON,
// influence map, wards); play-style axes (src/ai/profiles/style.ts) are not read yet.

import type { LaneName, Pt } from '../../sim/map';
import type { Rng } from '../../sim/rng';
import { sampleReactionMs } from '../profiles';
import type { BotAction, BotMemory, BotStatic, Brain, PlayerHud } from './types';
import { perceive, near, ticksOfMs, towerCovering, type View } from './perception';
import { escapeCast, hpPct, offensiveCast, supportCast, tradeScore } from './combat';
import { jungle, lastHit, laneSpot, pushTarget } from './laning';
import { nextItemPrice, settleBuys, shop, spendable } from './shop';
import { dst, laneProgress, lanePoint } from './geo';

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
  const out = decide(snap, ctx, mem, rng);
  for (const a of out) {
    if (a.cmd.t !== 'cast') continue;
    const ab = ctx.champ.abilities[a.cmd.slot];
    const rank = snap.me?.abilities[a.cmd.slot]?.rank ?? 1;
    const dur = ab.duration === undefined ? 0 : typeof ab.duration === 'number' ? ab.duration : ab.duration[Math.max(0, rank - 1)] ?? 0;
    const busy = ab.castTime + (ab.flags?.includes('channel') ? dur : 0);
    mem.busyFrom = snap.tick + (a.delay ?? 0);
    mem.busySlot = a.cmd.slot;
    mem.busyUntil = mem.busyFrom + Math.ceil(busy * 30) + 1;
  }
  return out;
};

const decide: Brain = (snap, ctx, mem, rng) => {
  const out: BotAction[] = [];
  const me = snap.me;
  if (!me) return out;
  const lv = levelUp(me, ctx);
  if (lv) out.push(lv);
  if (me.dead) {
    mem.wasDead = true;
    mem.mode = 'dead';
    mem.lastMove = null;
    mem.trail = [];
    return out;
  }
  const v = perceive(snap, ctx, mem, rng);
  if (!v) return out;
  settleBuys(me, mem);
  // own attack timer bookkeeping (start of the current/last auto)
  if (v.self.atkPhase === 1 && v.tick - mem.atkStart > 30 / Math.max(0.1, me.stats.as) - 3) mem.atkStart = v.tick;
  else if (v.self.atkPhase === 2 && v.tick - mem.atkStart > 30 / Math.max(0.1, me.stats.as)) mem.atkStart = v.tick - Math.round((30 * ctx.champ.base.windup) / Math.max(0.1, me.stats.as));
  const fountain = ctx.map.sides[ctx.team].fountain;
  const inFountain = dst(v.self, fountain) < fountain.r;
  if (!inFountain) mem.shopVisitDone = false;
  const go = (p: Pt): void => {
    const a = moveTo(v, mem, p);
    if (a) out.push(a);
  };

  // 2. recall channel: keep still unless an enemy shows up
  if (me.recallLeft > 0) {
    if (near(v.enemies, v.self, 1100).length === 0) return out;
    mem.lastMove = null;
    go(fountain);
    return out;
  }
  if (inFountain) {
    out.push(...shop(me, ctx, mem));
    const manaOk = v.self.maxMana <= 0 || v.self.mana / v.self.maxMana > 0.6;
    if (v.hpPct < 0.9 || !manaOk) {
      mem.mode = 'heal';
      return out;
    }
  }

  // 3. survive
  const surv = survive(v, ctx, mem, inFountain);
  if (surv) return [...out, ...surv];

  // 4. dodge
  const dodge = dodgeLine(v, ctx, mem, rng);
  if (dodge) return [...out, dodge];

  // 5. heal / shield allies (supports mostly; anyone with such a spell)
  if (v.self.atkPhase !== 1) {
    const sup = supportCast(v, ctx, mem.mode === 'fight');
    if (sup) return [...out, sup];
  }

  // 6. fight
  const fight = fightStep(v, ctx, mem, rng);
  if (fight) return [...out, ...fight];

  // 7. role
  out.push(...roleStep(v, ctx, mem, rng));
  stuckCheck(v, mem, rng, out);
  return out;
};

// ------------------------------------------------------------------ helpers

/** Move with throttling: every move runs A* in the sim, so only re-issue for a new goal or when stopped. */
function moveTo(v: View, mem: BotMemory, p: Pt): BotAction | null {
  if (dst(v.self, p) < 80 || v.tick < mem.holdUntil) return null;
  if (mem.lastMove && dst(mem.lastMove, p) < 200 && v.self.moving && v.tick - mem.lastMove.tick < 300) return null;
  mem.lastMove = { x: p.x, y: p.y, tick: v.tick };
  return { cmd: { t: 'move', x: p.x, y: p.y } };
}

/** Error injection: skip a correct but non-critical action (profile errorInjectionPct). */
const fumble = (ctx: BotStatic, rng: Rng): boolean => rng.chance(ctx.profile.behavior.errorInjectionPct / 100);

function levelUp(me: PlayerHud, ctx: BotStatic): BotAction | null {
  const can = (s: number): boolean => !!me.abilities[s]?.canLevel;
  const order = ctx.champ.maxOrder.map((k) => 'QWE'.indexOf(k)) as (0 | 1 | 2)[];
  let slot: 0 | 1 | 2 | 3 | -1 = -1;
  if (can(3)) slot = 3;
  else slot = order.find((s) => can(s) && me.abilities[s]!.rank === 0) ?? order.find((s) => can(s)) ?? -1;
  return slot === -1 ? null : { cmd: { t: 'levelUp', slot } };
}

function survive(v: View, ctx: BotStatic, mem: BotMemory, inFountain: boolean): BotAction[] | null {
  const fountain = ctx.map.sides[ctx.team].fountain;
  const foes = near(v.enemies, v.self, 1200);
  const friends = near(v.allies, v.self, 1200);
  const towerOnMe = v.enemyTowers.some((t) => t.atkTarget === v.me.eid);
  const low = v.hpPct < 0.3 && foes.length > 0;
  const outnumbered = v.hpPct < 0.55 && foes.length >= friends.length + 2;
  const stillUnsafe = mem.mode === 'retreat' && v.hpPct < 0.6 && foes.length > 0;
  if (!inFountain && (low || outnumbered || stillUnsafe || towerOnMe)) {
    mem.mode = 'retreat';
    const out: BotAction[] = [];
    const closest = Math.min(...foes.map((e) => dst(e, v.self)), Infinity);
    const sums = [4, 5].map((i) => v.me.abilities[i]);
    if (v.hpPct < 0.18 && closest < 650) {
      const heal = sums.findIndex((s) => s?.id === 'heilen' && s.rank > 0 && s.cdLeft <= 0);
      const flash = sums.findIndex((s) => s?.id === 'sprung' && s.rank > 0 && s.cdLeft <= 0);
      if (heal >= 0) out.push({ cmd: { t: 'spell', slot: heal as 0 | 1, x: v.self.x, y: v.self.y } });
      else if (flash >= 0 && closest < 450) out.push({ cmd: { t: 'spell', slot: flash as 0 | 1, x: fountain.x, y: fountain.y } });
    }
    if (closest < 500) {
      const esc = escapeCast(v, ctx, fountain);
      if (esc) out.push(esc);
    }
    const a = moveTo(v, mem, fountain);
    if (a) out.push(a);
    return out;
  }
  // go home: low HP (or after a retreat) walks/recalls to the fountain; enough gold for the next item recalls
  // when safe (profile recallGoldThreshold)
  const safe = near([...v.enemies, ...v.unnoticed], v.self, 1600).length === 0;
  const home = v.hpPct < 0.3 || (mem.mode === 'retreat' && v.hpPct < 0.6) || mem.mode === 'home';
  const thr = ctx.profile.behavior.recallGoldThreshold;
  const rich = thr !== null && spendable(v.me, mem) >= Math.max(thr, nextItemPrice(ctx, mem));
  if (!inFountain && (home || rich)) {
    if (safe && dst(v.self, fountain) > 2500 && near(v.enemyMinions, v.self, 650).length === 0) {
      mem.mode = 'recall';
      mem.lastMove = null;
      return [{ cmd: { t: 'recall' } }];
    }
    if (home) {
      mem.mode = 'home';
      const a = moveTo(v, mem, fountain);
      return a ? [a] : [];
    }
  }
  if (mem.mode === 'retreat' || mem.mode === 'home') mem.mode = 'lane';
  return null;
}

/** Step out of a visible enemy line skillshot heading at the bot (profile dodge rate + reaction delay). */
function dodgeLine(v: View, ctx: BotStatic, mem: BotMemory, rng: Rng): BotAction | null {
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
    if (react >= (along / speed) * 30 - 2) continue; // too late to react
    // perpendicular unit vector from the projectile line toward the bot
    let nx = rx - along * p.dx;
    let ny = ry - along * p.dy;
    const nl = Math.sqrt(nx * nx + ny * ny);
    if (nl > 1) (nx /= nl), (ny /= nl);
    else (nx = -p.dy), (ny = p.dx);
    const step = half + 60 - Math.abs(perp) + 40;
    mem.lastMove = null;
    res = { cmd: { t: 'move', x: v.self.x + nx * step, y: v.self.y + ny * step }, delay: react };
  }
  for (const id of mem.projSeen.keys()) if (!live.has(id)) mem.projSeen.delete(id);
  return res;
}

function fightStep(v: View, ctx: BotStatic, mem: BotMemory, rng: Rng): BotAction[] | null {
  const b = ctx.profile.behavior;
  const engage = Math.max(v.reach + 350, 900);
  const fighting = mem.mode === 'fight';
  const threshold = fighting ? -b.inertia * 0.3 : 0.05;
  let best = null;
  let bestScore = -Infinity;
  for (const e of v.enemies) {
    const d = dst(e, v.self);
    if (d > (fighting && e.serial === mem.fightTarget ? engage + 400 : engage)) continue;
    const s = tradeScore(v, ctx, e) + (e.serial === mem.fightTarget ? 0.15 : 0) - hpPct(e) * 0.2;
    if (s > bestScore) (bestScore = s), (best = e);
  }
  if (!best || bestScore < threshold) {
    if (fighting) {
      mem.mode = 'lane';
      // target vanished into fog: maybe chase to its last known position (profile chaseIntoFogPct)
      const last = mem.aware.get(mem.fightTarget);
      if (last && !v.enemies.some((e) => e.serial === mem.fightTarget) && !mem.chaseRolled.has(mem.fightTarget)) {
        const chase = rng.chance(b.chaseIntoFogPct / 100);
        mem.chaseRolled.set(mem.fightTarget, chase);
        if (chase && v.hpPct > 0.4) {
          const a = moveTo(v, mem, last);
          return a ? [a] : [];
        }
      }
    }
    return null;
  }
  if (!fighting || mem.fightTarget !== best.serial) {
    if (!fighting) mem.fightReadyAt = v.tick + Math.round(b.engageHesitationS * 30 * (0.5 + rng.next()));
    mem.mode = 'fight';
    mem.fightTarget = best.serial;
    mem.chaseRolled.delete(best.serial);
  }
  if (v.tick < mem.fightReadyAt) return null; // visible hesitation: keep farming meanwhile
  if (v.self.atkPhase === 1) return []; // never cancel own wind-up
  if (fumble(ctx, rng)) return [];
  const cast = offensiveCast(v, ctx, rng, best);
  if (cast) return [cast];
  // autos only in reach (or to finish a low target); no endless chases across the map
  const d = dst(v.self, best);
  if (d > v.reach + best.radius + 120 && !(hpPct(best) < 0.35 && d < engage)) return null;
  mem.lastMove = null;
  return v.self.atkTarget === best.id ? [] : [{ cmd: { t: 'attack', target: best.id } }];
}

/** Lane for this bot right now: role lane, jungle roaming lane, or mid after 15:00 once the own lane tower fell. */
function currentLane(v: View, ctx: BotStatic, mem: BotMemory, rng: Rng): LaneName {
  const b = ctx.profile.behavior;
  let lane: LaneName = ctx.lane ?? (['top', 'mid', 'bot'] as const)[Math.floor(v.time / (2 * b.macroIntervalS)) % 3]!;
  if (v.time >= 15 * 60 && ctx.lane) {
    const outer = ctx.map.sides[ctx.team].towers[ctx.lane][0]!;
    if (!v.ownTowers.some((t) => dst(t, outer) < 200)) {
      // ponytail: one-time roll; Phase 3 team AI decides grouping per macro interval with desires
      mem.groupRolled ??= rng.chance(b.groupAfterFirstTowerPct / 100);
      if (mem.groupRolled) lane = 'mid';
    }
  }
  return lane;
}

function roleStep(v: View, ctx: BotStatic, mem: BotMemory, rng: Rng): BotAction[] {
  if (mem.mode !== 'fight') mem.mode = 'lane';
  const out: BotAction[] = [];
  const go = (p: Pt): BotAction[] => {
    const a = moveTo(v, mem, p);
    return a ? [a] : [];
  };
  const melee = ctx.champ.attackType === 'melee';
  let behind = melee ? 220 : Math.max(250, v.me.stats.range * 0.75);
  if (ctx.role === 'jungle') {
    // gank: a noticed, hurt enemy champion within reach of a short walk
    const prey = v.enemies.find((e) => hpPct(e) < 0.45 && dst(e, v.self) < 3500 && !towerCovering(v, e));
    if (prey) return go(prey);
    const j = jungle(v, ctx, mem);
    if (j === 'wait') return out;
    if (j !== 'roam') {
      if ('cmd' in j) {
        mem.lastMove = null;
        return [j];
      }
      return go(j);
    }
  }
  const lane = currentLane(v, ctx, mem, rng);
  let farm = true;
  // minion aggro on me (no tank in front): back off further behind the wave
  if (v.enemyMinions.filter((m) => m.atkTarget === v.me.eid).length >= 2) behind += 350;
  let spot = laneSpot(v, ctx, lane, behind);
  if (ctx.role === 'support') {
    const adcSlot = ctx.players.find((p) => p.team === ctx.team && p.role === 'adc')?.slot;
    const adc = v.allies.find((a) => a.slot === adcSlot);
    const fountain = ctx.map.sides[ctx.team].fountain;
    if (adc && dst(adc, fountain) > 2500) {
      farm = false; // leave the CS to the ADC
      const pts = ctx.map.sides[ctx.team].lanes[lane];
      spot = lanePoint(pts, Math.max(0, laneProgress(pts, adc).s - 150));
      behind += 150;
    }
  }
  if (v.self.atkPhase === 1) return out; // never cancel own wind-up
  if (farm) {
    const lh = lastHit(v, ctx, mem, rng, decisionTicks(ctx));
    if (lh) {
      if (fumble(ctx, rng)) return out;
      mem.lastMove = null;
      if (lh.delay || v.self.atkTarget !== (lh.cmd as { target: number }).target) out.push(lh);
      return out;
    }
    const want = dst(v.self, spot) < 700 ? pushTarget(v, ctx) : -1;
    if (want >= 0) {
      mem.lastMove = null;
      if (v.self.atkTarget !== want) out.push({ cmd: { t: 'attack', target: want } });
      return out;
    }
  }
  // drop a lingering auto target (minion: keeps the attack timer free for the next last hit; champion: no chase)
  if (v.self.atkTarget >= 0) {
    mem.lastMove = null;
    const a = moveTo(v, mem, spot);
    out.push(a ?? { cmd: { t: 'stop' } });
    return out;
  }
  return go(spot);
}

/** No progress toward the move goal for 10 s: re-path via a random nearby point. */
function stuckCheck(v: View, mem: BotMemory, rng: Rng, out: BotAction[]): void {
  mem.trail.push({ x: v.self.x, y: v.self.y, tick: v.tick });
  while (mem.trail.length && v.tick - mem.trail[0]!.tick > 330) mem.trail.shift();
  const old = mem.trail[0];
  if (!old || !mem.lastMove || v.tick - old.tick < 300) return;
  if (dst(v.self, mem.lastMove) > 300 && dst(old, v.self) < 80) {
    const a = rng.next() * 2 - 1;
    const b = rng.next() * 2 - 1;
    out.push({ cmd: { t: 'move', x: v.self.x + a * 500, y: v.self.y + b * 500 } });
    mem.lastMove = null;
    mem.holdUntil = v.tick + 45;
    mem.trail = [];
  }
}
