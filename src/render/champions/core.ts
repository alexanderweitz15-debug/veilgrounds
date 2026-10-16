// Champion sprite core: tiny 3D math, the orthographic "paper-doll" projection, colour helpers, the gouache
// painter (variant C "Gouache-Dämmerung": 3 hard value steps, cool-violet shadows, warm terminator band,
// warm rim light, specular only on metal/glass, thin inner ink lines) and a depth-sorted part list.
//
// Character space: +x = the character's LEFT, +y = up, +z = forward (the way the character faces).
// Units are pixels of the 256 px master cell (a standard champion is ~180 px from soles to crown).

export type V3 = [number, number, number];

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scl = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const madd = (a: V3, b: V3, s: number): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const rotX = (v: V3, a: number): V3 => [v[0], v[1] * Math.cos(a) - v[2] * Math.sin(a), v[1] * Math.sin(a) + v[2] * Math.cos(a)];
export const rotY = (v: V3, a: number): V3 => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)];
export const rotZ = (v: V3, a: number): V3 => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]];
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
export const TAU = Math.PI * 2;

/** Orthonormal frame (x = left, y = up, z = forward of the thing it belongs to). */
export interface Basis {
  o: V3;
  x: V3;
  y: V3;
  z: V3;
}
export const at = (b: Basis, l: V3): V3 => [
  b.o[0] + b.x[0] * l[0] + b.y[0] * l[1] + b.z[0] * l[2],
  b.o[1] + b.x[1] * l[0] + b.y[1] * l[1] + b.z[1] * l[2],
  b.o[2] + b.x[2] * l[0] + b.y[2] * l[1] + b.z[2] * l[2],
];
export const dirOf = (b: Basis, l: V3): V3 => [
  b.x[0] * l[0] + b.y[0] * l[1] + b.z[0] * l[2],
  b.x[1] * l[0] + b.y[1] * l[1] + b.z[1] * l[2],
  b.x[2] * l[0] + b.y[2] * l[1] + b.z[2] * l[2],
];
/** Frame with exact y axis and z as close as possible to `zHint`. */
export function frameYZ(o: V3, yAxis: V3, zHint: V3): Basis {
  const y = norm(yAxis);
  let x = cross(y, zHint);
  if (len(x) < 1e-4) x = cross(y, [0, 0, 1]);
  if (len(x) < 1e-4) x = cross(y, [1, 0, 0]);
  x = norm(x);
  return { o, x, y, z: cross(x, y) };
}
/** Frame with exact z axis and y as close as possible to `yHint`. */
export function frameZY(o: V3, zAxis: V3, yHint: V3): Basis {
  const z = norm(zAxis);
  let x = cross(yHint, z);
  if (len(x) < 1e-4) x = cross([0, 1, 0], z);
  if (len(x) < 1e-4) x = cross([1, 0, 0], z);
  x = norm(x);
  return { o, x, y: cross(z, x), z };
}
export function rotBasis(b: Basis, f: (v: V3) => V3, o = b.o): Basis {
  return { o, x: f(b.x), y: f(b.y), z: f(b.z) };
}

/** Two-bone IK (shoulder/elbow/wrist or hip/knee/ankle); `pole` points where the middle joint should bend to. */
export function ik(root: V3, target: V3, l1: number, l2: number, pole: V3): [V3, V3] {
  const d = sub(target, root);
  const dist = clamp(len(d), Math.abs(l1 - l2) + 0.5, l1 + l2 - 0.05);
  const dir = norm(d);
  const cosA = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
  const a = Math.acos(cosA);
  let n = sub(pole, scl(dir, dot(pole, dir)));
  if (len(n) < 1e-4) n = [0, 0, 1];
  n = norm(n);
  const mid = add(add(root, scl(dir, Math.cos(a) * l1)), scl(n, Math.sin(a) * l1));
  return [mid, add(root, scl(dir, dist))];
}

// ------------------------------------------------------------------------------------------------ projection
export interface View {
  /** facing yaw: 0 = facing the viewer (S), PI/2 = facing screen-right (E), PI = away (N). */
  yaw: number;
  /** view elevation (rad); sprites use ~24° (not the game's 56°) so faces and legs stay readable. */
  elev: number;
  /** canvas position of the ground point between the feet */
  cx: number;
  cy: number;
  /** canvas px per character unit */
  k: number;
  /** death: rotation backwards about the feet (rad), plus lift so the body rests on the ground */
  fall: number;
  lift: number;
}

export interface P2 {
  x: number;
  y: number;
  d: number;
}

export function project(v: View, p: V3): P2 {
  let x = p[0];
  let y = p[1];
  let z = p[2];
  if (v.fall) {
    const c = Math.cos(v.fall);
    const s = Math.sin(v.fall);
    const y2 = y * c + z * s;
    z = -y * s + z * c;
    y = y2 + v.lift;
  }
  const cy = Math.cos(v.yaw);
  const sy = Math.sin(v.yaw);
  const x2 = x * cy + z * sy;
  const z2 = -x * sy + z * cy;
  const ce = Math.cos(v.elev);
  const se = Math.sin(v.elev);
  const up = y * ce - z2 * se;
  return { x: v.cx + x2 * v.k, y: v.cy - up * v.k, d: z2 * ce + y * se };
}

// ------------------------------------------------------------------------------------------------ colour
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
export function mix(a: string, b: string, t: number): string {
  const A = rgb(a);
  const B = rgb(b);
  return hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}
export function luma(a: string): number {
  const A = rgb(a);
  return (0.299 * A[0] + 0.587 * A[1] + 0.114 * A[2]) / 255;
}
/** Push saturation away from grey by `s` (0..1) keeping luma roughly. */
export function saturate(a: string, s: number): string {
  const A = rgb(a);
  const l = (A[0] + A[1] + A[2]) / 3;
  return hex(A[0] + (A[0] - l) * s, A[1] + (A[1] - l) * s, A[2] + (A[2] - l) * s);
}

/** Variant C constants (src/stylelab/styles.ts, variant C). */
export const INK = '#1a1420';
export const SHADOW_VIOLET = '#3a2d5a';
export const RIM = '#ffbf72';
export const SPEC = '#fff4dc';
const WARM_LIGHT = '#ffd9a8';

export type MatKind = 'cloth' | 'leather' | 'metal' | 'skin' | 'wood' | 'glass' | 'fur' | 'hair' | 'glow' | 'stone' | 'paper';
export interface Mat {
  c: string;
  k: MatKind;
}
export const m = (c: string, k: MatKind = 'cloth'): Mat => ({ c, k });

interface Tones {
  hi: string;
  lit: string;
  mid: string;
  shd: string;
  term: string;
  rim: string;
  line: string;
}
const toneCache = new Map<string, Tones>();
export function tones(mat: Mat): Tones {
  const key = mat.c + mat.k;
  let t = toneCache.get(key) as Tones | undefined;
  if (t) return t;
  const b = mat.c;
  switch (mat.k) {
    case 'metal':
      t = {
        hi: '',
        lit: mix(b, SPEC, 0.42),
        mid: b,
        shd: mix(mix(b, '#000000', 0.58), SHADOW_VIOLET, 0.3),
        term: saturate(mix(b, '#000000', 0.25), 0.5),
        rim: mix(RIM, SPEC, 0.4),
        line: mix(b, INK, 0.75),
      };
      break;
    case 'skin':
      t = {
        hi: '',
        lit: mix(b, WARM_LIGHT, 0.25),
        mid: b,
        shd: mix(mix(b, '#6a2f3a', 0.42), SHADOW_VIOLET, 0.22),
        term: saturate(mix(b, '#c0504a', 0.28), 0.4),
        rim: mix(RIM, '#ffe0b0', 0.3),
        line: mix(b, '#5a2a30', 0.7),
      };
      break;
    case 'glow':
      t = { hi: '', lit: mix(b, '#ffffff', 0.5), mid: b, shd: mix(b, '#ff9a40', 0.25), term: b, rim: '#ffffff', line: mix(b, INK, 0.5) };
      break;
    case 'glass':
      t = { hi: '', lit: mix(b, '#ffffff', 0.45), mid: b, shd: mix(mix(b, '#2a3a5a', 0.45), SHADOW_VIOLET, 0.2), term: saturate(b, 0.6), rim: '#ffffff', line: mix(b, INK, 0.6) };
      break;
    default:
      t = {
        hi: '',
        lit: mix(b, WARM_LIGHT, mat.k === 'hair' || mat.k === 'fur' ? 0.24 : 0.23),
        mid: b,
        shd: mix(mix(b, '#000000', 0.45), SHADOW_VIOLET, 0.32),
        term: saturate(mix(b, '#000000', 0.18), 0.55),
        rim: RIM,
        line: mix(b, INK, 0.72),
      };
  }
  t.hi = mix(t.lit, mat.k === 'metal' || mat.k === 'glass' ? '#ffffff' : WARM_LIGHT, 0.35);
  t.line = mix(mix(b, '#000000', 0.6), INK, 0.45);
  toneCache.set(key, t);
  return t;
}

// ------------------------------------------------------------------------------------------------ 2D shapes
export interface Shape {
  path: Path2D;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** projected points (for stitches / hull-based decoration) */
  pts: { x: number; y: number }[];
}

function bounds(pts: { x: number; y: number }[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

export function hull2(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const crossZ = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: { x: number; y: number }[] = [];
  for (const q of p) {
    while (lower.length >= 2 && crossZ(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: { x: number; y: number }[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!;
    while (upper.length >= 2 && crossZ(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Closed smooth path through the midpoints of a polygon (soft, brushy corners). */
export function smoothPath(pts: { x: number; y: number }[]): Path2D {
  const path = new Path2D();
  const n = pts.length;
  if (n < 3) return path;
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const s = mid(pts[0]!, pts[1]!);
  path.moveTo(s.x, s.y);
  for (let i = 1; i <= n; i++) {
    const c = pts[i % n]!;
    const e = mid(c, pts[(i + 1) % n]!);
    path.quadraticCurveTo(c.x, c.y, e.x, e.y);
  }
  path.closePath();
  return path;
}

export function polyPath(pts: { x: number; y: number }[]): Path2D {
  const path = new Path2D();
  pts.forEach((p, i) => (i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)));
  path.closePath();
  return path;
}

export function shapeFrom(pts: { x: number; y: number }[], path: Path2D): Shape {
  return { path, ...bounds(pts), pts };
}

/** Tapered capsule between two projected points. */
export function capsule2(a: { x: number; y: number }, b: { x: number; y: number }, ra: number, rb: number): Shape {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const path = new Path2D();
  if (d < Math.abs(ra - rb) + 0.5) {
    const r = Math.max(ra, rb);
    const c = ra >= rb ? a : b;
    path.arc(c.x, c.y, r, 0, TAU);
    return { path, x0: c.x - r, y0: c.y - r, x1: c.x + r, y1: c.y + r, pts: [c] };
  }
  const th = Math.atan2(dy, dx);
  const phi = Math.asin(clamp((ra - rb) / d, -1, 1));
  const al = Math.PI / 2 + phi;
  path.moveTo(a.x + ra * Math.cos(th + al), a.y + ra * Math.sin(th + al));
  path.lineTo(b.x + rb * Math.cos(th + al), b.y + rb * Math.sin(th + al));
  path.arc(b.x, b.y, rb, th + al, th - al, true);
  path.lineTo(a.x + ra * Math.cos(th - al), a.y + ra * Math.sin(th - al));
  path.arc(a.x, a.y, ra, th - al, th + al - TAU, true);
  path.closePath();
  return {
    path,
    x0: Math.min(a.x - ra, b.x - rb),
    y0: Math.min(a.y - ra, b.y - rb),
    x1: Math.max(a.x + ra, b.x + rb),
    y1: Math.max(a.y + ra, b.y + rb),
    pts: [a, b],
  };
}

// ------------------------------------------------------------------------------------------------ painter
export interface FillOpts {
  /** inner line width (0 = none); default 2 */
  lw?: number;
  /** stroke before filling (unions of overlapping sub-paths keep only their outer contour) */
  under?: boolean;
  /** rim light on the lit edge (default true) */
  rim?: boolean;
  /** extra decoration */
  grain?: { x: number; y: number }; // wood grain direction (screen)
  stitch?: boolean;
  folds?: { x: number; y: number }[][];
  /** bright highlight strokes (hair sheen, polished edges) */
  sheen?: { x: number; y: number }[][];
  /** shading strength multiplier for the shadow crescent */
  shadow?: number;
  /** contact shadow / AO onto what is beneath (default true) */
  ao?: boolean;
  /** flat fill (no 3-step shading) */
  flat?: boolean;
  alpha?: number;
  rule?: CanvasFillRule;
}

/** Sprite revision (docs/style/sprite-research.md): texture/decoration only on parts at least this many master px
 *  across (≈ 6 px in the 112 px game cell); inner ink lines at 0.72 of their nominal width (outer contour stays heavy). */
const DETAIL = 10;
const INNER_LW = 0.72;

const BIG = (() => {
  const p = new Path2D();
  p.rect(-2000, -2000, 5000, 5000);
  return p;
})();
function outside(p: Path2D, dx: number, dy: number): Path2D {
  const r = new Path2D();
  r.addPath(BIG);
  r.addPath(p, new DOMMatrix().translate(dx, dy));
  return r;
}

/** Screen-space key light direction (towards the light): upper right. */
export const LIGHT = (() => {
  const l = Math.hypot(0.58, 0.81);
  return { x: 0.58 / l, y: -0.81 / l };
})();

export class Painter {
  /** scale of the canvas relative to the 256 master (lines and offsets scale with it) */
  constructor(
    readonly ctx: CanvasRenderingContext2D,
    readonly s = 1,
  ) {}

  private region(path: Path2D, rule: CanvasFillRule, dx: number, dy: number, fill: string | CanvasPattern): void {
    const { ctx } = this;
    ctx.save();
    ctx.clip(path, rule);
    ctx.fillStyle = fill;
    ctx.fill(outside(path, dx, dy), 'evenodd');
    ctx.restore();
  }

  /** Gouache fill: mid tone, big lit side, warm saturated terminator, violet shadow crescent, rim, spec, ink. */
  fill(sh: Shape, mat: Mat, o: FillOpts = {}): void {
    const { ctx, s } = this;
    const t = tones(mat);
    const rule = o.rule ?? 'nonzero';
    const w = sh.x1 - sh.x0;
    const h = sh.y1 - sh.y0;
    const size = Math.max(2, Math.min(w, h));
    const lx = LIGHT.x;
    const ly = LIGHT.y;
    ctx.save();
    if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
    // ambient occlusion / contact shadow: the part darkens what is already painted beneath it (away from the light)
    if (o.ao !== false && mat.k !== 'glow') {
      const d = clamp(size * 0.14, 1.4 * s, 4.5 * s);
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      ctx.translate(-lx * d * 0.6, -ly * d * 0.6 + d * 0.5);
      ctx.fillStyle = 'rgba(34,20,56,0.34)';
      ctx.fill(sh.path, rule);
      ctx.restore();
    }
    if (o.under) {
      ctx.strokeStyle = t.line;
      ctx.lineWidth = (o.lw ?? 1.5) * s * 2;
      ctx.stroke(sh.path);
    }
    ctx.fillStyle = t.mid;
    ctx.fill(sh.path, rule);
    if (!o.flat && mat.k !== 'glow') {
      // 4 value steps: highlight / light / half-tone (base) / shadow (cool violet), feathered once.
      // One clip per part; each tone fills (pad rect − shifted shape) with even-odd inside that clip.
      const pad = 40 * s;
      const bx = sh.x0 - pad;
      const by = sh.y0 - pad;
      const bw = w + 2 * pad;
      const bh = h + 2 * pad;
      const base = ctx.globalAlpha;
      const paint = (dx: number, dy: number, fill: string, a = 1) => {
        const r = new Path2D();
        r.rect(bx, by, bw, bh);
        r.addPath(sh.path, new DOMMatrix([1, 0, 0, 1, dx, dy]));
        ctx.globalAlpha = base * a;
        ctx.fillStyle = fill;
        ctx.fill(r, 'evenodd');
      };
      const small = size < 7 * s;
      const sl = clamp(size * 0.5, 2 * s, 30 * s);
      const sHi = clamp(size * 0.17, 1 * s, 8 * s);
      const ss = clamp(size * 0.3 * (o.shadow ?? 1), 1.6 * s, 22 * s);
      const tb = Math.min(1.6 * s, ss * 0.4);
      ctx.save();
      ctx.clip(sh.path, rule);
      paint(-lx * sl, -ly * sl, t.lit);
      if (!small) {
        paint(-lx * sHi, -ly * sHi, t.hi, 0.75);
        paint(lx * (ss + tb), ly * (ss + tb), t.term, 0.55);
        paint(lx * ss * 0.72, ly * ss * 0.72, t.shd, 0.5);
      }
      paint(lx * ss, ly * ss, t.shd);
      if (!small) {
        // soft form gradient across the shape (painterly blend between the hard steps)
        const gr = ctx.createLinearGradient(sh.x1, sh.y0, sh.x0, sh.y1);
        gr.addColorStop(0, 'rgba(255,226,186,0.12)');
        gr.addColorStop(0.55, 'rgba(255,226,186,0)');
        gr.addColorStop(1, 'rgba(40,24,72,0.2)');
        ctx.globalAlpha = base;
        ctx.fillStyle = gr;
        ctx.fillRect(sh.x0 - 2, sh.y0 - 2, w + 4, h + 4);
      }
      if (o.rim !== false) {
        const rw = clamp(size * 0.08, 0.8 * s, 2 * s);
        paint(-lx * rw, -ly * rw, t.rim, 0.55);
      }
      ctx.restore();
      if (o.grain && size > DETAIL * s) this.grain(sh, rule, o.grain, t.line);
      if (o.folds && size > DETAIL * 0.7 * s) this.lines(sh, rule, o.folds, t.shd, 1.4 * s);
      if (o.sheen) this.lines(sh, rule, o.sheen, mix(t.lit, '#ffffff', 0.3), 1.6 * s);
      if (mat.k === 'metal' || mat.k === 'glass') this.spec(sh, rule, mat.k === 'glass');
      if (mat.k === 'metal' && size > DETAIL * 1.4 * s) this.scratches(sh, rule, t.line, mat.c);
      if (o.stitch && size > DETAIL * 1.2 * s) this.stitch(sh, rule, mix(mat.c, '#fff0d0', 0.45));
    } else if (mat.k === 'glow') {
      ctx.save();
      ctx.clip(sh.path, rule);
      const cx = (sh.x0 + sh.x1) / 2;
      const cy = (sh.y0 + sh.y1) / 2;
      ctx.fillStyle = t.lit;
      ctx.beginPath();
      ctx.ellipse(cx + w * 0.08, cy - h * 0.08, w * 0.3, h * 0.3, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    const lw = (o.lw ?? 1.5) * s * INNER_LW;
    if (lw > 0 && !o.under && size > 3.2 * s) {
      ctx.strokeStyle = t.line;
      ctx.lineWidth = lw;
      ctx.stroke(sh.path);
    }
    ctx.restore();
  }

  /** a few fine scratches on metal */
  private scratches(sh: Shape, rule: CanvasFillRule, dark: string, base: string): void {
    const { ctx, s } = this;
    const w = sh.x1 - sh.x0;
    const h = sh.y1 - sh.y0;
    const seed = Math.floor(sh.x0 * 7 + sh.y0 * 13);
    ctx.save();
    ctx.clip(sh.path, rule);
    ctx.lineWidth = 0.7 * s;
    for (let i = 0; i < 3; i++) {
      const x = sh.x0 + w * hash(seed + i);
      const y = sh.y0 + h * hash(seed + i * 3 + 1);
      const l = Math.min(w, h) * 0.35;
      ctx.strokeStyle = i % 2 ? dark : mix(base, '#ffffff', 0.5);
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + l * 0.8, y + l * 0.3);
      ctx.stroke();
    }
    ctx.restore();
  }

  private spec(sh: Shape, rule: CanvasFillRule, glass: boolean): void {
    const { ctx, s } = this;
    const w = sh.x1 - sh.x0;
    const h = sh.y1 - sh.y0;
    ctx.save();
    ctx.clip(sh.path, rule);
    if (glass) {
      // refraction: dark band hugging the lit edge inside, bright caustic on the shadow edge
      ctx.clip(outside(sh.path, -LIGHT.x * 3.5 * s, -LIGHT.y * 3.5 * s), 'evenodd');
      ctx.restore();
      this.region(sh.path, rule, LIGHT.x * 5 * s, LIGHT.y * 5 * s, 'rgba(255,255,255,0.55)');
      ctx.save();
      ctx.clip(sh.path, rule);
      ctx.strokeStyle = SPEC;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.5 * s, Math.min(w, h) * 0.09);
      ctx.beginPath();
      ctx.moveTo(sh.x0 + w * 0.35, sh.y0 + h * 0.75);
      ctx.lineTo(sh.x0 + w * 0.62, sh.y0 + h * 0.28);
      ctx.moveTo(sh.x0 + w * 0.58, sh.y0 + h * 0.8);
      ctx.lineTo(sh.x0 + w * 0.74, sh.y0 + h * 0.52);
      ctx.stroke();
      ctx.restore();
      return;
    }
    // one specular highlight: short streak inside the lit edge
    const r = Math.max(1.2 * s, Math.min(w, h) * 0.13);
    ctx.fillStyle = SPEC;
    ctx.beginPath();
    ctx.ellipse(sh.x0 + w * 0.68, sh.y0 + h * 0.3, r * (w > h ? 1.8 : 0.9), r * (w > h ? 0.9 : 1.8), 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  private grain(sh: Shape, rule: CanvasFillRule, dir: { x: number; y: number }, color: string): void {
    const { ctx, s } = this;
    const l = Math.hypot(dir.x, dir.y) || 1;
    const ux = dir.x / l;
    const uy = dir.y / l;
    const cx = (sh.x0 + sh.x1) / 2;
    const cy = (sh.y0 + sh.y1) / 2;
    const span = Math.max(sh.x1 - sh.x0, sh.y1 - sh.y0);
    ctx.save();
    ctx.clip(sh.path, rule);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.1 * s;
    for (let i = -2; i <= 2; i++) {
      const off = i * 3.2 * s;
      ctx.beginPath();
      ctx.moveTo(cx - ux * span - uy * off, cy - uy * span + ux * off);
      ctx.quadraticCurveTo(cx + uy * 1.5 * s * (i % 2 ? 1 : -1) - uy * off, cy - ux * 1.5 * s - ux * 0 + ux * off, cx + ux * span - uy * off, cy + uy * span + ux * off);
      ctx.stroke();
    }
    ctx.restore();
  }

  private lines(sh: Shape, rule: CanvasFillRule, polylines: { x: number; y: number }[][], color: string, w: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.clip(sh.path, rule);
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    for (const pl of polylines) {
      ctx.beginPath();
      pl.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    }
    ctx.restore();
  }

  private stitch(sh: Shape, rule: CanvasFillRule, color: string): void {
    const { ctx, s } = this;
    if (sh.pts.length < 3) return;
    const cx = (sh.x0 + sh.x1) / 2;
    const cy = (sh.y0 + sh.y1) / 2;
    const inset = 3.2 * s;
    const pts = sh.pts.map((p) => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const d = Math.hypot(dx, dy) || 1;
      return { x: p.x - (dx / d) * inset, y: p.y - (dy / d) * inset };
    });
    ctx.save();
    ctx.clip(sh.path, rule);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 * s;
    ctx.setLineDash([2.2 * s, 2.2 * s]);
    ctx.stroke(smoothPath(pts));
    ctx.restore();
  }

  /** Rope / string / thread: ink underlay + colour line. */
  rope(pts: { x: number; y: number }[], color: string, w: number, ink = true): void {
    const { ctx, s } = this;
    if (pts.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const path = new Path2D();
    pts.forEach((p, i) => (i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)));
    if (ink) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = w * s + 2.4 * s;
      ctx.stroke(path);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = w * s;
    ctx.stroke(path);
    ctx.restore();
  }

  /** Thin detail line (inner ink line, crease). */
  line(pts: { x: number; y: number }[], color = INK, w = 1.6): void {
    const { ctx, s } = this;
    if (pts.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = w * s;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.restore();
  }

  dot(x: number, y: number, rx: number, ry: number, color: string, rot = 0): void {
    const { ctx } = this;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.3, rx), Math.max(0.3, ry), rot, 0, TAU);
    ctx.fill();
  }
}

// ------------------------------------------------------------------------------------------------ part list
export interface Part {
  d: number;
  draw: (p: Painter) => void;
}

/** Collects parts in 3D, projects them with the current view, sorts by depth and paints. */
export class Stage {
  readonly parts: Part[] = [];
  /** main weapon tip and grip (character space), set by weapon props: the smear arc on the strike frame follows it */
  tip: { tip: V3; grip: V3 } | null = null;
  constructor(readonly view: View) {}

  p(v: V3): P2 {
    return project(this.view, v);
  }
  /** Signed facing of a char-space direction toward the viewer (>0 = faces the camera). */
  faces(n: V3): number {
    const o = project({ ...this.view, cx: 0, cy: 0, k: 1, lift: 0 }, [0, 0, 0]);
    const e = project({ ...this.view, cx: 0, cy: 0, k: 1, lift: 0 }, n);
    return e.d - o.d;
  }
  r(radius: number): number {
    return radius * this.view.k;
  }
  depth(anchor: V3): number {
    return project(this.view, anchor).d;
  }
  add(anchor: V3, bias: number, draw: (p: Painter) => void): void {
    this.parts.push({ d: this.depth(anchor) + bias, draw });
  }

  hull(pts: V3[]): Shape {
    const pp = pts.map((q) => this.p(q));
    const h = hull2(pp);
    return shapeFrom(h, smoothPath(h));
  }
  poly(pts: V3[], smooth = false): Shape {
    const pp = pts.map((q) => this.p(q));
    return shapeFrom(pp, smooth ? smoothPath(pp) : polyPath(pp));
  }
  capsule(a: V3, b: V3, ra: number, rb = ra): Shape {
    return capsule2(this.p(a), this.p(b), ra * this.view.k, rb * this.view.k);
  }
  sphere(c: V3, r: number): Shape {
    const q = this.p(c);
    const rr = r * this.view.k;
    const path = new Path2D();
    path.arc(q.x, q.y, rr, 0, TAU);
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < 16; i++) pts.push({ x: q.x + Math.cos((i / 16) * TAU) * rr, y: q.y + Math.sin((i / 16) * TAU) * rr });
    return { path, x0: q.x - rr, y0: q.y - rr, x1: q.x + rr, y1: q.y + rr, pts };
  }
  pts2(pts: V3[]): { x: number; y: number }[] {
    return pts.map((q) => this.p(q));
  }

  render(p: Painter): void {
    this.parts.sort((a, b) => a.d - b.d);
    for (const part of this.parts) part.draw(p);
  }
}

/** Points of an ellipse ring in a basis (local y = cy). */
export function ring(b: Basis, cy: number, rx: number, rz: number, n = 14, cz = 0, cx = 0): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    out.push(at(b, [cx + Math.sin(a) * rx, cy, cz + Math.cos(a) * rz]));
  }
  return out;
}
export function box(b: Basis, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): V3[] {
  const out: V3[] = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) out.push(at(b, [x, y, z]));
  return out;
}
/** Deterministic hash noise. */
export function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
