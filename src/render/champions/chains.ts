// Kerrin Fesselschatten props (jungle assassin, "the Chain Shade"): a mantle of chain loops across the shoulders and chest,
// iron manacles with dangling links on both wrists and a hook-blade in the right hand whose chain trails to the left
// hand (thrown out on attack and cast). 64 px read: slim hooded figure criss-crossed by bright chain, a hook on a line.
import { add, at, frameYZ, lerp3, m, madd, mix, norm, scl, sub, TAU, type V3 } from './core';
import { aimW, bladePts, glowOrb } from './props';
import type { PropCtx } from './types';

const LINK = '#aeb8c2';
const LINK_DARK = '#5a626c';
const IRON = m('#4a4f58', 'metal');
const HOOK_STEEL = m('#c9d2da', 'metal');
const GLOW = '#9a7cff';

/** Points of a sagging chain from a to b (character space). */
function chainPts(a: V3, b: V3, sag: number, n = 9): V3[] {
  const out: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    out.push(add(lerp3(a, b, u), [0, -sag * Math.sin(u * Math.PI), 0]));
  }
  return out;
}

/** Draw a chain as a dark rope with bright link dots. */
function drawChain(c: PropCtx, pts: V3[], w: number): void {
  const { st } = c;
  const q = st.pts2(pts);
  const k = st.view.k;
  return void st.add(lerp3(pts[0]!, pts[pts.length - 1]!, 0.5), 3.1, (p) => {
    p.rope(q, LINK_DARK, w * 1.5);
    q.forEach((s, i) => p.dot(s.x, s.y, (i % 2 ? 1.6 : 2.1) * k * (w / 2.4), 1.4 * k * (w / 2.4), LINK));
  });
}

/** Two chain loops crossed over the chest plus a sagging loop at the belt; sways with running. */
export function chainMantle(c: PropCtx): void {
  const { rig, pose } = c;
  const f = rig.body.chestD + 3.5;
  const front = (v: V3): V3 => madd(v, rig.chest.z, f);
  const sag = 5 + pose.sway * 3;
  drawChain(c, chainPts(front(madd(rig.shL, [0, 3, 0], 1)), front(lerp3(rig.hipR, rig.pelvis.o, 0.3)), sag), 2.4);
  drawChain(c, chainPts(front(madd(rig.shR, [0, 3, 0], 1)), front(lerp3(rig.hipL, rig.pelvis.o, 0.3)), sag), 2.4);
  drawChain(c, chainPts(madd(rig.hipL, rig.chest.z, 5), madd(rig.hipR, rig.chest.z, 5), 9 + pose.sway * 4, 8), 2.2);
}

/** Iron cuffs on both wrists, each with a short hanging chain that swings. */
export function wristManacles(c: PropCtx): void {
  const { st, rig, pose } = c;
  for (const [wr, s] of [[rig.wrL, -1], [rig.wrR, 1]] as const) {
    const swing = Math.sin(pose.t * TAU * (pose.anim === 'run' ? 2 : 1) + s) * 4 + pose.sway * 5;
    st.add(wr, 3.6, (p) => p.fill(st.sphere(wr, 6.4), IRON, { lw: 1.5 }));
    const end = madd(madd(wr, [0, 1, 0], -24), rig.chest.x, swing * s);
    drawChain(c, chainPts(wr, end, 3, 5), 1.8);
  }
}

/** Hook blade in the right hand on a chain to the left hand; it flies out along the aim on attack / cast. */
export function hookBlade(c: PropCtx): void {
  const { st, rig, pose } = c;
  const hand = rig.handR.o;
  const out = pose.anim === 'attack' ? Math.max(0, pose.act) : pose.anim === 'cast' ? pose.glow : 0;
  const dir = aimW(c);
  const tip = madd(madd(hand, dir, 18 + out * 70), [0, 1, 0], 2);
  // chain from the left hand to the hook
  drawChain(c, chainPts(rig.handL.o, add(hand, scl(dir, out * 20)), 7 - out * 5, 8), 2);
  const b = frameYZ(hand, norm(sub(tip, hand)), rig.chest.z);
  st.add(lerp3(hand, tip, 0.6), 3.5, (p) => {
    p.fill(st.capsule(madd(hand, dir, -5), madd(hand, dir, 5), 2.4, 2.4), m('#2a2228', 'leather'), { lw: 1.2, rim: false });
    // curved hook blade: a wide crescent with a barb
    p.fill(st.poly(bladePts({ ...b, o: at(b, [0, 5, 0]) }, 36 + out * 14, 7, 1.6, 0.7)), HOOK_STEEL, { lw: 1.6 });
    p.fill(st.poly([at(b, [0, 34 + out * 14, 0]), at(b, [-5.5, 28 + out * 14, 0]), at(b, [0, 24 + out * 14, 0])], true), m(mix('#c9d2da', '#7a8590', 0.3), 'metal'), { lw: 1.2 });
  });
  if (pose.glow > 0.3) st.add(tip, 3.9, (p) => glowOrb(st, p, tip, 3 + pose.glow * 2, GLOW, pose.glow));
}
