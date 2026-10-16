// Mira Quell hooks. Template for champion hook files: export `hooks: ChampionHooks`, register in index.ts.

import type { Sim } from '../sim';
import { sec } from '../types';
import { extendBuff } from '../buffs';
import type { ChampionHooks } from './hooks';
import { peekState } from './util';

/** Autos fired since the last double shot (0..2), per eid. */
function counter(sim: Sim): Map<number, number> {
  let m = sim.state.miraPassive as Map<number, number> | undefined;
  if (!m) sim.state.miraPassive = m = new Map();
  return m;
}

export const miraShotCount = (sim: Sim, eid: number): number => counter(sim).get(eid) ?? 0;

/** Q buff id = ability id from mira.json. */
const Q_ID = 'mira_q';
/** Each auto extends Q by 0.5 s; total Q uptime capped at 8 s so it cannot become permanent at high AS. */
const Q_EXTEND = sec(0.5);
const Q_MAX = sec(8);

export const hooks: ChampionHooks = {
  // Snapshot (read-only): Doppelzug counter on the HUD badge (autos 0..2 of 3); the third shot glows as empowered
  // (also right after E, which arms it). Q extension = the generic mira_q aura/buff timer.
  visuals(sim, eid) {
    const n = peekState<number>(sim, 'miraPassive')?.get(eid) ?? 0;
    return { passive: { stacks: n, max: 3, ready: n >= 2 }, ...(n >= 2 ? { empowered: 4 } : {}) };
  },
  passive: {
    // Doppelzug: every third auto fires a second arrow for 50 %.
    doppelzug: {
      onSpawn(sim, eid) {
        counter(sim).set(eid, 0);
      },
      onAutoFire(sim, eid) {
        const n = miraShotCount(sim, eid) + 1;
        if (n >= 3) {
          counter(sim).set(eid, 0);
          return [0.5];
        }
        counter(sim).set(eid, n);
      },
    },
    bogenspannungExtend: {
      onAutoFire(sim, eid) {
        extendBuff(sim, eid, Q_ID, Q_EXTEND, Q_MAX);
      },
    },
  },
  effects: {
    // Rolle: next auto is the third shot.
    rolleArm(sim, ctx) {
      counter(sim).set(ctx.caster, 2);
    },
  },
};
