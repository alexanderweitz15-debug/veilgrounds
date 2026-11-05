// Truda Sporenhauch props (mid control mage, "the Spore Hexer"): a huge red spotted mushroom cap worn as a hat, a
// gnarled staff with a small glowing mushroom, a cluster of toadstools growing from her back and drifting spore motes.
// 64 px read: hunched figure under a wide red dome (the widest head silhouette of the roster).
import { at, frameYZ, m, madd, mix, ring, TAU, type V3 } from './core';
import { aimW, glowOrb } from './props';
import type { PropCtx } from './types';

const CAP = m('#b8383a', 'cloth');
const CAP_UNDER = m('#e8d6b4', 'cloth');
const STEM = m('#e6dcc0', 'wood');
const SPORE = '#c8f08a';
const STAFF = m('#5a4630', 'wood');

/** Wide domed cap on the head: gills underneath, white spots on top. Sags a little when she runs. */
export function mushroomCap(c: PropCtx): void {
  const { st, rig, pose } = c;
  const H = rig.head;
  const r = rig.body.headR;
  const f = frameYZ(at(H, [0, r * 0.55, 0]), [0, 1, 0], rig.chest.z);
  const droop = pose.sway * 0.12;
  st.add(f.o, 0.9, (p) => {
    // gills (pale underside ring) then the dome
    p.fill(st.hull([...ring(f, -r * 0.1, r * 2.3, r * 2.3, 14), ...ring(f, r * 0.2, r * 2.1, r * 2.1, 14)]), CAP_UNDER, { lw: 1.4 });
    p.fill(st.hull([...ring(f, r * 0.1, r * 2.35, r * 2.35, 14), ...ring(f, r * (0.75 - droop), r * 1.9, r * 1.9, 14), ...ring(f, r * (1.25 - droop), r * 1.1, r * 1.1, 12), ...ring(f, r * (1.5 - droop), r * 0.4, r * 0.4, 8)]), CAP, { lw: 1.8 });
    for (const [a, rad, y] of [[0.3, 1.55, 0.95], [1.7, 1.7, 0.85], [2.9, 1.5, 0.95], [4.2, 1.65, 0.8], [5.3, 1.45, 0.95], [0, 0.5, 1.4]] as const) {
      const q = st.p(at(f, [Math.sin(a) * r * rad, r * (y - droop), Math.cos(a) * r * rad]));
      p.dot(q.x, q.y, 2.9 * st.view.k, 2.2 * st.view.k, '#f4ead2');
    }
  });
}

/** Gnarled staff in the right hand, a small glowing toadstool on top; a puff of spores on cast. */
export function sporeStaff(c: PropCtx): void {
  const { st, rig, pose } = c;
  const dir = aimW(c);
  const base = madd(rig.handR.o, dir, -48);
  const top = madd(rig.handR.o, dir, 96);
  st.add(rig.handR.o, 3.0, (p) => {
    p.fill(st.capsule(base, top, 3.2, 2.2), STAFF, { lw: 1.3 });
    const f = frameYZ(top, [0, 1, 0], rig.chest.z);
    p.fill(st.hull([...ring(f, 0, 2.4, 2.4, 8), ...ring(f, 8, 2, 2, 8)]), STEM, { lw: 1 });
    p.fill(st.hull([...ring(f, 6, 9, 9, 10), ...ring(f, 12, 6, 6, 10), ...ring(f, 15, 1.5, 1.5, 6)]), m('#d6593a', 'glow'), { lw: 1.4 });
    glowOrb(st, p, at(f, [0, 13, 0]), 3.2, SPORE, 0.7 + pose.glow * 0.8);
  });
}

/** Three toadstools of different size growing from the upper back. */
export function backShrooms(c: PropCtx): void {
  const { st, rig, pose } = c;
  const c0 = rig.chest;
  for (const [x, y, h, w] of [[-9, 8, 15, 9], [7, 14, 22, 12], [-2, 2, 9, 7]] as const) {
    const o = at(c0, [x, y, -(rig.body.chestD + 1)]);
    const f = frameYZ(o, [Math.sin(pose.t * TAU) * 0.05 + x * 0.01, 1, -0.2 - pose.sway * 0.2], c0.z);
    st.add(o, -0.4, (p) => {
      p.fill(st.hull([...ring(f, 0, 2.2, 2.2, 8), ...ring(f, h, 1.6, 1.6, 8)]), STEM, { lw: 1 });
      p.fill(st.hull([...ring(f, h - 2, w, w, 10), ...ring(f, h + 3, w * 0.6, w * 0.6, 8), ...ring(f, h + 5, 1, 1, 6)]), m(mix('#c9553a', '#8a3a44', x > 0 ? 0 : 0.5), 'cloth'), { lw: 1.4 });
    });
  }
}

/** Spore motes rising and drifting round the body. */
export function sporeMotes(c: PropCtx): void {
  const { st, rig, pose } = c;
  for (let i = 0; i < 7; i++) {
    const u = (pose.t * 0.8 + i / 7) % 1;
    const a = i * 2.4 + pose.t * TAU * 0.5;
    const o: V3 = at(rig.pelvis, [Math.sin(a) * (26 + (i % 3) * 7), 6 + u * 120, Math.cos(a) * (18 + (i % 2) * 8)]);
    st.add(o, 3.6, (p) => {
      const q = st.p(o);
      p.ctx.save();
      p.ctx.globalAlpha = 0.9 * (1 - u);
      p.dot(q.x, q.y, (1.5 + (i % 3) * 0.5) * st.view.k, (1.5 + (i % 3) * 0.5) * st.view.k, SPORE);
      p.ctx.restore();
    });
  }
}
