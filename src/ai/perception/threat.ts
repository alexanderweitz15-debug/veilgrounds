// ThreatMap layer (spec-bots §3): perceived enemies (attack + ability reach, + Flash reach when ready/unknown),
// weighted clouds, enemy towers, fog uncertainty in unwarded bushes (from Silver, growing with time unseen).
// Iron's map is nearly empty (no clouds, no bush threat): it walks into bushes.
// Evaluated lazily as a closure; cheap enough for path integrals (a few dozen sources).

import type { BotParams } from '../contract';
import type { MapData } from '../../sim/map';
import type { ChampionData } from '../../sim/champions/schema';
import { Kind } from '../../sim/types';
import type { SnapEntity } from '../../sim/snapshot';
import { atLeast } from './rankModel';
import type { Cloud } from './clouds';
import type { TrackMem } from './types';

const TOWER_REACH = 750 + 88 + 70;
const FLASH_RANGE = 400;

const rankedMax = (v: number | number[]): number => (typeof v === 'number' ? v : Math.max(...v));

/** Longest damaging/CC ability reach of a champion (data knowledge). */
export function threatReach(c: ChampionData | undefined): number {
  if (!c) return 900;
  let r = c.base.range;
  for (const a of c.abilities) {
    if (a.type === 'self' && !a.radius) continue;
    r = Math.max(r, rankedMax(a.range) + (a.type === 'dash' || a.type === 'blink' ? c.base.range : 0));
  }
  return Math.min(r, 1400);
}

export interface ThreatInputs {
  map: MapData;
  team: number;
  tick: number;
  params: BotParams;
  visible: readonly { e: SnapEntity; track: TrackMem; champ: ChampionData | undefined }[];
  clouds: readonly Cloud[];
  enemyTowers: readonly SnapEntity[];
  bushClear: ReadonlyMap<number, number>;
}

export function threatFn(inp: ThreatInputs): (x: number, y: number) => number {
  const silver = atLeast(inp.params, 'silver');
  const src = inp.visible.map(({ e, track, champ }) => {
    const flashKnownDown = track.cds.flashReadyAt !== undefined && track.cds.flashReadyAt > inp.tick;
    const reach = threatReach(champ) + (flashKnownDown ? 0 : FLASH_RANGE);
    return { x: e.x, y: e.y, reach, w: 0.6 + 0.4 * (e.maxHp > 0 ? e.hp / e.maxHp : 1) };
  });
  const towers = inp.enemyTowers.filter((t) => t.alive && t.kind === Kind.Tower).map((t) => ({ x: t.x, y: t.y }));
  const bushes = silver
    ? inp.map.bushes.map((b, i) => {
        const since = (inp.tick - (inp.bushClear.get(i) ?? 0)) / 30;
        return { x: b.x, y: b.y, r: b.r, w: Math.min(0.5, 0.1 + since * 0.01) };
      })
    : [];
  return (x: number, y: number): number => {
    let t = 0;
    for (const s of src) {
      const d = Math.hypot(x - s.x, y - s.y);
      if (d < s.reach) t += s.w;
      else if (d < s.reach + 300) t += s.w * (1 - (d - s.reach) / 300);
    }
    for (const c of inp.clouds) {
      const d = Math.hypot(x - c.x, y - c.y);
      const r = c.r + 500;
      if (d < r) t += c.weight * 0.6 * (1 - d / r);
    }
    for (const tw of towers) if (Math.hypot(x - tw.x, y - tw.y) < TOWER_REACH) t += 1.5;
    for (const b of bushes) if (Math.hypot(x - b.x, y - b.y) < b.r + 150) t += b.w;
    return t;
  };
}


/** Threat integral along a polyline (sampled every `step` units), plus its length. */
export function pathThreat(threat: (x: number, y: number) => number, from: { x: number; y: number }, path: readonly { x: number; y: number }[], step = 150): { integral: number; length: number } {
  let integral = 0;
  let length = 0;
  let a = from;
  for (const b of path) {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(d / step));
    for (let i = 1; i <= n; i++) integral += threat(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n) * (d / n);
    length += d;
    a = b;
  }
  return { integral, length };
}
