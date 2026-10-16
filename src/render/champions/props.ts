// Prop painters (signature items). Each prop is built from the same primitives as the body (hulls of 3D
// rings/boxes, planar polygons, ribbons) so it shades and outlines identically.
import {
  add,
  at,
  cross,
  dirOf,
  frameYZ,
  frameZY,
  INK,
  lerp3,
  m,
  madd,
  mix,
  norm,
  ring,
  box,
  scl,
  sub,
  TAU,
  shapeFrom,
  polyPath,
  type Basis,
  type Mat,
  type Painter,
  type Shape,
  type Stage,
  type V3,
} from './core';
import type { PropCtx, Rig } from './types';

// ------------------------------------------------------------------------------------------------ helpers
export const WOOD = m('#7b5530', 'wood');
export const WOOD_DARK = m('#4f3420', 'wood');
export const STEEL = m('#b9c2cc', 'metal');
export const IRON = m('#5c6068', 'metal');
export const BRASS = m('#d9a441', 'metal');
export const COPPER = m('#c06a3a', 'metal');
export const LEATHER = m('#6a4428', 'leather');
export const ROPE = '#c7ae7a';

/** Reports the main weapon (grip -> tip) for the smear arc of the strike frame; the first prop to call it wins. */
export const markTip = (c: PropCtx, grip: V3, tip: V3): void => {
  c.st.tip ??= { grip, tip };
};

/** world direction of the main-hand aim */
export const aimW = (c: PropCtx): V3 => norm(dirOf(c.rig.chest, c.pose.aim));
export const aimLW = (c: PropCtx): V3 => norm(dirOf(c.rig.chest, c.pose.aimL));
/** frame at a point whose y follows `dir` and whose z faces the character's forward */
export const along = (o: V3, dir: V3, rig: Rig): Basis => frameYZ(o, dir, rig.chest.z);
/** frame on the back of the chest (y up the spine, z pointing backwards) */
export const backFrame = (rig: Rig, up = 0, out = 0): Basis => {
  const c = rig.chest;
  return { o: at(c, [0, up, -(rig.body.chestD + 2 + out)]), x: scl(c.x, -1), y: c.y, z: scl(c.z, -1) };
};
export const hipFrame = (rig: Rig, side: number, out = 2): Basis => {
  const p = rig.pelvis;
  const o = at(p, [side * (rig.body.hipW + out + rig.body.belly * 6), 2, 0]);
  return frameYZ(o, p.y, scl(p.x, side));
};

/** Thick tapered ribbon along a 3D polyline (bows, scythes, chains, banners' poles). */
export function ribbon(st: Stage, pts: V3[], w0: number, w1: number): Shape {
  const pp = st.pts2(pts);
  const n = pp.length;
  const left: { x: number; y: number }[] = [];
  const right: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = pp[Math.max(0, i - 1)]!;
    const b = pp[Math.min(n - 1, i + 1)]!;
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    const w = ((w0 + (w1 - w0) * (i / (n - 1))) * st.view.k) / 2;
    left.push({ x: pp[i]!.x - dy * w, y: pp[i]!.y + dx * w });
    right.push({ x: pp[i]!.x + dy * w, y: pp[i]!.y - dx * w });
  }
  const all = [...left, ...right.reverse()];
  return shapeFrom(all, polyPath(all));
}

/** Flat blade in a frame: along +y, edge across x, thickness z. */
export function bladePts(b: Basis, len: number, w: number, curve = 0, tip = 0.82): V3[] {
  const pts: V3[] = [];
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const y = u * len * tip;
    const c = curve * Math.sin(u * Math.PI * 0.5) * len * 0.12;
    pts.push(at(b, [w / 2 + c, y, 0]));
  }
  pts.push(at(b, [curve * len * 0.12, len, 0]));
  for (let i = n; i >= 0; i--) {
    const u = i / n;
    const y = u * len * tip;
    const c = curve * Math.sin(u * Math.PI * 0.5) * len * 0.12;
    pts.push(at(b, [-w / 2 + c * 0.6, y, 0]));
  }
  return pts;
}

export function fillPoly(st: Stage, p: Painter, pts: V3[], mat: Mat, o: Parameters<Painter['fill']>[2] = {}): Shape {
  const sh = st.poly(pts);
  p.fill(sh, mat, o);
  return sh;
}

/** Hull of a box in a frame. */
export function fillBox(st: Stage, p: Painter, b: Basis, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: Mat, o: Parameters<Painter['fill']>[2] = {}): Shape {
  const sh = st.poly(boxOutline(st, box(b, x0, x1, y0, y1, z0, z1)));
  p.fill(sh, mat, o);
  return sh;
}
function boxOutline(st: Stage, pts: V3[]): V3[] {
  // convex hull in screen space, returned as 3D points in hull order
  const pp = pts.map((q, i) => ({ ...st.p(q), i }));
  const sorted = pp.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cr = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: typeof pp = [];
  for (const q of sorted) {
    while (lo.length >= 2 && cr(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop();
    lo.push(q);
  }
  const up: typeof pp = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const q = sorted[i]!;
    while (up.length >= 2 && cr(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop();
    up.push(q);
  }
  lo.pop();
  up.pop();
  return [...lo, ...up].map((q) => pts[q.i]!);
}

/** Cylinder / barrel hull between two rings along the frame's y. */
export function cyl(st: Stage, b: Basis, y0: number, y1: number, r0: number, r1: number, n = 14): Shape {
  return st.hull([...ring(b, y0, r0, r0, n), ...ring(b, y1, r1, r1, n)]);
}

/** Glow halo + core (opaque; the game uses alphaTest so no soft alpha). */
export function glowOrb(st: Stage, p: Painter, c: V3, r: number, color: string, power = 1): void {
  if (power <= 0.05) return;
  const q = st.p(c);
  const k = st.view.k;
  const R = r * k * (0.7 + power * 0.5);
  p.ctx.save();
  p.ctx.globalAlpha = 0.85;
  p.dot(q.x, q.y, R * 1.35, R * 1.35, mix(color, '#ffffff', 0.15));
  p.ctx.globalAlpha = 1;
  p.dot(q.x, q.y, R, R, mix(color, '#ffffff', 0.45));
  p.dot(q.x, q.y, R * 0.5, R * 0.5, '#ffffff');
  // four-point sparkle
  p.line([{ x: q.x - R * 2, y: q.y }, { x: q.x + R * 2, y: q.y }], mix(color, '#ffffff', 0.6), 1.6);
  p.line([{ x: q.x, y: q.y - R * 2 }, { x: q.x, y: q.y + R * 2 }], mix(color, '#ffffff', 0.6), 1.6);
  p.ctx.restore();
}

/** Ring with a hole (spools, wheels, bell mouths) in the plane of frame x/y. */
export function donut(st: Stage, b: Basis, rOut: number, rIn: number, mat: Mat, p: Painter, depth = 3): void {
  const outer = st.hull([...ring(frameZY(b.o, b.z, b.y), -depth, rOut, rOut, 24).map((q) => q), ...ring(frameZY(b.o, b.z, b.y), depth, rOut, rOut, 24)]);
  const innerPts = st.pts2(ringFlat(b, rIn, 20));
  const path = new Path2D();
  path.addPath(outer.path);
  innerPts.forEach((q, i) => (i ? path.lineTo(q.x, q.y) : path.moveTo(q.x, q.y)));
  path.closePath();
  p.fill({ ...outer, path }, mat, { rule: 'evenodd' });
}
function ringFlat(b: Basis, r: number, n: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    out.push(at(b, [Math.cos(a) * r, Math.sin(a) * r, 0]));
  }
  return out;
}
/** circle of points in the frame's x/y plane */
export const disc = ringFlat;

// ------------------------------------------------------------------------------------------------ Mira: long recurve bow + quiver
export function bowProp(c: PropCtx, o: { len: number; mat: Mat; fire?: boolean; grip?: Mat }): void {
  const { st, rig, pose } = c;
  const hb = rig.handL;
  const bf = frameYZ(hb.o, aimLW(c), rig.chest.z);
  const L = o.len;
  const pts: V3[] = [];
  const n = 12;
  const draw = Math.max(0, pose.act);
  for (let i = 0; i <= n; i++) {
    const u = (i / n) * 2 - 1;
    const bulge = (1 - u * u) * (7 + draw * 6);
    const recurve = Math.pow(Math.abs(u), 6) * 9;
    pts.push(at(bf, [0, u * L * 0.5, bulge - 4 + recurve]));
  }
  const top = pts[n]!;
  const bot = pts[0]!;
  const pull = draw > 0 ? rig.handR.o : lerp3(top, bot, 0.5);
  st.add(hb.o, 3.2, (p) => {
    // string first (behind the limbs)
    p.line(st.pts2([top, madd(pull, bf.z, 0), bot]), '#efe6cf', 1.3);
    p.fill(ribbon(st, pts.slice(0, n / 2 + 1), 3.2, 5.6), o.mat, { grain: undefined });
    p.fill(ribbon(st, pts.slice(n / 2), 5.6, 3.2), o.mat);
    // grip wrap
    p.fill(ribbon(st, [pts[n / 2 - 1]!, pts[n / 2 + 1]!], 6.4, 6.4), o.grip ?? LEATHER, { lw: 1.4 });
    if (draw > 0.1) {
      const tip = madd(pull, bf.z, 46);
      p.line(st.pts2([madd(pull, bf.z, -2), tip]), '#d8c49a', 1.8);
      const head = st.poly([madd(tip, bf.z, 6), madd(tip, bf.x, 2.2), madd(tip, bf.x, -2.2)]);
      p.fill(head, o.fire ? m('#ff9a40', 'glow') : STEEL, { lw: 1.2 });
      if (o.fire) glowOrb(st, p, madd(tip, bf.z, 4), 3, '#ffb060', 0.9);
    }
  });
}

export function quiver(c: PropCtx, o: { mat: Mat; fletch: string; tilt?: number; smoulder?: boolean }): void {
  const { st, rig } = c;
  const bk = backFrame(rig, -10, 2);
  const tilt = o.tilt ?? 0.35;
  const up = norm(add(scl(bk.y, Math.cos(tilt)), scl(bk.x, Math.sin(tilt))));
  const qf = frameYZ(bk.o, up, bk.z);
  st.add(madd(bk.o, bk.z, 4), 0, (p) => {
    // arrow fletchings sticking out of the top
    for (let i = 0; i < 4; i++) {
      const base = at(qf, [(i - 1.5) * 2.6, 22, (i % 2) * 1.5]);
      const tip = at(qf, [(i - 1.5) * 3.2, 33 + (i % 2) * 3, (i % 2) * 1.5]);
      p.fill(st.poly([base, at(qf, [(i - 1.5) * 2.6 + 2.2, 28, 0]), tip, at(qf, [(i - 1.5) * 2.6 - 2.2, 28, 0])]), m(o.fletch), { lw: 1.2, rim: false });
    }
    const sh = cyl(st, qf, -24, 24, 6.2, 7.2);
    p.fill(sh, o.mat, { stitch: o.mat.k === 'leather' });
    const band = cyl(st, qf, 14, 18, 7.4, 7.4);
    p.fill(band, BRASS, { lw: 1.4 });
    if (o.smoulder) glowOrb(st, p, at(qf, [0, 26, 0]), 3.5, '#ff8a3a', 0.8);
  });
}

// ------------------------------------------------------------------------------------------------ Renn: seven blades fanned on the back
export function bladeFan(c: PropCtx): void {
  const { st, rig } = c;
  const bk = backFrame(rig, -8, 3);
  st.add(madd(bk.o, bk.z, 3), 0.2, (p) => {
    const blades: { b: Basis; a: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const a = (-72 + i * 24) * (Math.PI / 180);
      const dir = norm(add(scl(bk.y, Math.cos(a)), scl(bk.x, Math.sin(a))));
      blades.push({ b: frameYZ(madd(bk.o, bk.z, i * 0.25), dir, bk.z), a });
    }
    // draw outer blades first so the middle one sits on top
    blades.sort((x, y) => Math.abs(y.a) - Math.abs(x.a));
    for (const { b } of blades) {
      const grip = st.capsule(at(b, [0, 6, 0]), at(b, [0, 22, 0]), 2.4, 2.2);
      p.fill(grip, m('#2a2228', 'leather'), { lw: 1.4, rim: false });
      p.fill(st.poly(bladePts({ ...b, o: at(b, [0, 26, 0]) }, 66, 6.2, 1)), STEEL, { lw: 1.6 });
      p.fill(st.hull([at(b, [-5.5, 23, -1.5]), at(b, [5.5, 23, -1.5]), at(b, [5.5, 26, 1.5]), at(b, [-5.5, 26, 1.5])]), BRASS, { lw: 1.4 });
    }
    // the strap harness hub
    p.fill(st.sphere(bk.o, 6), m('#5a3a2a', 'leather'), { lw: 1.6 });
  });
}

export function heldBlade(c: PropCtx, o: { len: number; w: number; curve: number; mat?: Mat; off?: boolean }): void {
  const { st, rig } = c;
  const hand = o.off ? rig.handL : rig.handR;
  const dir = o.off ? aimLW(c) : aimW(c);
  const b = frameYZ(hand.o, dir, cross(dir, rig.chest.y));
  if (!o.off) markTip(c, hand.o, madd(hand.o, dir, o.len + 6));
  st.add(madd(hand.o, dir, 6), 3.3, (p) => {
    p.fill(st.capsule(madd(hand.o, dir, -6), madd(hand.o, dir, 4), 2.3, 2.3), m('#2a2228', 'leather'), { lw: 1.3, rim: false });
    p.fill(st.hull([at(b, [-5.5, 4, -1.4]), at(b, [5.5, 4, -1.4]), at(b, [5.5, 6.5, 1.4]), at(b, [-5.5, 6.5, 1.4])]), BRASS, { lw: 1.3 });
    p.fill(st.poly(bladePts({ ...b, o: at(b, [0, 6, 0]) }, o.len, o.w, o.curve)), o.mat ?? STEEL, { lw: 1.6 });
  });
}

// ------------------------------------------------------------------------------------------------ Hagen / Oda: yoke with bell / buckets
export function yoke(c: PropCtx, o: { left: 'bell' | 'bucket'; right: 'bell' | 'bucket'; bellMat?: Mat; water?: boolean; span?: number }): void {
  const { st, rig, pose } = c;
  const ch = rig.chest;
  const span = o.span ?? rig.body.shW + 30;
  const y = 5;
  const bar: V3[] = [];
  for (let i = 0; i <= 8; i++) {
    const u = (i / 8) * 2 - 1;
    bar.push(at(ch, [u * span, y + (1 - u * u) * 4 - Math.abs(u) * 2, -2]));
  }
  st.add(at(ch, [0, y, -3]), 1.6, (p) => {
    p.fill(ribbon(st, bar, 7.5, 7.5), WOOD, { grain: { x: 1, y: 0 } });
    // neck notch pad
    p.fill(st.hull([...ring({ ...ch, o: at(ch, [0, y + 1, -2]) }, 0, 10, 8, 10), ...ring({ ...ch, o: at(ch, [0, y + 4, -2]) }, 0, 8, 7, 10)]), LEATHER, { lw: 1.6 });
  });
  const hang = (side: number, kind: 'bell' | 'bucket') => {
    const end = at(ch, [side * (span - 3), y - 2, -2]);
    const swing = kind === 'bell' ? pose.act * 0.5 * side * -1 : -pose.sway * 0.25;
    const down: V3 = norm([Math.sin(swing) * 0.6, -1, -Math.sin(swing) * 0.5 + (pose.sway > 0 ? 0.25 * pose.sway : 0)]);
    const ropeL = kind === 'bell' ? 14 : 26;
    const top = madd(end, down, ropeL);
    const f = frameYZ(top, scl(down, -1), ch.z);
    st.add(madd(top, down, 12), 1.0 + (kind === 'bell' ? 0.3 : 0), (p) => {
      p.line(st.pts2([end, top]), INK, 3.2);
      p.line(st.pts2([end, top]), ROPE, 1.6);
      if (kind === 'bell') {
        const bm = o.bellMat ?? m('#c99a3a', 'metal');
        const B = 1.3;
        const sh = st.hull([...ring(f, -2, 7 * B, 7 * B, 14), ...ring(f, -10 * B, 12 * B, 12 * B, 16), ...ring(f, -24 * B, 15 * B, 15 * B, 18), ...ring(f, -32 * B, 21 * B, 21 * B, 20), ...ring(f, -35 * B, 21.5 * B, 21.5 * B, 20)]);
        p.fill(sh, bm);
        // lip of the bell: visible front band + the dark mouth when seen from below
        p.fill(st.hull([...ring(f, -30 * B, 21.6 * B, 21.6 * B, 20), ...ring(f, -34 * B, 22 * B, 22 * B, 20)]), { c: mix(bm.c, '#000000', 0.15), k: 'metal' }, { lw: 1.6 });
        // engraved band
        p.line(st.pts2(ring(f, -20 * B, 14.5 * B, 14.5 * B, 20).filter((q) => st.faces(norm(sub(q, at(f, [0, -20 * B, 0])))) > 0).sort((a2, b2) => st.p(a2).x - st.p(b2).x)), mix(bm.c, INK, 0.6), 1.4);
        p.fill(st.sphere(at(f, [0, -38 * B, 0]), 4.8), IRON, { lw: 1.4 });
        p.fill(st.capsule(at(f, [0, 2, 0]), at(f, [0, -3, 0]), 4, 4), IRON, { lw: 1.4 });
      } else {
        const sh = st.hull([...ring(f, -4, 12, 12, 16), ...ring(f, -26, 10, 10, 16)]);
        p.fill(sh, WOOD, { grain: { x: 0, y: 1 } });
        for (const hy of [-8, -21]) p.fill(st.hull([...ring(f, hy, 11.8 + (hy === -8 ? 0 : -1), 12, 16), ...ring(f, hy - 2.5, 11.6 + (hy === -8 ? 0 : -1), 11.8, 16)]), IRON, { lw: 1.2, rim: false });
        // handle arc
        p.line(st.pts2([at(f, [-11, -4, 0]), at(f, [-6, 3, 0]), at(f, [0, 4.5, 0]), at(f, [6, 3, 0]), at(f, [11, -4, 0])]), INK, 2.2);
        if (o.water && st.faces(f.y) > -0.2) {
          const w = st.hull(ring(f, -5, 10.5, 10.5, 14));
          p.fill(w, m('#6fa0c8', 'glass'), { lw: 1.2, rim: false });
        }
      }
    });
  };
  hang(1, o.left);
  hang(-1, o.right);
}

// ------------------------------------------------------------------------------------------------ Isolde: glass shard arm + wire spool
export function glassArm(c: PropCtx): void {
  const { st, rig } = c;
  const el = rig.elR;
  const hand = rig.handR;
  const dir = norm(sub(hand.o, el));
  const b = frameYZ(el, dir, rig.chest.z);
  markTip(c, hand.o, madd(hand.o, dir, 52));
  st.add(madd(hand.o, dir, 10), 3.5, (p) => {
    // gauntlet of glass shards encasing the forearm and running out into a long blade
    const shard = (o: V3, d: V3, l: number, w: number, side: number) => {
      const bb = frameYZ(o, d, rig.chest.z);
      return [at(bb, [w * 0.5 * side, 0, 0]), at(bb, [w * 0.6, l * 0.55, 0]), at(bb, [0, l, 0]), at(bb, [-w * 0.6, l * 0.4, 0]), at(bb, [-w * 0.4, 0, 0])];
    };
    p.fill(st.poly(shard(at(b, [0, 4, 0]), norm(add(dir, scl(rig.chest.y, 0.25))), 32, 12, 1)), m('#a9d8df', 'glass'), { alpha: 0.92 });
    p.fill(st.poly(shard(at(b, [0, 14, 0]), dir, 78, 14, -1)), m('#cfe9ee', 'glass'), { alpha: 0.95 });
    p.fill(st.poly(shard(at(b, [2, 20, 0]), norm(add(dir, scl(rig.chest.y, -0.3))), 26, 8, 1)), m('#b7dde6', 'glass'), { alpha: 0.92 });
    // copper wire wraps
    for (const u of [6, 12, 18]) {
      const q = at(b, [0, u, 0]);
      p.fill(st.hull(ring(frameYZ(q, dir, rig.chest.z), 0, 6.2, 6.2, 10).concat(ring(frameYZ(q, dir, rig.chest.z), 1.6, 6.2, 6.2, 10))), COPPER, { lw: 1.2, rim: false });
    }
  });
}

export function wireSpool(c: PropCtx, o: { side?: number; r?: number } = {}): void {
  const { st, rig } = c;
  const bk = backFrame(rig, -4, 5);
  const side = o.side ?? 1;
  const center = at(bk, [-side * 10, 10, 0]);
  const f: Basis = { o: center, x: bk.x, y: bk.y, z: bk.z };
  const R = o.r ?? 22;
  st.add(madd(center, bk.z, 4), 0.1, (p) => {
    donut(st, f, R, R * 0.48, COPPER, p, 5);
    // wire turns
    for (let i = 0; i < 3; i++) {
      const pts = disc({ ...f, o: madd(center, f.z, 5.5) }, R * (0.6 + i * 0.12), 18);
      p.line(st.pts2([...pts, pts[0]!]), mix('#c06a3a', '#ffd0a0', 0.3), 1.1);
    }
    // loose wire end
    p.line(st.pts2([at(f, [R, 0, 2]), at(f, [R + 10, -14, 4]), at(f, [R + 4, -30, 2])]), '#c06a3a', 1.5);
  });
  // small coils on the hips
  for (const s of [1, -1]) {
    const hf = hipFrame(rig, s, 3);
    st.add(hf.o, 0.8, (p) => {
      const ff: Basis = { o: hf.o, x: rig.pelvis.z, y: rig.pelvis.y, z: hf.z };
      donut(st, ff, 7, 3.4, COPPER, p, 2.5);
    });
  }
}

// a small reused helper for straps that go over a shoulder to a back item
export function shoulderStrap(st: Stage, rig: Rig, mat: Mat, side = 1): void {
  st.add(at(rig.chest, [side * rig.body.shW * 0.5, 0, rig.body.chestD]), 0.45, (p) => {
    const a = at(rig.chest, [side * (rig.body.shW - 5), 2, rig.body.chestD * 0.3]);
    const b = at(rig.chest, [side * (rig.body.shW - 9), -16, rig.body.chestD + 1]);
    const e = at(rig.chest, [side * (rig.body.shW - 12), -30, rig.body.chestD + 0.5]);
    if (st.faces(rig.chest.z) > 0) p.fill(ribbon(st, [a, b, e], 4, 4), mat, { lw: 1.4 });
  });
}

export const vec = { add, sub, scl, madd, lerp3, norm, cross };
