// Static terrain in style C "Gouache-Dämmerung" (docs/style-variants.md, reference docs/style/variant-c-lane.jpg):
//  - ground: one painted 4096² texture (brush-stroke moss, worn cobbled lanes with ruts / puddles / cracks, blue-grey
//    river with a warm sky streak, team plazas, camp clearings, epic pits) + a tiled world-space brush detail texture
//    blended in the gouache shader for close-up grain
//  - walls: organic layered cliffs (organic.ts outline of the collision polygon) with moss caps, jagged rock
//    pinnacles and slim pines as silhouettes (instanced), violet crystals near the river
//  - bushes: tall spiky grass tufts; camps: worn clearings with rim props (stones, logs, bones, mushrooms, rune
//    pillars), landmarks, buff glow; fountains + base props per team
//  - beyond the map edge: dark forest and pinnacles sinking into the violet haze
// Draw calls: ground, skirt, cliffs (+outline), pinnacles (+outline), pines (+outline), bushes (+outline), props
// (+outline), glow props, buff glows, mist — about 16 (+ shadow passes).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapData, Pt } from '../sim/map';
import { walkable } from '../sim/map';
import { MAP_SIZE, mulberry, simToCanvas } from './coords';
import { detailUniform, gouache, outlineMaterial, outlineMesh, paint, withFog } from './materials';
import { edgeDist, offsetOutline, organicOutline, pointInPoly } from './organic';
import { BASE_LOOK } from './palette';
import { atlasStoreAvailable, buildVersion, loadStrip, saveStrip } from './atlasStore';
import { GROUND_ART_VER, staticStrip } from './staticAtlas';

const S = MAP_SIZE;

export interface Terrain {
  group: THREE.Group;
  update(timeSec: number): void;
}

const C = {
  moss: ['#55613f', '#4b5738', '#5d6a43', '#434f33', '#505c3a'],
  mossWarm: '#6b6a44',
  floor: '#3b4130',
  soil: '#4a4232',
  dirt: ['#8c7350', '#816a49', '#957c57', '#86704c'],
  rut: '#77633f',
  dirtLight: '#a48c64',
  cobble: ['#a59a84', '#958b77', '#b0a690', '#8a8172'],
  joint: '#4a4232',
  river: ['#6f7f99', '#66768f', '#7787a0', '#5d6c86'],
  riverDeep: '#4f5d76',
  riverBank: '#4a5866',
  sky: '#e3ad87',
  rock: '#6e6656',
  rockDark: '#4b4639',
  rockLight: '#8a8170',
  mossCap: ['#4f6238', '#5a6d40', '#465832'],
  pine: ['#2e4536', '#3b5640', '#344c3a'],
  trunk: '#4a3426',
  bush: ['#2f4a3e', '#3b5a45', '#456b48', '#2a4236'],
};

// ------------------------------------------------------------------------------------------------ geometry helpers
const laneHalf = 350;
type Seg = [number, number, number, number];
function segDist(px: number, py: number, s: Seg): number {
  const dx = s[2] - s[0];
  const dy = s[3] - s[1];
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - s[0]) * dx + (py - s[1]) * dy) / l2));
  return Math.hypot(px - s[0] - dx * t, py - s[1] - dy * t);
}
/** River centre offset across the anti-diagonal (wobble), shared by painting and props. */
function riverOffset(x: number, y: number): number {
  const t = (x - y + S) / (2 * S);
  return Math.sin(t * Math.PI * 5) * 257;
}
/** Signed distance across the river (0 = centre line). */
const riverDist = (x: number, y: number): number => Math.abs((x + y - S) / Math.SQRT2 - riverOffset(x, y));

/**
 * Jungle camp clearing (shared by the ground painting and the 3D props): radius of the readable camp area, free
 * walkable distance per direction (PROBES directions, capped at 1400), the landmark direction (nearest wall, or
 * opposite the main path when the clearing is open) and the entrance directions (the two most open paths).
 */
interface CampSite {
  x: number;
  y: number;
  id: string;
  buff?: boolean;
  side: number;
  epic: boolean;
  r: number;
  probe: number[];
  back: number;
  backD: number;
  open: number[];
}
const PROBES = 24;
/** Clearing radius: LoL camps read as a worn area of ~1000-1100 diameter (buffs a bit more). */
const CLEARING_R = { buff: 560, small: 500, epic: 900, scuttle: 420 };

function campSite(map: MapData, c: { x: number; y: number; id: string; buff?: boolean; side: number }): CampSite {
  const epic = c.side === 2;
  const probe: number[] = [];
  for (let i = 0; i < PROBES; i++) {
    const a = (i / PROBES) * Math.PI * 2;
    let d = 0;
    while (d < 1400 && walkable(map.nav, c.x + Math.cos(a) * d, c.y + Math.sin(a) * d)) d += 25;
    probe.push(d);
  }
  const ang = (i: number): number => (i / PROBES) * Math.PI * 2;
  let near = 0;
  for (let i = 1; i < PROBES; i++) if (probe[i]! < probe[near]!) near = i;
  // entrances: the most open direction, then the most open one at least 100 degrees away from it
  const order = probe.map((d, i) => [d, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const open = [ang(order[0]![1])];
  for (const [, i] of order) {
    const da = Math.abs(Math.atan2(Math.sin(ang(i) - open[0]!), Math.cos(ang(i) - open[0]!)));
    if (da > (100 * Math.PI) / 180) {
      open.push(ang(i));
      break;
    }
  }
  const r = epic ? CLEARING_R.epic : c.id === 'nebelschleicher' ? CLEARING_R.scuttle : c.buff ? CLEARING_R.buff : CLEARING_R.small;
  // landmark against the nearest wall when one is close, otherwise opposite the main path (the camp's "back")
  const wallBack = probe[near]! < r + 260;
  const back = wallBack ? ang(near) : open[0]! + Math.PI;
  return { ...c, epic, r, probe, back, backD: wallBack ? probe[near]! : r + 120, open };
}

/** Free distance of a camp site toward angle a (nearest probe). */
function probeAt(s: CampSite, a: number): number {
  const i = Math.round((((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / ((Math.PI * 2) / PROBES)) % PROBES;
  return s.probe[i]!;
}
/** True if angle a lies within `half` radians of one of the site's entrances. */
function nearEntrance(s: CampSite, a: number, half: number): boolean {
  return s.open.some((o) => Math.abs(Math.atan2(Math.sin(a - o), Math.cos(a - o))) < half);
}

interface Ctx {
  map: MapData;
  lanes: Seg[];
  laneDist(x: number, y: number): number;
  baseDist(x: number, y: number): [number, number];
  outlines: Pt[][];
  camps: CampSite[];
}

function context(map: MapData): Ctx {
  const lanes: Seg[] = [];
  for (const lane of Object.values(map.sides[0].lanes)) for (let i = 1; i < lane.length; i++) lanes.push([lane[i - 1]!.x, lane[i - 1]!.y, lane[i]!.x, lane[i]!.y]);
  const camps = [
    ...map.sides.flatMap((s, side) => s.camps.map((c) => ({ ...c, side }))),
    { id: 'leviathan', side: 2, ...map.objectives.leviathan },
    { id: 'schleierwaechter', side: 2, ...map.objectives.schleierwaechter },
    ...map.objectives.nebelschleicher.map((p) => ({ id: 'nebelschleicher', side: 2, ...p })),
  ];
  return {
    map,
    lanes,
    laneDist: (x, y) => {
      let d = Infinity;
      for (const s of lanes) d = Math.min(d, segDist(x, y, s));
      return d;
    },
    baseDist: (x, y) => {
      const a = Math.hypot(x - map.sides[0].nexus.x, y - map.sides[0].nexus.y);
      const b = Math.hypot(x - map.sides[1].nexus.x, y - map.sides[1].nexus.y);
      return a < b ? [a, 0] : [b, 1];
    },
    outlines: map.walls.map((w, i) => organicOutline(w, i * 1.7 + 0.3)),
    camps: camps.map((c) => campSite(map, c)),
  };
}

/** Vertex-colour a geometry per vertex from (position, normal). */
function colorize(geo: THREE.BufferGeometry, f: (p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color) => void): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    f(p, n, c);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function extrude(outline: Pt[], y0: number, h: number, bevel: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map((p) => new THREE.Vector2(p.x, p.y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel * 1.2, bevelSegments: 2, steps: 1, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

/** Inset outline usable as an upper cliff layer: every point well inside the polygon. */
function insetLayer(outline: Pt[], poly: Pt[], d: number, seed: number): Pt[] | null {
  const inset = offsetOutline(outline, -d, d * 0.25, seed);
  for (let i = 0; i < inset.length; i += 2) {
    const q = inset[i]!;
    if (!pointInPoly(q.x, q.y, poly) || edgeDist(q.x, q.y, poly) < d * 0.45) return null;
  }
  return inset;
}

// ------------------------------------------------------------------------------------------------ instanced props
interface Inst {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  rx: number;
  ry: number;
  rz: number;
  tint: number;
}
function instanced(geo: THREE.BufferGeometry, list: Inst[], outline: number, shadow = true): THREE.Object3D[] {
  if (!list.length) return [];
  const mat = gouache({ vertexColors: true });
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const c = new THREE.Color();
  list.forEach((it, i) => {
    q.setFromEuler(e.set(it.rx, it.ry, it.rz));
    m.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.sx, it.sy, it.sz));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.setScalar(it.tint));
  });
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  const out: THREE.Object3D[] = [mesh];
  if (outline > 0) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', geo.getAttribute('position').clone());
    const merged = mergeVerticesSafe(g);
    const o = new THREE.InstancedMesh(merged, outlineMaterial(outline), list.length);
    o.instanceMatrix = mesh.instanceMatrix;
    o.computeBoundingSphere();
    out.push(o);
  }
  return out;
}
function mergeVerticesSafe(g: THREE.BufferGeometry): THREE.BufferGeometry {
  // outline needs smooth normals: weld by position, then recompute
  const out = outlineMesh(g, 1).geometry;
  return out;
}

/** Slim pine: trunk + three stacked cones (unit height ~1, origin at the foot). */
function pineGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.035, 0.05, 0.22, 5);
  trunk.translate(0, 0.11, 0);
  parts.push(paint(trunk, C.trunk));
  const tiers: [number, number, number, string][] = [
    [0.2, 0.36, 0.2, C.pine[0]!],
    [0.16, 0.32, 0.42, C.pine[1]!],
    [0.11, 0.3, 0.64, C.pine[2]!],
  ];
  for (const [r, h, y, col] of tiers) {
    const cone = new THREE.ConeGeometry(r, h, 6);
    cone.translate(0, y + h / 2, 0);
    parts.push(paint(cone, col));
  }
  return mergeGeometries(parts)!;
}
/** Jagged rock pinnacle (unit size, origin at the foot): lighter warm top, dark foot. */
function pinnacleGeometry(): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(1, 1, 5, 2);
  g.translate(0, 0.5, 0);
  // break the symmetry a little
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > 0.05 && y < 0.95) pos.setX(i, pos.getX(i) * (0.82 + 0.3 * Math.abs(Math.sin(i * 2.7))));
  }
  const top = new THREE.Color(C.rockLight);
  const bot = new THREE.Color(C.rockDark);
  return colorize(g, (p, n, c) => {
    c.copy(bot).lerp(top, Math.min(1, p.y * 1.3));
    if (n.x > 0.3) c.multiplyScalar(1.08);
  });
}
/** Glowing crystal shard (unit size). */
function crystalGeometry(): THREE.BufferGeometry {
  const g = new THREE.OctahedronGeometry(1, 0);
  g.scale(0.35, 1, 0.35);
  g.translate(0, 0.8, 0);
  return g;
}

// ------------------------------------------------------------------------------------------------ main
export function buildTerrain(map: MapData, anisotropy: number, quality: string = 'medium'): Terrain {
  const low = quality === 'low';
  const group = new THREE.Group();
  const cx = context(map);
  const rnd = mulberry(7);

  // ---------------------------------------------------------------- ground + detail
  detailUniform.value = detailTexture();
  const tex = groundTexture(cx, low ? 2048 : 4096);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  const groundGeo = new THREE.PlaneGeometry(S, S);
  groundGeo.rotateX(-Math.PI / 2);
  groundGeo.translate(S / 2, 0, -S / 2);
  const ground = new THREE.Mesh(groundGeo, gouache({ map: tex }, { detail: !low, rim: 0 }));
  ground.receiveShadow = true;
  group.add(ground);
  // beyond the map: dark forest floor (depth-tested behind the ground)
  const skirtGeo = new THREE.PlaneGeometry(S * 3, S * 3);
  skirtGeo.rotateX(-Math.PI / 2);
  skirtGeo.translate(S / 2, -4, -S / 2);
  const skirt = new THREE.Mesh(skirtGeo, gouache({ color: '#2b3022' }, { detail: !low, rim: 0 }));
  skirt.renderOrder = 1;
  skirt.receiveShadow = true;
  group.add(skirt);

  // ---------------------------------------------------------------- cliffs
  const cliffParts: THREE.BufferGeometry[] = [];
  const pinnacles: Inst[] = [];
  const pines: Inst[] = [];
  const crystals: Inst[] = [];
  const rock = new THREE.Color(C.rock);
  const rockDark = new THREE.Color(C.rockDark);
  map.walls.forEach((poly, wi) => {
    const outline = cx.outlines[wi]!;
    const seed = wi * 3.1;
    const layers: { o: Pt[]; y0: number; h: number; cap: string }[] = [{ o: outline, y0: -6, h: 112, cap: C.mossCap[2]! }];
    const l1 = insetLayer(outline, poly, 85, seed + 1);
    if (l1) layers.push({ o: l1, y0: 90, h: 92, cap: C.mossCap[0]! });
    const l2 = l1 ? insetLayer(outline, poly, 200, seed + 2) : null;
    if (l2) layers.push({ o: l2, y0: 170, h: 80, cap: C.mossCap[1]! });
    for (const L of layers) {
      const capC = new THREE.Color(L.cap);
      const top = L.y0 + L.h;
      cliffParts.push(
        colorize(extrude(L.o, L.y0, L.h, 26), (p, n, c) => {
          if (n.y > 0.55) c.copy(capC).multiplyScalar(0.92 + 0.16 * Math.abs(Math.sin(p.x * 0.013 + p.z * 0.017)));
          else {
            const k = Math.max(0, Math.min(1, (p.y - L.y0) / (top - L.y0)));
            c.copy(rockDark).lerp(rock, k * 0.85);
            // horizontal strata
            if (Math.sin(p.y * 0.11) > 0.75) c.multiplyScalar(0.86);
            if (n.y < -0.2) c.multiplyScalar(0.7);
          }
        }),
      );
    }
    const topAt = (x: number, y: number): number => (l2 && pointInPoly(x, y, l2) ? 250 : l1 && pointInPoly(x, y, l1) ? 182 : 106);
    // pinnacles: rim (short) and interior (tall)
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of poly) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const placed: Pt[] = [];
    const tries = Math.ceil(((maxX - minX) * (maxY - minY)) / 3500);
    for (let i = 0; i < tries; i++) {
      const x = minX + rnd() * (maxX - minX);
      const y = minY + rnd() * (maxY - minY);
      if (!pointInPoly(x, y, poly)) continue;
      const ed = edgeDist(x, y, poly);
      if (ed < 50) continue;
      if (placed.some((q) => (q.x - x) ** 2 + (q.y - y) ** 2 < 125 * 125)) continue;
      placed.push({ x, y });
      const nearRiver = riverDist(x, y) < 1300 || Math.hypot(x - map.objectives.schleierwaechter.x, y - map.objectives.schleierwaechter.y) < 1500 || Math.hypot(x - map.objectives.leviathan.x, y - map.objectives.leviathan.y) < 1500;
      const r = rnd();
      if (ed > 140 && r < 0.42 && !low) {
        const s = 300 + rnd() * 260;
        pines.push({ x, y: topAt(x, y) - 10, z: -y, sx: s, sy: s * (0.9 + rnd() * 0.3), sz: s, rx: 0, ry: rnd() * 6, rz: 0, tint: 0.8 + rnd() * 0.3 });
      } else if (nearRiver && r > 0.9) {
        const s = 40 + rnd() * 40;
        for (let k = 0; k < 3; k++) crystals.push({ x: x + (rnd() - 0.5) * 60, y: topAt(x, y) - 10, z: -y + (rnd() - 0.5) * 60, sx: s, sy: s * (1.5 + rnd()), sz: s, rx: (rnd() - 0.5) * 0.7, ry: rnd() * 6, rz: (rnd() - 0.5) * 0.7, tint: 0.85 + rnd() * 0.3 });
      } else {
        const tall = ed > 160;
        const rr = tall ? 60 + rnd() * 50 : 40 + rnd() * 35;
        const h = tall ? 230 + rnd() * 240 : 120 + rnd() * 110;
        pinnacles.push({ x, y: topAt(x, y) - 20, z: -y, sx: rr, sy: h, sz: rr * (0.8 + rnd() * 0.4), rx: (rnd() - 0.5) * 0.25, ry: rnd() * 6, rz: (rnd() - 0.5) * 0.25, tint: 0.85 + rnd() * 0.25 });
      }
    }
  });
  const cliffGeo = mergeGeometries(cliffParts)!;
  const cliffs = new THREE.Mesh(cliffGeo, gouache({ vertexColors: true }, { rim: 0.35 }));
  cliffs.castShadow = cliffs.receiveShadow = true;
  group.add(cliffs, outlineMesh(cliffGeo, 6));

  // ---------------------------------------------------------------- border forest beyond the map edge
  const borderPine = (x: number, y: number, s: number): void => {
    pines.push({ x, y: 0, z: -y, sx: s, sy: s * (0.9 + rnd() * 0.35), sz: s, rx: 0, ry: rnd() * 6, rz: 0, tint: 0.65 + rnd() * 0.3 });
  };
  const nearPlay = (x: number, y: number): boolean => {
    if (x > 0 && y > 0 && x < S && y < S) {
      if (cx.laneDist(x, y) < 800) return true;
      for (const s of map.sides) if (Math.hypot(x - s.fountain.x, y - s.fountain.y) < s.fountain.r + 500) return true;
      if (cx.baseDist(x, y)[0] < 4300) return true;
    }
    return false;
  };
  const borderN = low ? 900 : 2600;
  for (let i = 0; i < borderN; i++) {
    const side = i % 4;
    const along = rnd() * (S + 3000) - 1500;
    const out = -rnd() * 2200 + 500; // up to 500 inside the edge
    const [x, y] = side === 0 ? [out, along] : side === 1 ? [S - out, along] : side === 2 ? [along, out] : [along, S - out];
    if (nearPlay(x, y)) continue;
    if (rnd() < 0.82) borderPine(x, y, 340 + rnd() * 320);
    else pinnacles.push({ x, y: 0, z: -y, sx: 80 + rnd() * 90, sy: 280 + rnd() * 380, sz: 80 + rnd() * 80, rx: (rnd() - 0.5) * 0.2, ry: rnd() * 6, rz: (rnd() - 0.5) * 0.2, tint: 0.65 + rnd() * 0.25 });
  }
  group.add(...instanced(pinnacleGeometry(), pinnacles, 0.045));
  group.add(...instanced(pineGeometry(), pines, 0.012));
  if (crystals.length) {
    const cm = new THREE.InstancedMesh(crystalGeometry(), withFog(new THREE.MeshBasicMaterial({ color: '#b39cf0' })), crystals.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    crystals.forEach((it, i) => {
      q.setFromEuler(new THREE.Euler(it.rx, it.ry, it.rz));
      cm.setMatrixAt(i, m.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.sx, it.sy, it.sz)));
      cm.setColorAt(i, new THREE.Color('#b39cf0').multiplyScalar(it.tint));
    });
    cm.computeBoundingSphere();
    group.add(cm);
  }

  // ---------------------------------------------------------------- bushes: tall spiky grass
  const bushParts: THREE.BufferGeometry[] = [];
  for (const b of map.bushes) {
    const n = Math.round(b.r / 6.5);
    for (let i = 0; i < n; i++) {
      const ang = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * b.r * 0.92;
      const h = 120 + rnd() * 120 * (1 - (d / b.r) * 0.5);
      const blade = new THREE.ConeGeometry(9 + rnd() * 9, h, 3);
      blade.translate(0, h / 2, 0);
      blade.rotateZ(Math.cos(ang) * (0.15 + (d / b.r) * 0.45) * -1);
      blade.rotateX(Math.sin(ang) * (0.15 + (d / b.r) * 0.45));
      blade.translate(b.x + Math.cos(ang) * d, 0, -(b.y + Math.sin(ang) * d));
      const col = new THREE.Color(C.bush[(rnd() * C.bush.length) | 0]!);
      const tip = col.clone().lerp(new THREE.Color('#8a9a5a'), 0.35);
      bushParts.push(colorize(blade, (p, _n, c) => c.copy(col).lerp(tip, Math.min(1, p.y / 220))));
    }
  }
  if (bushParts.length) {
    const bushGeo = mergeGeometries(bushParts)!;
    const bushes = new THREE.Mesh(bushGeo, gouache({ vertexColors: true }, { rim: 0.6 }));
    bushes.castShadow = true;
    bushes.receiveShadow = true;
    group.add(bushes);
  }

  // ---------------------------------------------------------------- camps: rim props, landmarks, buff glows
  // Sized against a champion (~170 tall): rim stones 60-150 tall, logs ~260 long, mushrooms knee-high. Props stand
  // on the clearing rim (campSite: radius per camp type, entrances toward the two most open paths stay free).
  const propParts: THREE.BufferGeometry[] = [];
  const glowParts: THREE.BufferGeometry[] = [];
  const glowPlanes: { mesh: THREE.Mesh; phase: number }[] = [];
  const stone = (x: number, y: number, r: number, h: number, col: string, yaw = 0): void => {
    const g = new THREE.DodecahedronGeometry(1, 0);
    g.scale(r, h, r * (0.8 + rnd() * 0.4));
    g.rotateY(yaw);
    g.translate(x, h * 0.45, -y);
    propParts.push(paint(g, col));
  };
  /** Leaning standing stone (5-sided slab). */
  const menhir = (x: number, y: number, r: number, h: number, col: string, lean: number, yaw: number): void => {
    const g = new THREE.CylinderGeometry(r * 0.55, r, h, 5);
    g.translate(0, h / 2, 0);
    g.rotateZ(lean);
    g.rotateY(yaw);
    g.translate(x, -4, -y);
    propParts.push(paint(g, col));
  };
  /** Fallen log with lighter cut ends. */
  const log = (x: number, y: number, len: number, r: number, ang: number): void => {
    const g = new THREE.CylinderGeometry(r, r * 1.12, len, 7);
    g.rotateZ(Math.PI / 2);
    g.rotateY(ang);
    g.translate(x, r * 0.8, -y);
    propParts.push(paint(g, rnd() < 0.5 ? '#5a4632' : '#4e3d2c'));
    for (const s of [-1, 1]) {
      const cut = new THREE.CylinderGeometry(r * 0.8, r * 0.8, 4, 7);
      cut.rotateZ(Math.PI / 2);
      cut.translate((s * len) / 2 + s * 2, 0, 0);
      cut.rotateY(ang);
      cut.translate(x, r * 0.8, -y);
      propParts.push(paint(cut, '#a88a62'));
    }
    // moss saddle
    const moss = new THREE.SphereGeometry(r * 1.05, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2);
    moss.scale(len * 0.012, 0.5, 1);
    moss.rotateY(ang);
    moss.translate(x, r * 1.5, -y);
    propParts.push(paint(moss, '#56703c'));
  };
  /** Mushroom with a glowing cap (cap in the unlit glow mesh). */
  const mushroom = (x: number, y: number, s: number, col: string): void => {
    const st = new THREE.CylinderGeometry(5 * s, 7 * s, 30 * s, 5);
    st.translate(x, 15 * s, -y);
    propParts.push(paint(st, '#d8ccb0'));
    const cap = new THREE.SphereGeometry(17 * s, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.scale(1, 0.62, 1);
    cap.translate(x, 27 * s, -y);
    glowParts.push(paint(cap, col));
  };
  /** Skull + rib arcs (wolves, beetles). */
  const bones = (x: number, y: number, s: number, ang: number): void => {
    const sk = new THREE.SphereGeometry(16 * s, 6, 4);
    sk.scale(1, 0.85, 1.25);
    sk.translate(x, 12 * s, -y);
    propParts.push(paint(sk, '#dcd2b8'));
    const jaw = new THREE.BoxGeometry(18 * s, 7 * s, 14 * s);
    jaw.translate(x + Math.cos(ang) * 16 * s, 5 * s, -y - Math.sin(ang) * 16 * s);
    propParts.push(paint(jaw, '#c9bea2'));
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.TorusGeometry((20 - i * 2) * s, 3 * s, 3, 7, Math.PI);
      rib.rotateY(ang + Math.PI / 2);
      const d = (34 + i * 14) * s;
      rib.translate(x - Math.cos(ang) * d, 0, -y + Math.sin(ang) * d);
      propParts.push(paint(rib, '#d6ccb0'));
    }
  };
  /** Glow crystal cluster (buff colour / shadow violet). */
  const crystalCluster = (x: number, y: number, s: number, col: string): void => {
    for (let i = 0; i < 3; i++) {
      const g = new THREE.OctahedronGeometry(14 * s, 0);
      g.scale(0.55, 1.9 - i * 0.4, 0.55);
      g.rotateZ((i - 1) * 0.35);
      g.translate(x + (i - 1) * 16 * s, (22 - i * 4) * s, -y + (i % 2) * 10 * s);
      glowParts.push(paint(g, col));
    }
  };
  const ROCK_COLS = ['#7d7666', '#686252', '#746d5c', '#5f5a4c'];
  const pick = <T,>(a: readonly T[]): T => a[(rnd() * a.length) | 0]!;
  const buffCol = (id: string): string =>
    id === 'dornenbock' ? '#6fc4f0' : id === 'glutwaechter' ? '#ff8a3a' : id === 'leviathan' ? '#6fd6c8' : id === 'schattenkrabbe' ? '#a98aec' : '#b993ff';
  for (const c of cx.camps) {
    if (c.id === 'nebelschleicher') continue;
    const lx = c.x + Math.cos(c.back) * Math.max(c.r * 0.8, Math.min(c.backD - 60, c.r + 140));
    const ly = c.y + Math.sin(c.back) * Math.max(c.r * 0.8, Math.min(c.backD - 60, c.r + 140));
    if (c.buff || c.epic) {
      // landmark: tall monolith with a glowing rune crystal + coloured ground glow
      const col = buffCol(c.id);
      const H = c.epic ? 420 : 340;
      const ob = new THREE.CylinderGeometry(34, 66, H, 5);
      ob.translate(lx, H / 2, -ly);
      propParts.push(paint(ob, '#5c574c'));
      const capg = new THREE.ConeGeometry(38, 80, 5);
      capg.translate(lx, H + 38, -ly);
      propParts.push(paint(capg, '#4b463c'));
      stone(lx + 70, ly - 40, 52, 34, '#686252', rnd() * 6);
      stone(lx - 64, ly + 26, 44, 28, '#7d7666', rnd() * 6);
      const rune = new THREE.OctahedronGeometry(30, 0);
      rune.scale(0.6, 1.5, 0.6);
      rune.translate(lx, H * 0.66, -ly + 40);
      glowParts.push(paint(rune, col));
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), withFog(new THREE.MeshBasicMaterial({ map: radialTexture(col), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 })));
      const gr = c.r * (c.epic ? 1.7 : 2.3);
      plane.scale.set(gr, 1, gr);
      plane.position.set(c.x, 3, -c.y);
      plane.renderOrder = 2;
      group.add(plane);
      glowPlanes.push({ mesh: plane, phase: rnd() * 6 });
      if (c.epic) continue;
      // rune pillars on the rim: knee-to-shoulder high obelisks with a glowing tip, entrances left open
      for (let i = 0; i < 7; i++) {
        const a = c.back + Math.PI / 7 + (i / 7) * Math.PI * 2;
        if (nearEntrance(c, a, 0.42) || probeAt(c, a) < c.r * 0.92) continue;
        const rr = c.r * (0.98 + rnd() * 0.08);
        const px = c.x + Math.cos(a) * rr;
        const py = c.y + Math.sin(a) * rr;
        const h = 120 + rnd() * 70;
        const p = new THREE.CylinderGeometry(14, 30, h, 4);
        p.rotateY(rnd());
        p.translate(px, h / 2 - 4, -py);
        propParts.push(paint(p, rnd() < 0.5 ? '#6e6858' : '#5f5a4c'));
        const tip = new THREE.OctahedronGeometry(13, 0);
        tip.scale(0.7, 1.4, 0.7);
        tip.translate(px, h + 14, -py);
        glowParts.push(paint(tip, col));
        stone(px + 30, py - 22, 26 + rnd() * 14, 18 + rnd() * 10, pick(ROCK_COLS), rnd() * 6);
      }
      continue;
    }
    // small camps: theme props on the rim (standing stones + camp-specific dressing), entrances stay free
    const N = 9;
    for (let i = 0; i < N; i++) {
      const a = c.back + (i / N) * Math.PI * 2 + (rnd() - 0.5) * 0.25;
      if (nearEntrance(c, a, 0.45)) continue;
      const free = probeAt(c, a);
      if (free < c.r * 0.9) continue; // the cliff is the boundary there
      const rr = Math.min(free - 40, c.r * (1.0 + rnd() * 0.14));
      const px = c.x + Math.cos(a) * rr;
      const py = c.y + Math.sin(a) * rr;
      const kind = (i + (c.id.length % 3)) % 3;
      if (kind === 0) menhir(px, py, 30 + rnd() * 16, 90 + rnd() * 70, pick(ROCK_COLS), (rnd() - 0.5) * 0.3, rnd() * 6);
      else if (kind === 1) {
        stone(px, py, 50 + rnd() * 26, 36 + rnd() * 26, pick(ROCK_COLS), rnd() * 6);
        stone(px + 44, py + 26, 26 + rnd() * 12, 20 + rnd() * 10, pick(ROCK_COLS), rnd() * 6);
      } else if (c.id === 'sumpfunke' || c.id === 'mooswolf') log(px, py, 220 + rnd() * 80, 22 + rnd() * 8, a + Math.PI / 2 + (rnd() - 0.5) * 0.6);
      else if (c.id === 'schattenkrabbe') {
        stone(px, py, 64 + rnd() * 24, 50 + rnd() * 30, '#5a5562', rnd() * 6);
        crystalCluster(px - 30, py + 20, 1.3, '#a98aec');
      } else bones(px, py, 1.3, a);
    }
    // landmark: cairn (gromp: mushroom ring, wolves: bones under a dead stump, beetles: twig nest, krugs: boulders)
    stone(lx, ly, 70, 44, '#6e6858', rnd() * 6);
    const g2 = new THREE.DodecahedronGeometry(1, 0);
    g2.scale(48, 32, 44);
    g2.translate(lx, 86, -ly);
    propParts.push(paint(g2, '#7d7666'));
    const g3 = new THREE.DodecahedronGeometry(1, 0);
    g3.scale(30, 26, 30);
    g3.translate(lx, 134, -ly);
    propParts.push(paint(g3, '#8a8372'));
    if (c.id === 'sumpfunke') {
      for (let i = 0; i < 9; i++) {
        const a = c.back + (rnd() - 0.5) * 2.2;
        const d = c.r * (0.82 + rnd() * 0.2);
        mushroom(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d, 1.4 + rnd() * 1.1, rnd() < 0.6 ? '#9fe8a0' : '#e8c86a');
      }
    } else if (c.id === 'mooswolf') {
      const st = new THREE.CylinderGeometry(30, 46, 120, 7);
      st.translate(lx + 90, 60, -ly - 40);
      propParts.push(paint(st, '#4e3d2c'));
      bones(lx - 110, ly + 60, 1.4, c.back + 2);
      for (let i = 0; i < 4; i++) mushroom(lx + (rnd() - 0.5) * 220, ly + (rnd() - 0.5) * 220, 1.2, '#c9a2e8');
    } else if (c.id === 'hohlkaefer') {
      const nest = new THREE.TorusGeometry(70, 20, 5, 12);
      nest.rotateX(Math.PI / 2);
      nest.scale(1, 0.6, 1);
      nest.translate(lx + Math.cos(c.back + 1.4) * 150, 14, -(ly + Math.sin(c.back + 1.4) * 150));
      propParts.push(paint(nest, '#6a5638'));
      for (let i = 0; i < 4; i++) {
        const eg = new THREE.SphereGeometry(13, 6, 4);
        eg.scale(1, 1.3, 1);
        eg.translate(lx + Math.cos(c.back + 1.4) * 150 + (rnd() - 0.5) * 60, 18, -(ly + Math.sin(c.back + 1.4) * 150) + (rnd() - 0.5) * 60);
        glowParts.push(paint(eg, '#bfe8dc'));
      }
    } else if (c.id === 'schattenkrabbe') {
      crystalCluster(lx + 70, ly + 40, 1.8, '#a98aec');
      crystalCluster(lx - 80, ly - 30, 1.4, '#8e74d8');
    }
  }

  // ---------------------------------------------------------------- fountains + base props
  for (const team of [0, 1] as const) {
    const s = map.sides[team];
    const L = BASE_LOOK[team];
    const f = s.fountain;
    const base = new THREE.CylinderGeometry(f.r, f.r + 70, 40, 24);
    base.translate(f.x, -17, -f.y);
    propParts.push(paint(base, L.stoneDark));
    const step = new THREE.CylinderGeometry(f.r * 0.82, f.r * 0.86, 14, 24);
    step.translate(f.x, 6, -f.y);
    propParts.push(paint(step, L.stone));
    const basin = new THREE.TorusGeometry(f.r * 0.32, 26, 6, 20);
    basin.rotateX(Math.PI / 2);
    basin.translate(f.x, 24, -f.y);
    propParts.push(paint(basin, L.metal));
    const pool = new THREE.CylinderGeometry(f.r * 0.31, f.r * 0.31, 6, 20);
    pool.translate(f.x, 18, -f.y);
    glowParts.push(paint(pool, team === 0 ? '#9fd8ff' : '#ff9a4a'));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const px = f.x + Math.cos(a) * f.r * 0.88;
      const py = f.y + Math.sin(a) * f.r * 0.88;
      lanternPost(propParts, glowParts, px, py, team, 1.1);
    }
    // banners + lanterns around the plaza (off the lanes)
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      for (const r of [2700, 3900]) {
        const x = s.nexus.x + Math.cos(a) * r;
        const y = s.nexus.y + Math.sin(a) * r;
        if (x < 300 || y < 300 || x > S - 300 || y > S - 300) continue;
        if (cx.laneDist(x, y) < 520 || !walkable(map.nav, x, y)) continue;
        if (Math.hypot(x - f.x, y - f.y) < f.r + 200) continue;
        if (i % 2) banner(propParts, x, y, team, a);
        else lanternPost(propParts, glowParts, x, y, team, 1);
      }
    }
  }
  const propGeo = mergeGeometries(propParts)!;
  const props = new THREE.Mesh(propGeo, gouache({ vertexColors: true }));
  props.castShadow = props.receiveShadow = true;
  group.add(props, outlineMesh(propGeo, 4));
  if (glowParts.length) group.add(new THREE.Mesh(mergeGeometries(glowParts)!, withFog(new THREE.MeshBasicMaterial({ vertexColors: true }))));

  // ---------------------------------------------------------------- rift mist (violet glow at the centre)
  const mistTex = new THREE.CanvasTexture(radialCanvas('rgba(130,104,190,0.8)', 'rgba(90,70,130,0)'));
  mistTex.colorSpace = THREE.SRGBColorSpace;
  const mists: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const mat = withFog(new THREE.MeshBasicMaterial({ map: mistTex, transparent: true, depthWrite: false, opacity: 0.16 }));
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    const sc = 1400 + i * 500;
    m.scale.set(sc, 1, sc * 0.8);
    m.position.set(S / 2 + (i - 1.5) * 260, 8 + i * 6, -S / 2 + (i % 2 ? 200 : -200));
    m.renderOrder = 2;
    group.add(m);
    mists.push(m);
  }

  return {
    group,
    update(t) {
      for (let i = 0; i < mists.length; i++) {
        const m = mists[i]!;
        m.rotation.y = t * 0.04 * (i % 2 ? 1 : -1) + i;
        (m.material as THREE.MeshBasicMaterial).opacity = 0.1 + 0.06 * Math.sin(t * 0.6 + i * 1.7);
      }
      for (const g of glowPlanes) (g.mesh.material as THREE.MeshBasicMaterial).opacity = 0.42 + 0.16 * Math.sin(t * 1.3 + g.phase);
    },
  };
}

/** Lantern post (Lichtwerk: brass lantern with a cold light) or brazier (Aschehalle: iron bowl with embers). */
function lanternPost(parts: THREE.BufferGeometry[], glow: THREE.BufferGeometry[], x: number, y: number, team: 0 | 1, s: number): void {
  const L = BASE_LOOK[team];
  const z = -y;
  if (team === 0) {
    const post = new THREE.CylinderGeometry(9 * s, 13 * s, 210 * s, 6);
    post.translate(x, 105 * s, z);
    parts.push(paint(post, '#5a4632'));
    const cage = new THREE.CylinderGeometry(22 * s, 18 * s, 44 * s, 6, 1, true);
    cage.translate(x, 232 * s, z);
    parts.push(paint(cage, L.metal));
    const roof = new THREE.ConeGeometry(30 * s, 34 * s, 6);
    roof.translate(x, 270 * s, z);
    parts.push(paint(roof, L.metal));
    const light = new THREE.OctahedronGeometry(15 * s, 0);
    light.translate(x, 232 * s, z);
    glow.push(paint(light, L.glow));
  } else {
    const leg = new THREE.CylinderGeometry(10 * s, 20 * s, 150 * s, 5);
    leg.translate(x, 75 * s, z);
    parts.push(paint(leg, L.stoneDark));
    const bowl = new THREE.CylinderGeometry(42 * s, 22 * s, 34 * s, 7);
    bowl.translate(x, 166 * s, z);
    parts.push(paint(bowl, L.metal));
    const fire = new THREE.ConeGeometry(30 * s, 70 * s, 5);
    fire.translate(x, 210 * s, z);
    glow.push(paint(fire, L.fire));
  }
}

/** Team banner on a pole (cloth faces the pole's outward direction). */
function banner(parts: THREE.BufferGeometry[], x: number, y: number, team: 0 | 1, a: number): void {
  const L = BASE_LOOK[team];
  const pole = new THREE.CylinderGeometry(7, 10, 330, 5);
  pole.translate(x, 165, -y);
  parts.push(paint(pole, '#4a3a2a'));
  const bar = new THREE.CylinderGeometry(5, 5, 110, 4);
  bar.rotateZ(Math.PI / 2);
  bar.rotateY(a);
  bar.translate(x, 318, -y);
  parts.push(paint(bar, L.metal));
  const cloth = new THREE.PlaneGeometry(96, 170, 1, 3);
  const pos = cloth.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const py = pos.getY(i);
    pos.setZ(i, Math.sin(py * 0.04) * 8);
    if (py < -80) pos.setY(i, py - (Math.abs(pos.getX(i)) < 10 ? 0 : 22)); // swallow-tail
  }
  cloth.translate(0, 228, 6);
  cloth.rotateY(a);
  cloth.translate(x, 0, -y);
  const g = colorize(cloth, (p, _n, c) => c.set(p.y > 290 ? L.metal : L.cloth));
  parts.push(g);
  const trim = new THREE.BoxGeometry(100, 12, 4);
  trim.translate(0, 304, 6);
  trim.rotateY(a);
  trim.translate(x, 0, -y);
  parts.push(paint(trim, L.metal));
}

function radialCanvas(inner: string, outer: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return c;
}
const radialCache = new Map<string, THREE.Texture>();
function radialTexture(color: string): THREE.Texture {
  let t = radialCache.get(color);
  if (!t) {
    const col = new THREE.Color(color);
    const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, `rgba(${rgb},0.75)`);
    g.addColorStop(0.45, `rgba(${rgb},0.28)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    radialCache.set(color, t);
  }
  return t;
}

// ------------------------------------------------------------------------------------------------ textures
/** Tileable 512² brush-stroke grain around mid grey (×2 in the shader = neutral). */
function detailTexture(): THREE.CanvasTexture {
  const N = 512;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, N, N);
  const rnd = mulberry(99);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * N;
    const y = rnd() * N;
    const v = rnd() < 0.5 ? 100 + rnd() * 20 : 140 + rnd() * 30;
    const warm = rnd() < 0.3 ? 8 : 0;
    ctx.fillStyle = `rgba(${v + warm},${v},${v - warm},${0.25 + rnd() * 0.35})`;
    const len = 6 + rnd() * 18;
    const ang = -0.4 + (rnd() - 0.5) * 0.8;
    for (const ox of [-N, 0, N]) {
      for (const oy of [-N, 0, N]) {
        if (x + ox < -30 || x + ox > N + 30 || y + oy < -30 || y + oy > N + 30) continue;
        ctx.beginPath();
        ctx.ellipse(x + ox, y + oy, len, 1.4 + rnd() * 1.6, ang, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * B7: the painted ground is the same for every match. Painted once per session (menu backdrop and game share it) and,
 * in builds, kept in IndexedDB as PNG (src/render/atlasStore.ts) so a warm start only decodes it. Until the stored or
 * freshly painted image is ready the texture shows a flat ground colour (under the loading cover).
 */
let groundImg: { n: number; canvas: HTMLCanvasElement } | null = null;
const GROUND_VER = buildVersion(import.meta.url);
function groundTexture(cx: Ctx, N: number): THREE.CanvasTexture {
  if (groundImg?.n === N) return new THREE.CanvasTexture(groundImg.canvas);
  const paint = (): HTMLCanvasElement => {
    const t0 = performance.now();
    const c = paintGround(cx, N);
    console.info(`terrain: ground painted in ${Math.round(performance.now() - t0)} ms`);
    groundImg = { n: N, canvas: c };
    return c;
  };
  if (import.meta.env.DEV || !atlasStoreAvailable() || typeof createImageBitmap === 'undefined') return new THREE.CanvasTexture(paint());
  const flat = document.createElement('canvas');
  flat.width = flat.height = 4;
  const fctx = flat.getContext('2d')!;
  fctx.fillStyle = C.floor;
  fctx.fillRect(0, 0, 4, 4);
  const tex = new THREE.CanvasTexture(flat);
  const key = `ground-${N}`;
  const use = (c: HTMLCanvasElement): void => {
    // the GPU storage of the 4 px placeholder is immutable: free it so the full image is allocated anew
    tex.dispose();
    tex.image = c;
    tex.needsUpdate = true;
  };
  void loadStrip(key, GROUND_VER)
    .then(async (hit) => {
      if (groundImg?.n === N) return use(groundImg.canvas);
      // S3: the build ships the painted ground (tools/bakeSprites.mjs); copy it into IndexedDB like the sprite strips
      const shipped = hit ? null : await staticStrip(key, GROUND_ART_VER);
      if (shipped) void saveStrip(key, GROUND_VER, shipped.blob, 0);
      const stored = hit ?? shipped;
      if (groundImg?.n === N) return use(groundImg.canvas);
      if (stored) {
        const t0 = performance.now();
        const bmp = await createImageBitmap(stored.blob);
        const c = document.createElement('canvas');
        c.width = c.height = N;
        c.getContext('2d')!.drawImage(bmp, 0, 0);
        bmp.close();
        groundImg = { n: N, canvas: c };
        console.info(`terrain: ground loaded in ${Math.round(performance.now() - t0)} ms`);
        return use(c);
      }
      const c = paint();
      use(c);
      c.toBlob((blob) => blob && void saveStrip(key, GROUND_VER, blob, 0), 'image/png');
    })
    .catch(() => use(paint()));
  return tex;
}

/** The painted ground of a map at N² (build-time bake: src/render/bakeEntry.ts). */
export const paintGroundFor = (map: MapData, N: number): HTMLCanvasElement => paintGround(context(map), N);

/** Painted ground (sim map -> canvas y-down via simToCanvas). */
function paintGround(cx: Ctx, N: number): HTMLCanvasElement {
  const { map } = cx;
  const k = N / S;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d')!;
  const rnd = mulberry(42);
  const P = (x: number, y: number): [number, number] => simToCanvas(x, y, N);
  const pick = <T,>(a: readonly T[]): T => a[(rnd() * a.length) | 0]!;
  const dab = (x: number, y: number, len: number, w: number, ang: number, col: string, alpha: number): void => {
    const [px, py] = P(x, y);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.ellipse(px, py, Math.max(0.8, len * k), Math.max(0.6, w * k), ang, 0, Math.PI * 2);
    ctx.fill();
  };
  const path = (pts: Pt[], close: boolean): void => {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(...P(p.x, p.y)) : ctx.moveTo(...P(p.x, p.y))));
    if (close) ctx.closePath();
  };
  const scale = N / 4096;
  const nStrokes = Math.round(110000 * scale * scale + 30000);

  // 1. moss base + large tonal patches
  ctx.fillStyle = C.moss[0]!;
  ctx.fillRect(0, 0, N, N);
  for (let i = 0; i < 900; i++) {
    dab(rnd() * S, rnd() * S, 250 + rnd() * 700, 150 + rnd() * 450, rnd() * 3, rnd() < 0.55 ? C.moss[3]! : rnd() < 0.5 ? C.moss[2]! : C.mossWarm, 0.22 + rnd() * 0.18);
  }
  // darker forest floor around the cliffs
  ctx.globalAlpha = 1;
  ctx.lineJoin = 'round';
  for (const o of cx.outlines) {
    path(o, true);
    ctx.strokeStyle = 'rgba(46,52,36,0.55)';
    ctx.lineWidth = 520 * k;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(58,52,40,0.7)';
    ctx.lineWidth = 230 * k;
    ctx.stroke();
    ctx.fillStyle = C.floor;
    ctx.fill();
  }

  // 2. bases: team plazas with flagstones and inlays
  for (const team of [0, 1] as const) {
    const s = map.sides[team];
    const L = BASE_LOOK[team];
    const [x, y] = P(s.nexus.x, s.nexus.y);
    const g = ctx.createRadialGradient(x, y, 0, x, y, 4500 * k);
    g.addColorStop(0, L.stone);
    g.addColorStop(0.72, L.stone);
    g.addColorStop(0.86, L.stoneDark);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 4500 * k, 0, Math.PI * 2);
    ctx.fill();
    // flagstone rings + radial joints
    ctx.strokeStyle = 'rgba(30,24,20,0.28)';
    ctx.lineWidth = 2.2 * scale;
    for (let r = 300; r < 3700; r += 230) {
      ctx.beginPath();
      ctx.arc(x, y, r * k, 0, Math.PI * 2);
      ctx.stroke();
      const n = Math.round(r / 110);
      for (let i = 0; i < n; i++) {
        const a = ((i + (r / 230) * 0.5) / n) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * r * k, y + Math.sin(a) * r * k);
        ctx.lineTo(x + Math.cos(a) * (r + 230) * k, y + Math.sin(a) * (r + 230) * k);
        ctx.stroke();
      }
    }
    // worn stones (tone variation)
    for (let i = 0; i < 1400; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * 3700;
      dab(s.nexus.x + Math.cos(a) * r, s.nexus.y + Math.sin(a) * r, 40 + rnd() * 70, 30 + rnd() * 50, a, rnd() < 0.5 ? L.stoneDark : '#c8b898', 0.12 + rnd() * 0.12);
    }
    // team inlay rings
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = L.metal;
    ctx.lineWidth = 24 * k;
    for (const r of [900, 1500]) {
      ctx.beginPath();
      ctx.arc(x, y, r * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = L.cloth;
    ctx.lineWidth = 44 * k;
    ctx.beginPath();
    ctx.arc(x, y, 1200 * k, 0, Math.PI * 2);
    ctx.stroke();
    // fountain plaza
    const [fx, fy] = P(s.fountain.x, s.fountain.y);
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = L.stoneDark;
    ctx.beginPath();
    ctx.arc(fx, fy, (s.fountain.r + 260) * k, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. lanes: worn dirt with ragged edges, ruts, cobbles, cracks, puddles
  const laneLines = Object.values(map.sides[0].lanes);
  ctx.lineCap = 'round';
  const strokeLanes = (width: number, color: string, alpha: number, jitter = 0): void => {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    for (const lane of laneLines) {
      for (let i = 1; i < lane.length; i++) {
        const a = lane[i - 1]!;
        const b = lane[i]!;
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 300));
        for (let j = 0; j < n; j++) {
          const t0 = j / n;
          const t1 = (j + 1) / n;
          ctx.lineWidth = (width + (rnd() - 0.5) * jitter) * k;
          ctx.beginPath();
          ctx.moveTo(...P(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0));
          ctx.lineTo(...P(a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1));
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  };
  strokeLanes(1080, '#3e4430', 0.22, 160);
  strokeLanes(900, C.rut, 0.75, 140);
  strokeLanes(780, C.dirt[0]!, 1, 120);
  strokeLanes(520, C.dirt[2]!, 0.35, 160);
  // inside the bases the lanes become paved team roads (flagstones with joints)
  for (const team of [0, 1] as const) {
    const L = BASE_LOOK[team];
    const nx = map.sides[team].nexus;
    const [bx, by] = P(nx.x, nx.y);
    ctx.save();
    ctx.beginPath();
    ctx.arc(bx, by, 3900 * k, 0, Math.PI * 2);
    ctx.clip();
    strokeLanes(820, L.stoneDark, 1, 0);
    strokeLanes(700, L.stone, 1, 0);
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#2a221c';
    ctx.lineWidth = 2.2 * scale;
    for (const lane of laneLines) {
      for (let i = 1; i < lane.length; i++) {
        const a = lane[i - 1]!;
        const b = lane[i]!;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const ux = (b.x - a.x) / len;
        const uy = (b.y - a.y) / len;
        for (let d = 0; d < len; d += 110) {
          const x = a.x + ux * d;
          const y = a.y + uy * d;
          for (const o of [-1, 0, 1]) {
            const ox = x - uy * o * 115 + ux * ((Math.abs(o) * 55) % 110);
            const oy = y + ux * o * 115 + uy * ((Math.abs(o) * 55) % 110);
            ctx.beginPath();
            ctx.moveTo(...P(ox - uy * 58, oy + ux * 58));
            ctx.lineTo(...P(ox + uy * 58, oy - ux * 58));
            ctx.stroke();
          }
        }
        for (const o of [-172, -57, 57, 172]) {
          ctx.beginPath();
          ctx.moveTo(...P(a.x - uy * o, a.y + ux * o));
          ctx.lineTo(...P(b.x - uy * o, b.y + ux * o));
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = L.metal;
    ctx.lineWidth = 16 * k;
    for (const o of [-330, 330]) {
      for (const lane of laneLines) {
        for (let i = 1; i < lane.length; i++) {
          const a = lane[i - 1]!;
          const b = lane[i]!;
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          const ux = (b.x - a.x) / len;
          const uy = (b.y - a.y) / len;
          ctx.beginPath();
          ctx.moveTo(...P(a.x - uy * o, a.y + ux * o));
          ctx.lineTo(...P(b.x - uy * o, b.y + ux * o));
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // 4. river: blue-grey water, darker banks, warm sky streak
  const riverPts: Pt[] = [];
  for (let i = 0; i <= 96; i++) {
    const t = i / 96;
    const x0 = t * S;
    const y0 = S - t * S;
    const off = riverOffset(x0, y0) / Math.SQRT2;
    riverPts.push({ x: x0 + off, y: y0 + off });
  }
  const strokeRiver = (width: number, color: string, alpha: number): void => {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width * k;
    path(riverPts, false);
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  strokeRiver(1500, '#3d4636', 0.6);
  strokeRiver(1250, C.riverBank, 0.9);
  strokeRiver(1060, C.river[0]!, 1);
  strokeRiver(640, C.riverDeep, 0.35);

  // 5. brush strokes everywhere (region-aware colours and directions)
  for (let i = 0; i < nStrokes; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const dr = riverDist(x, y);
    const dl = cx.laneDist(x, y);
    const [db] = cx.baseDist(x, y);
    let col: string;
    let ang: number;
    let len = 60 + rnd() * 110;
    let w = 9 + rnd() * 9;
    let alpha = 0.22 + rnd() * 0.25;
    if (dr < 520) {
      const nearC = dr < 160 && rnd() < 0.3;
      col = nearC ? C.sky : rnd() < 0.2 ? '#8d9cb4' : pick(C.river);
      ang = Math.PI / 4;
      len *= 1.5;
      if (nearC) alpha *= 0.8;
    } else if (dl < laneHalf + 20 && db > 3900) {
      col = rnd() < 0.15 ? C.rut : rnd() < 0.2 ? C.dirtLight : pick(C.dirt);
      ang = laneAngle(cx, x, y);
      w *= 1.2;
    } else if (db < 3900) {
      continue;
    } else {
      if (!walkable(map.nav, x, y) && rnd() < 0.6) continue;
      col = rnd() < 0.04 ? C.mossWarm : pick(C.moss);
      ang = 0.35 + (rnd() - 0.5) * 0.6;
    }
    dab(x, y, len, w, ang, col, alpha);
  }

  // 6. lane details: ragged grass edges, cobbles, cracks, puddles, pebbles
  for (let i = 0; i < 26000 * scale; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const dl = cx.laneDist(x, y);
    if (dl < laneHalf - 40 || dl > laneHalf + 110 || riverDist(x, y) < 560 || cx.baseDist(x, y)[0] < 3700) continue;
    dab(x, y, 30 + rnd() * 60, 8 + rnd() * 8, rnd() * 3, rnd() < 0.6 ? pick(C.moss) : '#6a7046', 0.5 + rnd() * 0.3);
  }
  for (let i = 0; i < 800; i++) {
    // cobble clusters along the lanes (the plazas have flagstones)
    const lane = pick(laneLines);
    const si = 1 + ((rnd() * (lane.length - 1)) | 0);
    const a = lane[si - 1]!;
    const b = lane[si]!;
    const t = rnd();
    const px = a.x + (b.x - a.x) * t + (rnd() - 0.5) * 500;
    const py = a.y + (b.y - a.y) * t + (rnd() - 0.5) * 500;
    if (cx.laneDist(px, py) > laneHalf - 30 || riverDist(px, py) < 520) continue;
    if (cx.baseDist(px, py)[0] < 3800) continue;
    const n = 5 + ((rnd() * 12) | 0);
    for (let j = 0; j < n; j++) {
      const qx = px + (rnd() - 0.5) * 220;
      const qy = py + (rnd() - 0.5) * 220;
      const [sx, sy] = P(qx, qy);
      const r = (11 + rnd() * 9) * k;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = pick(C.cobble);
      ctx.strokeStyle = C.joint;
      ctx.lineWidth = 1.2 * scale;
      ctx.beginPath();
      ctx.ellipse(sx, sy, r, r * (0.7 + rnd() * 0.3), rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.45;
      ctx.stroke();
    }
  }
  ctx.lineCap = 'round';
  for (let i = 0; i < 700; i++) {
    // cracks
    let x = rnd() * S;
    let y = rnd() * S;
    if (cx.laneDist(x, y) > laneHalf - 60 || riverDist(x, y) < 560) continue;
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = '#4e4030';
    ctx.lineWidth = 1.4 * scale;
    ctx.beginPath();
    ctx.moveTo(...P(x, y));
    let a = rnd() * 6;
    for (let j = 0; j < 5; j++) {
      a += (rnd() - 0.5) * 1.2;
      x += Math.cos(a) * 40;
      y += Math.sin(a) * 40;
      ctx.lineTo(...P(x, y));
    }
    ctx.stroke();
  }
  for (let i = 0; i < 240; i++) {
    // puddles reflecting the evening sky
    const x = rnd() * S;
    const y = rnd() * S;
    if (cx.laneDist(x, y) > laneHalf - 90 || riverDist(x, y) < 600 || cx.baseDist(x, y)[0] < 3800) continue;
    const r = 40 + rnd() * 60;
    dab(x, y, r * 1.6, r, rnd() * 3, '#5c6a7c', 0.75);
    dab(x + r * 0.2, y + r * 0.1, r * 1.1, r * 0.4, 0.5, C.sky, 0.35);
    dab(x, y, r * 1.6, r, rnd() * 3, '#3e3a30', 0.15);
  }
  for (let i = 0; i < 9000 * scale; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    if (cx.laneDist(x, y) > laneHalf + 60) continue;
    dab(x, y, 6 + rnd() * 8, 5 + rnd() * 5, 0, rnd() < 0.5 ? '#6e6250' : '#b8a888', 0.6);
  }
  // ford stones where lanes cross the river
  for (let i = 0; i < 1600; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    if (cx.laneDist(x, y) > laneHalf - 50 || riverDist(x, y) > 560) continue;
    dab(x, y, 28 + rnd() * 20, 20 + rnd() * 14, rnd() * 3, pick(C.cobble), 0.55);
  }

  // 7. camp clearings + epic pits: worn soil disc (ragged trampled edge), lighter packed centre, a rune circle
  //    (buffs: glowing glyph ring in the buff colour; small camps: inlaid flagstones) and camp-specific marks
  for (const cp of cx.camps) {
    const epic = cp.epic;
    if (cp.id === 'nebelschleicher') {
      dab(cp.x, cp.y, 420, 300, 0.78, '#8a98ae', 0.35);
      continue;
    }
    const r = cp.r;
    const [x, y] = P(cp.x, cp.y);
    const floor = epic ? (cp.id === 'leviathan' ? '#3c5c66' : '#3a2f48') : cp.id === 'sumpfunke' ? '#5a5a3a' : cp.id === 'schattenkrabbe' ? '#5e5648' : '#6a5a42';
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.08 * k);
    g.addColorStop(0, floor);
    g.addColorStop(0.8, floor);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = epic ? 0.85 : 0.8;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.08 * k, 0, Math.PI * 2);
    ctx.fill();
    // ragged trampled edge: soil tongues into the moss, moss tufts into the soil
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2;
      const d = r * (0.88 + rnd() * 0.24);
      dab(cp.x + Math.cos(a) * d, cp.y + Math.sin(a) * d, 40 + rnd() * 70, 14 + rnd() * 16, a + Math.PI / 2 + (rnd() - 0.5), rnd() < 0.5 ? floor : pick(C.moss), 0.5);
    }
    // packed, lighter centre where the monsters stand
    if (!epic) {
      const c2 = ctx.createRadialGradient(x, y, 0, x, y, r * 0.62 * k);
      c2.addColorStop(0, cp.buff ? '#8a7656' : '#86704e');
      c2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = c2;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.62 * k, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 300; i++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * r * 0.9;
      dab(cp.x + Math.cos(a) * d, cp.y + Math.sin(a) * d, 30 + rnd() * 50, 8 + rnd() * 8, rnd() * 3, epic ? (rnd() < 0.5 ? '#2a2236' : '#4a3e5e') : rnd() < 0.5 ? '#5a4c38' : '#7a6a4e', 0.35);
    }
    const rc = cp.buff || epic ? (cp.id === 'dornenbock' ? '#6fc4f0' : cp.id === 'glutwaechter' ? '#ff8a3a' : cp.id === 'leviathan' ? '#6fd6c8' : '#b993ff') : '#3e3428';
    const rr = (epic ? 620 : r * 0.7) * k;
    if (cp.buff || epic) {
      // glowing rune circle: double ring, glyph ticks between the rings, spokes outward
      ctx.strokeStyle = rc;
      for (const [rad, lw, al] of [
        [rr, 14, 0.5],
        [rr * 0.84, 6, 0.4],
      ] as const) {
        ctx.globalAlpha = al;
        ctx.lineWidth = lw * k;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 7 * k;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const m = rr * 0.92;
        const t = 0.07;
        ctx.beginPath();
        if (i % 2) {
          ctx.moveTo(x + Math.cos(a - t) * m, y + Math.sin(a - t) * m);
          ctx.lineTo(x + Math.cos(a) * rr * 0.86, y + Math.sin(a) * rr * 0.86);
          ctx.lineTo(x + Math.cos(a + t) * m, y + Math.sin(a + t) * m);
        } else {
          ctx.moveTo(x + Math.cos(a) * rr * 0.86, y + Math.sin(a) * rr * 0.86);
          ctx.lineTo(x + Math.cos(a) * rr * 0.98, y + Math.sin(a) * rr * 0.98);
        }
        ctx.stroke();
      }
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * rr * 1.04, y + Math.sin(a) * rr * 1.04);
        ctx.lineTo(x + Math.cos(a + 0.1) * rr * 1.26, y + Math.sin(a + 0.1) * rr * 1.26);
        ctx.stroke();
      }
      // soft inner glow wash
      const gw = ctx.createRadialGradient(x, y, rr * 0.2, x, y, rr);
      gw.addColorStop(0, 'rgba(0,0,0,0)');
      gw.addColorStop(1, rc);
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = gw;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // inlaid flagstone ring (worn, some missing)
      for (let i = 0; i < 22; i++) {
        if (rnd() < 0.18) continue;
        const a = (i / 22) * Math.PI * 2 + rnd() * 0.06;
        const sx = cp.x + Math.cos(a) * r * 0.7;
        const sy = cp.y + Math.sin(a) * r * 0.7;
        dab(sx, sy, 46 + rnd() * 14, 26 + rnd() * 8, -a + Math.PI / 2, '#3a3024', 0.55);
        dab(sx, sy, 38 + rnd() * 12, 20 + rnd() * 6, -a + Math.PI / 2, pick(C.cobble), 0.6);
      }
      // camp marks: claw scratches (wolves, beetles), puddle (gromp), cracks (krugs)
      ctx.lineCap = 'round';
      if (cp.id === 'mooswolf' || cp.id === 'hohlkaefer') {
        for (let i = 0; i < 9; i++) {
          const a = rnd() * Math.PI * 2;
          const d = r * (0.2 + rnd() * 0.45);
          const [mx, my] = P(cp.x + Math.cos(a) * d, cp.y + Math.sin(a) * d);
          const o = rnd() * Math.PI;
          ctx.globalAlpha = 0.45;
          ctx.strokeStyle = '#3a2e22';
          ctx.lineWidth = 6 * k;
          for (let j = -1; j <= 1; j++) {
            ctx.beginPath();
            ctx.moveTo(mx + Math.cos(o + Math.PI / 2) * j * 14 * k, my + Math.sin(o + Math.PI / 2) * j * 14 * k);
            ctx.lineTo(mx + Math.cos(o) * 80 * k + Math.cos(o + Math.PI / 2) * j * 20 * k, my + Math.sin(o) * 80 * k + Math.sin(o + Math.PI / 2) * j * 20 * k);
            ctx.stroke();
          }
        }
      } else if (cp.id === 'sumpfunke') {
        const a = cp.back + 0.6;
        const px = cp.x + Math.cos(a) * r * 0.5;
        const py = cp.y + Math.sin(a) * r * 0.5;
        dab(px, py, 230, 150, a, '#3e5a52', 0.7);
        dab(px, py, 190, 115, a, '#5f8a82', 0.6);
        dab(px + 40, py + 20, 80, 30, a, '#a8c8b8', 0.35);
        for (let i = 0; i < 6; i++) dab(px + (rnd() - 0.5) * 300, py + (rnd() - 0.5) * 200, 26, 20, rnd() * 3, '#5d7a3a', 0.8);
      } else if (cp.id === 'schattenkrabbe') {
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#2e2a26';
        ctx.lineWidth = 5 * k;
        for (let i = 0; i < 7; i++) {
          let a = rnd() * Math.PI * 2;
          let [px, py] = P(cp.x + Math.cos(a) * r * 0.15, cp.y + Math.sin(a) * r * 0.15);
          ctx.beginPath();
          ctx.moveTo(px, py);
          for (let j = 0; j < 4; j++) {
            a += (rnd() - 0.5) * 0.9;
            px += Math.cos(a) * 70 * k;
            py += Math.sin(a) * 70 * k;
            ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
      }
    }
  }

  // 8. roots and moss creeping out from the cliff feet
  ctx.lineCap = 'round';
  for (const o of cx.outlines) {
    for (let i = 0; i < o.length; i += 2) {
      if (rnd() < 0.55) continue;
      const p = o[i]!;
      const q = o[(i + 1) % o.length]!;
      const nx = q.y - p.y;
      const ny = -(q.x - p.x);
      const l = Math.hypot(nx, ny) || 1;
      let x = p.x;
      let y = p.y;
      const sgn = pointInPoly(p.x + (nx / l) * 60, p.y + (ny / l) * 60, o) ? -1 : 1;
      let a = Math.atan2((ny / l) * sgn, (nx / l) * sgn);
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = rnd() < 0.5 ? '#3a2e22' : '#4a5a34';
      ctx.lineWidth = (5 + rnd() * 5) * k;
      ctx.beginPath();
      ctx.moveTo(...P(x, y));
      for (let j = 0; j < 4; j++) {
        a += (rnd() - 0.5) * 0.8;
        x += Math.cos(a) * (30 + rnd() * 30);
        y += Math.sin(a) * (30 + rnd() * 30);
        ctx.lineTo(...P(x, y));
      }
      ctx.stroke();
    }
  }

  // 9. bush ground shadows, flowers, grass ticks
  for (const b of map.bushes) {
    const [x, y] = P(b.x, b.y);
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#1c2a20';
    ctx.beginPath();
    ctx.ellipse(x, y, b.r * k * 1.15, b.r * k * 1.0, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 16000 * scale; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    if (cx.laneDist(x, y) < laneHalf + 80 || riverDist(x, y) < 600 || cx.baseDist(x, y)[0] < 3900 || !walkable(map.nav, x, y)) continue;
    const r = rnd();
    if (r < 0.12) dab(x, y, 7, 7, 0, rnd() < 0.4 ? '#d9c25a' : rnd() < 0.5 ? '#e8e2d0' : '#a08ad0', 0.75);
    else {
      const [px, py] = P(x, y);
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = rnd() < 0.5 ? '#7a8a50' : '#2e3824';
      ctx.lineWidth = 1.2 * scale;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - 2 * scale, py - 6 * scale);
      ctx.moveTo(px, py);
      ctx.lineTo(px + 3 * scale, py - 5 * scale);
      ctx.stroke();
    }
  }
  // 10. map edge: the ground fades into the dark forest floor of the skirt (no hard cut where the base plazas meet
  // the edge), with ragged moss/earth dabs so the transition is not a clean ruler line
  ctx.globalAlpha = 1;
  const EDGE = 520;
  const fade = (x0: number, y0: number, x1: number, y1: number): CanvasGradient => {
    const g = ctx.createLinearGradient(...P(x0, y0), ...P(x1, y1));
    g.addColorStop(0, 'rgba(43,48,34,1)');
    g.addColorStop(0.35, 'rgba(43,48,34,0.75)');
    g.addColorStop(1, 'rgba(43,48,34,0)');
    return g;
  };
  for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [
    [0, 0, EDGE, 0, 0, 0, EDGE, S],
    [S, 0, S - EDGE, 0, S - EDGE, 0, EDGE, S],
    [0, 0, 0, EDGE, 0, 0, S, EDGE],
    [0, S, 0, S - EDGE, 0, S - EDGE, S, EDGE],
  ] as const) {
    ctx.fillStyle = fade(x0, y0, x1, y1);
    const [ax, ay] = P(rx, ry);
    const [bx, by] = P(rx + rw, ry + rh);
    ctx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
  }
  for (let i = 0; i < 900 * scale; i++) {
    const side = i % 4;
    const along = rnd() * S;
    const inset = rnd() * rnd() * EDGE * 1.1;
    const [x, y] = side === 0 ? [inset, along] : side === 1 ? [S - inset, along] : side === 2 ? [along, inset] : [along, S - inset];
    dab(x, y, 50 + rnd() * 110, 30 + rnd() * 70, rnd() * Math.PI, rnd() < 0.55 ? '#2b3022' : rnd() < 0.5 ? '#3a4a2a' : '#4a3f2e', 0.35 + rnd() * 0.35);
  }
  ctx.globalAlpha = 1;
  return c;
}

/** Brush direction along the nearest lane segment (canvas angle). */
function laneAngle(cx: Ctx, x: number, y: number): number {
  let best = Infinity;
  let ang = 0;
  for (const s of cx.lanes) {
    const d = segDist(x, y, s);
    if (d < best) {
      best = d;
      ang = Math.atan2(-(s[3] - s[1]), s[2] - s[0]);
    }
  }
  return ang;
}
