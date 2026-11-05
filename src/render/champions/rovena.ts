// Rovena Aderlass props (mid blood mage, "the Bloodletter"): a ring of six curved bone thorns standing up from the brow
// (the 64 px silhouette: a spiky crown on a slim robed figure), three blood orbs circling her chest (pulse on casts) and
// blood drops falling from the right hand. The robe and the tattered crimson cape come from the kit outfit.
import { add, at, madd, mix, TAU, type V3 } from './core';
import { glowOrb } from './props';
import type { PropCtx } from './types';

const BONE = '#e8dcc4';
const BONE_SHADE = '#8a7a64';
const BLOOD = '#c0182a';

/** Six curved bone thorns rising from a ring round the head, bending outward; they spread on casts. */
export function thornCrown(c: PropCtx): void {
  const { st, rig, pose } = c;
  const H = rig.head;
  const r = rig.body.headR;
  const spread = 1 + pose.glow * 0.35;
  for (let i = 0; i < 6; i++) {
    const a = (i * TAU) / 6 + 0.3;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const pts: V3[] = [];
    for (let k = 0; k <= 4; k++) {
      const u = k / 4;
      const out = (0.78 + u * u * 0.95 * spread) * r;
      pts.push(at(H, [dx * out, (0.55 + u * (i % 2 ? 1.5 : 1.95)) * r, dz * out]));
    }
    const mid = pts[2]!;
    const front = dz > 0;
    st.add(mid, front ? 0.9 : -0.9, (p) => {
      const k = st.view.k;
      const q = st.pts2(pts);
      p.line(q, BONE_SHADE, 3.4 * k);
      p.line(q, BONE, 2.1 * k);
      p.line(q.slice(-2), BONE, 1.2 * k);
      p.dot(q[q.length - 1]!.x, q[q.length - 1]!.y, 1.1 * k, 1.1 * k, mix(BLOOD, '#ffffff', 0.15));
    });
  }
}

/** Three blood orbs orbiting at chest height; brighter and wider while casting. */
export function bloodOrbs(c: PropCtx): void {
  const { st, rig, pose } = c;
  const pulse = Math.max(pose.glow, Math.abs(pose.act) * 0.5);
  for (let i = 0; i < 3; i++) {
    const a = pose.t * TAU * 0.6 + (i * TAU) / 3;
    const R = 30 + pulse * 18;
    const h = 8 + i * 8 + Math.sin(pose.t * TAU * 1.5 + i * 2) * 3;
    const o: V3 = add(rig.chest.o, [Math.cos(a) * R, h, Math.sin(a) * R]);
    st.add(o, Math.sin(a) > 0 ? 4.1 : -1.1, (p) => glowOrb(st, p, o, 3.4 + pulse * 1.6, BLOOD, 0.8 + pulse * 0.5));
  }
}

/** Blood drops falling from the right hand, a thin trail of three. */
export function bloodDrips(c: PropCtx): void {
  const { st, rig, pose } = c;
  for (let i = 0; i < 3; i++) {
    const u = (pose.t * 1.4 + i / 3) % 1;
    const o = madd(rig.handR.o, [0, 1, 0], -u * 26 - 2);
    st.add(o, 3.6, (p) => {
      const q = st.p(o);
      const k = st.view.k;
      p.ctx.save();
      p.ctx.globalAlpha = 1 - u * 0.7;
      p.dot(q.x, q.y, 1.5 * k, 2.3 * k, BLOOD);
      p.ctx.restore();
    });
  }
}
