// Respawn timers of the normal jungle camps for context pings ("Dornenbock in 1:23"). The client only sees monster deaths
// inside its own vision, so a camp's timer starts when the last monster of it was seen to die (the sim starts the
// respawn at the same moment, jungle.ts onMonsterDeath) and is empty for camps the team never saw cleared.
import { CAMPS, type CampId } from '../sim/systems/jungle';
import type { Pt } from '../sim/map';
import raw from '../data/map.json';

export interface CampSpot extends Pt {
  /** CAMPS id (monster set, respawn). */
  id: string;
  /** Unique per spot: the same camp type exists on both sides. */
  key: string;
}

/** Both sides' normal camps; the red side is the point mirror of blue (src/sim/map.ts). */
export function defaultCamps(): CampSpot[] {
  const out: CampSpot[] = [];
  for (const c of raw.blue.camps) out.push({ id: c.id, key: `${c.id}:0`, x: c.x, y: c.y }, { id: c.id, key: `${c.id}:1`, x: raw.size - c.x, y: raw.size - c.y });
  return out;
}

const NEAR = 700;
const TICK_HZ = 30;

export class CampTimers {
  private readonly dead = new Map<string, number>();
  private readonly count = new Map<string, number>();

  constructor(private readonly camps: readonly CampSpot[] = defaultCamps()) {}

  /** Camp whose centre is within reach of a point, or null. */
  campAt(x: number, y: number): CampSpot | null {
    let best: CampSpot | null = null;
    let bestD = NEAR * NEAR;
    for (const c of this.camps) {
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /** A non-epic monster died at (x, y) in the snapshot tick `tick`. */
  noteDeath(x: number, y: number, tick: number): void {
    const c = this.campAt(x, y);
    if (!c) return;
    const def = CAMPS[c.id as CampId];
    if (!def || def.epic) return;
    const n = (this.count.get(c.key) ?? 0) + 1;
    if (n >= def.monsters.length) {
      this.count.set(c.key, 0);
      this.dead.set(c.key, tick);
    } else this.count.set(c.key, n);
  }

  /** Seconds until the camp is back; null while it is up (or never seen cleared). */
  left(c: CampSpot, tick: number): number | null {
    const d = this.dead.get(c.key);
    const def = CAMPS[c.id as CampId];
    if (d === undefined || !def) return null;
    const left = (d + def.respawn * TICK_HZ - tick) / TICK_HZ;
    return left > 0 ? left : null;
  }
}
