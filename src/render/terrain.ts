// placeholder art: static terrain. Painted ground texture (lanes, river, jungle, bases), extruded low-poly
// walls, bush clusters, fountain platforms and the violet mist at the central rift.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapData, Pt } from '../sim/map';
import { MAP_SIZE, mulberry, simToCanvas } from './coords';
import { outlineMesh, paint, toon, withFog } from './materials';
import { TEAM } from './palette';

const GROUND_PX = 4096;
const WALL_H = 170;

export interface Terrain {
  group: THREE.Group;
  update(timeSec: number): void;
}

export function buildTerrain(map: MapData, anisotropy: number): Terrain {
  const group = new THREE.Group();

  // ---------------------------------------------------------------- ground
  const tex = new THREE.CanvasTexture(paintGround(map));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  const groundGeo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE);
  groundGeo.rotateX(-Math.PI / 2);
  groundGeo.translate(MAP_SIZE / 2, 0, -MAP_SIZE / 2);
  // ponytail: one 4096^2 texture for the whole map (~4 units/px). Upgrade: tiled detail texture blended in shader.
  const ground = new THREE.Mesh(groundGeo, toon({ map: tex }));
  ground.receiveShadow = true;
  group.add(ground);
  // dark skirt beyond the map edge so clamped camera views never show the void
  const skirtGeo = new THREE.PlaneGeometry(MAP_SIZE * 3, MAP_SIZE * 3);
  skirtGeo.rotateX(-Math.PI / 2);
  skirtGeo.translate(MAP_SIZE / 2, -4, -MAP_SIZE / 2);
  const skirt = new THREE.Mesh(skirtGeo, new THREE.MeshBasicMaterial({ color: '#2b3324' }));
  skirt.renderOrder = 1; // after the ground: the depth test rejects the hidden part (was ~1 ms of overdraw at 1080p)
  group.add(skirt);

  // ---------------------------------------------------------------- walls (one merged mesh + outline)
  const rnd = mulberry(7);
  const wallParts: THREE.BufferGeometry[] = [];
  for (const poly of map.walls) {
    const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, p.y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: WALL_H, bevelEnabled: true, bevelSize: 40, bevelThickness: 40, bevelSegments: 1, steps: 1 });
    g.rotateX(-Math.PI / 2);
    wallParts.push(paint(g, '#6d6a5c'));
    // low-poly boulders along the rim break up the boxy silhouette
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(1, Math.floor(len / 260));
      for (let k = 0; k < n; k++) {
        const t = (k + rnd()) / n;
        const r = 70 + rnd() * 80;
        const rock = new THREE.IcosahedronGeometry(r, 0);
        rock.scale(1, 0.7 + rnd() * 0.8, 1);
        rock.rotateY(rnd() * 6);
        rock.translate(a.x + (b.x - a.x) * t, WALL_H * (0.4 + rnd() * 0.7), -(a.y + (b.y - a.y) * t));
        wallParts.push(paint(rock, rnd() < 0.5 ? '#7c7867' : '#5f5c50'));
      }
    }
  }
  const wallGeo = mergeGeometries(wallParts)!;
  const walls = new THREE.Mesh(wallGeo, toon({ vertexColors: true }));
  walls.castShadow = true;
  walls.receiveShadow = true;
  group.add(walls, outlineMesh(wallGeo, 7));

  // ---------------------------------------------------------------- bushes
  const bushParts: THREE.BufferGeometry[] = [];
  for (const b of map.bushes) {
    const n = Math.round(b.r / 35);
    for (let i = 0; i < n; i++) {
      const ang = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * b.r * 0.85;
      const r = 55 + rnd() * 45;
      const leaf = new THREE.IcosahedronGeometry(r, 0);
      leaf.scale(1, 0.8 + rnd() * 0.5, 1);
      leaf.translate(b.x + Math.cos(ang) * d, r * 0.6, -(b.y + Math.sin(ang) * d));
      bushParts.push(paint(leaf, rnd() < 0.5 ? '#2f5a46' : '#3d6a4c'));
    }
  }
  if (bushParts.length) {
    const bushGeo = mergeGeometries(bushParts)!;
    const bushes = new THREE.Mesh(bushGeo, toon({ vertexColors: true }));
    bushes.castShadow = true;
    bushes.receiveShadow = true;
    group.add(bushes, outlineMesh(bushGeo, 5));
  }

  // ---------------------------------------------------------------- fountain platforms
  for (const team of [0, 1] as const) {
    const f = map.sides[team].fountain;
    const pal = TEAM[team];
    const parts: THREE.BufferGeometry[] = [];
    const base = new THREE.CylinderGeometry(f.r, f.r + 60, 40, 10); // nearly flush: units stand on it at Y=0
    base.translate(0, -17, 0);
    parts.push(paint(base, pal.stone));
    const top = new THREE.CylinderGeometry(f.r * 0.55, f.r * 0.6, 10, 10);
    top.translate(0, 1, 0);
    parts.push(paint(top, pal.secondary));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const pillar = new THREE.CylinderGeometry(35, 45, 260, 6);
      pillar.translate(Math.cos(a) * f.r * 0.85, 130, Math.sin(a) * f.r * 0.85);
      parts.push(paint(pillar, pal.primary));
      const cap = new THREE.OctahedronGeometry(40);
      cap.translate(Math.cos(a) * f.r * 0.85, 290, Math.sin(a) * f.r * 0.85);
      parts.push(paint(cap, pal.accent));
    }
    const geo = mergeGeometries(parts)!;
    const m = new THREE.Mesh(geo, toon({ vertexColors: true }));
    m.position.set(f.x, 0, -f.y);
    m.castShadow = m.receiveShadow = true;
    const o = outlineMesh(geo, 6);
    o.position.copy(m.position);
    group.add(m, o);
  }

  // ---------------------------------------------------------------- rift mist (violet-grey glow at the centre)
  const mistTex = new THREE.CanvasTexture(radialCanvas('rgba(190,170,230,0.9)', 'rgba(120,110,150,0)'));
  mistTex.colorSpace = THREE.SRGBColorSpace;
  const mists: THREE.Mesh[] = [];
  const cx = MAP_SIZE / 2;
  for (let i = 0; i < 4; i++) {
    const mat = withFog(new THREE.MeshBasicMaterial({ map: mistTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.35 }));
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    const s = 1400 + i * 500;
    m.scale.set(s, 1, s * 0.8);
    m.position.set(cx + (i - 1.5) * 260, 8 + i * 6, -cx + (i % 2 ? 200 : -200));
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
        (m.material as THREE.MeshBasicMaterial).opacity = 0.22 + 0.12 * Math.sin(t * 0.6 + i * 1.7);
      }
    },
  };
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

/** placeholder art: hand-painted-ish ground. Muted moss jungle, worn lanes, silvery river, team bases. */
function paintGround(map: MapData): HTMLCanvasElement {
  const N = GROUND_PX;
  const k = N / MAP_SIZE;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d')!;
  const rnd = mulberry(42);
  const P = (p: Pt): [number, number] => simToCanvas(p.x, p.y, N);

  ctx.fillStyle = '#56653f';
  ctx.fillRect(0, 0, N, N);
  // mottled moss
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = ['#4d5c39', '#5f6e45', '#526140', '#65704a', '#475634'][(rnd() * 5) | 0]!;
    ctx.globalAlpha = 0.25 + rnd() * 0.3;
    ctx.beginPath();
    ctx.arc(rnd() * N, rnd() * N, 15 + rnd() * 90, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // bases: stone plazas in the two corners
  for (const team of [0, 1] as const) {
    const s = map.sides[team];
    const [x, y] = P(s.nexus);
    const pal = TEAM[team];
    const g = ctx.createRadialGradient(x, y, 0, x, y, 4600 * k);
    g.addColorStop(0, pal.stone);
    g.addColorStop(0.75, pal.stone);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 4600 * k, 0, Math.PI * 2);
    ctx.fill();
    // flagstone lines
    ctx.strokeStyle = 'rgba(30,25,20,0.18)';
    ctx.lineWidth = 2;
    for (let r = 400; r < 3600; r += 380) {
      ctx.beginPath();
      ctx.arc(x, y, r * k, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // soil under walls
  ctx.lineJoin = 'round';
  for (const poly of map.walls) {
    ctx.beginPath();
    poly.forEach((p, i) => (i ? ctx.lineTo(...P(p)) : ctx.moveTo(...P(p))));
    ctx.closePath();
    ctx.fillStyle = '#3e3a2e';
    ctx.strokeStyle = 'rgba(52,46,34,0.7)';
    ctx.lineWidth = 140 * k;
    ctx.stroke();
    ctx.fill();
  }

  // lanes (sides[0].lanes already run nexus -> nexus)
  const lanes = Object.values(map.sides[0].lanes);
  const strokeLanes = (width: number, color: string, alpha: number): void => {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width * k;
    ctx.lineCap = 'round';
    for (const lane of lanes) {
      ctx.beginPath();
      lane.forEach((p, i) => (i ? ctx.lineTo(...P(p)) : ctx.moveTo(...P(p))));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };
  strokeLanes(1050, '#4a4a32', 0.55);
  strokeLanes(900, '#7d6a4a', 1);
  strokeLanes(700, '#9c8862', 1);
  strokeLanes(420, '#ab9871', 0.6);

  // river along the anti-diagonal, gentle wobble
  const river: [number, number][] = [];
  for (let i = 0; i <= 64; i++) {
    const t = i / 64;
    const w = Math.sin(t * Math.PI * 5) * 260;
    river.push(P({ x: t * MAP_SIZE + w * 0.7, y: MAP_SIZE - t * MAP_SIZE + w * 0.7 }));
  }
  const strokeRiver = (width: number, color: string, alpha: number): void => {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width * k;
    ctx.beginPath();
    river.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  strokeRiver(1500, '#4b5a52', 0.7);
  strokeRiver(1250, '#6f838c', 0.95);
  strokeRiver(1000, '#94a8b3', 0.9);
  strokeRiver(500, '#b9c8d0', 0.45);
  // silver glints
  ctx.strokeStyle = 'rgba(230,238,244,0.55)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 260; i++) {
    const t = rnd();
    const [x, y] = P({ x: t * MAP_SIZE + (rnd() - 0.5) * 900, y: MAP_SIZE - t * MAP_SIZE + (rnd() - 0.5) * 900 });
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 10 + rnd() * 25, y - 4 - rnd() * 6);
    ctx.stroke();
  }
  // lane crossing stays readable through the water
  strokeLanes(700, '#9c8862', 0.25);

  // dark ground under bushes
  for (const b of map.bushes) {
    const [x, y] = P(b);
    ctx.fillStyle = 'rgba(25,40,28,0.55)';
    ctx.beginPath();
    ctx.arc(x, y, b.r * k * 1.1, 0, Math.PI * 2);
    ctx.fill();
  }

  // grass tufts and pebbles
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * N;
    const y = rnd() * N;
    if (rnd() < 0.7) {
      ctx.strokeStyle = rnd() < 0.5 ? 'rgba(120,140,80,0.5)' : 'rgba(40,55,30,0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 2, y - 6);
      ctx.moveTo(x, y);
      ctx.lineTo(x + 3, y - 5);
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(70,62,50,0.35)';
      ctx.fillRect(x, y, 3, 2);
    }
  }
  return c;
}
