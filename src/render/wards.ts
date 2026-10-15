// Player wards (Schleierward / Siegelward): small pole + gem markers, pooled per entity id. The snapshot only
// contains enemy wards the team can see (revealed Schleierwards, Siegelwards in vision), so drawing everything in it
// is fog-correct. Own wards disabled by an enemy seal/sweep (vision 0) are drawn dimmed.
// placeholder art: simple meshes until the art pass.
import * as THREE from 'three';
import type { ClientState } from '../game/state';
import { Kind } from '../sim/types';
import { REL } from './palette';

interface Marker {
  root: THREE.Group;
  gem: THREE.Mesh;
  ring: THREE.Mesh;
  gemMat: THREE.MeshBasicMaterial;
  ringMat: THREE.MeshBasicMaterial;
}

export class WardMarkers {
  readonly group = new THREE.Group();
  private readonly markers = new Map<number, Marker>();
  private readonly pole = new THREE.CylinderGeometry(3, 4, 60, 6).translate(0, 30, 0);
  private readonly poleMat = new THREE.MeshLambertMaterial({ color: '#4a3d2c' });
  private readonly gemGeo = new THREE.OctahedronGeometry(12, 0);
  private readonly ringGeo = new THREE.RingGeometry(26, 32, 24).rotateX(-Math.PI / 2);

  update(state: ClientState, now: number): void {
    const seen = new Set<number>();
    for (const e of state.snap?.entities ?? []) {
      if (e.kind !== Kind.Ward || !e.ward || !e.alive) continue;
      seen.add(e.id);
      let m = this.markers.get(e.id);
      if (!m) {
        m = this.make();
        this.markers.set(e.id, m);
      }
      const own = e.team === state.myTeam;
      const col = own ? REL.ally : REL.enemy;
      m.gemMat.color.set(e.ward === 'seal' ? (own ? '#f2d36b' : '#ff8a5a') : col);
      m.ringMat.color.set(col);
      const disabled = own && e.vision === 0;
      m.gemMat.opacity = disabled ? 0.35 : 0.95;
      m.ringMat.opacity = disabled ? 0.2 : 0.55;
      m.root.position.set(e.x, 0, -e.y);
      m.gem.position.y = 72 + Math.sin(now / 400 + e.id) * 4;
      m.gem.rotation.y = now / 900 + e.id;
      m.gem.scale.setScalar(e.ward === 'seal' ? 1.25 : 1);
    }
    for (const [id, m] of this.markers) {
      if (seen.has(id)) continue;
      this.group.remove(m.root);
      m.gemMat.dispose();
      m.ringMat.dispose();
      this.markers.delete(id);
    }
  }

  private make(): Marker {
    const root = new THREE.Group();
    const pole = new THREE.Mesh(this.pole, this.poleMat);
    pole.castShadow = true;
    const gemMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    const gem = new THREE.Mesh(this.gemGeo, gemMat);
    const ringMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const ring = new THREE.Mesh(this.ringGeo, ringMat);
    ring.position.y = 3;
    root.add(pole, gem, ring);
    this.group.add(root);
    return { root, gem, ring, gemMat, ringMat };
  }
}
