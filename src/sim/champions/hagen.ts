// Mutter Hagen hooks: bell tolls (passive) and the storm peal aura (R).

import type { Sim } from '../sim';
import { sec } from '../types';
import { addBuff } from '../buffs';
import { dist2 } from '../vec';
import { enemiesInRadius } from '../systems/abilities';
import type { ChampionHooks, ChampionVisuals } from './hooks';
import { alliedChamps, stateMap } from './dagny';
import { peekState } from './util';

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
/** Slow stage (1..4 = 15..60 %) after `t` ticks inside the R aura (same rule as hagenTick). */
const pealStage = (t: number): number => Math.min(4, 1 + Math.floor(t / 30));

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
    const pct = 15 * pealStage(t);
    addBuff(sim, e, { kind: 'slow', id: 'hagen_r', src: eid, pct, ticks: sec(0.5) });
  }
  // allied champions inside keep the listed 20 % tenacity (generic buff covers the cast moment)
  for (const a of alliedChamps(sim, eid)) {
    if (dist2(Pos.x[a]!, Pos.y[a]!, Pos.x[eid]!, Pos.y[eid]!) <= R_RADIUS * R_RADIUS)
      addBuff(sim, a, { kind: 'stat', stat: 'tenacity', id: 'hagen_r', src: eid, pct: 20, ticks: sec(0.5) });
  }
}

/**
 * Snapshot (read-only): bell tolls 0-3 + 10 s stun cooldown on the passive badge, empowered glow when the next auto
 * stuns, R aura ring (500) with timer and the slow stage (pips) on every enemy inside.
 */
function hagenVisuals(sim: Sim, eid: number): ChampionVisuals {
  const { Pos, Unit } = sim.c;
  const b = peekState<Bell>(sim, 'hagenBell')?.get(eid);
  const tolls = b?.tolls ?? 0;
  const cdLeft = b ? Math.max(0, b.ready - sim.tick) : 0;
  const ready = tolls >= 3 && cdLeft === 0;
  const v: ChampionVisuals = { passive: { stacks: tolls, max: 3, cdLeft, cdTotal: sec(10), ready } };
  if (ready && Unit.alive[eid]) v.empowered = 4;
  const p = peekState<Peal>(sim, 'hagenPeal')?.get(eid);
  if (p && sim.tick < p.until && Unit.alive[eid]) {
    v.objects = [{ key: `${eid}`, tag: 'hagen_r_peal', x: Pos.x[eid]!, y: Pos.y[eid]!, r: R_RADIUS, shape: 'dome', left: p.until - sim.tick, total: sec(4) }];
    v.marks = [...p.inside].map(([target, t]) => ({ target, id: 'hagen_r_peal', n: pealStage(t), max: 4 }));
    v.aura = 3;
  }
  return v;
}

export const hooks: ChampionHooks = {
  visuals: hagenVisuals,
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
