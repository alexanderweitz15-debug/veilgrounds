// World ping markers (LoL-like): pulsing ground ring + expanding shock rings, a light beam and a floating icon
// badge per ping kind, all in the ping colour, fading out over PING_MS.
import * as THREE from 'three';
import type { ClientState } from '../game/state';
import type { PingKind } from '../sim/types';
import { PING_COLOR } from '../ui/pingWheel';
import { settings } from '../settings';

export const PING_MS = 3000;

const ICON: Record<PingKind, string> = {
  alert: '!',
  danger: '⚠',
  onMyWay: '➜',
  back: '↶',
  missing: '?',
  vision: '◉',
  help: '✚',
  group: '⚑',
  focus: '◎',
  objective: '★',
  ok: '✓',
  question: '?',
  myBad: '✗',
};

const iconTex = new Map<PingKind, THREE.Texture>();
/** Round badge with the kind's glyph, cached per kind. */
function iconTexture(kind: PingKind): THREE.Texture {
  let tex = iconTex.get(kind);
  if (tex) return tex;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 6, 0, Math.PI * 2);
  g.fillStyle = 'rgba(14, 12, 18, 0.88)';
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = PING_COLOR[kind];
  g.stroke();
  g.fillStyle = PING_COLOR[kind];
  g.font = `900 ${S * 0.56}px "Segoe UI Symbol", "Segoe UI", system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(ICON[kind], S / 2, S / 2 + 4);
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  iconTex.set(kind, tex);
  return tex;
}

interface Marker {
  ring: THREE.Mesh;
  wave: THREE.Mesh;
  beam: THREE.Mesh;
  icon: THREE.Sprite;
  mat: THREE.MeshBasicMaterial;
  waveMat: THREE.MeshBasicMaterial;
  iconMat: THREE.SpriteMaterial;
}

export class PingMarkers {
  readonly group = new THREE.Group();
  // 3x the old 70-95 ring: readable at full zoom-out
  private readonly ringGeo = new THREE.RingGeometry(210, 285, 48).rotateX(-Math.PI / 2);
  private readonly waveGeo = new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2);
  private readonly beamGeo = new THREE.CylinderGeometry(16, 16, 560, 10, 1, true).translate(0, 280, 0);
  private readonly live = new Map<number, Marker>();

  update(state: ClientState, now: number): void {
    const seen = new Set<number>();
    const calm = settings.reduceMotion;
    for (const p of state.pings) {
      seen.add(p.id);
      let m = this.live.get(p.id);
      if (!m) {
        const col = PING_COLOR[p.kind];
        const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 });
        const waveMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
        const iconMat = new THREE.SpriteMaterial({ map: iconTexture(p.kind), transparent: true, depthTest: false, depthWrite: false });
        m = { ring: new THREE.Mesh(this.ringGeo, mat), wave: new THREE.Mesh(this.waveGeo, waveMat), beam: new THREE.Mesh(this.beamGeo, mat), icon: new THREE.Sprite(iconMat), mat, waveMat, iconMat };
        m.ring.position.set(p.x, 5, -p.y);
        m.wave.position.set(p.x, 6, -p.y);
        m.beam.position.set(p.x, 0, -p.y);
        m.icon.position.set(p.x, 420, -p.y);
        m.icon.renderOrder = 10;
        this.group.add(m.ring, m.wave, m.beam, m.icon);
        this.live.set(p.id, m);
      }
      const ms = now - p.at;
      const age = ms / PING_MS;
      const fade = age < 0.7 ? 1 : Math.max(0, 1 - (age - 0.7) / 0.3);
      // pop in, then breathe
      const pop = Math.min(1, ms / 160);
      const breathe = calm ? 1 : 1 + 0.08 * Math.sin(ms / 110);
      const s = (0.6 + 0.4 * pop) * breathe;
      m.ring.scale.set(s, 1, s);
      m.mat.opacity = 0.85 * fade;
      // expanding shock rings: three pulses in the first 1.5 s
      const wk = (ms % 500) / 500;
      const waveOn = !calm && ms < 1500;
      m.wave.visible = waveOn;
      if (waveOn) {
        m.wave.scale.setScalar(120 + 380 * wk);
        m.waveMat.opacity = 0.9 * (1 - wk);
      }
      m.beam.scale.set(1, Math.max(0.01, 1 - age * 1.2), 1);
      const bob = calm ? 0 : Math.sin(ms / 220) * 14;
      m.icon.position.y = 420 + bob;
      const is = 190 * (0.5 + 0.5 * pop) * (calm ? 1 : 1 + 0.05 * Math.sin(ms / 110));
      m.icon.scale.set(is, is, 1);
      m.iconMat.opacity = fade;
    }
    for (const [id, m] of this.live) {
      if (seen.has(id)) continue;
      this.group.remove(m.ring, m.wave, m.beam, m.icon);
      m.mat.dispose();
      m.waveMat.dispose();
      m.iconMat.dispose();
      this.live.delete(id);
    }
  }
}
