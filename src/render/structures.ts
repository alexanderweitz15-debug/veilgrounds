// Towers, inhibitors and nexus in style C, team-themed like the minions (palette.ts BASE_LOOK):
//   Lichtwerk (blue): ivory sandstone, brass bands and railings, blue banners, a lantern cage with a cold light
//                     crystal under a blue-slate dome; inhibitor = brass ring arch around a light crystal; nexus =
//                     stepped sandstone ziggurat with four brass arches holding a great light crystal.
//   Aschehalle (red): basalt and riveted iron, red banners, a furnace chamber with a glowing grate and chimney
//                     horns; inhibitor = iron brazier cage with an ember crystal; nexus = basalt forge with chimneys
//                     around a great ember core.
// Created from snapshot entities (keyed by serial). One merged body mesh (+ outline) and one glow mesh per
// structure (~11 per team).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SnapEntity } from '../sim/snapshot';
import { Kind } from '../sim/types';
import { gouache, outlineMesh, paint, withFog } from './materials';
import { BASE_LOOK } from './palette';

interface Template {
  body: THREE.BufferGeometry;
  outline: THREE.Mesh;
  glow: THREE.BufferGeometry;
  /** Height of the health bar anchor. */
  height: number;
}

/** Overall structure scale (towers ~2.5x champion height). */
const SCALE = 0.8;
const bodyMat = gouache({ vertexColors: true }, { rim: 0.5 });
const glowMats = [0, 1].map((t) => withFog(new THREE.MeshBasicMaterial({ color: BASE_LOOK[t]!.glow })));

function cyl(rt: number, rb: number, h: number, seg: number, y: number, color: string, x = 0, z = 0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  g.translate(x, y + h / 2, z);
  return paint(g, color);
}
function ring(r: number, tube: number, y: number, color: string, seg = 12): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(r, tube, 5, seg);
  g.rotateX(Math.PI / 2);
  g.translate(0, y, 0);
  return paint(g, color);
}
function cone(r: number, h: number, seg: number, y: number, color: string, x = 0, z = 0, tilt = 0, ry = 0): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, seg);
  g.translate(0, h / 2, 0);
  if (tilt) g.rotateZ(tilt);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return paint(g, color);
}
/**
 * Banner colours, brighter than the minions' BASE_LOOK cloth: the banners must read as the team colour at game
 * distance on both the ivory (blue) and the basalt (red) towers. Light trim + emblem for value contrast.
 */
const BANNER = [
  { cloth: '#3d7fe0', trim: '#f1e4c0', emblem: '#f3c95a' },
  { cloth: '#dc3b26', trim: '#ffcf7a', emblem: '#ffe1a0' },
] as const;

/**
 * Hanging banners (one-sided quads facing outward, with a swallow tail, team emblem and hem stripe), a pair at the
 * angles ry and PI - ry. Both are built by rotation: a mirrored copy would face inward (invisible cloth) or turn
 * inside out (the trim box under the back-face outline hull).
 */
function banner(w: number, h: number, y: number, r: number, ry: number, team: number): THREE.BufferGeometry[] {
  const { cloth, trim, emblem } = BANNER[Math.min(team, 1)]!;
  const out: THREE.BufferGeometry[] = [];
  for (const a of [ry, Math.PI - ry]) {
    const g = new THREE.PlaneGeometry(w, h, 1, 3);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const py = pos.getY(i);
      pos.setZ(i, Math.sin(py * 0.05) * 5);
      if (py < -h / 2 + 1 && Math.abs(pos.getX(i)) < 1) pos.setY(i, py + h * 0.18);
    }
    g.translate(0, y, r);
    const t = new THREE.BoxGeometry(w + 14, 12, 8);
    t.translate(0, y + h / 2, r);
    // emblem (diamond) + hem stripe a little in front of the cloth (it waves by up to 5 units)
    const e = new THREE.PlaneGeometry(w * 0.42, w * 0.42);
    e.rotateZ(Math.PI / 4);
    e.translate(0, y + h * 0.12, r + 7);
    const st = new THREE.PlaneGeometry(w * 0.86, h * 0.07);
    st.translate(0, y - h * 0.2, r + 7);
    for (const [geo, col] of [[g, cloth], [t, trim], [e, emblem], [st, trim]] as const) {
      geo.rotateY(a);
      out.push(paint(geo, col));
    }
  }
  return out;
}

function tower(team: number): Template {
  const L = BASE_LOOK[team]!;
  const parts: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  if (team === 0) {
    parts.push(cyl(170, 185, 34, 8, 0, L.stoneDark), cyl(145, 160, 30, 8, 34, L.stone));
    parts.push(cyl(78, 98, 300, 8, 64, L.stone));
    for (const y of [120, 230, 330]) parts.push(cyl(100 - (y - 64) * 0.06, 102 - (y - 64) * 0.06, 14, 8, y, L.metal));
    for (let i = 0; i < 2; i++) parts.push(...banner(96, 205, 245, 100, (i * Math.PI) + Math.PI / 4, 0));
    // gallery with railing posts
    parts.push(cyl(132, 92, 30, 8, 364, L.stoneDark), cyl(134, 134, 10, 12, 394, L.metal));
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      parts.push(cyl(6, 6, 36, 4, 404, L.metal2, Math.cos(a) * 124, Math.sin(a) * 124));
    }
    parts.push(ring(124, 5, 440, L.metal, 16));
    // lantern cage: brass pillars around the light crystal
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      parts.push(cyl(9, 11, 130, 5, 404, L.metal, Math.cos(a) * 66, Math.sin(a) * 66));
    }
    parts.push(cyl(84, 84, 16, 8, 534, L.metal));
    parts.push(cone(110, 150, 8, 550, L.roof));
    parts.push(cyl(6, 6, 70, 4, 690, L.metal), cone(16, 34, 6, 756, L.metal));
    const crystal = new THREE.OctahedronGeometry(46, 0);
    crystal.scale(1, 1.5, 1);
    crystal.translate(0, 470, 0);
    glow.push(crystal);
    return { body: mergeGeometries(parts)!, outline: outlineMesh(mergeGeometries(parts)!, 7), glow: mergeGeometries(glow.map((g) => paint(g, '#ffffff')))!, height: 790 };
  }
  parts.push(cyl(175, 190, 40, 6, 0, L.stoneDark), cyl(150, 165, 26, 6, 40, L.stone));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    parts.push(cone(16, 70, 4, 40, L.metal, Math.cos(a) * 160, Math.sin(a) * 160, (Math.cos(a) > 0 ? -1 : 1) * 0.5));
  }
  parts.push(cyl(84, 104, 290, 6, 66, L.metal2));
  for (const y of [110, 200, 290]) parts.push(cyl(108 - (y - 66) * 0.07, 110 - (y - 66) * 0.07, 16, 6, y, L.metal));
  for (let i = 0; i < 2; i++) parts.push(...banner(100, 210, 235, 112, (i * Math.PI) + Math.PI / 4, 1));
  // furnace chamber with chimney horns
  parts.push(cyl(130, 96, 40, 6, 356, L.stoneDark), cyl(122, 130, 110, 6, 396, L.metal2), cyl(140, 128, 20, 6, 506, L.metal));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * 92;
    const z = Math.sin(a) * 92;
    const c = new THREE.CylinderGeometry(20, 26, 170, 6);
    c.translate(0, 85, 0);
    c.rotateZ(-Math.cos(a) * 0.32);
    c.rotateX(Math.sin(a) * 0.32);
    c.translate(x, 520, z);
    parts.push(paint(c, L.metal2));
    const tip = new THREE.OctahedronGeometry(16, 0);
    tip.translate(x * 1.6, 690, z * 1.6);
    glow.push(tip);
  }
  parts.push(cone(70, 90, 6, 526, L.roof));
  // glowing grate band around the chamber
  const grate = new THREE.CylinderGeometry(124, 128, 46, 6, 1, true);
  grate.translate(0, 430, 0);
  glow.push(grate);
  return { body: mergeGeometries(parts)!, outline: outlineMesh(mergeGeometries(parts)!, 7), glow: mergeGeometries(glow.map((g) => paint(g, '#ffffff')))!, height: 760 };
}

function inhibitor(team: number): Template {
  const L = BASE_LOOK[team]!;
  const parts: THREE.BufferGeometry[] = [cyl(200, 220, 36, 10, 0, L.stoneDark), cyl(160, 180, 26, 10, 36, L.stone)];
  const glow: THREE.BufferGeometry[] = [];
  if (team === 0) {
    const arch = new THREE.TorusGeometry(130, 18, 6, 16, Math.PI);
    arch.translate(0, 60, 0);
    parts.push(paint(arch, L.metal));
    const arch2 = arch.clone();
    arch2.rotateY(Math.PI / 2);
    parts.push(paint(arch2, L.metal2));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      parts.push(cyl(14, 18, 120, 6, 62, L.stone, Math.cos(a) * 150, Math.sin(a) * 150), cone(20, 34, 6, 182, L.metal, Math.cos(a) * 150, Math.sin(a) * 150));
    }
  } else {
    parts.push(cyl(120, 70, 70, 7, 62, L.metal));
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const bar = new THREE.CylinderGeometry(8, 10, 170, 4);
      bar.translate(0, 85, 0);
      bar.rotateZ(-Math.cos(a) * 0.25);
      bar.rotateX(Math.sin(a) * 0.25);
      bar.translate(Math.cos(a) * 100, 110, Math.sin(a) * 100);
      parts.push(paint(bar, L.metal2));
    }
  }
  const crystal = new THREE.OctahedronGeometry(62, 0);
  crystal.scale(0.8, 1.4, 0.8);
  crystal.translate(0, 210, 0);
  glow.push(crystal);
  return { body: mergeGeometries(parts)!, outline: outlineMesh(mergeGeometries(parts)!, 6), glow: mergeGeometries(glow.map((g) => paint(g, '#ffffff')))!, height: 380 };
}

function nexus(team: number): Template {
  const L = BASE_LOOK[team]!;
  const parts: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  if (team === 0) {
    parts.push(cyl(360, 390, 60, 8, 0, L.stoneDark), cyl(300, 330, 60, 8, 60, L.stone), cyl(230, 260, 60, 8, 120, L.stoneDark), cyl(240, 240, 12, 16, 178, L.metal));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const pillar = new THREE.CylinderGeometry(26, 34, 340, 6);
      pillar.translate(Math.cos(a) * 250, 180 + 170, Math.sin(a) * 250);
      parts.push(paint(pillar, L.stone));
      parts.push(cone(40, 70, 6, 520, L.metal, Math.cos(a) * 250, Math.sin(a) * 250));
      const beam = new THREE.CylinderGeometry(12, 12, 260, 5);
      beam.rotateZ(Math.PI / 2);
      beam.translate(-130, 0, 0);
      beam.rotateZ(-0.55);
      beam.rotateY(-a);
      beam.translate(Math.cos(a) * 250, 500, Math.sin(a) * 250);
      parts.push(paint(beam, L.metal));
      parts.push(...banner(100, 190, 300, 200, -a + Math.PI / 2, 0));
    }
    const core = new THREE.OctahedronGeometry(150, 0);
    core.scale(1, 1.6, 1);
    core.translate(0, 500, 0);
    glow.push(core);
    return { body: mergeGeometries(parts)!, outline: outlineMesh(mergeGeometries(parts)!, 8), glow: mergeGeometries(glow.map((g) => paint(g, '#ffffff')))!, height: 820 };
  }
  parts.push(cyl(370, 400, 70, 6, 0, L.stoneDark), cyl(300, 340, 90, 6, 70, L.metal2), cyl(280, 300, 18, 6, 160, L.metal));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = Math.cos(a) * 260;
    const z = Math.sin(a) * 260;
    parts.push(cyl(38, 50, 300 + (i % 2) * 80, 6, 160, L.metal2, x, z), cyl(54, 46, 24, 6, 460 + (i % 2) * 80, L.metal, x, z));
    const ember = new THREE.OctahedronGeometry(22, 0);
    ember.translate(x, 500 + (i % 2) * 80, z);
    glow.push(ember);
    if (i % 2 === 0) parts.push(...banner(100, 180, 280, 240, -a + Math.PI / 2, 1));
  }
  const core = new THREE.OctahedronGeometry(140, 0);
  core.scale(1, 1.5, 1);
  core.translate(0, 420, 0);
  glow.push(core);
  return { body: mergeGeometries(parts)!, outline: outlineMesh(mergeGeometries(parts)!, 8), glow: mergeGeometries(glow.map((g) => paint(g, '#ffffff')))!, height: 820 };
}

function rubble(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const b = new THREE.DodecahedronGeometry(50 + (i % 3) * 25, 0);
    b.scale(1, 0.5, 1);
    b.translate(Math.cos(i * 2.1) * 120, 15, Math.sin(i * 2.1) * 120);
    parts.push(paint(b, i % 2 ? '#4a463e' : '#2e2b27'));
  }
  return mergeGeometries(parts)!;
}

interface View {
  root: THREE.Group;
  alive: THREE.Group;
  rubble: THREE.Mesh;
  glow: THREE.Mesh;
  height: number;
  seen: boolean;
  spin: boolean;
}

export class Structures {
  readonly group = new THREE.Group();
  private readonly templates = new Map<string, Template>();
  private readonly views = new Map<number, View>();
  private readonly rubbleGeo = rubble();

  /** Health-bar anchor height for a structure kind. */
  heightOf(kind: number): number {
    return SCALE * (kind === Kind.Tower ? 780 : kind === Kind.Nexus ? 820 : 380);
  }

  private template(kind: number, team: number): Template {
    const key = `${kind}:${team}`;
    let t = this.templates.get(key);
    if (!t) {
      const tm = Math.min(team, 1);
      t = kind === Kind.Tower ? tower(tm) : kind === Kind.Nexus ? nexus(tm) : inhibitor(tm);
      this.templates.set(key, t);
    }
    return t;
  }

  update(entities: SnapEntity[], timeSec: number): void {
    for (const v of this.views.values()) v.seen = false;
    for (const e of entities) {
      if (e.kind < Kind.Tower || e.kind > Kind.Nexus) continue;
      let v = this.views.get(e.serial);
      if (!v) v = this.create(e);
      v.seen = true;
      v.alive.visible = e.alive;
      v.rubble.visible = !e.alive;
    }
    for (const v of this.views.values()) {
      if (!v.seen && v.alive.visible) {
        // despawned (destroyed) structure: leave rubble
        v.alive.visible = false;
        v.rubble.visible = true;
      }
      if (v.spin) {
        v.glow.rotation.y = timeSec * 0.8;
        v.glow.position.y = Math.sin(timeSec * 1.6) * 12;
      } else {
        const s = 1 + Math.sin(timeSec * 3.1) * 0.04;
        v.glow.scale.set(s, 1, s);
      }
    }
  }

  private create(e: SnapEntity): View {
    // a structure respawning at the same spot (inhibitor) replaces the old rubble
    for (const [serial, old] of this.views) {
      if (!old.alive.visible && old.root.position.distanceToSquared(new THREE.Vector3(e.x, 0, -e.y)) < 200 * 200) {
        this.group.remove(old.root);
        this.views.delete(serial);
      }
    }
    const t = this.template(e.kind, e.team);
    const root = new THREE.Group();
    root.position.set(e.x, 0, -e.y);
    root.scale.setScalar(SCALE);
    root.rotation.y = e.team === 1 ? Math.PI : 0;
    const alive = new THREE.Group();
    const body = new THREE.Mesh(t.body, bodyMat);
    body.castShadow = body.receiveShadow = true;
    const outline = new THREE.Mesh(t.outline.geometry, t.outline.material);
    const glow = new THREE.Mesh(t.glow, glowMats[Math.min(e.team, 1)]!);
    glow.castShadow = true;
    alive.add(body, outline, glow);
    const rub = new THREE.Mesh(this.rubbleGeo, bodyMat);
    rub.visible = false;
    rub.receiveShadow = true;
    root.add(alive, rub);
    this.group.add(root);
    // single crystals spin and bob; Aschehalle furnace grates / chimney embers only pulse
    const spin = !(e.team === 1 && (e.kind === Kind.Tower || e.kind === Kind.Nexus));
    const v: View = { root, alive, rubble: rub, glow, height: t.height, seen: true, spin };
    this.views.set(e.serial, v);
    return v;
  }
}
