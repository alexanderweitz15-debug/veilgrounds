// Hedda Fellwechsel props (jungle shapeshifter, "the Shapeshifter"): a long bone-tipped hunting spear with a feather
// tassel in the right hand and a necklace of curved claws on the chest. The cat ears, ringed tail and spotted pelt cape
// come from the humanoid outfit. 64 px read: tall spear, long ringed tail, pointy ears.
import { at, frameYZ, m, madd, ring, TAU } from './core';
import { aimW } from './props';
import type { PropCtx } from './types';

const SHAFT = m('#6a4a2c', 'wood');
const BONE = m('#eee4cc', 'metal');
const TASSEL = '#d87a2a';
const CLAW = '#f0e6cc';

/** Hunting spear: long haft, leaf-shaped bone head, a feather tassel that flutters. */
export function huntSpear(c: PropCtx): void {
  const { st, rig, pose } = c;
  const dir = aimW(c);
  const base = madd(rig.handR.o, dir, -56);
  const top = madd(rig.handR.o, dir, 112);
  st.add(rig.handR.o, 3.0, (p) => {
    p.fill(st.capsule(base, top, 2.2, 1.9), SHAFT, { lw: 1.2 });
    const f = frameYZ(top, dir, rig.chest.z);
    p.fill(st.hull([...ring(f, -2, 3.2, 3.2, 8), ...ring(f, 8, 4.4, 1.6, 8), ...ring(f, 22, 0.8, 0.5, 6)]), BONE, { lw: 1.3 });
    const tip = madd(top, dir, -6);
    const sway = Math.sin(pose.t * TAU * 2) * 3;
    const q = st.p(tip);
    const e = st.p([tip[0] + sway, tip[1] - 14, tip[2]]);
    p.line([q, e], TASSEL, 3 * st.view.k);
  });
}

/** Necklace of curved claws on the upper chest. */
export function clawNecklace(c: PropCtx): void {
  const { st, rig } = c;
  for (let i = -2; i <= 2; i++) {
    const o = at(rig.chest, [i * 4.2, 10 - Math.abs(i) * 1.6, rig.body.chestD + 1]);
    st.add(o, 1.4, (p) => {
      const a = st.p(o);
      const b = st.p(at(rig.chest, [i * 4.6, 5.2 - Math.abs(i) * 1.6, rig.body.chestD + 1.6]));
      p.line([a, b], CLAW, 2 * st.view.k);
    });
  }
}
