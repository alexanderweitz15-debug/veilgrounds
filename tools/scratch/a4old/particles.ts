// D1b: ability particle language. One additive THREE.Points pool per particle kind (ember / spark / drip / mote /
// shard, values in src/render/abilityMotifs.json): missile trails, impact bursts, cast flourishes and ambient particles
// on hook ground objects. Particles live in a ring buffer (the oldest is overwritten); a dead particle is black
// (= invisible with additive blending). Purely visual, no sim access.
import * as THREE from 'three';
import { PARTICLE_KINDS, PARTICLE_KIND_IDS, type ParticleKind, type ParticleKindId } from './abilityTheme';

const POOL = 640;

let dotTex: THREE.Texture | null = null;
/** Soft round dot (null in Node tests without a document: square points). */
function dot(): THREE.Texture | null {
  if (dotTex || typeof document === 'undefined') return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  if (!g) return null;
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, '#fff');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 32, 32);
  return (dotTex = new THREE.CanvasTexture(c));
}

class Pool {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(POOL * 3);
  /** RGBA: alpha fades (normal blending); additive kinds fade the RGB instead. */
  private readonly col = new Float32Array(POOL * 4);
  private readonly base = new Float32Array(POOL * 3);
  private readonly vel = new Float32Array(POOL * 3);
  private readonly t0 = new Float64Array(POOL);
  private readonly life = new Float32Array(POOL);
  private readonly alive = new Uint8Array(POOL);
  private next = 0;
  live = 0;

  constructor(readonly kind: ParticleKind) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.PointsMaterial({ size: kind.size, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: kind.additive ? THREE.AdditiveBlending : THREE.NormalBlending, map: dot() });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  /** One particle at world (x, h, z) with velocity (vx, vy, vz) and linear RGB colour. */
  spawn(x: number, h: number, z: number, vx: number, vy: number, vz: number, c: THREE.Color, now: number): void {
    const i = this.next;
    this.next = (i + 1) % POOL;
    if (!this.alive[i]) this.live++;
    this.alive[i] = 1;
    this.pos.set([x, h, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.base.set([c.r, c.g, c.b], i * 3);
    this.t0[i] = now;
    this.life[i] = this.kind.life * (0.7 + 0.6 * Math.random());
  }

  update(now: number, dt: number): void {
    if (!this.live) return;
    const k = this.kind;
    for (let i = 0; i < POOL; i++) {
      if (!this.alive[i]) continue;
      const a = (now - this.t0[i]!) / this.life[i]!;
      const j = i * 3;
      const q = i * 4;
      if (a >= 1) {
        this.alive[i] = 0;
        this.live--;
        this.col[q] = this.col[q + 1] = this.col[q + 2] = this.col[q + 3] = 0;
        continue;
      }
      this.vel[j + 1] = this.vel[j + 1]! - k.gravity * dt;
      this.pos[j] = this.pos[j]! + this.vel[j]! * dt;
      this.pos[j + 1] = Math.max(2, this.pos[j + 1]! + this.vel[j + 1]! * dt);
      this.pos[j + 2] = this.pos[j + 2]! + this.vel[j + 2]! * dt;
      let f = 1 - a;
      if (k.flicker) f *= 0.7 + 0.3 * Math.sin(now / 37 + i * 1.3);
      const c = k.additive ? f : 1;
      this.col[q] = this.base[j]! * c;
      this.col[q + 1] = this.base[j + 1]! * c;
      this.col[q + 2] = this.base[j + 2]! * c;
      this.col[q + 3] = k.additive ? 1 : Math.min(1, f * 1.4);
    }
    const g = this.points.geometry;
    g.attributes.position!.needsUpdate = true;
    g.attributes.color!.needsUpdate = true;
  }
}

export class Particles {
  readonly group = new THREE.Group();
  private readonly pools = new Map<ParticleKindId, Pool>();
  private readonly c = new THREE.Color();
  /** Global emission scale (reduce motion: fewer particles). */
  scale = 1;

  constructor() {
    for (const id of PARTICLE_KIND_IDS) {
      const p = new Pool(PARTICLE_KINDS[id]);
      this.pools.set(id, p);
      this.group.add(p.points);
    }
  }

  kind(id: ParticleKindId): ParticleKind {
    return PARTICLE_KINDS[id];
  }

  /** Live particle count (all kinds). */
  get live(): number {
    let n = 0;
    for (const p of this.pools.values()) n += p.live;
    return n;
  }

  /**
   * Emit `count` particles of `id` at sim (x, y), height h, element hue. `dir` = flight direction (sim units, unit
   * vector) for trails: shards spray backwards along it.
   */
  emit(id: ParticleKindId, x: number, y: number, h: number, hue: number, count: number, now: number, dir?: { dx: number; dy: number }, spread = 1): void {
    const pool = this.pools.get(id);
    if (!pool) return;
    const k = pool.kind;
    const n = count * this.scale;
    const whole = Math.floor(n) + (Math.random() < n - Math.floor(n) ? 1 : 0);
    for (let i = 0; i < whole; i++) {
      this.c.setHSL(((hue + (Math.random() - 0.5) * 24) % 360 + 360) % 360 / 360, 0.95, (k.light + (Math.random() - 0.5) * 16) / 100);
      const a = Math.random() * Math.PI * 2;
      const s = k.speed * spread * (0.4 + 0.6 * Math.random());
      let vx = Math.cos(a) * s;
      let vy = Math.sin(a) * s;
      if (dir && k.back) {
        vx -= dir.dx * k.back;
        vy -= dir.dy * k.back;
      }
      const jx = (Math.random() - 0.5) * 16;
      const jy = (Math.random() - 0.5) * 16;
      pool.spawn(x + jx, h + (Math.random() - 0.5) * 12, -(y + jy), vx, k.rise * (0.6 + 0.8 * Math.random()), -vy, this.c, now);
    }
  }

  update(now: number, dt: number): void {
    for (const p of this.pools.values()) p.update(now, dt);
  }
}
