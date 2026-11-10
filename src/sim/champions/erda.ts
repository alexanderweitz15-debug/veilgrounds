// Erda Felsruf hooks: Stone Ring (W creates a ring of impassable rock around the circle's edge for 2.5 s, blockTerrain) and
// Stone Blood (+20 armor/MR within 450 of one of her own rings). State in sim.state keyed by champion eid; no Math.random/sin/cos.

import type { Sim } from '../sim';
import { sec } from '../types';
import { dist2 } from '../vec';
import { blockTerrain, ringCells } from '../summons';
import type { ChampionHooks, ChampionVisuals, VisualObject } from './hooks';
import { hookState, peekState } from './util';

const RING_SEC = 2.5;
const THICKNESS = 60;
const NEAR = 450;
const RES = 20;

interface Ring {
  x: number;
  y: number;
  r: number;
  start: number;
  until: number;
}
const KEY = 'erdaRings';
const rings = (sim: Sim, eid: number): Ring[] => {
  const m = hookState<Ring[]>(sim, KEY);
  let l = m.get(eid);
  if (!l) m.set(eid, (l = []));
  return l;
};
const live = (sim: Sim, l: Ring[] | undefined): Ring[] => (l ?? []).filter((r) => r.until > sim.tick);

/** Is `eid` within 450 of one of her own live rings? Read-only. */
export function erdaNearRing(sim: Sim, eid: number): boolean {
  const { Pos } = sim.c;
  return live(sim, peekState<Ring[]>(sim, KEY)?.get(eid)).some((r) => dist2(Pos.x[eid]!, Pos.y[eid]!, r.x, r.y) <= NEAR * NEAR);
}

export const hooks: ChampionHooks = {
  visuals(sim, eid): ChampionVisuals {
    const list = live(sim, peekState<Ring[]>(sim, KEY)?.get(eid));
    const v: ChampionVisuals = { passive: { ready: erdaNearRing(sim, eid) } };
    if (list.length) {
      v.objects = list.map((r, i): VisualObject => ({ key: `${eid}:${i}`, tag: 'erda_ring', x: r.x, y: r.y, r: r.r, shape: 'ring', left: r.until - sim.tick, total: r.until - r.start }));
    }
    return v;
  },
  passive: {
    erda_stone: {
      onComputeStats(sim, eid) {
        if (!erdaNearRing(sim, eid)) return;
        sim.c.Stats.armor[eid] = sim.c.Stats.armor[eid]! + RES;
        sim.c.Stats.mr[eid] = sim.c.Stats.mr[eid]! + RES;
      },
    },
  },
  effects: {
    erda_w_ring(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      const r = ctx.ability.radius ?? 300;
      const l = rings(sim, ctx.caster);
      l.splice(0, l.length, ...live(sim, l));
      l.push({ x: ctx.x, y: ctx.y, r, start: sim.tick, until: sim.tick + sec(RING_SEC) });
      blockTerrain(sim, ringCells(sim, ctx.x, ctx.y, r, THICKNESS), sec(RING_SEC));
    },
  },
};
