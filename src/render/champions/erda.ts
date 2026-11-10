// Erda Felsruf props (support terrain mage, "the Earthweaver"): a big boulder resting on the right shoulder with a glowing
// crack and three rocks orbiting her hands. 64 px read: grey stone woman with a lumpy boulder shoulder and floating rocks.
import { at, frameYZ, m, ring, TAU } from './core';
import type { PropCtx } from './types';

const ROCK = m('#8a8a90', 'stone');
const ROCK_DARK = m('#5a5a62', 'stone');
const GLOW = '#ffb050';

/** Boulder on the right shoulder: lumpy hull, a glowing crack down its face. */
export function shoulderBoulder(c: PropCtx): void {
  const { st, rig, pose } = c;
  const o = at(rig.chest, [-rig.body.shW * 0.9, 12, 0]);
  const f = frameYZ(o, [0, 1, 0], rig.chest.z);
  st.add(o, 1.8, (p) => {
    p.fill(st.hull([...ring(f, -6, 8, 8, 9), ...ring(f, 4, 13, 12, 9), ...ring(f, 14, 9, 9, 9), ...ring(f, 19, 3, 3, 6)]), ROCK, { lw: 1.6 });
    p.fill(st.hull([...ring(f, -6, 7, 7, 8), ...ring(f, 0, 9, 9, 8)]), ROCK_DARK, { lw: 1 });
    const a = st.p(at(f, [-3, 12, 10]));
    const b = st.p(at(f, [2, 2, 12]));
    p.ctx.save();
    p.ctx.globalAlpha = 0.7 + 0.3 * pose.glow;
    p.line([a, b], GLOW, 1.8 * st.view.k);
    p.ctx.restore();
  });
}

/** Three small rocks orbiting at hand height. */
export function orbitRocks(c: PropCtx): void {
  const { st, rig, pose } = c;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + pose.t * TAU * 0.5;
    const o = at(rig.pelvis, [Math.cos(a) * 30, 26 + Math.sin(a * 2) * 5, Math.sin(a) * 20]);
    st.add(o, 3.4, (p) => {
      const f = frameYZ(o, [0.2, 1, 0.1], rig.chest.z);
      p.fill(st.hull([...ring(f, -3, 3.4, 3.4, 6), ...ring(f, 1, 4.6, 4.2, 6), ...ring(f, 4, 2.2, 2.2, 5)]), i % 2 ? ROCK : ROCK_DARK, { lw: 1.2 });
    });
  }
}
