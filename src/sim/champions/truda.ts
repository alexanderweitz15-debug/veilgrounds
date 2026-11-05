// Truda Sporenhauch hooks: spore fields (Q lob, W root), fields poison + slow enemies inside and spread to adjacent
// ground when an enemy stands in them for 0.5 s (cap 6 fields), E spreads all fields at once, R bursts every field.
// Blight passive: autos on poisoned enemies deal bonus magic damage. All state in sim.state (per caster eid).

import type { Sim } from '../sim';
import { sec } from '../types';
import { addBuff, hasBuff } from '../buffs';
import { dist2 } from '../vec';
import { walkable } from '../map';
import { applyEffects, enemiesInRadius, rv, setCooldown } from '../systems/abilities';
import type { ChampionHooks, ChampionVisuals, VisualObject } from './hooks';
import { byLevel, stateMap } from './dagny';
import { peekState } from './util';

const POISON = 'truda_poison';
export const FIELD_CAP = 6;
const FIELD_TICKS = sec(5);
const CHILD_TICKS = sec(4);
const SPREAD_TICKS = 15; // 0.5 s standing in a field
const SPREAD_CD = sec(1.5);
const MAX_GEN = 2;
const EVAL_EVERY = 3; // fields act at 10 Hz
const BURST_TICKS = 12;
/** Six hex directions for Overgrowth (E), fixed order = deterministic. */
const HEX: [number, number][] = [[1, 0], [0.5, 0.866], [-0.5, 0.866], [-1, 0], [-0.5, -0.866], [0.5, -0.866]];

interface Field {
  id: number;
  x: number;
  y: number;
  r: number;
  until: number;
  total: number;
  gen: number;
  /** consecutive ticks each enemy has stood in the field */
  inside: Map<number, number>;
  spreadAt: number;
}
interface Burst {
  id: number;
  x: number;
  y: number;
  r: number;
  until: number;
}
interface Garden {
  next: number;
  fields: Field[];
  bursts: Burst[];
}
const gardens = (sim: Sim): Map<number, Garden> => stateMap<Garden>(sim, 'trudaGarden');
const garden = (sim: Sim, eid: number): Garden => {
  let g = gardens(sim).get(eid);
  if (!g) gardens(sim).set(eid, (g = { next: 1, fields: [], bursts: [] }));
  return g;
};

export const trudaFieldCount = (sim: Sim, eid: number): number => gardens(sim).get(eid)?.fields.length ?? 0;
export const trudaFields = (sim: Sim, eid: number): readonly { x: number; y: number; r: number; gen: number }[] => gardens(sim).get(eid)?.fields ?? [];

/** A field at (x, y); over the cap the oldest field is dropped (cast fields), spread fields just do not appear. */
export function addField(sim: Sim, eid: number, x: number, y: number, r: number, ticks: number, gen: number, force: boolean): boolean {
  const g = garden(sim, eid);
  if (g.fields.length >= FIELD_CAP) {
    if (!force) return false;
    g.fields.shift();
  }
  g.fields.push({ id: g.next++, x, y, r, until: sim.tick + ticks, total: ticks, gen, inside: new Map(), spreadAt: sim.tick + SPREAD_CD });
  return true;
}

/** A child field next to `f` in direction (dx, dy): on walkable ground, not on top of another field. */
function spread(sim: Sim, eid: number, f: Field, dx: number, dy: number): boolean {
  const g = garden(sim, eid);
  const r = Math.max(110, f.r * 0.9);
  const x = f.x + dx * f.r * 1.5;
  const y = f.y + dy * f.r * 1.5;
  if (!walkable(sim.map.nav, x, y)) return false;
  if (g.fields.some((o) => dist2(o.x, o.y, x, y) < (r * 0.9) * (r * 0.9))) return false;
  return addField(sim, eid, x, y, r, CHILD_TICKS, f.gen + 1, false);
}

function fieldTick(sim: Sim, eid: number, g: Garden): void {
  const { Pos } = sim.c;
  g.fields = g.fields.filter((f) => sim.tick < f.until);
  g.bursts = g.bursts.filter((b) => sim.tick < b.until);
  if (sim.tick % EVAL_EVERY !== 0) return;
  const pct = byLevel(sim, eid, 20, 35);
  const dot = byLevel(sim, eid, 8, 30) + 0.1 * sim.c.Stats.ap[eid]!;
  for (const f of [...g.fields]) {
    const now = new Set<number>();
    for (const e of enemiesInRadius(sim, eid, f.x, f.y, f.r)) {
      now.add(e);
      addBuff(sim, e, { kind: 'slow', id: 'truda_field', src: eid, pct, ticks: sec(0.6) });
      addBuff(sim, e, { kind: 'dot', id: POISON, src: eid, amount: dot, period: sec(1), dmgType: 'magic', ticks: sec(2) });
      const n = (f.inside.get(e) ?? 0) + EVAL_EVERY;
      f.inside.set(e, n);
      if (n >= SPREAD_TICKS && f.gen < MAX_GEN && sim.tick >= f.spreadAt) {
        const dx = Pos.x[e]! - f.x;
        const dy = Pos.y[e]! - f.y;
        let d = Math.sqrt(dx * dx + dy * dy);
        let ux = dx / d;
        let uy = dy / d;
        if (d < 20) {
          // enemy dead centre: grow outward, away from the caster
          const ox = f.x - Pos.x[eid]!;
          const oy = f.y - Pos.y[eid]!;
          d = Math.sqrt(ox * ox + oy * oy) || 1;
          ux = ox / d;
          uy = oy / d;
        }
        f.spreadAt = sim.tick + SPREAD_CD;
        f.inside.set(e, 0);
        spread(sim, eid, f, ux, uy);
      }
    }
    for (const e of [...f.inside.keys()]) if (!now.has(e)) f.inside.delete(e);
  }
}

function trudaTick(sim: Sim, eid: number): void {
  const g = gardens(sim).get(eid);
  if (!g) return;
  if (!sim.c.Unit.alive[eid]) {
    g.fields = [];
    return;
  }
  fieldTick(sim, eid, g);
}

function trudaVisuals(sim: Sim, eid: number): ChampionVisuals {
  const g = peekState<Garden>(sim, 'trudaGarden')?.get(eid);
  const v: ChampionVisuals = {};
  const objects: VisualObject[] = [];
  for (const f of g?.fields ?? []) if (sim.tick < f.until) objects.push({ key: `${eid}:${f.id}`, tag: 'truda_field', x: f.x, y: f.y, r: f.r, shape: 'disc', left: f.until - sim.tick, total: f.total, n: f.gen });
  for (const b of g?.bursts ?? []) if (sim.tick < b.until) objects.push({ key: `${eid}:b${b.id}`, tag: 'truda_burst', x: b.x, y: b.y, r: b.r, shape: 'ring', left: b.until - sim.tick, total: BURST_TICKS });
  if (objects.length) v.objects = objects;
  const n = g?.fields.length ?? 0;
  v.passive = { stacks: n, max: FIELD_CAP, ready: n > 0 };
  return v;
}

export const hooks: ChampionHooks = {
  visuals: trudaVisuals,
  onTick: trudaTick,
  ownsHits: ['truda_r'],
  passive: {
    truda_blight: {
      modifyDamage(sim, eid, target, amount, _type, isAuto) {
        return isAuto && hasBuff(sim, target, 'dot', POISON) ? amount + byLevel(sim, eid, 8, 36) : amount;
      },
    },
  },
  effects: {
    truda_q_field(sim, ctx) {
      addField(sim, ctx.caster, ctx.x, ctx.y, ctx.ability.radius ?? 190, FIELD_TICKS, 0, true);
    },
    truda_w_field(sim, ctx) {
      if (ctx.target < 0) return;
      addField(sim, ctx.caster, sim.c.Pos.x[ctx.target]!, sim.c.Pos.y[ctx.target]!, 170, FIELD_TICKS, 0, true);
    },
    truda_e_spread(sim, ctx) {
      const g = garden(sim, ctx.caster);
      for (const f of [...g.fields]) {
        if (f.gen >= MAX_GEN + 1) continue;
        for (let k = 0; k < HEX.length; k++) {
          const [dx, dy] = HEX[(f.id + k) % HEX.length]!;
          if (spread(sim, ctx.caster, f, dx, dy)) break;
        }
      }
    },
    truda_r_burst(sim, ctx) {
      const g = garden(sim, ctx.caster);
      if (!g.fields.length) {
        // nothing to burst: cooldown and mana back
        setCooldown(sim, ctx.caster, 3, 0);
        const { Mana } = sim.c;
        Mana.cur[ctx.caster] = Math.min(Mana.max[ctx.caster]!, Mana.cur[ctx.caster]! + rv(ctx.ability.cost, ctx.rank));
        return;
      }
      const hits = new Set<number>();
      for (const f of g.fields) {
        for (const e of enemiesInRadius(sim, ctx.caster, f.x, f.y, f.r)) hits.add(e);
        g.bursts.push({ id: g.next++, x: f.x, y: f.y, r: f.r, until: sim.tick + BURST_TICKS });
      }
      g.fields = [];
      applyEffects(sim, { ...ctx, hits: [...hits].sort((a, b) => a - b) }, 'hit');
    },
  },
};
