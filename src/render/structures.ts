// placeholder art: low-poly towers, inhibitors and nexus, created from snapshot entities (keyed by serial).
// ponytail: one mesh (+ outline + glow) per structure, ~25 per team. Upgrade: InstancedMesh per type/team.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SnapEntity } from '../sim/snapshot';
import { Kind } from '../sim/types';
import { outlineMesh, paint, toon, withFog } from './materials';
import { TEAM } from './palette';

interface Template {
  body: THREE.BufferGeometry;
  outline: THREE.Mesh;
  glow: THREE.BufferGeometry;
  /** Height of the health bar anchor. */
  height: number;
}

/** Overall structure scale (towers ~2.5x champion height). */
const SCALE = 0.8;
const bodyMat = toon({ vertexColors: true });
const glowMats = [0, 1].map((t) => withFog(new THREE.MeshBasicMaterial({ color: TEAM[t]!.glow })));

function cyl(rt: number, rb: number, h: number, seg: number, y: number, color: string): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  g.translate(0, y + h / 2, 0);
  return paint(g, color);
}

function tower(team: number): Template {
  const p = TEAM[team]!;
  const parts = [
    cyl(150, 170, 60, 8, 0, p.stone),
    cyl(85, 110, 360, 8, 60, p.primary),
    cyl(120, 100, 50, 8, 420, p.accent),
    cyl(70, 70, 40, 8, 470, p.secondary),
  ];
  if (team === 0) {
    const roof = new THREE.ConeGeometry(130, 170, 8);
    roof.translate(0, 600, 0);
    parts.push(paint(roof, p.primary));
  } else {
    for (let i = 0; i < 4; i++) {
      const spike = new THREE.ConeGeometry(30, 190, 4);
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      spike.translate(Math.cos(a) * 85, 600, Math.sin(a) * 85);
      parts.push(paint(spike, p.accent));
    }
  }
  const body = mergeGeometries(parts)!;
  const glow = new THREE.OctahedronGeometry(55);
  glow.scale(1, 1.5, 1);
  glow.translate(0, team === 0 ? 720 : 560, 0);
  return { body, outline: outlineMesh(body, 8), glow, height: 780 };
}

function inhibitor(team: number): Template {
  const p = TEAM[team]!;
  const ring = new THREE.TorusGeometry(120, 30, 6, 10);
  ring.translate(0, 200, 0);
  const body = mergeGeometries([cyl(190, 210, 50, 10, 0, p.stone), cyl(150, 170, 30, 10, 50, p.primary), paint(ring, p.accent)])!;
  const glow = new THREE.IcosahedronGeometry(70, 0);
  glow.translate(0, 200, 0);
  return { body, outline: outlineMesh(body, 7), glow, height: 380 };
}

function nexus(team: number): Template {
  const p = TEAM[team]!;
  const parts = [cyl(330, 360, 80, 8, 0, p.stone), cyl(240, 280, 70, 8, 80, p.primary), cyl(160, 200, 50, 8, 150, p.accent)];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const pylon = new THREE.CylinderGeometry(30, 45, 380, 5);
    pylon.translate(Math.cos(a) * 290, 190, Math.sin(a) * 290);
    parts.push(paint(pylon, p.secondary));
  }
  const body = mergeGeometries(parts)!;
  const glow = new THREE.OctahedronGeometry(170);
  glow.scale(1, 1.7, 1);
  glow.translate(0, 480, 0);
  return { body, outline: outlineMesh(body, 9), glow, height: 820 };
}

function rubble(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const b = new THREE.DodecahedronGeometry(50 + (i % 3) * 25, 0);
    b.scale(1, 0.5, 1);
    b.translate(Math.cos(i * 2.1) * 110, 15, Math.sin(i * 2.1) * 110);
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
      v.glow.rotation.y = timeSec * 0.8;
      v.glow.position.y = Math.sin(timeSec * 1.6) * 12;
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
    const v: View = { root, alive, rubble: rub, glow, height: t.height, seen: true };
    this.views.set(e.serial, v);
    return v;
  }
}
