// Ignatz Funkenhammer props (mid bruiser mage, "the Forgemaster"): a huge hammer with a glowing orange face in the right
// hand and a shower of orange sparks around the shoulders. 64 px read: stocky smith with a big square hammer head and
// glowing orange dots (no other champion has a square glowing hammer).
import { at, cross, frameYZ, m, madd, TAU } from './core';
import { aimW, fillBox, glowOrb } from './props';
import type { PropCtx } from './types';

const HAFT = m('#5a4028', 'wood');
const IRON = m('#4a4e58', 'metal');
const HOT = m('#e8602a', 'glow');

/** Long-hafted sledge: dark iron block with a glowing striking face. */
export function forgeHammer(c: PropCtx): void {
  const { st, rig, pose } = c;
  const dir = aimW(c);
  const hand = rig.handR.o;
  const len = 60;
  const b = frameYZ(hand, dir, cross(dir, rig.chest.y));
  st.add(madd(hand, dir, 20), 3.3, (p) => {
    p.fill(st.capsule(madd(hand, dir, -16), madd(hand, dir, len), 2.6, 2.3), HAFT, { lw: 1.3 });
    fillBox(st, p, b, -9, 9, len - 6, len + 16, -8, 8, IRON, { lw: 1.6 });
    fillBox(st, p, b, 9, 11.5, len - 4, len + 14, -6.5, 6.5, HOT, { lw: 1.2 });
    glowOrb(st, p, madd(madd(hand, dir, len + 5), b.x, 12), 3.2, '#ff9a4a', 0.5 + pose.glow * 0.9);
  });
}

/** Orange sparks rising and falling round the shoulders. */
export function forgeSparks(c: PropCtx): void {
  const { st, rig, pose } = c;
  const n = 7 + Math.round(pose.glow * 4);
  for (let i = 0; i < n; i++) {
    const u = (pose.t * 1.1 + i / n) % 1;
    const a = i * 2.4 + pose.t * TAU * 0.6;
    const o = at(rig.chest, [Math.sin(a) * (22 + (i % 3) * 5), 6 + u * 44, Math.cos(a) * 14]);
    st.add(o, 3.6, (p) => {
      const q = st.p(o);
      const k = st.view.k;
      p.ctx.save();
      p.ctx.globalAlpha = 1 - u;
      p.dot(q.x, q.y, (1.3 + (i % 2) * 0.6) * k, (1.3 + (i % 2) * 0.6) * k, i % 3 ? '#ff9a3a' : '#ffd070');
      p.ctx.restore();
    });
  }
}
