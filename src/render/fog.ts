// Fog of war overlay: low-res canvas (alpha = fogged) redrawn ~10 Hz from own-team vision sources, sampled by
// every fog-patched material (ground, walls, structures) and drawn onto the minimap.
import * as THREE from 'three';
import type { ClientState } from '../game/state';
import { MAP_SIZE, simToCanvas, visionRadius } from './coords';
import { fogUniform } from './materials';
import type { MapData } from '../sim/map';

const PX = 256;
const INTERVAL_MS = 100;

export class FogOfWar {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private last = -Infinity;

  constructor(private readonly map: MapData) {
    this.canvas.width = this.canvas.height = PX;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.fillStyle = '#fff';
    this.ctx.fillRect(0, 0, PX, PX);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    fogUniform.value = this.texture;
  }

  update(state: ClientState, now: number): void {
    if (now - this.last < INTERVAL_MS || !state.snap) return;
    this.last = now;
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, PX, PX);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, PX, PX);
    ctx.globalCompositeOperation = 'destination-out';
    const k = PX / MAP_SIZE;
    const hole = (x: number, y: number, r: number): void => {
      const [cx, cy] = simToCanvas(x, y, PX);
      const rr = r * k;
      const g = ctx.createRadialGradient(cx, cy, rr * 0.8, cx, cy, rr);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.fill();
    };
    const f = this.map.sides[state.myTeam === 1 ? 1 : 0].fountain;
    hole(f.x, f.y, f.r + 900);
    for (const e of state.snap.entities) {
      if (e.team !== state.myTeam || !e.alive) continue;
      const r = e.vision ?? visionRadius(e.kind); // player wards carry their live radius (0 = disabled)
      if (r > 0) hole(state.x(e), state.y(e), r);
    }
    ctx.globalCompositeOperation = 'source-over';
    this.texture.needsUpdate = true;
  }
}
