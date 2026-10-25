// Per-tick dodge of the micro layer (A13): visible enemy line skillshots and ground telegraphs.
//
// Information: only what the bot's team sees. A line skillshot is reconstructed from the fog-filtered cast event
// (caster visible, cursor point, wind-up end) plus the static ability data - exactly the missile a player sees leave
// the caster; a ground telegraph is the 'zone' event (centre, radius, resolve tick). No cooldowns, no hidden units.
// Reaction: the profile's reaction time (+ the attention penalty); predictiveDodgePct reads the cast wind-up / the
// telegraph at once (reaction 0, off while distracted). The rank's error rate acts through the attention model
// (a distracted bot reacts 150 ms later and reads nothing); there is no separate "ignore x % of the threats" roll, the
// dodge rate is what reaction time, geometry and walking speed allow. Which spells are worth a sidestep comes from the
// hints (threat).
//
// Execution: at the decision tick the threat is re-checked against the real positions, the cheapest exit from the
// danger area that the bot can reach in time is chosen (12 directions: shortest walk, walkable, not into a tower, not
// into the enemies, not into another threat), one move command is issued, and the bot holds all other orders until
// the missile has passed (BotMemory.busy, so the next decision does not walk back into it). An own auto wind-up is
// finished first when that still leaves time.

import { lineWalkable, walkable } from '../../sim/map';
import type { Rng } from '../../sim/rng';
import type { BotAction, BotMemory, BotStatic, SnapEntity, Snapshot } from '../bot/types';
import type { View } from '../bot/perception';
import { ticksOfMs, towerCovering } from '../bot/perception';
import { dst } from '../bot/geo';
import { championData } from '../../sim/champions';
import { Kind } from '../../sim/types';
import { sampleReactionMs } from '../profiles';
import { attentionAt, reactionPenaltyMs } from '../humanize/attention';
import { hintsOf } from '../../data/bots/hints';
import { MICRO } from './params';

type Vec = { x: number; y: number };

interface Threat {
  key: string;
  kind: 'line' | 'circle' | 'segment';
  /** Tick the area resolves where the bot stands (zones: the resolve tick; lines: computed per point). */
  at: number;
  slot: number;
  src: number;
  threat: number;
  // line: origin, unit direction, length, half width, speed (0 = instant), launch tick
  ox: number;
  oy: number;
  dx: number;
  dy: number;
  len: number;
  half: number;
  speed: number;
  launch: number;
  blockable: boolean;
  // circle: centre + radius (follow: the caster's position); segment: a-b + half width
  cx: number;
  cy: number;
  r: number;
  bx: number;
  by: number;
  follow: boolean;
  /** Decision tick (reaction), -1 = bot has not noticed that it stands in the danger yet. */
  decideAt: number;
  done: boolean;
}

export interface DodgeStats {
  threats: number;
  ignored: number;
  moved: number;
  infeasible: number;
  notNeeded: number;
}

interface DodgeState {
  threats: Map<string, Threat>;
  stats: DodgeStats;
}

const STATES = new WeakMap<BotMemory, DodgeState>();
const stateOf = (mem: BotMemory): DodgeState => {
  let s = STATES.get(mem);
  if (!s) STATES.set(mem, (s = { threats: new Map(), stats: { threats: 0, ignored: 0, moved: 0, infeasible: 0, notNeeded: 0 } }));
  return s;
};
export const dodgeStats = (mem: BotMemory): DodgeStats => stateOf(mem).stats;

const INSTANT = 20000;
/** Search directions for the sidestep and the march step (units) used to find the edge of the danger area. */
const DIRS = 12;
const STEP = 20;
const MAX_SIDE = 700;

// ------------------------------------------------------------------ geometry

/** Distance the missile has travelled at `tick` (0 before the launch). */
const travelled = (t: Threat, tick: number): number => (tick <= t.launch ? 0 : t.speed > 0 && t.speed < INSTANT ? ((tick - t.launch) / 30) * t.speed : t.len);

/** Tick the missile of a line threat reaches the along-distance `along`. */
const arrival = (t: Threat, along: number): number => (t.speed > 0 && t.speed < INSTANT ? t.launch + Math.ceil((Math.max(0, along) / t.speed) * 30) : t.launch);

/** Is the point inside the (still dangerous part of the) area? `rad` = the bot's radius, `pad` extra margin. */
function inside(t: Threat, p: Vec, rad: number, pad: number, tick: number, caster?: Vec): boolean {
  if (t.kind === 'line') {
    const rx = p.x - t.ox;
    const ry = p.y - t.oy;
    const along = rx * t.dx + ry * t.dy;
    // already passed: the missile is beyond this point
    if (along < travelled(t, tick) - rad) return false;
    if (along > t.len + rad) return false;
    if (along < -rad) return false;
    return Math.abs(rx * -t.dy + ry * t.dx) <= t.half + rad + pad;
  }
  if (t.kind === 'circle') {
    const c = t.follow && caster ? caster : { x: t.cx, y: t.cy };
    return dst(p, c) <= t.r + rad + pad;
  }
  // segment a -> b
  const abx = t.bx - t.cx;
  const aby = t.by - t.cy;
  const l2 = abx * abx + aby * aby || 1;
  const k = Math.max(0, Math.min(1, ((p.x - t.cx) * abx + (p.y - t.cy) * aby) / l2));
  return Math.hypot(p.x - (t.cx + abx * k), p.y - (t.cy + aby * k)) <= t.r + rad + pad;
}

// ------------------------------------------------------------------ ingest

function ingest(snap: Snapshot, ctx: BotStatic, st: DodgeState, idx: Map<number, SnapEntity>): void {
  const T = snap.tick;
  for (const ev of snap.events) {
    if (ev.e === 'cast') {
      if (ev.recast || ev.slot > 3) continue;
      const src = idx.get(ev.src);
      if (!src || src.team === ctx.team || src.kind !== Kind.Champion || !src.champ) continue;
      const champ = championData(src.champ);
      const ab = champ.abilities[ev.slot];
      if (!ab || ab.type !== 'skillshot_line') continue;
      const h = hintsOf(champ).abilities[ev.slot]!;
      if (h.threat < MICRO.dodge.minThreat) continue;
      const l = Math.hypot(ev.x - src.x, ev.y - src.y);
      if (l < 1) continue;
      const key = `L${ev.src}:${ev.slot}:${T}`;
      if (st.threats.has(key)) continue;
      st.threats.set(key, {
        key,
        kind: 'line',
        at: ev.at ?? T,
        slot: ev.slot,
        src: ev.src,
        threat: h.threat,
        ox: src.x,
        oy: src.y,
        dx: (ev.x - src.x) / l,
        dy: (ev.y - src.y) / l,
        len: Math.min(h.range, 3000),
        half: h.width / 2,
        speed: h.speed,
        launch: ev.at ?? T,
        blockable: !!ab.flags?.includes('blocked_by_minions'),
        cx: 0,
        cy: 0,
        r: 0,
        bx: 0,
        by: 0,
        follow: false,
        decideAt: -1,
        done: false,
      });
    } else if (ev.e === 'zone') {
      if (ev.team === ctx.team) continue;
      // the telegraph is visible with the point; the caster need not be (its id is only used to follow self AoEs)
      const src = idx.get(ev.src);
      if (src && src.kind !== Kind.Champion) continue;
      // standing damage areas are not a one-time hit: skip them (the stand point logic leaves them)
      if (ev.until !== undefined && ev.until > ev.at + MICRO.dodge.persistentZoneTicks) continue;
      const key = `Z${ev.src}:${ev.start}:${Math.round(ev.x)}:${Math.round(ev.y)}`;
      if (st.threats.has(key)) continue;
      st.threats.set(key, {
        key,
        kind: ev.line ? 'segment' : 'circle',
        at: ev.at,
        slot: -1,
        src: ev.src,
        threat: 2,
        ox: 0,
        oy: 0,
        dx: 0,
        dy: 0,
        len: 0,
        half: 0,
        speed: 0,
        launch: ev.at,
        blockable: false,
        cx: ev.line ? ev.line.ax : ev.x,
        cy: ev.line ? ev.line.ay : ev.y,
        r: ev.line ? ev.line.width / 2 : ev.r,
        bx: ev.line ? ev.line.bx : 0,
        by: ev.line ? ev.line.by : 0,
        follow: !!ev.follow,
        decideAt: -1,
        done: false,
      });
    }
  }
}

// ------------------------------------------------------------------ the step

export function dodgeStep(snap: Snapshot, ctx: BotStatic, mem: BotMemory, rng: Rng, v: View, idx: Map<number, SnapEntity>): BotAction[] {
  const st = stateOf(mem);
  const T = snap.tick;
  ingest(snap, ctx, st, idx);
  if (!st.threats.size) return [];
  const me = v.self;
  const rad = me.radius;
  const out: BotAction[] = [];
  const b = ctx.profile.behavior;
  const casterOf = (t: Threat): Vec | undefined => idx.get(t.src);
  let acted = false;
  for (const t of [...st.threats.values()]) {
    // forget finished threats
    const end = t.kind === 'line' ? arrival(t, t.len) + 10 : t.at + 10;
    if (T > end || (t.done && T > t.at + 5)) {
      st.threats.delete(t.key);
      continue;
    }
    if (t.done) continue;
    const covered = inside(t, me, rad, 0, T, casterOf(t));
    if (t.decideAt < 0) {
      if (!covered) continue;
      // blocked by a minion of the bot's team in front of it: the missile never arrives
      if (t.blockable && blockedBeforeMe(t, me, v)) continue;
      // first time the bot stands in the danger: reaction time (or a read of the wind-up), attention
      st.stats.threats++;
      const att = attentionAt(mem, T);
      const predicted = rng.chance(b.predictiveDodgePct / 100) && att.predictiveDodge;
      const react = predicted ? 1 : ticksOfMs(sampleReactionMs(b, rng) + reactionPenaltyMs(mem, T));
      // the missile is a thing the bot reacts to once it exists (a read of the wind-up reacts at once)
      t.decideAt = (predicted ? T : Math.max(T, t.kind === 'line' ? t.launch : T)) + react;
      continue;
    }
    if (T < t.decideAt) continue;
    // ---- decision tick
    t.done = true;
    if (acted) continue;
    if (!covered) {
      st.stats.notNeeded++;
      continue;
    }
    if (!me.alive || (v.me.recallLeft > 0 && t.threat < 2)) continue;
    // own spell wind-up / channel: the bot does not cancel it
    if (T < mem.busyUntil && T >= mem.busyFrom - 1) {
      st.stats.infeasible++;
      continue;
    }
    const hitAt = t.kind === 'line' ? arrival(t, (me.x - t.ox) * t.dx + (me.y - t.oy) * t.dy) : t.at;
    // finish a running auto wind-up when the sidestep still fits afterwards
    if (me.atkPhase === 1 && me.atkEnd !== undefined && me.atkEnd + MICRO.dodge.windupSlackTicks < hitAt - exitTicks(t, me, rad, v)) {
      t.done = false;
      t.decideAt = me.atkEnd + 1;
      continue;
    }
    const plan = chooseExit(t, st, v, ctx, T, hitAt, casterOf(t));
    if (!plan) {
      st.stats.infeasible++;
      ctx.log.push({ tick: T, bot: ctx.slot, node: 'dodge', inputs: { ability: t.slot, left: hitAt - T, kind: t.kind }, chosen: 'none', reason: 'no exit reachable in time' });
      continue;
    }
    st.stats.moved++;
    acted = true;
    out.push({ cmd: { t: 'move', x: plan.x, y: plan.y } });
    mem.lastMove = null;
    mem.cancelTags.add('orb');
    mem.cancelTags.add('lh');
    // hold every other order until the missile / the area has resolved
    mem.busyFrom = T;
    mem.busyUntil = Math.max(mem.busyUntil, hitAt + MICRO.dodge.holdTicks);
    mem.busySlot = -1;
    ctx.log.push({
      tick: T,
      bot: ctx.slot,
      node: 'dodge',
      inputs: { ability: t.slot, left: hitAt - T, walk: Math.round(plan.dist), kind: t.kind, threat: t.threat },
      chosen: 'sidestep',
      reason: t.kind === 'line' ? 'line skillshot' : 'ground telegraph',
    });
  }
  return out;
}

/** Ticks the sidestep needs at the bot's speed (best direction by straight-line exit distance). */
function exitTicks(t: Threat, me: SnapEntity, rad: number, v: View): number {
  let best = Infinity;
  for (let i = 0; i < DIRS; i++) {
    const a = (i * 2 * Math.PI) / DIRS;
    const s = exitDist(t, me, { x: Math.cos(a), y: Math.sin(a) }, rad, 0);
    if (s < best) best = s;
  }
  return Math.ceil((best / Math.max(100, v.me.stats.ms)) * 30);
}

/** Distance along `dir` from p until the point is out of the danger area (+ margin); MAX_SIDE+ when never. */
function exitDist(t: Threat, p: Vec, dir: Vec, rad: number, tick: number, caster?: Vec): number {
  for (let s = 0; s <= MAX_SIDE; s += STEP) {
    if (!inside(t, { x: p.x + dir.x * s, y: p.y + dir.y * s }, rad, MICRO.dodge.margin, tick, caster)) return s;
  }
  return MAX_SIDE + 1;
}

function blockedBeforeMe(t: Threat, me: Vec, v: View): boolean {
  const alongMe = (me.x - t.ox) * t.dx + (me.y - t.oy) * t.dy;
  for (const m of [...v.ownMinions, ...v.monsters]) {
    const rx = m.x - t.ox;
    const ry = m.y - t.oy;
    const along = rx * t.dx + ry * t.dy;
    if (along <= 0 || along >= alongMe) continue;
    if (Math.abs(rx * -t.dy + ry * t.dx) <= t.half + m.radius) return true;
  }
  return false;
}

interface Exit {
  x: number;
  y: number;
  dist: number;
}

function chooseExit(t: Threat, st: DodgeState, v: View, ctx: BotStatic, tick: number, hitAt: number, caster: Vec | undefined): Exit | null {
  const me = v.self;
  const rad = me.radius;
  const nav = ctx.map.nav;
  const ms = Math.max(100, v.me.stats.ms);
  // the command needs a tick to turn into movement
  const reach = (ms / 30) * Math.max(0, hitAt - tick - 1);
  const enemies = v.snap.entities.filter((e) => e.kind === Kind.Champion && e.team !== ctx.team && e.alive);
  let best: Exit | null = null;
  let bestCost = Infinity;
  for (let i = 0; i < DIRS; i++) {
    const a = (i * 2 * Math.PI) / DIRS;
    const dir = { x: Math.cos(a), y: Math.sin(a) };
    const s = exitDist(t, me, dir, rad, tick, caster);
    if (s > reach || s > MAX_SIDE) continue;
    const p = { x: me.x + dir.x * (s + STEP), y: me.y + dir.y * (s + STEP) };
    if (!walkable(nav, p.x, p.y) || !lineWalkable(nav, me.x, me.y, p.x, p.y)) continue;
    let cost = s;
    if (towerCovering(v, p) && !towerCovering(v, me)) cost += MICRO.dodge.towerPenalty;
    for (const e of enemies) if (dst(e, p) < dst(e, me) && dst(e, p) < 600) cost += MICRO.dodge.enemyPenalty;
    for (const o of st.threats.values()) if (o !== t && !o.done && inside(o, p, rad, 0, tick, undefined)) cost += 500;
    if (cost < bestCost) {
      bestCost = cost;
      best = { x: p.x, y: p.y, dist: s };
    }
  }
  return best;
}
