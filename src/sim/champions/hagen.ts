// Mutter Hagen hooks: bell tolls (passive) and the storm peal aura (R).

import type { Sim } from '../sim';
import { sec } from '../types';
import { addBuff } from '../buffs';
import { dist2 } from '../vec';
import { enemiesInRadius } from '../systems/abilities';
import type { ChampionHooks } from './hooks';
import { alliedChamps, stateMap } from './dagny';

interface Bell {
  tolls: number;
  /** Tick from which the stun may trigger again (10 s internal cooldown). */
  ready: number;
}
const bells = (sim: Sim): Map<number, Bell> => stateMap<Bell>(sim, 'hagenBell');
const bell = (sim: Sim, eid: number): Bell => {
  let b = bells(sim).get(eid);
  if (!b) bells(sim).set(eid, (b = { tolls: 0, ready: 0 }));
  return b;
};

export const hagenTolls = (sim: Sim, eid: number): number => bells(sim).get(eid)?.tolls ?? 0;

/** R aura: per enemy, ticks spent inside since entering (slow grows 15 % per full second). */
interface Peal {
  until: number;
  inside: Map<number, number>;
}
const peals = (sim: Sim): Map<number, Peal> => stateMap<Peal>(sim, 'hagenPeal');
const R_RADIUS = 500;

/** One aura tick: escalate slows on enemies inside, re-apply tenacity to allied champions inside. */
function hagenTick(sim: Sim, eid: number): void {
  const p = peals(sim).get(eid);
  if (!p) return;
  if (sim.tick >= p.until || !sim.c.Unit.alive[eid]) return void peals(sim).delete(eid);
  const { Pos } = sim.c;
  const inside = enemiesInRadius(sim, eid, Pos.x[eid]!, Pos.y[eid]!, R_RADIUS);
  for (const k of [...p.inside.keys()]) if (!inside.includes(k)) p.inside.delete(k);
  for (const e of inside) {
    const t = (p.inside.get(e) ?? 0) + 1;
    p.inside.set(e, t);
    const pct = 15 * Math.min(4, 1 + Math.floor(t / 30));
    addBuff(sim, e, { kind: 'slow', id: 'hagen_r', src: eid, pct, ticks: sec(0.5) });
  }
  // allied champions inside keep the listed 20 % tenacity (generic buff covers the cast moment)
  for (const a of alliedChamps(sim, eid)) {
    if (dist2(Pos.x[a]!, Pos.y[a]!, Pos.x[eid]!, Pos.y[eid]!) <= R_RADIUS * R_RADIUS)
      addBuff(sim, a, { kind: 'stat', stat: 'tenacity', id: 'hagen_r', src: eid, pct: 20, ticks: sec(0.5) });
  }
}

export const hooks: ChampionHooks = {
  onTick: hagenTick,
  passive: {
    hagen_bell_toll: {
      onSpawn(sim, eid) {
        bell(sim, eid);
      },
      onCast(sim, eid) {
        const b = bell(sim, eid);
        b.tolls = Math.min(3, b.tolls + 1);
      },
      onAutoHit(sim, eid, target) {
        const b = bell(sim, eid);
        if (b.tolls < 3 || sim.tick < b.ready) return;
        b.tolls = 0;
        b.ready = sim.tick + sec(10);
        addBuff(sim, target, { kind: 'stun', id: 'hagen_bell', src: eid, ticks: sec(0.5) });
      },
    },
  },
  effects: {
    hagen_r_storm_peal(sim, ctx) {
      peals(sim).set(ctx.caster, { until: sim.tick + sec(4), inside: new Map() });
    },
  },
};
