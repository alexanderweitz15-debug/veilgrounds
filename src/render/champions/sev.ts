// Sev Aschenblick props (agent E): floating ember eye over the open palm (the 64 px feature), the left eye's copper
// glow with a three-armed crack, the collar up to the nose, the copper hem and grey ash swirls on the coat.
// Black ember = near-black body with a copper-red core (docs/champions/sev.md: no borrowed flame or eye shapes).
import { add, at, lerp3, m, madd, mix, ring, sub, TAU, type Basis, type Painter, type V3 } from './core';
import type { PropCtx } from './types';

export const SEV_COPPER = '#c8582e';
const EMBER_CORE = '#ff7a3c';
const EMBER_BLACK = '#17121a';
const COAL = '#2a282e';
const ASH = '#a8a29c';

/** Three jagged arms from the centre (120 degrees apart): the crack instead of a pupil. */
function crack(p: Painter, x: number, y: number, r: number, color: string, w: number, rot: number): void {
  for (let i = 0; i < 3; i++) {
    const a = rot + (i / 3) * TAU;
    const mid = a + 0.35;
    p.line(
      [
        { x, y },
        { x: x + Math.cos(mid) * r * 0.5, y: y + Math.sin(mid) * r * 0.5 },
        { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r },
      ],
      color,
      w,
    );
  }
}

/** Small ember eye hovering above the right palm; it circles slowly and flares on cast/attack. */
export function emberEye(c: PropCtx): void {
  const { st, rig, pose } = c;
  const ph = pose.t * TAU;
  const lift = 22 + Math.sin(ph) * 2.5 + pose.glow * 4;
  const o: V3 = madd(madd(madd(rig.handR.o, [0, 1, 0], lift), rig.chest.x, Math.cos(ph) * 3), rig.chest.z, Math.sin(ph) * 3 + 2);
  st.add(o, 3.9, (p) => {
    const q = st.p(o);
    const k = st.view.k;
    const R = (7 + pose.glow * 2) * k;
    // copper heat halo, black ember lids (almond), copper-red iris, black three-armed crack
    p.ctx.save();
    p.ctx.globalAlpha = 0.55 + pose.glow * 0.35;
    p.dot(q.x, q.y, R * 1.7, R * 1.25, mix(EMBER_CORE, '#ffd8a0', 0.25));
    p.ctx.restore();
    const lid = new Path2D();
    lid.moveTo(q.x - R * 1.5, q.y);
    lid.quadraticCurveTo(q.x, q.y - R * 1.15, q.x + R * 1.5, q.y);
    lid.quadraticCurveTo(q.x, q.y + R * 1.15, q.x - R * 1.5, q.y);
    p.ctx.fillStyle = EMBER_BLACK;
    p.ctx.fill(lid);
    p.dot(q.x, q.y, R * 0.92, R * 0.86, mix(SEV_COPPER, '#000000', 0.05));
    p.dot(q.x, q.y, R * 0.66, R * 0.62, EMBER_CORE);
    p.dot(q.x - R * 0.2, q.y - R * 0.2, R * 0.2, R * 0.16, '#ffe2b8');
    crack(p, q.x, q.y, R * 0.8, EMBER_BLACK, 1.6 * k, 0.5 + ph * 0.25);
    // three soot specks drifting up around the eye
    for (let i = 0; i < 3; i++) {
      const a = ph + (i * TAU) / 3;
      p.dot(q.x + Math.cos(a) * R * 1.6, q.y - R * 0.6 - ((pose.t * 3 + i / 3) % 1) * R * 1.4, R * 0.16, R * 0.16, EMBER_BLACK);
    }
  });
}

/** Left eye: copper-red glow with a three-armed crack (the right eye stays plain). */
export function crackedEye(c: PropCtx): void {
  const { st, rig, pose } = c;
  const H = rig.head;
  const r = rig.body.headR;
  const front = st.faces(H.z);
  if (front < 0.05) return;
  st.add(H.o, 0.62, (p) => {
    const e = st.p(at(H, [0.36 * r, -0.04 * r, 0.95 * r]));
    const k = st.view.k;
    const s = Math.min(1, 0.35 + front);
    p.dot(e.x, e.y, r * 0.22 * k * s, r * 0.15 * k, EMBER_CORE);
    p.dot(e.x, e.y, r * 0.11 * k * s, r * 0.08 * k, '#ffd0a0');
    crack(p, e.x, e.y, r * 0.16 * k, '#3a0e08', 1.1 * k, 0.3);
    if (pose.glow > 0.3) {
      p.ctx.save();
      p.ctx.globalAlpha = 0.6;
      p.dot(e.x, e.y, r * 0.36 * k, r * 0.22 * k, mix(EMBER_CORE, '#ffffff', 0.3));
      p.ctx.restore();
    }
  });
}

/** High collar up to the nose (charcoal) with a copper rim; only the front half rises (the camera looks down). */
export function noseCollar(c: PropCtx): void {
  const { st, rig } = c;
  const H = rig.head;
  const r = rig.body.headR;
  const fwd = (q: V3): number => (q[0] - H.o[0]) * H.z[0] + (q[1] - H.o[1]) * H.z[1] + (q[2] - H.o[2]) * H.z[2];
  st.add(H.o, 0.66, (p) => {
    const lo = ring(H, -r * 1.45, r * 0.98, r * 0.95, 20);
    const hi = ring(H, -r * 0.42, r * 1.05, r * 1.03, 20).filter((q) => fwd(q) > r * 0.15);
    p.fill(st.hull([...lo, ...hi]), m(COAL, 'cloth'), { lw: 1.8 });
    if (hi.length > 1) p.line(st.pts2(hi.sort((a, b) => sideOf(H, a) - sideOf(H, b))), SEV_COPPER, 2.2 * st.view.k);
  });
}
const sideOf = (H: Basis, q: V3): number => (q[0] - H.o[0]) * H.x[0] + (q[1] - H.o[1]) * H.x[1] + (q[2] - H.o[2]) * H.x[2];

/** Hem frame of the coat skirt (same formula as humanoid.ts drawBody) and its half widths. */
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

/** Copper hem band along the visible bottom edge of the floor-length coat. */
export function copperHem(c: PropCtx): void {
  const { st } = c;
  const { hemB, hw, hz } = hemOf(c);
  st.add(hemB.o, 1.55, (p) => {
    const pts = ring(hemB, 1.5, hw * 0.99, hz * 0.99, 28);
    const facing = pts.filter((q) => st.faces(sub(q, hemB.o)) > 0);
    if (facing.length < 2) return;
    facing.sort((a, b) => sideOf(hemB, a) - sideOf(hemB, b));
    p.line(st.pts2(facing), SEV_COPPER, 3 * st.view.k);
  });
}

/** Grey ash swirls (open spirals) on the chest and the coat skirt, on the side that faces the camera. */
export function ashSwirls(c: PropCtx): void {
  const { st, rig } = c;
  const b = rig.body;
  const { hemB, hw, hz } = hemOf(c);
  const swirl = (o: V3, ax: V3, ay: V3, size: number, bias: number, turn: number): void => {
    st.add(o, bias, (p) => {
      const pts: V3[] = [];
      for (let i = 0; i <= 16; i++) {
        const a = turn + (i / 16) * TAU * 1.5;
        const rr = size * (0.15 + (i / 16) * 0.85);
        pts.push(madd(madd(o, ax, Math.cos(a) * rr), ay, Math.sin(a) * rr));
      }
      p.line(st.pts2(pts), ASH, 1.5 * st.view.k);
    });
  };
  // skirt: points between the waist ring and the hem at a few angles around the body
  for (const [ang, u, size] of [[-0.5, 0.45, 5], [0.55, 0.7, 6], [0.1, 0.9, 4.5], [2.6, 0.6, 5.5], [-2.4, 0.35, 5], [1.6, 0.5, 4.5], [-1.5, 0.75, 5]] as [number, number, number][]) {
    const top = at(rig.pelvis, [Math.sin(ang) * (b.hipW + 2.5), -2, Math.cos(ang) * (b.chestD + 1.5)]);
    const bot = at(hemB, [Math.sin(ang) * hw, 0, Math.cos(ang) * hz]);
    const o = lerp3(top, bot, u);
    const out: V3 = [Math.sin(ang) * rig.pelvis.x[0] + Math.cos(ang) * rig.pelvis.z[0], Math.sin(ang) * rig.pelvis.x[1] + Math.cos(ang) * rig.pelvis.z[1], Math.sin(ang) * rig.pelvis.x[2] + Math.cos(ang) * rig.pelvis.z[2]];
    if (st.faces(out) < 0.15) continue;
    const tangent: V3 = [Math.cos(ang) * rig.pelvis.x[0] - Math.sin(ang) * rig.pelvis.z[0], Math.cos(ang) * rig.pelvis.x[1] - Math.sin(ang) * rig.pelvis.z[1], Math.cos(ang) * rig.pelvis.x[2] - Math.sin(ang) * rig.pelvis.z[2]];
    swirl(madd(o, out, 0.8), tangent, rig.pelvis.y, size, 1.6, ang * 2);
  }
  // chest (front and back)
  for (const [x, y, side] of [[-6, -6, 1], [6, -16, 1], [5, -4, -1], [-6, -18, -1]] as [number, number, number][]) {
    const n: V3 = [rig.chest.z[0] * side, rig.chest.z[1] * side, rig.chest.z[2] * side];
    if (st.faces(n) < 0.15) continue;
    swirl(at(rig.chest, [x, y, side * (b.chestD + 1.2)]), rig.chest.x, rig.chest.y, 4.5, 0.75, x);
  }
}
