// A4 VFX: GPU particle system. Every particle is written once at spawn into a ring buffer (position, velocity,
// birth time, life, effect index, tint); the vertex shader evaluates position (gravity, drag), colour, alpha and size
// over life from a per-effect curve table. So the CPU does nothing per frame except advance one time uniform and
// upload the slots that were spawned (sub-range upload). Two draw calls in total (alpha-blended + additive), no
// per-frame allocation. Hard caps: ring size per effect class (oldest overwritten), `maxLive` per effect, a spawn
// budget per class and frame. Purely visual: no sim access. Format: docs/VFX-FORMAT.md.
import * as THREE from 'three';
import { REL } from '../palette';
import { glyphAtlas, ATLAS_COLS, ATLAS_ROWS } from './glyphs';
import { EFFECTS, effectHandle } from './registry';
import { RENDER_ORDER } from './order';
import { CLASS_CAP, CLASS_FRAME_BUDGET, CURVE_SAMPLES, GLYPHS, VFX_CLASSES, type EffectDef, type Stop, type VfxClass } from './schema';

export type VfxTeam = 'own' | 'enemy' | 'neutral';

/** Optional parameters of one emit call. Reuse one object in hot paths (nothing is retained). */
export interface EmitOpts {
  /** Override of the effect's burst count (before the global scale). */
  count?: number;
  /** Element hue 0..360 for `tint.mode: hue`. */
  hue?: number;
  /** Relation for `tint.mode: team` (default neutral = untinted). */
  team?: VfxTeam;
  /** Flight / facing direction in sim units (unit vector): `forward` velocity, cone axis, trail `back`. */
  dx?: number;
  dy?: number;
  /** Multiplier of the horizontal speed. */
  spread?: number;
  /** Override of the emitter radius (disc / ring / cone). */
  radius?: number;
  /** Line emitter end point (sim). */
  x2?: number;
  y2?: number;
  /** Use another class pool than the effect's default (a trail kind that also bursts). */
  cls?: VfxClass;
}

const STRIDE = 16;
const NCLS = VFX_CLASSES.length;
const CLS_INDEX: Readonly<Record<VfxClass, number>> = { projectile: 0, hit: 1, aura: 2, telegraph: 3, ultimate: 4 };
const TAU = Math.PI * 2;

interface Compiled {
  d: EffectDef;
  cls: number;
  blend: number;
  glyph: number;
  tintMode: number;
  /** Death times of the last `maxLive` spawns (ring): a new spawn needs the oldest of them to be dead. */
  ring: Float64Array;
  head: number;
}

const VERT = /* glsl */ `
uniform float uTime;
uniform float uScale;
uniform sampler2D uCurves;
attribute float aT0;
attribute vec3 aVel;
attribute float aLife;
attribute vec4 aMeta; // effect index, seed, size, start angle
attribute vec4 aTint; // rgb (linear), spin rad/s
varying vec4 vColor;
varying vec2 vGlyph;
vec4 curveAt(int row, float k) {
  float f = clamp(k, 0.0, 1.0) * ${(CURVE_SAMPLES - 1).toFixed(1)};
  int i = int(f);
  int j = min(i + 1, ${CURVE_SAMPLES - 1});
  return mix(texelFetch(uCurves, ivec2(i, row), 0), texelFetch(uCurves, ivec2(j, row), 0), f - float(i));
}
void main() {
  float age = uTime - aT0;
  float k = age / max(aLife, 0.0001);
  if (aLife <= 0.0 || age < 0.0 || k >= 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vColor = vec4(0.0);
    vGlyph = vec2(0.0);
    return;
  }
  int e = int(aMeta.x + 0.5);
  vec4 prm = texelFetch(uCurves, ivec2(0, e * 3 + 2), 0); // gravity, drag, glyph, flicker
  float vf = prm.y > 0.0001 ? (1.0 - exp(-prm.y * age)) / prm.y : age;
  vec3 p = position + aVel * vf;
  p.y = max(2.0, p.y - 0.5 * prm.x * age * age);
  vec4 col = curveAt(e * 3, k);
  float sz = curveAt(e * 3 + 1, k).x * aMeta.z;
  float fl = (1.0 - prm.w) + prm.w * sin(uTime * 27.027 + aMeta.y * 40.0);
  vColor = vec4(col.rgb * aTint.rgb, col.a * fl);
  vGlyph = vec2(prm.z, aMeta.w + aTint.w * age);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(sz * uScale / -mv.z, 0.0, 512.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
varying vec4 vColor;
varying vec2 vGlyph;
void main() {
  vec2 pc = gl_PointCoord - 0.5;
  float c = cos(vGlyph.y);
  float s = sin(vGlyph.y);
  pc = vec2(c * pc.x - s * pc.y, s * pc.x + c * pc.y) + 0.5;
  if (pc.x < 0.0 || pc.x > 1.0 || pc.y < 0.0 || pc.y > 1.0) discard;
  float g = floor(vGlyph.x + 0.5);
  vec2 cell = vec2(mod(g, ${ATLAS_COLS.toFixed(1)}), floor(g / ${ATLAS_COLS.toFixed(1)}));
  vec2 uv = vec2((cell.x + pc.x) / ${ATLAS_COLS.toFixed(1)}, 1.0 - (cell.y + pc.y) / ${ATLAS_ROWS.toFixed(1)});
  gl_FragColor = vec4(vColor.rgb, vColor.a * texture2D(uAtlas, uv).a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** One blend mode: interleaved ring buffers, one segment per effect class. */
class Layer {
  readonly data: Float32Array;
  readonly deathAt: Float64Array;
  readonly buf: THREE.InterleavedBuffer;
  readonly points: THREE.Points;
  readonly base = new Int32Array(NCLS);
  readonly next = new Int32Array(NCLS);
  readonly lo = new Int32Array(NCLS).fill(1 << 30);
  readonly hi = new Int32Array(NCLS).fill(-1);
  readonly total: number;
  private readonly size = new THREE.Vector2();

  constructor(additive: boolean, readonly uniforms: Record<string, THREE.IUniform>) {
    let total = 0;
    for (const c of VFX_CLASSES) {
      this.base[CLS_INDEX[c]] = total;
      total += CLASS_CAP[c];
    }
    this.total = total;
    this.data = new Float32Array(total * STRIDE);
    this.deathAt = new Float64Array(total);
    this.buf = new THREE.InterleavedBuffer(this.data, STRIDE).setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.InterleavedBufferAttribute(this.buf, 3, 0));
    geo.setAttribute('aT0', new THREE.InterleavedBufferAttribute(this.buf, 1, 3));
    geo.setAttribute('aVel', new THREE.InterleavedBufferAttribute(this.buf, 3, 4));
    geo.setAttribute('aLife', new THREE.InterleavedBufferAttribute(this.buf, 1, 7));
    geo.setAttribute('aMeta', new THREE.InterleavedBufferAttribute(this.buf, 4, 8));
    geo.setAttribute('aTint', new THREE.InterleavedBufferAttribute(this.buf, 4, 12));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? RENDER_ORDER.vfxAdditive : RENDER_ORDER.vfxNormal;
    this.points.onBeforeRender = (renderer): void => {
      renderer.getDrawingBufferSize(this.size);
      (uniforms.uScale as { value: number }).value = this.size.y * 0.5; // same attenuation as THREE.PointsMaterial
    };
  }

  /** Upload the slots written since the last flush (one sub-range per class segment). */
  flush(): void {
    let any = false;
    for (let c = 0; c < NCLS; c++) {
      if (this.hi[c]! < this.lo[c]!) continue;
      this.buf.addUpdateRange(this.lo[c]! * STRIDE, (this.hi[c]! - this.lo[c]! + 1) * STRIDE);
      this.lo[c] = 1 << 30;
      this.hi[c] = -1;
      any = true;
    }
    if (any) this.buf.needsUpdate = true;
  }
}

/** Piecewise-linear value of `stops` at t. */
function sampleStops(stops: Stop<number>[], t: number): number {
  for (let i = 1; i < stops.length; i++) {
    const [t1, v1] = stops[i]!;
    if (t <= t1) {
      const [t0, v0] = stops[i - 1]!;
      return t1 > t0 ? v0 + ((v1 - v0) * (t - t0)) / (t1 - t0) : v1;
    }
  }
  return stops[stops.length - 1]![1];
}

/** Per-effect curve table (3 rows per effect: colour + alpha, size, parameters), CURVE_SAMPLES wide. */
export function buildCurveTable(defs: readonly EffectDef[]): Float32Array {
  const rows = Math.max(1, defs.length) * 3;
  const out = new Float32Array(CURVE_SAMPLES * rows * 4);
  const c = new THREE.Color();
  defs.forEach((d, e) => {
    const rgb = d.colorOverLife.map(([t, hex]) => {
      c.set(hex); // linear working space, like every other colour of the renderer
      return [t, c.r, c.g, c.b] as const;
    });
    for (let i = 0; i < CURVE_SAMPLES; i++) {
      const t = i / (CURVE_SAMPLES - 1);
      const o0 = (e * 3 * CURVE_SAMPLES + i) * 4;
      const ch = [1, 2, 3].map((k) => sampleStops(rgb.map((s) => [s[0], s[k]!] as Stop<number>), t));
      out[o0] = ch[0]!;
      out[o0 + 1] = ch[1]!;
      out[o0 + 2] = ch[2]!;
      out[o0 + 3] = sampleStops(d.alphaOverLife, t);
      out[((e * 3 + 1) * CURVE_SAMPLES + i) * 4] = sampleStops(d.sizeOverLife, t);
    }
    const p = ((e * 3 + 2) * CURVE_SAMPLES) * 4;
    out[p] = d.gravity;
    out[p + 1] = d.drag;
    out[p + 2] = GLYPHS.indexOf(d.glyph);
    out[p + 3] = d.flicker;
  });
  return out;
}

export interface VfxStats {
  /** Particles accepted since the last reset. */
  spawned: number;
  /** Refused by a cap (class budget per frame or effect maxLive). */
  dropped: number;
  /** Draw calls of the particle layers (always 2). */
  drawCalls: number;
}

export class VfxSystem {
  readonly group = new THREE.Group();
  /** Global emission scale (reduce motion: fewer particles). */
  scale = 1;
  readonly stats: VfxStats = { spawned: 0, dropped: 0, drawCalls: 2 };
  private readonly fx: Compiled[];
  private readonly layers: [Layer, Layer];
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly curves: THREE.DataTexture;
  private readonly budget = new Int32Array(NCLS);
  private epoch = Number.NaN;
  private now = 0;
  private rng = 0x9e3779b9;
  private readonly col = new THREE.Color();
  private readonly tint = new THREE.Color();

  constructor(defs: readonly EffectDef[] = EFFECTS) {
    this.fx = defs.map((d) => ({
      d,
      cls: CLS_INDEX[d.class],
      blend: d.blend === 'add' ? 1 : 0,
      glyph: GLYPHS.indexOf(d.glyph),
      tintMode: d.tint.mode === 'hue' ? 1 : d.tint.mode === 'team' ? 2 : 0,
      ring: new Float64Array(d.maxLive),
      head: 0,
    }));
    this.curves = new THREE.DataTexture(buildCurveTable(defs), CURVE_SAMPLES, Math.max(1, defs.length) * 3, THREE.RGBAFormat, THREE.FloatType);
    this.curves.minFilter = this.curves.magFilter = THREE.NearestFilter;
    this.curves.generateMipmaps = false;
    this.curves.needsUpdate = true;
    this.uniforms = { uTime: { value: 0 }, uScale: { value: 400 }, uCurves: { value: this.curves }, uAtlas: { value: glyphAtlas() } };
    this.layers = [new Layer(false, this.uniforms), new Layer(true, this.uniforms)];
    this.group.add(this.layers[0].points, this.layers[1].points);
    this.budget.set(VFX_CLASSES.map((c) => CLASS_FRAME_BUDGET[c]));
  }

  /** Effect handle of an id (-1 if unknown); pass handles in hot paths. */
  handle(id: string): number {
    return effectHandle(id);
  }

  def(handle: number): EffectDef | undefined {
    return this.fx[handle]?.d;
  }

  private rnd(): number {
    // xorshift32: deterministic, allocation free
    let s = this.rng;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.rng = s >>> 0;
    return this.rng / 4294967296;
  }

  /** Reseed the emitter randomness (tests). */
  seed(n: number): void {
    this.rng = (n >>> 0) || 1;
  }

  /** Live particles at the latest time seen (O(capacity); for stats and tests, not for the frame loop). */
  get live(): number {
    let n = 0;
    for (const l of this.layers) for (let i = 0; i < l.total; i++) if (l.deathAt[i]! > this.now) n++;
    return n;
  }

  /** Live particles per class (all effects and both blend modes). */
  liveByClass(): Record<VfxClass, number> {
    const r = { projectile: 0, hit: 0, aura: 0, telegraph: 0, ultimate: 0 };
    for (const l of this.layers) for (const c of VFX_CLASSES) for (let i = l.base[CLS_INDEX[c]]!, e = i + CLASS_CAP[c]; i < e; i++) if (l.deathAt[i]! > this.now) r[c]++;
    return r;
  }

  /**
   * Burst of effect `id` (string or handle) at sim (x, y), height h. Returns the number of particles accepted.
   * `now` in ms (the render clock).
   */
  emit(id: string | number, x: number, y: number, h: number, now: number, o?: EmitOpts): number {
    const handle = typeof id === 'number' ? id : effectHandle(id);
    const f = this.fx[handle];
    if (!f) return 0;
    if (Number.isNaN(this.epoch)) this.epoch = now;
    this.now = now;
    const d = f.d;
    const em = d.emitter;
    const vel = d.velocity;
    const cls = o?.cls ? CLS_INDEX[o.cls] : f.cls;
    const n = (o?.count ?? d.count) * this.scale;
    let whole = Math.floor(n) + (this.rnd() < n - Math.floor(n) ? 1 : 0);
    const want = whole;
    whole = Math.min(whole, this.budget[cls]!);
    const layer = this.layers[f.blend]!;
    const cap = CLASS_CAP[VFX_CLASSES[cls]!];
    const base = layer.base[cls]!;
    const hasDir = o?.dx !== undefined && o.dy !== undefined;
    const dx = hasDir ? o!.dx! : 1;
    const dy = hasDir ? o!.dy! : 0;
    const spread = o?.spread ?? 1;
    const radius = o?.radius ?? em.radius;
    const dirAngle = Math.atan2(dy, dx);
    const halfCone = (em.angle * Math.PI) / 360;
    // tint of this call (hue tint varies per particle below)
    if (f.tintMode === 2) {
      const t = o?.team;
      if (t === 'own') this.tint.set(REL.ownShot);
      else if (t === 'enemy') this.tint.set(REL.enemyShot);
      else this.tint.setRGB(1, 1, 1);
    }
    const hue = o?.hue ?? 0;
    const data = layer.data;
    let spawned = 0;
    for (let i = 0; i < whole; i++) {
      // per-effect live cap: the spawn made `maxLive` spawns ago must be dead
      if (f.ring[f.head]! > now) break;
      const lifeMs = d.life[0] + (d.life[1] - d.life[0]) * this.rnd();
      f.ring[f.head] = now + lifeMs;
      f.head = (f.head + 1) % f.ring.length;
      // position offset (sim x/y) and the particle's own direction angle
      let ox = 0;
      let oy = 0;
      let ang = this.rnd() * TAU;
      switch (em.shape) {
        case 'disc': {
          const r = radius * Math.sqrt(this.rnd());
          const a = this.rnd() * TAU;
          ox = Math.cos(a) * r;
          oy = Math.sin(a) * r;
          break;
        }
        case 'ring': {
          const r = radius - em.thickness * this.rnd();
          const a = this.rnd() * TAU;
          ox = Math.cos(a) * r;
          oy = Math.sin(a) * r;
          break;
        }
        case 'line': {
          const t = this.rnd();
          ox = ((o?.x2 ?? x) - x) * t;
          oy = ((o?.y2 ?? y) - y) * t;
          break;
        }
        case 'cone': {
          const r = radius * Math.sqrt(this.rnd());
          ang = dirAngle + (this.rnd() * 2 - 1) * halfCone;
          ox = Math.cos(ang) * r;
          oy = Math.sin(ang) * r;
          break;
        }
        default:
          break;
      }
      const jx = em.jitter ? (this.rnd() - 0.5) * 2 * em.jitter : 0;
      const jy = em.jitter ? (this.rnd() - 0.5) * 2 * em.jitter : 0;
      const jh = em.jitterH ? (this.rnd() - 0.5) * 2 * em.jitterH : 0;
      // horizontal velocity direction (sim angle)
      let va = ang;
      if (vel.dir === 'forward') va = em.shape === 'cone' ? ang : dirAngle + (this.rnd() * 2 - 1) * halfCone;
      else if (vel.dir === 'outward' || vel.dir === 'inward') {
        va = ox !== 0 || oy !== 0 ? Math.atan2(oy, ox) : ang;
        if (vel.dir === 'inward') va += Math.PI;
      }
      const s = (vel.speed[0] + (vel.speed[1] - vel.speed[0]) * this.rnd()) * spread;
      let vx = Math.cos(va) * s;
      let vy = Math.sin(va) * s;
      if (hasDir && vel.back) {
        vx -= dx * vel.back;
        vy -= dy * vel.back;
      }
      const rise = vel.rise[0] + (vel.rise[1] - vel.rise[0]) * this.rnd();
      // tint
      if (f.tintMode === 1) {
        const t = d.tint;
        this.col.setHSL((((hue + (this.rnd() - 0.5) * 2 * t.hueJitter) % 360) + 360) % 360 / 360, t.saturation, t.lightness + (this.rnd() - 0.5) * 2 * t.lightnessJitter);
      } else if (f.tintMode === 2) this.col.copy(this.tint);
      else this.col.setRGB(1, 1, 1);
      // slot
      const slot = base + layer.next[cls]!;
      layer.next[cls] = (layer.next[cls]! + 1) % cap;
      layer.deathAt[slot] = now + lifeMs;
      if (slot < layer.lo[cls]!) layer.lo[cls] = slot;
      if (slot > layer.hi[cls]!) layer.hi[cls] = slot;
      const q = slot * STRIDE;
      data[q] = x + ox + jx;
      data[q + 1] = h + em.height[0] + (em.height[1] - em.height[0]) * this.rnd() + jh;
      data[q + 2] = -(y + oy + jy);
      data[q + 3] = (now - this.epoch) / 1000;
      data[q + 4] = vx;
      data[q + 5] = rise;
      data[q + 6] = -vy;
      data[q + 7] = lifeMs / 1000;
      data[q + 8] = handle;
      data[q + 9] = this.rnd();
      data[q + 10] = d.size[0] + (d.size[1] - d.size[0]) * this.rnd();
      data[q + 11] = this.rnd() * TAU;
      data[q + 12] = this.col.r;
      data[q + 13] = this.col.g;
      data[q + 14] = this.col.b;
      data[q + 15] = d.spin[0] + (d.spin[1] - d.spin[0]) * this.rnd();
      spawned++;
    }
    this.budget[cls] = this.budget[cls]! - spawned;
    this.stats.spawned += spawned;
    this.stats.dropped += want - spawned;
    return spawned;
  }

  /** Once per frame: advance the shader clock, upload the new spawns, refill the spawn budgets. */
  update(now: number): void {
    if (Number.isNaN(this.epoch)) this.epoch = now;
    this.now = now;
    this.uniforms.uTime!.value = (now - this.epoch) / 1000;
    this.layers[0].flush();
    this.layers[1].flush();
    for (let c = 0; c < NCLS; c++) this.budget[c] = CLASS_FRAME_BUDGET[VFX_CLASSES[c]!];
  }

  dispose(): void {
    for (const l of this.layers) {
      l.points.geometry.dispose();
      (l.points.material as THREE.Material).dispose();
    }
    this.curves.dispose();
  }
}
