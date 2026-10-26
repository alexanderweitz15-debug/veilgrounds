// World ping markers (LoL-like): pulsing ground ring + expanding shock rings, a light beam and a floating icon
// badge per ping kind, all in the ping colour, fading out over PING_MS.
import * as THREE from 'three';
import type { ClientState } from '../game/state';
import type { PingKind } from '../sim/types';
import { PING_COLOR, PING_ICON } from '../ui/pingWheel';
import { PING_MS, pingFrame } from './pingAnim';
import { settings } from '../settings';

export { PING_MS };

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
  g.fillText(PING_ICON[kind], S / 2, S / 2 + 4);
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  iconTex.set(kind, tex);
  return tex;
}

const labelTex = new Map<string, THREE.CanvasTexture>();
/** Text plate under the badge ("Leviathan in 1:23"), cached per text + colour. Returns the texture and its aspect. */
function labelTexture(text: string, color: string): { tex: THREE.CanvasTexture; aspect: number } {
  const key = `${color}|${text}`;
  let tex = labelTex.get(key);
  const H = 64;
  const font = `700 ${H * 0.55}px "Segoe UI", system-ui, sans-serif`;
  const c = (tex?.image as HTMLCanvasElement | undefined) ?? document.createElement('canvas');
  if (!tex) {
    const g = c.getContext('2d')!;
    g.font = font;
    const w = Math.ceil(g.measureText(text).width) + 36;
    c.width = w;
    c.height = H;
    g.font = font;
    g.fillStyle = 'rgba(14, 12, 18, 0.88)';
    g.beginPath();
    g.roundRect(2, 2, w - 4, H - 4, 14);
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = color;
    g.stroke();
    g.fillStyle = '#f2ead6';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, H / 2 + 2);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    if (labelTex.size > 40) labelTex.clear();
    labelTex.set(key, tex);
  }
  return { tex, aspect: c.width / c.height };
}

interface Marker {
  ring: THREE.Mesh;
  wave: THREE.Mesh;
  beam: THREE.Mesh;
  icon: THREE.Sprite;
  mat: THREE.MeshBasicMaterial;
  waveMat: THREE.MeshBasicMaterial;
  iconMat: THREE.SpriteMaterial;
  /** Context text plate (only pings with a label). */
  label?: { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; aspect: number };
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
        if (p.label) {
          const { tex, aspect } = labelTexture(p.label, col);
          const lm = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
          const sprite = new THREE.Sprite(lm);
          sprite.position.set(p.x, 250, -p.y);
          sprite.renderOrder = 11;
          this.group.add(sprite);
          m.label = { sprite, mat: lm, aspect };
        }
        this.live.set(p.id, m);
      }
      const ms = now - p.at;
      const f = pingFrame(p.kind, ms, calm);
      m.ring.scale.set(f.ringScale, 1, f.ringScale);
      m.mat.opacity = 0.85 * f.fade;
      m.wave.visible = f.waveOn;
      if (f.waveOn) {
        m.wave.scale.setScalar(f.waveR);
        m.waveMat.opacity = f.waveOpacity;
      }
      m.beam.scale.set(1, f.beamScale, 1);
      m.icon.position.y = 420 + f.iconDy;
      const is = 190 * f.iconScale;
      m.icon.scale.set(is, is, 1);
      m.iconMat.rotation = f.iconRot;
      m.iconMat.opacity = f.fade;
      if (m.label) {
        const h = 95 * Math.min(1, 0.4 + ms / 200);
        m.label.sprite.scale.set(h * m.label.aspect, h, 1);
        m.label.mat.opacity = f.fade;
      }
    }
    for (const [id, m] of this.live) {
      if (seen.has(id)) continue;
      this.group.remove(m.ring, m.wave, m.beam, m.icon);
      if (m.label) {
        this.group.remove(m.label.sprite);
        m.label.mat.dispose(); // the cached text texture stays
      }
      m.mat.dispose();
      m.waveMat.dispose();
      m.iconMat.dispose();
      this.live.delete(id);
    }
  }
}
