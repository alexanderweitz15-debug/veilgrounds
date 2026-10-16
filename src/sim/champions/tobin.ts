// Tobin Sturmkiel hooks: sea legs (AS after dashes/blinks), tether (Q), empowered auto (W).

import type { Sim } from '../sim';
import { isRef } from '../sim';
import { sec } from '../types';
import { addBuff, buffs } from '../buffs';
import { dist2 } from '../vec';
import type { ChampionHooks, ChampionVisuals } from './hooks';
import { stateMap } from './dagny';
import { peekState } from './util';

interface Tether {
  target: number;
  serial: number;
  end: number;
}
const tethers = (sim: Sim): Map<number, Tether> => stateMap<Tether>(sim, 'tobinTether');
const TETHER_RANGE = 650;

export const tobinTetherTarget = (sim: Sim, eid: number): number => tethers(sim).get(eid)?.target ?? -1;

/** Per-tick: resolve the tether at its end (root 1 s if farther than 650); it breaks if Tobin dies. */
function tobinTick(sim: Sim, eid: number): void {
  const t = tethers(sim).get(eid);
  if (!t) return;
  if (!sim.c.Unit.alive[eid] || !isRef(sim, t.target, t.serial)) return void tethers(sim).delete(eid);
  if (sim.tick < t.end) return;
  tethers(sim).delete(eid);
  const { Pos } = sim.c;
  if (dist2(Pos.x[eid]!, Pos.y[eid]!, Pos.x[t.target]!, Pos.y[t.target]!) > TETHER_RANGE * TETHER_RANGE)
    addBuff(sim, t.target, { kind: 'root', id: 'tobin_q', src: eid, ticks: sec(1) });
}

const TETHER_TICKS = sec(2.5);
const SEA_LEGS_TICKS = sec(3);

/**
 * Snapshot visuals (read-only): Q tether rope Tobin -> target with the root distance (650) as a timer ring around
 * Tobin and a mark on the target; sea legs (passive AS after dashes/blinks) as a glowing badge.
 */
function tobinVisuals(sim: Sim, eid: number): ChampionVisuals {
  const v: ChampionVisuals = {};
  const { Pos } = sim.c;
  const t = peekState<Tether>(sim, 'tobinTether')?.get(eid);
  if (t && sim.c.Unit.alive[eid] && isRef(sim, t.target, t.serial) && sim.tick < t.end) {
    const left = t.end - sim.tick;
    const far = dist2(Pos.x[eid]!, Pos.y[eid]!, Pos.x[t.target]!, Pos.y[t.target]!) > TETHER_RANGE * TETHER_RANGE;
    v.objects = [
      { key: `${eid}`, tag: 'tobin_q_tether', x: Pos.x[eid]!, y: Pos.y[eid]!, x2: Pos.x[t.target]!, y2: Pos.y[t.target]!, follow: t.target, r: 10, shape: 'line' },
      // the target must leave this ring before the timer runs out to be rooted
      { key: `${eid}`, tag: 'tobin_q_range', x: Pos.x[eid]!, y: Pos.y[eid]!, r: TETHER_RANGE, shape: 'ring', left, total: TETHER_TICKS },
    ];
    v.marks = [{ target: t.target, id: far ? 'tobin_q_tether_far' : 'tobin_q_tether', left }];
  }
  const sea = buffs(sim, eid).find((b) => b.kind === 'stat' && b.id === 'tobin_sea_legs' && b.until > sim.tick);
  v.passive = { ready: !!sea }; // the AS buff itself already gets the generic aura ring
  return v;
}

export const hooks: ChampionHooks = {
  visuals: tobinVisuals,
  onTick: tobinTick,
  passive: {
    tobin_sea_legs: {
      // W dash end and Flash (slot -1) alike
      onDashEnd(sim, eid) {
        addBuff(sim, eid, { kind: 'stat', stat: 'as', id: 'tobin_sea_legs', src: eid, pct: 20, ticks: SEA_LEGS_TICKS });
      },
    },
  },
  effects: {
    tobin_q_tether(sim, ctx) {
      const t = ctx.hits[0];
      if (t === undefined) return;
      tethers(sim).set(ctx.caster, { target: t, serial: sim.c.Unit.serial[t]!, end: sim.tick + TETHER_TICKS });
    },
    // engine arms the next auto (`*_next_auto`) and applies the listed slow on it
    tobin_w_next_auto() {},
  },
};
