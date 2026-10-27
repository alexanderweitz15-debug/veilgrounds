// Bots use the jungle plants (sim: src/sim/systems/plants.ts; values: data/bots/values.json "plants"). One leaf, `plants`,
// between `fountain` and `survive` in the tree. A bot only sees what its team sees, so only visible, ripe plants count.
//   Honigfrucht  pop at low HP when no enemy champion is near; walk over the honey pieces afterwards (also below 90 % HP)
//   Manafrucht   pop when mana is low and it is safe
//   Schildfrucht pop when an enemy champion is a fight away (800-1800) and the bot is not outnumbered
//   Windfrucht   pop while fleeing (nobody within reach) or chasing a target that is still out of reach
//   Spähfrucht   pop for vision: junglers and supports, safe, at most every 90 s
// Sprungfrucht is left alone (it launches the bot too). A pop is an auto attack on the 1-HP plant. The bot keeps
// one target at a time (per-bot state in a WeakMap: BotMemory/BotExt stay untouched) and drops it after 12 s.
import { Kind } from '../../sim/types';
import values from '../../data/bots/values.json';
import type { NodeCtx, NodeResult } from '../bt/types';
import type { SnapEntity } from './types';
import { near } from './perception';
import { dst } from './geo';

const V = values.plants;

interface PlantMem {
  /** Serial of the plant being popped, tick the walk started, serials given up on (until tick). */
  target: { serial: number; type: string; since: number } | null;
  blocked: Map<number, number>;
  spaehAt: number;
}
const mems = new WeakMap<object, PlantMem>();
const memOf = (key: object): PlantMem => {
  let m = mems.get(key);
  if (!m) mems.set(key, (m = { target: null, blocked: new Map(), spaehAt: -1e9 }));
  return m;
};

const TICKS = 30;

/** Ripe, visible fruits of one type that no enemy tower covers, nearest first. */
function fruits(n: NodeCtx, type: string, maxDist: number, blocked: Map<number, number>): SnapEntity[] {
  const { v } = n;
  return v.snap.entities
    .filter((e) => e.kind === Kind.Plant && e.alive && e.variant === type && e.grow === undefined && (blocked.get(e.serial) ?? 0) <= v.tick)
    .filter((e) => dst(e, v.self) <= maxDist && !v.enemyTowers.some((t) => dst(t, e) < V.towerClear))
    .sort((a, b) => dst(a, v.self) - dst(b, v.self));
}

/** What the bot wants right now: [plant type, why, max detour] in priority order, filtered by the situation. */
function wants(n: NodeCtx, pm: PlantMem): { type: string; why: string; detour: number }[] {
  const { v, ctx, mem } = n;
  const foes = [...v.enemies, ...v.unnoticed];
  const safe = near(foes, v.self, V.safeR).length === 0;
  const out: { type: string; why: string; detour: number }[] = [];
  if (safe && v.hpPct < V.honig.hp) out.push({ type: 'honigfrucht', why: 'low hp, safe', detour: v.hpPct < V.honig.hpLow ? V.honig.detourLow : V.honig.detour });
  if (safe && v.self.maxMana > 0 && v.self.mana / v.self.maxMana < V.mana.pct) out.push({ type: 'manafrucht', why: 'low mana, safe', detour: V.mana.detour });
  const closest = Math.min(...foes.map((e) => dst(e, v.self)), Infinity);
  if (closest >= V.schild.enemyMin && closest <= V.schild.enemyMax && v.hpPct >= V.schild.hp && v.allies.length + 1 >= v.enemies.length && mem.mode !== 'retreat' && mem.mode !== 'home') {
    out.push({ type: 'schildfrucht', why: 'fight ahead', detour: V.schild.detour });
  }
  const fleeing = mem.mode === 'retreat' || mem.mode === 'home';
  const serial = mem.ext.trade?.serial ?? mem.fightTarget;
  const target = serial >= 0 ? v.enemies.find((e) => e.serial === serial) : undefined;
  const chasing = (!!mem.ext.trade || mem.mode === 'fight') && !!target && dst(target, v.self) > V.wind.chaseGap;
  if ((fleeing && closest >= V.wind.enemyMin) || chasing) out.push({ type: 'windfrucht', why: fleeing ? 'fleeing' : 'chasing', detour: V.wind.detour });
  if (safe && V.spaeh.roles.includes(ctx.role) && v.hpPct > V.spaeh.hp && v.tick - pm.spaehAt > V.spaeh.everyS * TICKS) out.push({ type: 'spaehfrucht', why: 'vision', detour: V.spaeh.detour });
  return out;
}

export function plants(n: NodeCtx): NodeResult {
  const { v, ctx, mem } = n;
  if (ctx.mode === 'arena' || v.me.recallLeft > 0 || v.me.inFountain) return 'failure';
  const pm = memOf(mem);
  const foes = [...v.enemies, ...v.unnoticed];

  // 1. honey pieces on the ground: walk over the nearest one while hurt and nobody is close
  if (v.hpPct < V.honig.eatBelow && near(foes, v.self, V.honig.pieceSafeR).length === 0) {
    const piece = v.snap.entities
      .filter((e) => e.kind === Kind.Plant && e.alive && e.variant === 'honigstueck' && dst(e, v.self) <= V.honig.pieceR)
      .sort((a, b) => dst(a, v.self) - dst(b, v.self))[0];
    if (piece) {
      const lm = mem.lastMove;
      if (!v.self.moving || !lm || dst(lm, piece) > 40) {
        mem.lastMove = { x: piece.x, y: piece.y, tick: v.tick };
        n.out.push({ cmd: { t: 'move', x: piece.x, y: piece.y } });
        n.log('plants', 'honey', 'eat honey piece', { dist: Math.round(dst(piece, v.self)) }, { hp: v.hpPct });
      }
      return 'success';
    }
  }

  // 2. the plant being popped: keep going until it is gone, the situation changed or it takes too long
  const t = pm.target;
  if (t) {
    const e = v.snap.entities.find((x) => x.serial === t.serial && x.alive);
    const still = e && wants(n, pm).some((w) => w.type === t.type);
    if (!e || !still || v.tick - t.since > V.giveUpS * TICKS) {
      if (e) pm.blocked.set(t.serial, v.tick + V.blockS * TICKS);
      if (!e && t.type === 'spaehfrucht') pm.spaehAt = v.tick;
      pm.target = null;
    } else {
      if (v.self.atkTarget !== e.id && v.self.atkPhase !== 1) {
        mem.lastMove = null;
        n.out.push({ cmd: { t: 'attack', target: e.id } });
      }
      return 'success';
    }
  }

  // 3. pick a new plant
  for (const w of wants(n, pm)) {
    const e = fruits(n, w.type, w.detour, pm.blocked)[0];
    if (!e) continue;
    pm.target = { serial: e.serial, type: w.type, since: v.tick };
    mem.lastMove = null;
    n.out.push({ cmd: { t: 'attack', target: e.id } });
    n.log('plants', w.type, w.why, { dist: Math.round(dst(e, v.self)) }, { hp: v.hpPct });
    return 'success';
  }
  return 'failure';
}
