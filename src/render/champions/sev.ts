// Sev Aschenblick props (agent E, Fassung 3): crows circling him (they scatter outward on casts and attacks), a crow
// hovering over the open palm, red eyes with a slowly turning three-blade pattern (own design, no comma shapes),
// tear-trough lines, long front strands and a long low ponytail, the high collar with crimson inner rim, a three-ring
// necklace and grey crow-feather marks on the dark cloak. 64 px read: long-haired cloaked figure with crows.
import { add, at, lerp3, m, madd, ring, sub, TAU, type Basis, type Painter, type V3 } from './core';
import type { PropCtx } from './types';

export const SEV_CRIMSON = '#9a1826';
const EYE_RED = '#e0242c';
const CROW = '#141018';
const CROW_EDGE = '#3c3446';
const HAIR = '#08070b';
const CLOAK = '#1c1a22';
const FEATHER = '#6a6670';

/** A small crow seen from above/side: body, head, beak, two flapping wings. (x, y) screen, s = size in px. */
function crow(p: Painter, x: number, y: number, s: number, flap: number, dir: number): void {
  const c = Math.cos(dir);
  const sn = Math.sin(dir);
  const P = (u: number, v: number) => ({ x: x + u * c - v * sn, y: y + u * sn + v * c });
  const ctx = p.ctx;
  ctx.save();
  // wings: two curved blades that rise and fall with the flap
  const lift = 0.35 + flap * 0.65;
  for (const side of [1, -1]) {
    const w = new Path2D();
    const root = P(0.1 * s, 0);
    const tip = P(-0.25 * s, side * 1.25 * s * lift + side * 0.25 * s);
    const mid = P(0.35 * s, side * 0.75 * s * lift);
    w.moveTo(root.x, root.y);
    w.quadraticCurveTo(mid.x, mid.y, tip.x, tip.y);
    const back = P(-0.35 * s, side * 0.2 * s);
    w.quadraticCurveTo(back.x, back.y, root.x, root.y);
    ctx.fillStyle = CROW;
    ctx.fill(w);
    ctx.strokeStyle = CROW_EDGE;
    ctx.lineWidth = Math.max(0.8, s * 0.08);
    ctx.stroke(w);
  }
  // body + tail + head + beak
  const body = P(0, 0);
  p.dot(body.x, body.y, s * 0.5, s * 0.26, CROW, dir);
  const tail = new Path2D();
  const t0 = P(-0.4 * s, 0);
  const t1 = P(-0.95 * s, 0.22 * s);
  const t2 = P(-0.95 * s, -0.22 * s);
  tail.moveTo(t0.x, t0.y);
  tail.lineTo(t1.x, t1.y);
  tail.lineTo(t2.x, t2.y);
  tail.closePath();
  ctx.fillStyle = CROW;
  ctx.fill(tail);
  const head = P(0.55 * s, 0);
  p.dot(head.x, head.y, s * 0.22, s * 0.22, CROW);
  const b0 = P(0.72 * s, -0.08 * s);
  const b1 = P(1.0 * s, 0);
  const b2 = P(0.72 * s, 0.08 * s);
  const beak = new Path2D();
  beak.moveTo(b0.x, b0.y);
  beak.lineTo(b1.x, b1.y);
  beak.lineTo(b2.x, b2.y);
  ctx.fillStyle = '#4a4048';
  ctx.fill(beak);
  const eye = P(0.6 * s, -0.06 * s);
  p.dot(eye.x, eye.y, s * 0.06, s * 0.06, EYE_RED);
  ctx.restore();
}

/** Crows circling Sev at shoulder height; on cast/attack (pose.glow / act) they scatter outward. */
export function crowRing(c: PropCtx): void {
  const { st, rig, pose } = c;
  const scatter = Math.max(pose.glow, Math.abs(pose.act) * 0.6);
  const n = 3;
  for (let i = 0; i < n; i++) {
    const a = pose.t * TAU * 0.5 + (i * TAU) / n;
    const R = 34 + scatter * 26 + (i === 1 ? 6 : 0);
    const h = 18 + i * 9 + Math.sin(pose.t * TAU + i) * 4 + scatter * 10;
    const o: V3 = add(rig.chest.o, [Math.cos(a) * R, h, Math.sin(a) * R]);
    const front = Math.sin(a) > 0;
    st.add(o, front ? 4.2 : -1.2, (p) => {
      const q = st.p(o);
      const nx = st.p(add(o, [-Math.sin(a) * 5, 0, Math.cos(a) * 5]));
      const dir = Math.atan2(nx.y - q.y, nx.x - q.x);
      crow(p, q.x, q.y, 6.5 * st.view.k, 0.5 + 0.5 * Math.sin(pose.t * TAU * 4 + i * 2), dir);
    });
  }
}

/** A crow hovering over the open right palm (the casting hand). */
export function palmCrow(c: PropCtx): void {
  const { st, rig, pose } = c;
  const o = madd(rig.handR.o, [0, 1, 0], 13 + Math.sin(pose.t * TAU) * 2 + pose.glow * 5);
  st.add(o, 3.9, (p) => {
    const q = st.p(o);
    crow(p, q.x, q.y, 7.5 * st.view.k, 0.5 + 0.5 * Math.sin(pose.t * TAU * 3), -0.3);
  });
}

/** Red eyes with a slowly turning three-blade pattern (straight tapered blades) and tear-trough lines. */
export function genjutsuEyes(c: PropCtx): void {
  const { st, rig, pose } = c;
  const H = rig.head;
  const r = rig.body.headR;
  const front = st.faces(H.z);
  if (front < 0.05) return;
  st.add(H.o, 0.62, (p) => {
    const k = st.view.k;
    const s = Math.min(1, 0.35 + front);
    for (const side of [1, -1]) {
      const e = st.p(at(H, [side * 0.36 * r, -0.04 * r, 0.95 * r]));
      p.dot(e.x, e.y, r * 0.17 * k * s, r * 0.12 * k, EYE_RED);
      const rot = pose.t * TAU * 0.25;
      for (let i = 0; i < 3; i++) {
        const a = rot + (i * TAU) / 3;
        p.line([{ x: e.x, y: e.y }, { x: e.x + Math.cos(a) * r * 0.13 * k * s, y: e.y + Math.sin(a) * r * 0.1 * k }], '#1a0406', 0.9 * k);
      }
      p.dot(e.x, e.y, r * 0.035 * k, r * 0.035 * k, '#1a0406');
      if (pose.glow > 0.3) {
        p.ctx.save();
        p.ctx.globalAlpha = 0.55;
        p.dot(e.x, e.y, r * 0.32 * k, r * 0.2 * k, '#ff6a5a');
        p.ctx.restore();
      }
      // tear-trough line under the eye
      const t0 = st.p(at(H, [side * 0.2 * r, -0.2 * r, 0.96 * r]));
      const t1 = st.p(at(H, [side * 0.34 * r, -0.36 * r, 0.9 * r]));
      p.line([t0, t1], '#5a4048', 1 * k);
    }
  });
}

/** Long front strands framing the face and a long low ponytail down the back (sways with the cloak). */
export function longHair(c: PropCtx): void {
  const { st, rig, pose } = c;
  const H = rig.head;
  const r = rig.body.headR;
  const hm = m(HAIR, 'hair');
  // ponytail: from the nape down between the shoulder blades
  const sw = pose.sway;
  const a = at(H, [0, -r * 0.55, -r * 0.92]);
  const b = at(H, [0, -r * 1.9, -r * (1.25 + sw * 0.6)]);
  const cc = at(H, [0, -r * 3.4, -r * (1.35 + sw * 1.4)]);
  st.add(madd(H.o, H.z, -r * 1.2), -0.15, (p) => {
    p.fill(st.capsule(a, b, r * 0.24, r * 0.2), hm, { lw: 1.5 });
    p.fill(st.capsule(b, cc, r * 0.2, r * 0.08), hm, { lw: 1.5 });
    const tie = st.p(a);
    p.dot(tie.x, tie.y, r * 0.14 * st.view.k, r * 0.1 * st.view.k, SEV_CRIMSON);
  });
  // front strands: from the temples past the cheeks to the jaw
  for (const side of [1, -1]) {
    const top = at(H, [side * 0.5 * r, 0.6 * r, 0.8 * r]);
    const mid = at(H, [side * 0.78 * r, -0.2 * r, 0.75 * r]);
    const end = at(H, [side * 0.8 * r, -1.25 * r, 0.62 * r]);
    st.add(H.o, 0.68, (p) => {
      if (st.faces(H.z) < -0.3) return;
      p.fill(st.capsule(top, mid, r * 0.14, r * 0.12), hm, { lw: 1.3, rim: false });
      p.fill(st.capsule(mid, end, r * 0.12, r * 0.05), hm, { lw: 1.3, rim: false });
    });
  }
}

/** High collar up to the chin (cloak colour, crimson inner rim), only the front half rises. */
export function highCollar(c: PropCtx): void {
  const { st, rig } = c;
  const H = rig.head;
  const r = rig.body.headR;
  const fwd = (q: V3): number => (q[0] - H.o[0]) * H.z[0] + (q[1] - H.o[1]) * H.z[1] + (q[2] - H.o[2]) * H.z[2];
  st.add(H.o, 0.66, (p) => {
    const lo = ring(H, -r * 1.75, r * 1.05, r * 1.0, 20);
    const hi = ring(H, -r * 1.0, r * 0.98, r * 0.95, 20).filter((q) => fwd(q) > r * 0.1);
    p.fill(st.hull([...lo, ...hi]), m(CLOAK, 'cloth'), { lw: 1.8 });
    if (hi.length > 1) p.line(st.pts2(hi.sort((a2, b2) => sideOf(H, a2) - sideOf(H, b2))), SEV_CRIMSON, 1.4 * st.view.k);
  });
}
const sideOf = (H: Basis, q: V3): number => (q[0] - H.o[0]) * H.x[0] + (q[1] - H.o[1]) * H.x[1] + (q[2] - H.o[2]) * H.x[2];

/** Three-ring necklace below the collar (front only). */
export function ringNecklace(c: PropCtx): void {
  const { st, rig } = c;
  const b = rig.body;
  if (st.faces(rig.chest.z) < 0.1) return;
  const pts: V3[] = [-1, 0, 1].map((i) => at(rig.chest, [i * 4.5, 4 - Math.abs(i) * 1.5, b.chestD + 2]));
  st.add(pts[1]!, 0.9, (p) => {
    const k = st.view.k;
    p.line(st.pts2([at(rig.chest, [-9, 8, b.chestD + 1]), ...pts, at(rig.chest, [9, 8, b.chestD + 1])]), '#5a5660', 1 * k);
    for (const q of pts) {
      const s = st.p(q);
      p.ctx.save();
      p.ctx.strokeStyle = '#b8b4c0';
      p.ctx.lineWidth = 1.4 * k;
      p.ctx.beginPath();
      p.ctx.arc(s.x, s.y, 2.1 * k, 0, TAU);
      p.ctx.stroke();
      p.ctx.restore();
    }
  });
}

/** Coat skirt hem frame (same formula as humanoid.ts drawBody). */
function hemOf(c: PropCtx): { hemB: Basis; hw: number; hz: number } {
  const { rig, pose, kit } = c;
  const b = rig.body;
  const coat = kit.outfit.coat!;
  const kneeAvg = lerp3(rig.knL, rig.knR, 0.5);
  const hemY = -(rig.thigh * coat.len) - 2;
  const legShift = sub(kneeAvg, at(rig.pelvis, [0, -rig.thigh, 0]));
  const hemC = add(at(rig.pelvis, [0, hemY, -pose.sway * coat.len * 10]), [legShift[0] * 0.5, 0, legShift[2] * 0.6]);
  return { hemB: { ...rig.pelvis, o: hemC }, hw: b.hipW + 3 + coat.flare * coat.len * 9 + b.belly * 6, hz: b.chestD + 2 + coat.flare * coat.len * 7 + b.belly * 6 };
}

/** Crimson lining showing at the hem (the side facing the camera). */
export function crimsonHem(c: PropCtx): void {
  const { st } = c;
  const { hemB, hw, hz } = hemOf(c);
  st.add(hemB.o, 1.55, (p) => {
    const pts = ring(hemB, 1.2, hw * 0.98, hz * 0.98, 28).filter((q) => st.faces(sub(q, hemB.o)) > 0);
    if (pts.length < 2) return;
    pts.sort((a, b) => sideOf(hemB, a) - sideOf(hemB, b));
    p.line(st.pts2(pts), SEV_CRIMSON, 3 * st.view.k);
  });
}

/** Grey crow-feather marks on the cloak skirt (pointed leaf shapes with a quill line). */
export function featherMarks(c: PropCtx): void {
  const { st, rig } = c;
  const b = rig.body;
  const { hemB, hw, hz } = hemOf(c);
  for (const [ang, u, rot] of [[-0.55, 0.5, 0.4], [0.5, 0.7, -0.5], [0.05, 0.88, 0.2], [2.6, 0.55, 0.3], [-2.5, 0.4, -0.3], [1.6, 0.6, 0.6], [-1.5, 0.78, -0.6]] as [number, number, number][]) {
    const top = at(rig.pelvis, [Math.sin(ang) * (b.hipW + 2.5), -2, Math.cos(ang) * (b.chestD + 1.5)]);
    const bot = at(hemB, [Math.sin(ang) * hw, 0, Math.cos(ang) * hz]);
    const out: V3 = [Math.sin(ang) * rig.pelvis.x[0] + Math.cos(ang) * rig.pelvis.z[0], Math.sin(ang) * rig.pelvis.x[1] + Math.cos(ang) * rig.pelvis.z[1], Math.sin(ang) * rig.pelvis.x[2] + Math.cos(ang) * rig.pelvis.z[2]];
    if (st.faces(out) < 0.15) continue;
    const o = madd(lerp3(top, bot, u), out, 0.8);
    st.add(o, 1.6, (p) => {
      const q = st.p(o);
      const k = st.view.k;
      const L = 7 * k;
      const ca = Math.cos(rot - Math.PI / 2);
      const sa = Math.sin(rot - Math.PI / 2);
      const tip = { x: q.x + ca * L, y: q.y + sa * L };
      const base = { x: q.x - ca * L, y: q.y - sa * L };
      const nx = -sa * 2.2 * k;
      const ny = ca * 2.2 * k;
      const path = new Path2D();
      path.moveTo(base.x, base.y);
      path.quadraticCurveTo(q.x + nx, q.y + ny, tip.x, tip.y);
      path.quadraticCurveTo(q.x - nx, q.y - ny, base.x, base.y);
      p.ctx.save();
      p.ctx.fillStyle = FEATHER;
      p.ctx.globalAlpha = 0.85;
      p.ctx.fill(path);
      p.ctx.restore();
      p.line([base, tip], '#3a3640', 0.8 * k);
    });
  }
}
