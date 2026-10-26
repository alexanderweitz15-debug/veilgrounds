// Map loading (mirroring), nav grid and pathfinding.
// ponytail: grid A* + string pulling instead of recast-navigation WASM. Deterministic, sync, no WASM in worker.
// Upgrade to recast if crowd steering or non-grid accuracy becomes a measured problem.

import raw from '../data/map.json';
import { segDist2 } from './vec';

export type Pt = { x: number; y: number };
export type Poly = Pt[];
export type Circle = Pt & { r: number };
export type LaneName = 'top' | 'mid' | 'bot';
export const LANES: LaneName[] = ['top', 'mid', 'bot'];

export interface SideData {
  fountain: Circle;
  nexus: Pt;
  nexusTowers: Pt[];
  /** Lane waypoints from own nexus to enemy nexus. */
  lanes: Record<LaneName, Pt[]>;
  /** Per lane: [outer, inner, inhib tower]. */
  towers: Record<LaneName, Pt[]>;
  inhibitors: Record<LaneName, Pt>;
  camps: { id: string; x: number; y: number; buff?: boolean }[];
  plants: { type: string; x: number; y: number }[];
}

export interface MapData {
  size: number;
  sides: [SideData, SideData];
  walls: Poly[];
  bushes: Circle[];
  objectives: Record<'leviathan' | 'kesselbrut' | 'schleierwaechter', Pt> & { nebelschleicher: Pt[] };
  nav: NavGrid;
}

/**
 * Map scale: map.json is authored in a 16000 design space (`designSize`); `size` is the playable edge. Every
 * coordinate and length in map.json (wall vertices, bush / fountain radii, lanes, towers, camps, objectives, ward
 * spots) is multiplied by K and rounded to whole units BEFORE the quarter swap and the point mirror, so S - x stays
 * exact. Lengths in code (unit radii, ranges, speeds, clearances, scenario distances) do not scale. `size` must be a
 * multiple of CELL (the nav grid needs an integer cell count).
 */
export const MAP_SIZE: number = raw.size;
export const MAP_SCALE: number = raw.size / raw.designSize;
const S = MAP_SIZE;
const k = (v: number): number => Math.round(v * MAP_SCALE);
/** Scale an authored point (design space) into map space. */
export const scalePt = <T extends { x: number; y: number }>(p: T): T => ({ ...p, x: k(p.x), y: k(p.y) });
const mirror = (p: Pt): Pt => ({ x: S - p.x, y: S - p.y });
const swap = (p: Pt): Pt => ({ x: p.y, y: p.x });
const pt = (a: number[] | Pt): Pt => (Array.isArray(a) ? { x: k(a[0]!), y: k(a[1]!) } : { x: k(a.x), y: k(a.y) });
const circ = (c: Circle): Circle => ({ x: k(c.x), y: k(c.y), r: k(c.r) });

/** Scaled neutral objective positions (map space), without building the nav grid. */
export const MAP_OBJECTIVES = {
  leviathan: pt(raw.neutral.objectives.leviathan),
  kesselbrut: pt(raw.neutral.objectives.kesselbrut),
  schleierwaechter: pt(raw.neutral.objectives.schleierwaechter),
  nebelschleicher: raw.neutral.objectives.nebelschleicher.map(pt),
};

function buildSide(m: (p: Pt) => Pt): SideData {
  const b = raw.blue;
  const lane = (kk: LaneName): Pt[] => b.lanes[kk].map((p) => m(pt(p)));
  const tw = (kk: LaneName): Pt[] => b.towers[kk].map((p) => m(pt(p)));
  const fountain = circ(b.fountain);
  return {
    fountain: { ...m(fountain), r: fountain.r },
    nexus: m(pt(b.nexus)),
    nexusTowers: b.nexusTowers.map((p) => m(pt(p))),
    // Point mirroring maps blue top onto red bot; lane identity follows the physical lane, so swap names.
    lanes: m === mirror ? { top: lane('bot'), mid: lane('mid'), bot: lane('top') } : { top: lane('top'), mid: lane('mid'), bot: lane('bot') },
    towers: m === mirror ? { top: tw('bot'), mid: tw('mid'), bot: tw('top') } : { top: tw('top'), mid: tw('mid'), bot: tw('bot') },
    inhibitors:
      m === mirror
        ? { top: m(pt(b.inhibitors.bot)), mid: m(pt(b.inhibitors.mid)), bot: m(pt(b.inhibitors.top)) }
        : { top: m(pt(b.inhibitors.top)), mid: m(pt(b.inhibitors.mid)), bot: m(pt(b.inhibitors.bot)) },
    camps: b.camps.map((c) => ({ ...c, ...m(pt(c)) })),
    plants: b.plants.map((c) => ({ ...c, ...m(pt(c)) })),
  };
}

export function loadMap(): MapData {
  const id = (p: Pt): Pt => p;
  const quarterWalls = raw.quarter.walls.map((w) => w.map(pt));
  const blueWalls = [...quarterWalls, ...quarterWalls.map((w) => w.map(swap))];
  const quarterBushes = raw.quarter.bushes.map(circ);
  const blueBushes = [...quarterBushes, ...quarterBushes.map((c) => ({ ...swap(c), r: c.r }))];
  const walls = [...blueWalls, ...blueWalls.map((w) => w.map(mirror)), ...raw.neutral.walls.map((w) => w.map(pt))];
  const bushes = [...blueBushes, ...blueBushes.map((c) => ({ ...mirror(c), r: c.r })), ...raw.neutral.bushes.map(circ)];
  return {
    size: S,
    sides: [buildSide(id), buildSide(mirror)],
    walls,
    bushes,
    objectives: { ...MAP_OBJECTIVES, nebelschleicher: MAP_OBJECTIVES.nebelschleicher.map((p) => ({ ...p })) },
    nav: buildNav(walls),
  };
}

export function inPoly(x: number, y: number, poly: Poly): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function inBush(map: MapData, x: number, y: number): number {
  for (let i = 0; i < map.bushes.length; i++) {
    const b = map.bushes[i]!;
    const dx = x - b.x;
    const dy = y - b.y;
    if (dx * dx + dy * dy <= b.r * b.r) return i;
  }
  return -1;
}

// ---------------------------------------------------------------- nav grid

export const CELL = 50;

export interface NavGrid {
  w: number;
  h: number;
  /** 1 = walkable. */
  walk: Uint8Array;
}

// wall clearance for unit centres: large enough that champion sprites (≈ 110-140 wide) do not visibly clip into walls
const UNIT_CLEARANCE = 75;

function buildNav(walls: Poly[]): NavGrid {
  const w = S / CELL;
  const h = S / CELL;
  const walk = new Uint8Array(w * h).fill(1);
  for (const poly of walls) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of poly) {
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
    const cx0 = Math.max(0, Math.floor((x0 - UNIT_CLEARANCE) / CELL));
    const cy0 = Math.max(0, Math.floor((y0 - UNIT_CLEARANCE) / CELL));
    const cx1 = Math.min(w - 1, Math.floor((x1 + UNIT_CLEARANCE) / CELL));
    const cy1 = Math.min(h - 1, Math.floor((y1 + UNIT_CLEARANCE) / CELL));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const x = (cx + 0.5) * CELL;
        const y = (cy + 0.5) * CELL;
        if (inPoly(x, y, poly) || nearPoly(x, y, poly, UNIT_CLEARANCE)) walk[cy * w + cx] = 0;
      }
    }
  }
  return { w, h, walk };
}

function nearPoly(x: number, y: number, poly: Poly, r: number): boolean {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (segDist2(x, y, poly[i]!.x, poly[i]!.y, poly[j]!.x, poly[j]!.y) < r * r) return true;
  }
  return false;
}

export function walkable(nav: NavGrid, x: number, y: number): boolean {
  const cx = Math.floor(x / CELL);
  const cy = Math.floor(y / CELL);
  if (cx < 0 || cy < 0 || cx >= nav.w || cy >= nav.h) return false;
  return nav.walk[cy * nav.w + cx] === 1;
}

/**
 * Straight-line walkability: every grid cell the segment touches must be walkable (supercover DDA), so a path
 * can never cut across the corner of a blocked cell that movement would later refuse.
 */
export function lineWalkable(nav: NavGrid, ax: number, ay: number, bx: number, by: number): boolean {
  let cx = Math.floor(ax / CELL);
  let cy = Math.floor(ay / CELL);
  const cell = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < nav.w && y < nav.h && nav.walk[y * nav.w + x] === 1;
  // the start cell itself is not checked: a unit nudged into a blocked cell may always walk out
  const dx = bx - ax;
  const dy = by - ay;
  const sx = dx > 0 ? 1 : -1;
  const sy = dy > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(CELL / dx) : Infinity;
  const tdy = dy !== 0 ? Math.abs(CELL / dy) : Infinity;
  let tmx = dx !== 0 ? ((sx > 0 ? (cx + 1) * CELL : cx * CELL) - ax) / dx : Infinity;
  let tmy = dy !== 0 ? ((sy > 0 ? (cy + 1) * CELL : cy * CELL) - ay) / dy : Infinity;
  // walk cell boundaries until the segment ends (t = 1); endpoints on boundaries must not overshoot
  for (let guard = 0; Math.min(tmx, tmy) < 1 - 1e-12 && guard < 4096; guard++) {
    if (Math.abs(tmx - tmy) < 1e-9) {
      // passes exactly through a corner: both side cells must be free
      if (!cell(cx + sx, cy) || !cell(cx, cy + sy)) return false;
      cx += sx;
      cy += sy;
      tmx += tdx;
      tmy += tdy;
    } else if (tmx < tmy) {
      cx += sx;
      tmx += tdx;
    } else {
      cy += sy;
      tmy += tdy;
    }
    if (!cell(cx, cy)) return false;
  }
  return true;
}

/** Grid cell index clamped into [0, n-1]; NaN maps to 0 (callers validate inputs, this only keeps the grid safe). */
const clampCell = (c: number, n: number): number => (c !== c ? 0 : Math.min(n - 1, Math.max(0, c)));

/**
 * Nearest walkable point to (x,y), searching outward ring by ring. Points outside the map (or NaN) are clamped
 * into the grid first, so the result is always inside the map.
 */
export function nearestWalkable(nav: NavGrid, x: number, y: number): Pt {
  if (walkable(nav, x, y)) return { x, y };
  const cx = clampCell(Math.floor(x / CELL), nav.w);
  const cy = clampCell(Math.floor(y / CELL), nav.h);
  for (let r = 0; r < 60; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const px = (cx + dx + 0.5) * CELL;
        const py = (cy + dy + 0.5) * CELL;
        if (walkable(nav, px, py)) return { x: px, y: py };
      }
    }
  }
  return { x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL };
}

/**
 * A* on the grid (8-neighbour, octile), then string-pulled. Returns waypoints excluding the start.
 * Deterministic: binary heap with (f, insertion order) tie-break.
 */
export function findPath(nav: NavGrid, sx: number, sy: number, tx: number, ty: number): Pt[] {
  const goal = nearestWalkable(nav, tx, ty);
  if (lineWalkable(nav, sx, sy, goal.x, goal.y)) return [goal];
  const { w, h, walk } = nav;
  const start = nearestWalkable(nav, sx, sy);
  const s = Math.floor(start.y / CELL) * w + Math.floor(start.x / CELL);
  const g = Math.floor(goal.y / CELL) * w + Math.floor(goal.x / CELL);
  const gx = g % w;
  const gy = (g - gx) / w;
  const cost = new Float64Array(w * h).fill(Infinity);
  const from = new Int32Array(w * h).fill(-1);
  const closed = new Uint8Array(w * h);
  const heap = new MinHeap();
  cost[s] = 0;
  heap.push(s, 0);
  const D = 1;
  const D2 = Math.SQRT2;
  while (heap.size > 0) {
    const cur = heap.pop();
    if (cur === g) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % w;
    const cy = (cur - cx) / w;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue;
        const nx = cx + ox;
        const ny = cy + oy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (!walk[n] || closed[n]) continue;
        // no corner cutting
        if (ox !== 0 && oy !== 0 && (!walk[cy * w + nx] || !walk[ny * w + cx])) continue;
        const nc = cost[cur]! + (ox !== 0 && oy !== 0 ? D2 : D);
        if (nc < cost[n]!) {
          cost[n] = nc;
          from[n] = cur;
          const hx = Math.abs(nx - gx);
          const hy = Math.abs(ny - gy);
          heap.push(n, nc + D * (hx + hy) + (D2 - 2 * D) * Math.min(hx, hy));
        }
      }
    }
  }
  if (from[g] === -1 && g !== s) return [goal]; // unreachable: walk straight, movement will stop at walls
  const cells: Pt[] = [];
  // guarded walk back (g and s are in-grid cells; the counter only protects against a corrupt parent chain)
  for (let c = g, n = 0; c !== s && c >= 0 && c < w * h && n < w * h; c = from[c]!, n++) {
    const cx = c % w;
    cells.push({ x: (cx + 0.5) * CELL, y: ((c - cx) / w + 0.5) * CELL });
  }
  cells.reverse();
  cells[cells.length - 1] = goal;
  // string pulling
  const out: Pt[] = [];
  let ax = sx;
  let ay = sy;
  let i = 0;
  while (i < cells.length) {
    let j = cells.length - 1;
    while (j > i && !lineWalkable(nav, ax, ay, cells[j]!.x, cells[j]!.y)) j--;
    out.push(cells[j]!);
    ax = cells[j]!.x;
    ay = cells[j]!.y;
    i = j + 1;
  }
  return out;
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  private order: number[] = [];
  private seq = 0;
  get size(): number {
    return this.ids.length;
  }
  push(id: number, key: number): void {
    this.ids.push(id);
    this.keys.push(key);
    this.order.push(this.seq++);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.ids[0]!;
    const last = this.ids.length - 1;
    this.swap(0, last);
    this.ids.pop();
    this.keys.pop();
    this.order.pop();
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < this.ids.length && this.less(l, m)) m = l;
      if (r < this.ids.length && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }
  private less(a: number, b: number): boolean {
    return this.keys[a]! < this.keys[b]! || (this.keys[a] === this.keys[b] && this.order[a]! < this.order[b]!);
  }
  private swap(a: number, b: number): void {
    [this.ids[a], this.ids[b]] = [this.ids[b]!, this.ids[a]!];
    [this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!];
    [this.order[a], this.order[b]] = [this.order[b]!, this.order[a]!];
  }
}
