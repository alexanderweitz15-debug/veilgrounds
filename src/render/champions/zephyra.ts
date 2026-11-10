// Zephyra Weitblick props (mid global mage, "the Stargazer"): a long brass telescope used as a staff with a glowing lens
// at the top and a ring of small floating stars orbiting her shoulders. 64 px read: robed figure with a long brass tube
// and a halo of tiny stars (the stars orbit wider than any other champion's effect).
import { at, frameYZ, m, madd, ring, TAU } from './core';
import { aimW, BRASS } from './props';
import type { PropCtx } from './types';

const TUBE = m('#c8a04a', 'metal');
const TUBE_DARK = m('#7a5a28', 'metal');
const STAR = '#cfe0ff';

/** Telescope in the right hand: three brass sections of falling width, a glowing lens at the top. */
export function telescope(c: PropCtx): void {
  const { st, rig, pose } = c;
  const dir = aimW(c);
  const hand = rig.handR.o;
  const a = madd(hand, dir, -40);
  const b = madd(hand, dir, 30);
  const t = madd(hand, dir, 104);
  st.add(hand, 3.0, (p) => {
    p.fill(st.capsule(a, b, 3.4, 3), TUBE, { lw: 1.3 });
    p.fill(st.capsule(b, t, 2.6, 2.2), TUBE, { lw: 1.2 });
    const f = frameYZ(b, dir, rig.chest.z);
    p.fill(st.hull([...ring(f, -1, 3.8, 3.8, 8), ...ring(f, 2, 3.8, 3.8, 8)]), BRASS, { lw: 1 });
    const g = frameYZ(t, dir, rig.chest.z);
    p.fill(st.hull([...ring(g, 0, 3.4, 3.4, 8), ...ring(g, 5, 4.6, 4.6, 8)]), TUBE_DARK, { lw: 1.2 });
    const q = st.p(madd(t, dir, 5.5));
    p.ctx.save();
    p.ctx.globalAlpha = 0.7 + 0.3 * pose.glow;
    p.dot(q.x, q.y, 2.8 * st.view.k, 2.8 * st.view.k, '#bfe0ff');
    p.ctx.restore();
  });
}

/** Seven small four-point stars on a wide orbit round the shoulders. */
export function orbitStars(c: PropCtx): void {
  const { st, rig, pose } = c;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + pose.t * TAU * 0.35;
    const o = at(rig.chest, [Math.cos(a) * 34, 10 + Math.sin(a * 2) * 6, Math.sin(a) * 22]);
    st.add(o, 3.6, (p) => {
      const q = st.p(o);
      const k = st.view.k;
      const tw = 0.5 + 0.5 * Math.sin(pose.t * TAU * 2 + i * 1.3);
      const R = (1.8 + tw * 2) * k;
      p.line([{ x: q.x - R, y: q.y }, { x: q.x + R, y: q.y }], STAR, 1.4 * k);
      p.line([{ x: q.x, y: q.y - R }, { x: q.x, y: q.y + R }], STAR, 1.4 * k);
    });
  }
}
