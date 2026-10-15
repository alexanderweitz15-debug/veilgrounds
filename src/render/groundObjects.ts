// Ground objects from champion hooks (Renn blades, Nyx seeds, Grimald traps): flat team-tinted markers.
// placeholder art: simple meshes, pooled per object id.
import * as THREE from 'three';
import type { ClientState } from '../game/state';

const STYLE: Record<string, { color: string; shape: 'blade' | 'ring' | 'disc' }> = {
  renn_blade: { color: '#d9dde6', shape: 'blade' },
  nyx_seed: { color: '#8a5cc7', shape: 'disc' },
  grimald_trap: { color: '#8c6a3c', shape: 'ring' },
};

export class GroundObjects {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<number, THREE.Mesh>();
  private readonly geo = {
    blade: new THREE.BoxGeometry(70, 6, 14),
    ring: new THREE.RingGeometry(0.7, 1, 24).rotateX(-Math.PI / 2),
    disc: new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2),
  };
  private readonly mats = new Map<string, THREE.MeshBasicMaterial>();

  update(state: ClientState, now: number): void {
    const seen = new Set<number>();
    for (const o of state.snap?.objects ?? []) {
      seen.add(o.id);
      let m = this.meshes.get(o.id);
      if (!m) {
        const st = STYLE[o.tag] ?? { color: '#cccccc', shape: 'disc' as const };
        let mat = this.mats.get(o.tag);
        if (!mat) this.mats.set(o.tag, (mat = new THREE.MeshBasicMaterial({ color: st.color, transparent: true, opacity: 0.85, depthWrite: false })));
        m = new THREE.Mesh(this.geo[st.shape], mat);
        if (st.shape !== 'blade') m.scale.set(o.r, 1, o.r);
        m.rotation.y = st.shape === 'blade' ? (o.id * 1.7) % Math.PI : 0;
        this.group.add(m);
        this.meshes.set(o.id, m);
      }
      const bob = STYLE[o.tag]?.shape === 'blade' ? 8 + Math.sin(now / 200 + o.id) * 3 : 3;
      m.position.set(o.x, bob, -o.y);
    }
    for (const [id, m] of this.meshes) {
      if (seen.has(id)) continue;
      this.group.remove(m);
      this.meshes.delete(id);
    }
  }
}
