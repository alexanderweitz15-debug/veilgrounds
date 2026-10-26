// Fenna Staubflügel props (support, "the Dusk Moth"): four dusty moth wings on the back with dusk-violet eye-spots, two
// feathery antennae, a small gold flame hovering over the right hand (Chosen Flame) and a glowing thread that trails
// from the left hand (the Lightbond). 64 px read: slim figure with a wide wing triangle behind her and two antennae.
import { at, lerp3, m, madd, mix, TAU, type V3 } from './core';
import { backFrame, glowOrb } from './props';
import type { PropCtx } from './types';

export const FENNA_DUST = '#b79c74';
const WING_EDGE = '#efe2c4';
const EYE_SPOT = '#4a3a78';
const THREAD = '#ffd98a';
const FLAME = '#ffc65a';

/** One wing pair side: outline in the back frame (x out to the side, y up, z backwards), spread opens it. */
const UPPER: V3[] = [[3, 6, 0], [14, 30, 4], [38, 54, 9], [66, 68, 14], [78, 48, 15], [72, 30, 13], [58, 20, 10], [50, 10, 8], [28, 2, 3]];
const LOWER: V3[] = [[3, 2, 0], [28, 0, 3], [54, -4, 9], [64, -24, 12], [50, -42, 11], [32, -34, 7], [18, -24, 4], [5, -10, 1]];

/** Four dusty wings behind the shoulders: idle flutter, swept back when running, wide open when casting. */
export function mothWings(c: PropCtx): void {
  const { st, rig, pose } = c;
  const bk = backFrame(rig, 2, 0);
  const flutter = Math.sin(pose.t * TAU * 2) * 0.05;
  const spread = 0.04 + flutter + pose.glow * 0.3 + Math.abs(pose.act) * 0.12 - pose.sway * 0.22;
  const wing = (pts: V3[], s: number): V3[] => pts.map(([x, y, z]) => at(bk, [s * x * (1 + spread), y, z * (1 + spread * 1.3)]));
  for (const s of [1, -1]) {
    for (const [pts, big] of [[LOWER, false], [UPPER, true]] as const) {
      const w = wing(pts, s);
      const mid = w[Math.floor(w.length / 2)]!;
      st.add(mid, -0.35 + (big ? 0.02 : 0), (p) => {
        const sh = st.poly(w);
        const base = m(big ? FENNA_DUST : mix(FENNA_DUST, '#6a5a78', 0.3), 'cloth');
        p.fill(sh, base, { lw: 1.6, folds: [st.pts2([w[0]!, w[2]!]), st.pts2([w[0]!, w[3]!]), st.pts2([w[0]!, w[4]!]), st.pts2([w[0]!, w[5]!])] });
        const tip = st.p(w[3]!);
        const root = st.p(w[0]!);
        const k = st.view.k;
        // eye-spot: dusk-violet ring with a cream centre two thirds out along the wing
        const ex = root.x + (tip.x - root.x) * 0.66;
        const ey = root.y + (tip.y - root.y) * 0.66;
        p.dot(ex, ey, (big ? 6 : 4.2) * k, (big ? 6 : 4.2) * k, EYE_SPOT);
        p.dot(ex, ey, (big ? 3.4 : 2.3) * k, (big ? 3.4 : 2.3) * k, WING_EDGE);
        p.line([st.p(w[1]!), tip, st.p(w[w.length - 2]!)], WING_EDGE, 1.1 * k);
      });
    }
  }
  // dust motes sifting off the wing tips
  for (let i = 0; i < 4; i++) {
    const u = (pose.t + i * 0.25) % 1;
    const s = i % 2 ? 1 : -1;
    const o = at(bk, [s * (50 + (i % 3) * 6), 30 - u * 70, 12]);
    st.add(o, -0.2, (p) => {
      const q = st.p(o);
      p.ctx.save();
      p.ctx.globalAlpha = 0.85 * (1 - u);
      p.dot(q.x, q.y, 1.3 * st.view.k, 1.3 * st.view.k, WING_EDGE);
      p.ctx.restore();
    });
  }
}

/** Two feathery antennae curving up and out of the brow, small barbs along each. */
export function antennae(c: PropCtx): void {
  const { st, rig, pose } = c;
  const H = rig.head;
  const r = rig.body.headR;
  const sway = Math.sin(pose.t * TAU) * 0.1 - pose.sway * 0.3;
  for (const s of [1, -1]) {
    const pts: V3[] = [];
    for (let i = 0; i <= 6; i++) {
      const u = i / 6;
      pts.push(at(H, [s * (0.22 + u * (0.7 + sway)) * r, (0.8 + u * 1.55 - u * u * 0.5) * r, (0.45 + u * 0.45 - u * u * 0.5) * r]));
    }
    st.add(pts[3]!, 0.7, (p) => {
      const k = st.view.k;
      const q = st.pts2(pts);
      p.line(q, '#d8c9a4', 1.5 * k);
      for (let i = 1; i < q.length; i++) {
        const a = q[i - 1]!;
        const b = q[i]!;
        const nx = -(b.y - a.y);
        const ny = b.x - a.x;
        const d = Math.hypot(nx, ny) || 1;
        const L = (3.4 - i * 0.35) * k;
        for (const sg of [1, -1]) p.line([{ x: b.x, y: b.y }, { x: b.x + (sg * nx * L) / d + (b.x - a.x) * 0.5, y: b.y + (sg * ny * L) / d + (b.y - a.y) * 0.5 }], '#efe2c4', 0.9 * k);
      }
      p.dot(q[q.length - 1]!.x, q[q.length - 1]!.y, 1.6 * k, 1.6 * k, THREAD);
    });
  }
}

/** Small gold flame hovering over the right hand; flares on cast. */
export function flameLamp(c: PropCtx): void {
  const { st, rig, pose } = c;
  const o = madd(rig.handR.o, [0, 1, 0], 15 + Math.sin(pose.t * TAU * 2) * 1.5 + pose.glow * 5);
  st.add(o, 3.9, (p) => glowOrb(st, p, o, 4.5 + pose.glow * 2.5, FLAME, 0.9 + pose.glow * 0.5));
}

/** The Lightbond: a glowing thread leaving the left hand and trailing away to the side and back, with a bead. */
export function lightThread(c: PropCtx): void {
  const { st, rig, pose } = c;
  const hand = rig.handL.o;
  const pts: V3[] = [];
  for (let i = 0; i <= 9; i++) {
    const u = i / 9;
    const wob = Math.sin(u * 6 + pose.t * TAU) * 3 * u;
    pts.push(madd(madd(madd(hand, rig.chest.x, 8 + u * 46), [0, 1, 0], -u * 6 + wob), rig.chest.z, -u * (6 + pose.sway * 24)));
  }
  st.add(lerp3(pts[4]!, pts[5]!, 0.5), 3.0, (p) => {
    const q = st.pts2(pts);
    p.line(q, mix(THREAD, '#c07a2a', 0.5), 3.4 * st.view.k);
    p.line(q, '#fff0b8', 1.8 * st.view.k);
    p.dot(q[9]!.x, q[9]!.y, 2.2 * st.view.k, 2.2 * st.view.k, '#fff4cc');
  });
}
