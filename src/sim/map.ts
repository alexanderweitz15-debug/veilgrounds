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

const S = raw.size;
const mirror = (p: Pt): Pt => ({ x: S - p.x, y: S - p.y });
const swap = (p: Pt): Pt => ({ x: p.y, y: p.x });
const pt = (a: number[] | Pt): Pt => (Array.isArray(a) ? { x: a[0]!, y: a[1]! } : { x: a.x, y: a.y });

function buildSide(m: (p: Pt) => Pt): SideData {
  const b = raw.blue;
  const lane = (k: LaneName): Pt[] => b.lanes[k].map((p) => m(pt(p)));
  return {
    fountain: { ...m(b.fountain), r: b.fountain.r },
    nexus: m(b.nexus),
    nexusTowers: b.nexusTowers.map((p) => m(p)),
    // Point mirroring maps blue top onto red bot; lane identity follows the physical lane, so swap names.
    lanes: m === mirror ? { top: lane('bot'), mid: lane('mid'), bot: lane('top') } : { top: lane('top'), mid: lane('mid'), bot: lane('bot') },
    towers:
      m === mirror
        ? { top: b.towers.bot.map((p) => m(p)), mid: b.towers.mid.map((p) => m(p)), bot: b.towers.top.map((p) => m(p)) }
        : { top: b.towers.top.map((p) => m(p)), mid: b.towers.mid.map((p) => m(p)), bot: b.towers.bot.map((p) => m(p)) },
    inhibitors:
      m === mirror
        ? { top: m(b.inhibitors.bot), mid: m(b.inhibitors.mid), bot: m(b.inhibitors.top) }
        : { top: m(b.inhibitors.top), mid: m(b.inhibitors.mid), bot: m(b.inhibitors.bot) },
    camps: b.camps.map((c) => ({ ...c, ...m(c) })),
    plants: b.plants.map((c) => ({ ...c, ...m(c) })),
  };
}

export function loadMap(): MapData {
  const id = (p: Pt): Pt => p;
  const quarterWalls = raw.quarter.walls.map((w) => w.map(pt));
  const blueWalls = [...quarterWalls, ...quarterWalls.map((w) => w.map(swap))];
  const quarterBushes = raw.quarter.bushes.map((c) => ({ ...c }));
  const blueBushes = [...quarterBushes, ...quarterBushes.map((c) => ({ ...swap(c), r: c.r }))];
  const walls = [...blueWalls, ...blueWalls.map((w) => w.map(mirror)), ...raw.neutral.walls.map((w) => w.map(pt))];
  const bushes = [...blueBushes, ...blueBushes.map((c) => ({ ...mirror(c), r: c.r })), ...raw.neutral.bushes];
  const o = raw.neutral.objectives;
  return {
    size: S,
    sides: [buildSide(id), buildSide(mirror)],
    walls,
    bushes,
    objectives: { leviathan: o.leviathan, kesselbrut: o.kesselbrut, schleierwaechter: o.schleierwaechter, nebelschleicher: o.nebelschleicher },
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

const UNIT_CLEARANCE = 40;

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

/** Nearest walkable point to (x,y), searching outward ring by ring. */
export function nearestWalkable(nav: NavGrid, x: number, y: number): Pt {
  if (walkable(nav, x, y)) return { x, y };
  const cx = Math.floor(x / CELL);
  const cy = Math.floor(y / CELL);
  for (let r = 1; r < 60; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const px = (cx + dx + 0.5) * CELL;
        const py = (cy + dy + 0.5) * CELL;
        if (walkable(nav, px, py)) return { x: px, y: py };
      }
    }
  }
  return { x, y };
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
  for (let c = g; c !== s && c !== -1; c = from[c]!) {
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
