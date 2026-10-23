// Scale audit: clearance radii (distance to nearest blocked nav cell / wall polygon) at camps, lanes, corridors.
import { loadMap, CELL, inPoly, type Pt } from '../../src/sim/map';
import { segDist2 } from '../../src/sim/vec';

const map = loadMap();
const S = map.size;
// distance from point to nearest wall polygon (0 inside)
function wallDist(x: number, y: number): number {
  let best = Infinity;
  for (const poly of map.walls) {
    if (inPoly(x, y, poly)) return 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) best = Math.min(best, Math.sqrt(segDist2(x, y, poly[i]!.x, poly[i]!.y, poly[j]!.x, poly[j]!.y)));
  }
  return Math.min(best, x, y, S - x, S - y);
}
const r = (n: number): number => Math.round(n);
console.log('map size', S);
const b = map.sides[0];
console.log('fountain', b.fountain, 'nexus', b.nexus);
const d = (a: Pt, c: Pt): number => r(Math.hypot(a.x - c.x, a.y - c.y));
console.log('nexus->nexus', d(map.sides[0].nexus, map.sides[1].nexus));
console.log('fountain->nexus', d(b.fountain, b.nexus));
for (const l of ['top', 'mid', 'bot'] as const) {
  const t = b.towers[l];
  let len = 0;
  const w = b.lanes[l];
  for (let i = 1; i < w.length; i++) len += Math.hypot(w[i]!.x - w[i - 1]!.x, w[i]!.y - w[i - 1]!.y);
  console.log(l, 'lane len', r(len), 'fountain->outer', d(b.fountain, t[0]!), 'outer->inner', d(t[0]!, t[1]!), 'inner->inhibT', d(t[1]!, t[2]!), 'inhibT->inhib', d(t[2]!, b.inhibitors[l]), 'inhib->nexus', d(b.inhibitors[l], b.nexus), 'outer->enemy outer', d(t[0]!, map.sides[1].towers[l][0]!));
}
console.log('camps (wall clearance = free radius to nearest wall polygon)');
for (const c of [...b.camps, ...Object.entries(map.objectives).filter(([k]) => k !== 'nebelschleicher').map(([k, p]) => ({ id: k, ...(p as Pt) }))]) {
  console.log(' ', c.id, c.x, c.y, 'free r', r(wallDist(c.x, c.y)));
}
// lane width: sample along each lane, measure distance to walls on both sides perpendicular
function laneWidth(l: 'top' | 'mid' | 'bot'): number[] {
  const out: number[] = [];
  const w = b.lanes[l];
  for (let i = 1; i < w.length; i++) {
    const a = w[i - 1]!, c = w[i]!;
    const L = Math.hypot(c.x - a.x, c.y - a.y);
    const nx = -(c.y - a.y) / L, ny = (c.x - a.x) / L;
    for (let s = 800; s < L - 800; s += 600) {
      const x = a.x + ((c.x - a.x) * s) / L, y = a.y + ((c.y - a.y) * s) / L;
      let lw = 0;
      for (const sg of [1, -1]) {
        let k = 0;
        while (k < 3000 && wallDist(x + nx * sg * k, y + ny * sg * k) > 0 && x + nx * sg * k > 0 && y + ny * sg * k > 0 && x + nx * sg * k < S && y + ny * sg * k < S) k += 20;
        lw += k;
      }
      out.push(r(lw));
    }
  }
  return out;
}
for (const l of ['top', 'mid', 'bot'] as const) console.log(l, 'open width across lane (wall to wall / map edge)', laneWidth(l).join(' '));
// corridor widths: local max of wall distance along jungle (medial axis approx): histogram of 2*wallDist for jungle cells
const hist = new Map<number, number>();
let walkCells = 0;
for (let y = 2500; y < 13500; y += 100) for (let x = 2500; x < 13500; x += 100) {
  const wd = wallDist(x, y);
  if (wd <= 0) continue;
  walkCells++;
  // ridge test: larger than 4 neighbours at 100 in either axis pair -> on medial axis
  const n = [wallDist(x + 100, y), wallDist(x - 100, y), wallDist(x, y + 100), wallDist(x, y - 100)];
  if ((wd >= n[0]! && wd >= n[1]!) || (wd >= n[2]! && wd >= n[3]!)) {
    const k = Math.min(2000, Math.round((2 * wd) / 100) * 100);
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
}
console.log('jungle medial-axis width histogram (2x wall dist, 100-buckets):', [...hist.entries()].sort((a, c) => a[0] - c[0]).map(([k, v]) => `${k}:${v}`).join(' '));
// wall thickness: for each wall polygon, 2x max inner distance (approx by sampling)
const th: number[] = [];
for (const poly of map.walls.slice(0, 8)) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  let best = 0;
  for (let y = y0; y <= y1; y += 25) for (let x = x0; x <= x1; x += 25) {
    if (!inPoly(x, y, poly)) continue;
    let m = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) m = Math.min(m, Math.sqrt(segDist2(x, y, poly[i]!.x, poly[i]!.y, poly[j]!.x, poly[j]!.y)));
    best = Math.max(best, m);
  }
  th.push(r(2 * best));
}
console.log('quarter wall max thickness', th.join(' '));
let walk = 0;
for (let i = 0; i < map.nav.walk.length; i++) walk += map.nav.walk[i]!;
console.log('walkable fraction', (walk / map.nav.walk.length).toFixed(3), 'cell', CELL);
// narrow chokes in blue's top-side quarter (y > x, x + y < 15000): medial points narrower than 450
const chokes: string[] = [];
for (let y = 2500; y < 13000; y += 100) for (let x = 1500; x < 8000; x += 100) {
  if (y <= x + 200 || x + y > 15000) continue;
  const wd = wallDist(x, y);
  if (wd <= 0 || 2 * wd >= 450) continue;
  const n = [wallDist(x + 100, y), wallDist(x - 100, y), wallDist(x, y + 100), wallDist(x, y - 100)];
  if ((wd >= n[0]! && wd >= n[1]!) || (wd >= n[2]! && wd >= n[3]!)) chokes.push(`(${x},${y}):${r(2 * wd)}`);
}
console.log('chokes < 450 in blue top quarter:', chokes.join(' '));
