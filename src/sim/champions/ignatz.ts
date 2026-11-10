// Ignatz Funkenhammer hooks: Heat (ability hits stack Heat on the target for 5 s; the third hit ignites it: a magic dot).
// State in sim.state keyed by the target's eid per smith; no Math.random/sin/cos.

import type { Sim } from '../sim';
import { sec } from '../types';
import { addBuff } from '../buffs';
import type { ChampionHooks, ChampionVisuals, UnitMark } from './hooks';
import { hookState, peekState } from './util';

const MAX = 3;
const WINDOW = sec(5);
const BURN_SEC = 3;
const BURN_BASE = 18;
const BURN_AP = 0.15;

interface Heat {
  n: number;
  until: number;
}
/** smith eid -> (target eid -> Heat) */
const heat = (sim: Sim, eid: number): Map<number, Heat> => {
  const m = hookState<Map<number, Heat>>(sim, 'ignatzHeat');
  let h = m.get(eid);
  if (!h) m.set(eid, (h = new Map()));
  return h;
};

function ignatzVisuals(sim: Sim, eid: number): ChampionVisuals {
  const h = peekState<Map<number, Heat>>(sim, 'ignatzHeat')?.get(eid);
  if (!h) return { passive: { stacks: 0, max: MAX } };
  const marks: UnitMark[] = [];
  for (const [t, v] of h) if (v.until > sim.tick && v.n > 0) marks.push({ target: t, id: 'ignatz_heat', n: v.n, max: MAX, left: v.until - sim.tick });
  return { passive: { stacks: marks.reduce((a, k) => Math.max(a, k.n ?? 0), 0), max: MAX, ready: marks.some((k) => (k.n ?? 0) >= MAX - 1) }, ...(marks.length ? { marks } : {}) };
}

export const hooks: ChampionHooks = {
  visuals: ignatzVisuals,
  passive: {
    ignatz_heat: {
      onAbilityHit(sim, eid, target) {
        const h = heat(sim, eid);
        const cur = h.get(target);
        const n = (cur && cur.until > sim.tick ? cur.n : 0) + 1;
        if (n < MAX) return void h.set(target, { n, until: sim.tick + WINDOW });
        h.delete(target);
        const amount = BURN_BASE + BURN_AP * sim.c.Stats.ap[eid]!;
        addBuff(sim, target, { kind: 'dot', id: 'ignatz_burn', src: eid, amount, period: sec(1), dmgType: 'magic', ticks: sec(BURN_SEC) });
      },
    },
  },
};
