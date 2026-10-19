// Enemy items as last seen (LoL scoreboard / target frame): each team remembers the inventory of every enemy champion
// from the last tick it saw that champion; nothing updates from the fog. Runs as a system right after vision (so the
// memory is deterministic and independent of how many snapshots are built); snapshots only read it.

import type { Sim } from './sim';
import type { System } from './systems/index';
import { champions } from './systems/economy';
import { inventory } from './items/inventory';
import { sees } from './vision';

interface Seen {
  items: (string | null)[];
  /** Tick of the last sighting. */
  tick: number;
}

/** seen[team]: champion slot -> last seen inventory. */
type SeenState = [Map<number, Seen>, Map<number, Seen>];

/** Last seen inventory of an enemy champion for `team` (undefined: never seen). Read-only. */
export function seenItems(sim: Sim, team: number, slot: number): Seen | undefined {
  if (team !== 0 && team !== 1) return undefined;
  return (sim.state.seenItems as SeenState | undefined)?.[team].get(slot);
}

export const seenItemsSystem: System = {
  name: 'seenItems',
  init(sim) {
    sim.state.seenItems = [new Map(), new Map()] as SeenState;
  },
  update(sim) {
    const s = sim.state.seenItems as SeenState;
    const { Unit } = sim.c;
    for (const e of champions(sim)) {
      const t = Unit.team[e]!;
      if ((t !== 0 && t !== 1) || Unit.alive[e] !== 1) continue;
      const viewer = t === 0 ? 1 : 0;
      if (!sees(sim, viewer, e)) continue;
      const inv = inventory(sim, e);
      const slot = Unit.slot[e]!;
      const rec = s[viewer].get(slot);
      if (rec && rec.items.length === inv.length && rec.items.every((x, i) => x === inv[i])) rec.tick = sim.tick;
      else s[viewer].set(slot, { items: [...inv], tick: sim.tick });
    }
  },
};
