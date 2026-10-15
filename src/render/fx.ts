// Transient effects: projectiles (instanced), ground telegraphs ('zone' events), click markers, range circle,
// cast rings and death puffs. All rings/discs lie flat on the ground with polygon offset against z-fighting.
import * as THREE from 'three';
import type { ClientState } from '../game/state';
import type { SimEvent } from '../sim/types';
import { REL } from './palette';

const MAX_PROJ = 160;

interface Pulse {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t0: number;
  dur: number;
  r0: number;
  r1: number;
  a0: number;
  active: boolean;
}

interface Zone {
  rim: THREE.Mesh;
  fill: THREE.Mesh;
  rimMat: THREE.MeshBasicMaterial;
  fillMat: THREE.MeshBasicMaterial;
  ev: Extract<SimEvent, { e: 'zone' }> | null;
}

const flatRing = new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2);
const flatDisc = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);

function groundMat(color: string, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
}

export class Fx {
  readonly group = new THREE.Group();
  private readonly proj: THREE.InstancedMesh;
  private readonly halo: THREE.InstancedMesh;
  private readonly pulses: Pulse[] = [];
  private readonly zones: Zone[] = [];
  private readonly range: THREE.Mesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private readonly axis = new THREE.Vector3(1, 0, 0);
  private readonly dir = new THREE.Vector3();

  constructor() {
    const g = new THREE.IcosahedronGeometry(1, 1);
    this.proj = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial(), MAX_PROJ);
    this.halo = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }), MAX_PROJ);
    for (const m of [this.proj, this.halo]) {
      m.setColorAt(0, this.c.set(1, 1, 1));
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
    }
    this.proj.castShadow = true;
    this.group.add(this.proj, this.halo);
    this.range = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 96).rotateX(-Math.PI / 2), groundMat('#f2e7b6', 0.7));
    this.range.visible = false;
    this.group.add(this.range);
  }

  private pulse(x: number, y: number, color: string, r0: number, r1: number, dur: number, now: number, disc = false, a0 = 0.9): void {
    let p = this.pulses.find((q) => !q.active && (q.mesh.geometry === flatDisc) === disc);
    if (!p) {
      const mat = groundMat(color, a0);
      const mesh = new THREE.Mesh(disc ? flatDisc : flatRing, mat);
      mesh.renderOrder = 3;
      this.group.add(mesh);
      p = { mesh, mat, t0: 0, dur: 0, r0: 0, r1: 0, a0, active: false };
      this.pulses.push(p);
    }
    p.mat.color.set(color);
    p.mesh.position.set(x, 3, -y);
    Object.assign(p, { t0: now, dur, r0, r1, a0, active: true });
    p.mesh.visible = true;
  }

  /** Click feedback for move / attack commands. */
  clickMarker(x: number, y: number, attack: boolean, now: number): void {
    this.pulse(x, y, attack ? '#ff5a3c' : '#7dff8a', 90, 20, 380, now);
  }

  onEvent(ev: SimEvent, state: ClientState, now: number): void {
    switch (ev.e) {
      case 'zone':
        this.addZone(ev);
        break;
      case 'cast': {
        const src = state.byId.get(ev.src);
        if (src) this.pulse(src.x, src.y, src.team === state.myTeam ? REL.ownShot : REL.enemyShot, 40, 160, 300, now);
        break;
      }
      case 'death':
        this.pulse(ev.x, ev.y, '#c8c4bc', 30, 140, 600, now, true, 0.5);
        break;
    }
  }

  private addZone(ev: Extract<SimEvent, { e: 'zone' }>): void {
    let z = this.zones.find((q) => !q.ev);
    if (!z) {
      const rimMat = groundMat('#fff', 0.95);
      const fillMat = groundMat('#fff', 0.3);
      const rim = new THREE.Mesh(flatRing, rimMat);
      const fill = new THREE.Mesh(flatDisc, fillMat);
      rim.renderOrder = fill.renderOrder = 2;
      this.group.add(rim, fill);
      z = { rim, fill, rimMat, fillMat, ev: null };
      this.zones.push(z);
    }
    z.ev = ev;
  }

  update(state: ClientState, now: number, showRange: boolean): void {
    const snap = state.snap;
    // projectiles
    let n = 0;
    if (snap) {
      const a = state.alpha;
      for (const pr of snap.projectiles) {
        if (n >= MAX_PROJ) break;
        const own = pr.team === state.myTeam;
        const homing = pr.kind === 0;
        const x = pr.px + (pr.x - pr.px) * a;
        const y = pr.py + (pr.y - pr.py) * a;
        const w = Math.max(14, pr.width * (homing ? 0.6 : 0.55));
        this.p.set(x, homing ? 110 : 70, -y);
        this.dir.set(pr.dx || 1, 0, -(pr.dy || 0)).normalize();
        this.q.setFromUnitVectors(this.axis, this.dir);
        this.s.set(homing ? w * 1.8 : w * 2.6, w * 0.7, w * 0.7);
        this.m.compose(this.p, this.q, this.s);
        this.proj.setMatrixAt(n, this.m);
        this.c.set(homing ? (own ? '#bfe4ff' : '#ffc29a') : own ? REL.ownShot : REL.enemyShot);
        this.proj.setColorAt(n, this.c);
        this.s.multiplyScalar(1.9);
        this.m.compose(this.p, this.q, this.s);
        this.halo.setMatrixAt(n, this.m);
        this.halo.setColorAt(n, this.c);
        n++;
      }
    }
    for (const m of [this.proj, this.halo]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }

    // zones: rim at full radius, fill grows from start to resolve tick, brief flash after
    const tick = snap ? snap.tick + state.alpha : 0;
    for (const z of this.zones) {
      const ev = z.ev;
      if (!ev) {
        z.rim.visible = z.fill.visible = false;
        continue;
      }
      if (tick > ev.at + 6) {
        z.ev = null;
        z.rim.visible = z.fill.visible = false;
        continue;
      }
      const col = ev.team === state.myTeam ? REL.ownShot : REL.enemyShot;
      const k = Math.min(1, Math.max(0, (tick - ev.start) / Math.max(1, ev.at - ev.start)));
      z.rim.visible = z.fill.visible = true;
      z.rim.position.set(ev.x, 4, -ev.y);
      z.rim.scale.setScalar(ev.r);
      z.fill.position.set(ev.x, 3, -ev.y);
      z.fill.scale.setScalar(Math.max(1, ev.r * k));
      z.rimMat.color.set(col);
      z.fillMat.color.set(col);
      z.fillMat.opacity = tick > ev.at ? 0.6 * (1 - (tick - ev.at) / 6) : 0.18 + 0.2 * k;
    }

    // pulses
    for (const p of this.pulses) {
      if (!p.active) continue;
      const k = (now - p.t0) / p.dur;
      if (k >= 1) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      p.mesh.scale.setScalar(p.r0 + (p.r1 - p.r0) * k);
      p.mat.opacity = p.a0 * (1 - k);
    }

    // attack range circle (hold C)
    const me = state.me();
    const stats = snap?.me?.stats;
    this.range.visible = showRange && !!me && !!stats;
    if (me && stats) {
      this.range.position.set(state.x(me), 4, -state.y(me));
      this.range.scale.setScalar(stats.range + me.radius);
    }
  }
}
