// Geometry builder for the procedural champions: collects faceted (non-indexed) triangles with vertex colour,
// skin index/weight (rigid: one bone per part; cloth: weight functions) and fx (glow, metal). Parts are authored
// with small primitive helpers in model units (a human is ~180 tall) and transformed by the builder's current matrix.
import * as THREE from 'three';

export type Vec = [number, number, number];

export interface Ring {
  /** centre */
  c: Vec;
  /** half width (x), half depth (z) */
  rx: number;
  rz: number;
  /** optional per-ring yaw (rad) and per-vertex radial jitter function (u = 0..1 around) */
  jag?: (u: number) => number;
  /** squash the front (z>0) side: 1 = ellipse, <1 flatter front */
  front?: number;
  /** extra depth on the back side (positive = bulge backward) */
  back?: number;
}

/** Skin weights for one vertex: up to 4 [bone, weight] pairs. */
export type Weights = [number, number][];
export type WeightFn = (p: THREE.Vector3) => Weights;

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

export class MeshBuilder {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  readonly si: number[] = [];
  readonly sw: number[] = [];
  readonly fx: number[] = [];
  private color = new THREE.Color();
  private bone = 0;
  private glow = 0;
  private metal = 0;
  private weightFn: WeightFn | null = null;
  /** transform applied to authored points (part space → bind/model space) */
  readonly mat = new THREE.Matrix4();
  private stack: THREE.Matrix4[] = [];

  set(o: { color?: string | THREE.Color; bone?: number; glow?: number; metal?: number; weights?: WeightFn | null }): this {
    if (o.color !== undefined) this.color.set(o.color);
    if (o.bone !== undefined) this.bone = o.bone;
    if (o.glow !== undefined) this.glow = o.glow;
    if (o.metal !== undefined) this.metal = o.metal;
    if (o.weights !== undefined) this.weightFn = o.weights;
    return this;
  }
  get currentBone(): number {
    return this.bone;
  }
  push(m?: THREE.Matrix4): this {
    this.stack.push(this.mat.clone());
    if (m) this.mat.multiply(m);
    return this;
  }
  pop(): this {
    const m = this.stack.pop();
    if (m) this.mat.copy(m);
    return this;
  }

  private vert(x: number, y: number, z: number): void {
    _v.set(x, y, z).applyMatrix4(this.mat);
    this.pos.push(_v.x, _v.y, _v.z);
    this.col.push(this.color.r, this.color.g, this.color.b);
    this.fx.push(this.glow, this.metal);
    if (this.weightFn) {
      const w = this.weightFn(_v);
      let sum = 0;
      for (const [, ww] of w) sum += ww;
      for (let i = 0; i < 4; i++) {
        const e = w[i];
        this.si.push(e ? e[0] : 0);
        this.sw.push(e ? e[1] / (sum || 1) : 0);
      }
    } else {
      this.si.push(this.bone, 0, 0, 0);
      this.sw.push(1, 0, 0, 0);
    }
  }

  tri(a: Vec, b: Vec, c: Vec): void {
    this.vert(a[0], a[1], a[2]);
    this.vert(b[0], b[1], b[2]);
    this.vert(c[0], c[1], c[2]);
  }
  quad(a: Vec, b: Vec, c: Vec, d: Vec): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  /** Add a three.js geometry (any indexing), transformed by `m` then the builder matrix. */
  geo(g: THREE.BufferGeometry, m?: THREE.Matrix4): this {
    const src = g.index ? g.toNonIndexed() : g;
    const p = src.getAttribute('position');
    if (m) this.push(m);
    for (let i = 0; i < p.count; i++) this.vert(p.getX(i), p.getY(i), p.getZ(i));
    if (m) this.pop();
    if (src !== g) src.dispose();
    g.dispose();
    return this;
  }

  /**
   * Lofted tube through elliptic rings (bottom → top or any order), `seg` sides, optional caps.
   * Ring points: angle a, x = c.x + sin(a) * rx, z = c.z + cos(a) * rz (a = 0 → front, +z).
   */
  loft(rings: Ring[], seg: number, capStart = true, capEnd = true, arc?: [number, number]): this {
    const pts: Vec[][] = rings.map((r) => ringPts(r, seg, arc));
    const n = arc ? seg + 1 : seg;
    for (let k = 0; k < rings.length - 1; k++) {
      const A = pts[k]!;
      const B = pts[k + 1]!;
      for (let i = 0; i < (arc ? seg : n); i++) {
        const j = (i + 1) % n;
        this.quad(A[i]!, A[j]!, B[j]!, B[i]!);
      }
    }
    if (!arc) {
      if (capStart) fan(this, pts[0]!, rings[0]!.c, true);
      if (capEnd) fan(this, pts[pts.length - 1]!, rings[rings.length - 1]!.c, false);
    }
    return this;
  }

  /** Loft through explicit point rings (each ring same length, ordered bottom → top, points CCW seen from above). */
  rings(pts: Vec[][], closed = true, capStart = false, capEnd = false): this {
    const n = pts[0]!.length;
    for (let k = 0; k < pts.length - 1; k++) {
      const A = pts[k]!;
      const Bn = pts[k + 1]!;
      for (let i = 0; i < (closed ? n : n - 1); i++) {
        const j = (i + 1) % n;
        this.quad(A[i]!, A[j]!, Bn[j]!, Bn[i]!);
      }
    }
    const centre = (r: Vec[]): Vec => {
      const c: Vec = [0, 0, 0];
      for (const p of r) for (let i = 0; i < 3; i++) c[i] += p[i] / r.length;
      return c;
    };
    if (capStart) fan(this, pts[0]!, centre(pts[0]!), true);
    if (capEnd) fan(this, pts[pts.length - 1]!, centre(pts[pts.length - 1]!), false);
    return this;
  }

  /** Box from min to max corners (axis aligned in part space), optional taper of the top face. */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, taperTop = 1, taperDepthTop = taperTop): this {
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const tx = hx * taperTop;
    const tz = hz * taperDepthTop;
    const b: Vec[] = [
      [cx - hx, cy - hy, cz - hz],
      [cx + hx, cy - hy, cz - hz],
      [cx + hx, cy - hy, cz + hz],
      [cx - hx, cy - hy, cz + hz],
    ];
    const t: Vec[] = [
      [cx - tx, cy + hy, cz - tz],
      [cx + tx, cy + hy, cz - tz],
      [cx + tx, cy + hy, cz + tz],
      [cx - tx, cy + hy, cz + tz],
    ];
    this.quad(b[0]!, b[1]!, b[2]!, b[3]!);
    this.quad(t[3]!, t[2]!, t[1]!, t[0]!);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(b[j]!, b[i]!, t[i]!, t[j]!);
    }
    return this;
  }

  /** Segment between two points with radius r0 → r1 (n sides), capped. */
  limb(a: Vec, bEnd: Vec, r0: number, r1: number, n = 6, rzScale = 1): this {
    _a.set(...a);
    _b.set(...bEnd);
    const dir = _c.subVectors(_b, _a);
    const len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    const m = new THREE.Matrix4().compose(_a.clone(), q, new THREE.Vector3(1, 1, 1));
    this.push(m);
    this.loft(
      [
        { c: [0, 0, 0], rx: r0, rz: r0 * rzScale },
        { c: [0, len, 0], rx: r1, rz: r1 * rzScale },
      ],
      n,
    );
    this.pop();
    return this;
  }

  /** Low-poly blob (icosahedron detail 0/1) with scale. */
  blob(c: Vec, r: Vec, detail = 0, rotY = 0): this {
    const g = new THREE.IcosahedronGeometry(1, detail);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...c), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)), new THREE.Vector3(...r));
    return this.geo(g, m);
  }

  /** Flat polygon plate (convex, in the XY plane of the given matrix) extruded by depth. */
  plate(poly: [number, number][], depth: number, m?: THREE.Matrix4): this {
    if (m) this.push(m);
    const d = depth / 2;
    const n = poly.length;
    for (let i = 1; i < n - 1; i++) {
      const a = poly[0]!;
      const b = poly[i]!;
      const c = poly[i + 1]!;
      this.tri([a[0], a[1], d], [b[0], b[1], d], [c[0], c[1], d]);
      this.tri([a[0], a[1], -d], [c[0], c[1], -d], [b[0], b[1], -d]);
    }
    for (let i = 0; i < n; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % n]!;
      this.quad([a[0], a[1], -d], [b[0], b[1], -d], [b[0], b[1], d], [a[0], a[1], d]);
    }
    if (m) this.pop();
    return this;
  }

  get triangles(): number {
    return this.pos.length / 9;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aFx', new THREE.Float32BufferAttribute(this.fx, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.computeVertexNormals();
    return g;
  }
}

function ringPts(r: Ring, seg: number, arc?: [number, number]): Vec[] {
  const out: Vec[] = [];
  const n = arc ? seg + 1 : seg;
  for (let i = 0; i < n; i++) {
    const u = arc ? arc[0] + ((arc[1] - arc[0]) * i) / seg : i / seg;
    const a = u * Math.PI * 2;
    const j = r.jag ? r.jag(u) : 1;
    const cz = Math.cos(a);
    let rz = r.rz;
    if (cz > 0 && r.front !== undefined) rz *= r.front;
    if (cz < 0 && r.back !== undefined) rz += r.back;
    out.push([r.c[0] + Math.sin(a) * r.rx * j, r.c[1], r.c[2] + cz * rz * j]);
  }
  return out;
}

function fan(b: MeshBuilder, ring: Vec[], c: Vec, down: boolean): void {
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    if (down) b.tri(c, q, p);
    else b.tri(c, p, q);
  }
}

// ------------------------------------------------------------------------------------------------ matrix helpers
const E = new THREE.Euler();
const Q = new THREE.Quaternion();
/** Translation + Euler (XYZ) + scale matrix. */
export function T(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s: number | Vec = 1): THREE.Matrix4 {
  E.set(rx, ry, rz);
  Q.setFromEuler(E);
  const sv = typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), Q, sv);
}

/** Matrix that maps the +Y axis onto the segment a→b (origin at a). */
export function along(a: Vec, b: Vec): { m: THREE.Matrix4; len: number } {
  const A = new THREE.Vector3(...a);
  const d = new THREE.Vector3(...b).sub(A);
  const len = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return { m: new THREE.Matrix4().compose(A, q, new THREE.Vector3(1, 1, 1)), len };
}

/** Colour helpers (hex in, hex out). */
export function shade(hex: string, f: number): string {
  const c = new THREE.Color(hex).multiplyScalar(f);
  return '#' + c.getHexString();
}
export function mixHex(a: string, b: string, t: number): string {
  return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
}
