// Alt+click on the minimap (C4, LoL): pings snap to what is under the cursor. An enemy structure -> "focus" on it,
// an own structure -> "danger" at it (defend), an epic objective pit -> "objective", anything else -> "danger".
import type { SnapEntity } from '../sim/snapshot';
import { isStructure, type PingKind } from '../sim/types';

/** Snap radius in map units (a minimap pixel is ~53 units at 280 px). */
const SNAP_STRUCT = 450;
const SNAP_OBJECTIVE = 700;

export interface MinimapPing {
  kind: PingKind;
  x: number;
  y: number;
  target?: number;
}

export function minimapPingFor(x: number, y: number, entities: readonly SnapEntity[], myTeam: number, objectives: readonly { x: number; y: number }[]): MinimapPing {
  let best: SnapEntity | null = null;
  let bestD = SNAP_STRUCT * SNAP_STRUCT;
  for (const e of entities) {
    if (!e.alive || !isStructure(e.kind)) continue;
    const d = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  if (best) return best.team === myTeam ? { kind: 'danger', x: best.x, y: best.y } : { kind: 'focus', x: best.x, y: best.y, target: best.id };
  for (const o of objectives) if ((o.x - x) ** 2 + (o.y - y) ** 2 < SNAP_OBJECTIVE ** 2) return { kind: 'objective', x: o.x, y: o.y };
  return { kind: 'danger', x, y };
}
