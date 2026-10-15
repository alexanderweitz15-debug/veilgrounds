// World ping markers: a ground ring + short beam in the ping colour, fading out over PING_MS.
import * as THREE from 'three';
import type { ClientState } from '../game/state';
import { PING_COLOR } from '../ui/pingWheel';

export const PING_MS = 3000;

export class PingMarkers {
  readonly group = new THREE.Group();
  private readonly ringGeo = new THREE.RingGeometry(70, 95, 32).rotateX(-Math.PI / 2);
  private readonly beamGeo = new THREE.CylinderGeometry(10, 10, 420, 8).translate(0, 210, 0);
  private readonly live = new Map<number, { ring: THREE.Mesh; beam: THREE.Mesh }>();

  update(state: ClientState, now: number): void {
    const seen = new Set<number>();
    for (const p of state.pings) {
      seen.add(p.id);
      let m = this.live.get(p.id);
      if (!m) {
        const mat = new THREE.MeshBasicMaterial({ color: PING_COLOR[p.kind], transparent: true, depthWrite: false });
        m = { ring: new THREE.Mesh(this.ringGeo, mat), beam: new THREE.Mesh(this.beamGeo, mat) };
        m.ring.position.set(p.x, 4, -p.y);
        m.beam.position.set(p.x, 0, -p.y);
        this.group.add(m.ring, m.beam);
        this.live.set(p.id, m);
      }
      const age = (now - p.at) / PING_MS;
      const s = 1 + Math.min(1, age * 4) * 0.6;
      m.ring.scale.set(s, 1, s);
      (m.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - age);
      m.beam.scale.set(1, Math.max(0.01, 1 - age * 1.5), 1);
    }
    for (const [id, m] of this.live) {
      if (seen.has(id)) continue;
      this.group.remove(m.ring, m.beam);
      (m.ring.material as THREE.Material).dispose();
      this.live.delete(id);
    }
  }
}
