// Ysmay Degenfeld props (top parry duelist, "the Fencing Master"): a long red plume on the tricorn, a thin rapier with a
// brass cup guard in the right hand and a short parrying dagger in the left. 64 px read: slim fencer with a tall
// swooping plume and a very long thin blade (no other champion has a plume + needle).
import { at, cross, frameYZ, m, madd, TAU, type V3 } from './core';
import { aimLW, aimW, bladePts, BRASS, markTip } from './props';
import type { PropCtx } from './types';

const PLUME = '#c0283a';
const PLUME_TIP = '#f0d8d0';
const STEEL = m('#d4dae2', 'metal');

/** Long feather arching back from the hat, swaying with the run. */
export function plume(c: PropCtx): void {
  const { st, rig, pose } = c;
  const H = rig.head;
  const r = rig.body.headR;
  const lift = 0.5 + pose.sway * 0.5;
  const pts: V3[] = [];
  for (let i = 0; i <= 6; i++) {
    const u = i / 6;
    pts.push(at(H, [r * 0.5 + Math.sin(pose.t * TAU + u * 3) * r * 0.1 * u, r * (1.6 + u * 1.3 * (1 - 0.3 * lift)), -r * (0.2 + u * 2.4 * lift)]));
  }
  st.add(pts[3]!, 0.9, (p) => {
    const q = st.pts2(pts);
    const k = st.view.k;
    p.line(q, PLUME, 4.2 * k);
    p.line(q.slice(3), PLUME_TIP, 1.6 * k);
  });
}

function blade(c: PropCtx, off: boolean): void {
  const { st, rig } = c;
  const hand = off ? rig.handL : rig.handR;
  const dir = off ? aimLW(c) : aimW(c);
  const len = off ? 34 : 104;
  const b = frameYZ(hand.o, dir, cross(dir, rig.chest.y));
  if (!off) markTip(c, hand.o, madd(hand.o, dir, len + 8));
  st.add(madd(hand.o, dir, 8), 3.3, (p) => {
    p.fill(st.capsule(madd(hand.o, dir, -6), madd(hand.o, dir, 4), 2, 2), m('#2a2228', 'leather'), { lw: 1.2, rim: false });
    // cup guard
    p.fill(st.hull([at(b, [-7, 5, -3]), at(b, [7, 5, -3]), at(b, [7, 5, 3]), at(b, [-7, 5, 3]), at(b, [0, 8, 0])]), BRASS, { lw: 1.2 });
    p.fill(st.poly(bladePts({ ...b, o: at(b, [0, 6, 0]) }, len, off ? 3.2 : 2.2, 0)), STEEL, { lw: 1.2 });
  });
}

/** Rapier in the right hand (long and thin). */
export function rapier(c: PropCtx): void {
  blade(c, false);
}

/** Parrying dagger in the left hand. */
export function parryDagger(c: PropCtx): void {
  blade(c, true);
}
