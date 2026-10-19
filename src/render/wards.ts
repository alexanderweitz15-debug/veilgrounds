// Player wards (Schleierward / Siegelward): small pole + gem markers, pooled per entity id. The snapshot only
// contains enemy wards the team can see (revealed Schleierwards, Siegelwards in vision), so drawing everything in it
// is fog-correct. Own wards disabled by an enemy seal/sweep (vision 0) are drawn dimmed.
// placeholder art: simple meshes until the art pass. A freshly placed own ward briefly shows its vision circle.
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
  /** Placement flash: vision circle that sweeps out to the ward's vision radius and fades. */
  vis: THREE.Mesh;
  visFill: THREE.Mesh;
  visMat: THREE.MeshBasicMaterial;
  visFillMat: THREE.MeshBasicMaterial;
  born: number;
}

const VIS_MS = 1600;

export class WardMarkers {
  readonly group = new THREE.Group();
  private readonly markers = new Map<number, Marker>();
  // readable at game zoom: taller staff, bigger gem, wide base ring
  private readonly pole = new THREE.CylinderGeometry(5, 8, 110, 8).translate(0, 55, 0);
  private readonly poleMat = new THREE.MeshLambertMaterial({ color: '#5a4732' });
  private readonly gemGeo = new THREE.OctahedronGeometry(22, 0);
  private readonly ringGeo = new THREE.RingGeometry(46, 56, 32).rotateX(-Math.PI / 2);
  private readonly visGeo = new THREE.RingGeometry(0.97, 1, 64).rotateX(-Math.PI / 2);
  private readonly visFillGeo = new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2);

  update(state: ClientState, now: number): void {
    const seen = new Set<number>();
    for (const e of state.snap?.entities ?? []) {
      if (e.kind !== Kind.Ward || !e.ward || !e.alive) continue;
      seen.add(e.id);
      let m = this.markers.get(e.id);
      if (!m) {
        m = this.make(now);
        this.markers.set(e.id, m);
      }
      const own = e.team === state.myTeam;
      const col = own ? REL.ally : REL.enemy;
      m.gemMat.color.set(e.ward === 'seal' ? (own ? '#f2d36b' : '#ff8a5a') : col);
      m.ringMat.color.set(col);
      const disabled = own && e.vision === 0;
      // B1 stealth (LoL look): own stealthed wards translucent, revealed enemy ones with a bright reveal ring
      const ghost = own && e.stealth === true;
      const revealedEnemy = !own && e.stealth === true;
      m.gemMat.opacity = disabled ? 0.35 : ghost ? 0.6 : 0.95;
      m.ringMat.opacity = disabled ? 0.2 : revealedEnemy ? 0.9 : 0.55;
      m.root.position.set(e.x, 0, -e.y);
      m.gem.position.y = 135 + Math.sin(now / 400 + e.id) * 6;
      m.gem.rotation.y = now / 900 + e.id;
      m.gem.scale.setScalar(e.ward === 'seal' ? 1.25 : 1);
      // own ward just placed: show the area it reveals for a moment
      const k = (now - m.born) / VIS_MS;
      const flash = own && (e.vision ?? 0) > 0 && k < 1;
      m.vis.visible = m.visFill.visible = flash;
      if (flash) {
        const r = (e.vision ?? 0) * Math.min(1, k * 3);
        m.vis.scale.setScalar(Math.max(1, r));
        m.visFill.scale.setScalar(Math.max(1, r));
        m.visMat.color.set(col);
        m.visFillMat.color.set(col);
        const a = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
        m.visMat.opacity = 0.8 * a;
        m.visFillMat.opacity = 0.14 * a;
      }
    }
    for (const [id, m] of this.markers) {
      if (seen.has(id)) continue;
      this.group.remove(m.root);
      m.gemMat.dispose();
      m.ringMat.dispose();
      m.visMat.dispose();
      m.visFillMat.dispose();
      this.markers.delete(id);
    }
  }

  private make(now: number): Marker {
    const root = new THREE.Group();
    const pole = new THREE.Mesh(this.pole, this.poleMat);
    pole.castShadow = true;
    const gemMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    const gem = new THREE.Mesh(this.gemGeo, gemMat);
    const ringMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const ring = new THREE.Mesh(this.ringGeo, ringMat);
    ring.position.y = 3;
    const visMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const visFillMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const vis = new THREE.Mesh(this.visGeo, visMat);
    const visFill = new THREE.Mesh(this.visFillGeo, visFillMat);
    vis.position.y = 4;
    visFill.position.y = 2;
    vis.visible = visFill.visible = false;
    root.add(pole, gem, ring, vis, visFill);
    this.group.add(root);
    return { root, gem, ring, gemMat, ringMat, vis, visFill, visMat, visFillMat, born: now };
  }
}
