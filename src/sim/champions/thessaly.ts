// Thessaly Vorn hooks. Contract: ./hooks.ts, behaviour list: docs/champion-hooks.md.
import type { Sim } from '../sim';
import { Kind, enemyOf, sec } from '../types';
import { dealDamage } from '../damage';
import { hasBuff } from '../buffs';
import { dist2 } from '../vec';
import { sees } from '../vision';
import { champAbil, cooldownLeft } from '../systems/abilities';
import type { ChampionHooks, ChampionVisuals, HintMarker } from './hooks';
import { hookState, peekState } from './util';
import { unitsWhere } from './dagny';

const FREE_CD = sec(12);
const R_RANGE = 700;
/** Tick from which the next ability is free, per eid. */
const freeAt = (sim: Sim): Map<number, number> => hookState<number>(sim, 'thessalyFree');

/**
 * Snapshot visuals (read-only): passive free-cast timer (ready = next ability costs no mana); R execute hints on
 * visible enemy champions below 30 % HP while R is learned and ready (dimmed when out of range).
 */
function thessalyVisuals(sim: Sim, eid: number): ChampionVisuals {
  const { Unit, Pos, Hp } = sim.c;
  const at = peekState<number>(sim, 'thessalyFree')?.get(eid) ?? 0;
  const v: ChampionVisuals = { passive: { cdLeft: Math.max(0, at - sim.tick), cdTotal: FREE_CD, ready: sim.tick >= at } };
  if (!Unit.alive[eid] || champAbil(sim, eid).ranks[3]! <= 0 || cooldownLeft(sim, eid, 3) > 0) return v;
  const team = Unit.team[eid]!;
  const hints: HintMarker[] = [];
  for (const t of unitsWhere(sim, (e) => (Unit.kind[e] === Kind.Champion || Unit.kind[e] === Kind.Dummy) && !!Unit.alive[e] && Unit.team[e] === enemyOf(team))) {
    if (Hp.cur[t]! >= 0.3 * Hp.max[t]! || !sees(sim, team, t)) continue;
    const reach = R_RANGE + Unit.radius[eid]! + Unit.radius[t]!;
    hints.push({ slot: 3, x: Pos.x[t]!, y: Pos.y[t]!, r: Unit.radius[t]! + 30, ok: dist2(Pos.x[t]!, Pos.y[t]!, Pos.x[eid]!, Pos.y[eid]!) <= reach * reach });
  }
  if (hints.length) v.hints = hints;
  return v;
}

export const hooks: ChampionHooks = {
  visuals: thessalyVisuals,
  passive: {
    // Every 12 s the next ability costs no mana; the timer restarts on that cast. W reflect lives here too
    // (onDamageTaken), active while the W shield holds.
    thessaly_free_cast: {
      onSpawn(sim, eid) {
        freeAt(sim).set(eid, 0);
      },
      modifyCast(sim, eid, _slot, m) {
        if (sim.tick >= (freeAt(sim).get(eid) ?? 0)) m.cost = 0;
      },
      onCast(sim, eid) {
        if (sim.tick >= (freeAt(sim).get(eid) ?? 0)) freeAt(sim).set(eid, sim.tick + FREE_CD);
      },
      onDamageTaken(sim, eid, src, info) {
        // 25 % of the absorbed amount back as magic damage (>= 1: no ping-pong between two shielded Thessalys)
        if (src < 0 || info.absorbed < 1 || !hasBuff(sim, eid, 'shield', 'thessaly_w')) return;
        dealDamage(sim, eid, src, 0.25 * info.absorbed, 'magic');
      },
    },
  },
  effects: {
    // ponytail: the reflect is the passive's onDamageTaken while the W shield buff exists; nothing to do on cast.
    thessaly_w_reflect() {},
    // Listed before the damage: +50 % R damage below 30 % HP.
    thessaly_r_execute_bonus(sim, ctx) {
      const t = ctx.hits[0];
      if (ctx.phase !== 'cast' || t === undefined) return;
      if (sim.c.Hp.cur[t]! < 0.3 * sim.c.Hp.max[t]!) ctx.dmgMult = 1.5;
    },
  },
};
