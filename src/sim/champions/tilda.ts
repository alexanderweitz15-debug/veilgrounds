// Tilda Saitenwind hooks (musician support). Contract: ./hooks.ts, behaviour list: docs/champion-hooks.md.
// Passive Note Gleaning: notes (heal / speed / stun colour) appear near her, only her team sees them; walking over one stores it.
// Songs: Q heals (green notes +25 % each), W speeds (blue +8 % each), E chord stuns (red: 0.4 s + 0.2 s each), R uses all.
import type { Sim } from '../sim';
import { sec } from '../types';
import { addBuff, healUnit } from '../buffs';
import { nearestWalkable, walkable } from '../map';
import { scaleAmount } from '../systems/abilities';
import type { ChampionHooks, ChampionVisuals, EffectCtx, VisualObject } from './hooks';
import { hookState, peekState } from './util';
import { alliedChamps } from './dagny';
import V from '../../data/champions/tilda.values.json';

/** Note colours = song slots: 0 heal (Q, green), 1 speed (W, blue), 2 stun (E, red). */
const HUE = [120, 195, 345];
interface Note {
  id: number;
  x: number;
  y: number;
  color: number;
  until: number;
}
interface TState {
  stacks: [number, number, number];
  notes: Note[];
  nextSpawn: number;
  nextId: number;
}
const KEY = 'tilda';
const state = (sim: Sim, eid: number): TState => {
  const m = hookState<TState>(sim, KEY);
  let s = m.get(eid);
  if (!s) m.set(eid, (s = { stacks: [0, 0, 0], notes: [], nextSpawn: sec(V.notes.firstSec), nextId: 0 }));
  return s;
};

/** Stored notes of a colour (tests, bots, HUD). Read-only. */
export const tildaNotes = (sim: Sim, eid: number, color: number): number => peekState<TState>(sim, KEY)?.get(eid)?.stacks[color] ?? 0;

function tildaTick(sim: Sim, eid: number): void {
  const s = hookState<TState>(sim, KEY).get(eid);
  if (!s) return;
  const { Pos, Unit } = sim.c;
  if (!Unit.alive[eid]) {
    s.notes = [];
    s.stacks = [0, 0, 0];
    return;
  }
  s.notes = s.notes.filter((n) => n.until > sim.tick);
  // pick up
  const r2 = V.notes.pickupRadius * V.notes.pickupRadius;
  s.notes = s.notes.filter((n) => {
    if ((n.x - Pos.x[eid]!) ** 2 + (n.y - Pos.y[eid]!) ** 2 > r2) return true;
    s.stacks[n.color] = Math.min(V.notes.maxPerColor, s.stacks[n.color]! + 1);
    return false;
  });
  if (sim.tick < s.nextSpawn || s.notes.length >= V.notes.maxOnMap) return;
  s.nextSpawn = sim.tick + sec(V.notes.everySec);
  const a = sim.rng.range(0, Math.PI * 2);
  const d = sim.rng.range(V.notes.minDist, V.notes.maxDist);
  // ponytail: cos/sin are not allowed in sim code (determinism): a 16-direction table instead
  const [cx, cy] = DIRS[Math.floor((a / (Math.PI * 2)) * 16) % 16]!;
  let x = Pos.x[eid]! + cx * d;
  let y = Pos.y[eid]! + cy * d;
  if (!walkable(sim.map.nav, x, y)) ({ x, y } = nearestWalkable(sim.map.nav, x, y));
  s.notes.push({ id: s.nextId++, x, y, color: sim.rng.int(3), until: sim.tick + sec(V.notes.lifeSec) });
}

// 16 unit directions (exact decimals: no Math.sin/cos in the sim)
const DIRS: [number, number][] = [
  [1, 0], [0.9239, 0.3827], [0.7071, 0.7071], [0.3827, 0.9239], [0, 1], [-0.3827, 0.9239], [-0.7071, 0.7071], [-0.9239, 0.3827],
  [-1, 0], [-0.9239, -0.3827], [-0.7071, -0.7071], [-0.3827, -0.9239], [0, -1], [0.3827, -0.9239], [0.7071, -0.7071], [0.9239, -0.3827],
];

function tildaVisuals(sim: Sim, eid: number): ChampionVisuals {
  const s = peekState<TState>(sim, KEY)?.get(eid);
  const total = s ? s.stacks[0] + s.stacks[1] + s.stacks[2] : 0;
  const v: ChampionVisuals = { passive: { stacks: total, max: 3 * V.notes.maxPerColor, ready: total > 0 } };
  if (!s || !sim.c.Unit.alive[eid]) return v;
  const life = sec(V.notes.lifeSec);
  const objs: VisualObject[] = s.notes.map((n) => ({ key: `${eid}:n${n.id}`, tag: 'tilda_note', x: n.x, y: n.y, r: 45, shape: 'pin', left: n.until - sim.tick, total: life, n: n.color, hue: HUE[n.color]!, hidden: true }));
  if (objs.length) v.objects = objs;
  v.marks = (['tilda_heal', 'tilda_speed', 'tilda_stun'] as const).flatMap((id, i) => (s.stacks[i]! > 0 ? [{ target: eid, id, n: s.stacks[i]!, max: V.notes.maxPerColor }] : []));
  return v;
}

/** Allied champions in range of the effect centre (the caster included). */
const alliesIn = (sim: Sim, ctx: EffectCtx): number[] => {
  const { Pos } = sim.c;
  const r = ctx.ability.radius ?? 650;
  return alliedChamps(sim, ctx.caster).filter((a) => (Pos.x[a]! - ctx.x) ** 2 + (Pos.y[a]! - ctx.y) ** 2 <= (r + 40) ** 2);
};
const healEffect = (ctx: EffectCtx) => ctx.ability.effects.find((e) => e.kind === 'heal') as { amount: Parameters<typeof scaleAmount>[1] } | undefined;
/** Extra heal of `n` green notes on top of the generic heal effect. */
function extraHeal(sim: Sim, ctx: EffectCtx, n: number): void {
  const h = healEffect(ctx);
  if (!h || n <= 0) return;
  for (const a of alliesIn(sim, ctx)) healUnit(sim, a, scaleAmount(sim, h.amount, ctx.caster, a, ctx.rank) * V.heal.perNote * n);
}
function extraSpeed(sim: Sim, ctx: EffectCtx, n: number): void {
  if (n > 0) for (const a of alliesIn(sim, ctx)) addBuff(sim, a, { kind: 'stat', stat: 'ms', id: 'tilda_note_ms', src: ctx.caster, pct: V.speed.pctPerNote * n, ticks: sec(V.speed.sec) });
}

export const hooks: ChampionHooks = {
  visuals: tildaVisuals,
  onTick: tildaTick,
  passive: {
    tilda_notes: {
      onSpawn(sim, eid) {
        state(sim, eid);
      },
    },
  },
  effects: {
    tilda_q_notes(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      const s = state(sim, ctx.caster);
      extraHeal(sim, ctx, s.stacks[0]);
      s.stacks[0] = 0;
    },
    tilda_w_notes(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      const s = state(sim, ctx.caster);
      extraSpeed(sim, ctx, s.stacks[1]);
      s.stacks[1] = 0;
    },
    tilda_e_notes(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      const s = state(sim, ctx.caster);
      const n = s.stacks[2];
      if (n > 0) for (const t of ctx.hits) addBuff(sim, t, { kind: 'stun', id: 'tilda_e', src: ctx.caster, ticks: sec(V.stun.baseSec + V.stun.perNoteSec * n) });
      s.stacks[2] = 0;
    },
    tilda_r_notes(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      const s = state(sim, ctx.caster);
      extraHeal(sim, ctx, s.stacks[0]);
      extraSpeed(sim, ctx, s.stacks[1]);
      const stun = ctx.ability.effects.find((e) => e.kind === 'stun') as { duration: number | number[] } | undefined;
      const base = stun ? (typeof stun.duration === 'number' ? stun.duration : stun.duration[Math.min(stun.duration.length, ctx.rank) - 1]!) : 0;
      if (s.stacks[2] > 0) for (const t of ctx.hits) addBuff(sim, t, { kind: 'stun', id: 'tilda_r', src: ctx.caster, ticks: sec(base + V.stun.rPerNoteSec * s.stacks[2]) });
      s.stacks = [0, 0, 0];
    },
  },
};
