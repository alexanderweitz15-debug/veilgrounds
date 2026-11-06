// One-lane map (ARAM): the classic map with everything off the mid diagonal walled in. Derived, not authored: lanes,
// towers, nexus and fountains stay where they are, top / bot structures are skipped (`activeLanes`), jungle is empty.
// Does not touch map.ts: the nav grid is blocked here, the wall polygons are added for the renderer.
import { CELL, loadMap, MAP_SIZE, type MapData, type Poly } from './map';
import type { SimConfig } from './types';

/** Corridor half-width as |x - y| (perpendicular width = this / sqrt 2 = ~1060). */
export const ARAM_HALF = 1500;
const UNIT_CLEARANCE = 75;

export function aramMap(): MapData {
  const m = loadMap();
  const S = MAP_SIZE;
  const d = ARAM_HALF;
  // two triangles: x - y > d (below the corridor) and y - x > d (above); both clipped to the square
  const lower: Poly = [{ x: d, y: 0 }, { x: S, y: 0 }, { x: S, y: S - d }];
  const upper: Poly = [{ x: 0, y: d }, { x: 0, y: S }, { x: S - d, y: S }];
  m.walls.push(lower, upper);
  const { w, h, walk } = m.nav;
  const edge = d - UNIT_CLEARANCE * Math.SQRT2;
  for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) if (Math.abs(cx - cy) * CELL > edge) walk[cy * w + cx] = 0;
  m.bushes = m.bushes.filter((b) => Math.abs(b.x - b.y) < d - b.r);
  for (const side of m.sides) {
    side.camps = [];
    side.plants = [];
  }
  m.activeLanes = ['mid'];
  return m;
}

/** The map a config plays on (a fresh copy: summons edit the nav grid). */
export const mapFor = (config: Pick<SimConfig, 'rules'> | null | undefined): MapData => (config?.rules?.oneLane ? aramMap() : loadMap());
