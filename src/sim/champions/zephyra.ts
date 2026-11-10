// Zephyra Weitblick hooks: Star Chart (every takedown on a champion cuts Starfall's remaining cooldown by 15 s). Starfall
// itself is data (range 8000 ground circle with a 2.2 s delay). No state; no Math.random/sin/cos.

import { sec } from '../types';
import { reduceCooldown } from '../systems/abilities';
import type { ChampionHooks } from './hooks';

const CUT = sec(15);

export const hooks: ChampionHooks = {
  visuals() {
    return { passive: { ready: true } };
  },
  passive: {
    zephyra_chart: {
      onTakedown(sim, eid) {
        reduceCooldown(sim, eid, 3, CUT);
      },
    },
  },
};
