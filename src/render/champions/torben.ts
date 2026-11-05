// Torben Wutmähne props (top berserker, "the Berserker"): a bearded hand axe in each fist, a belt of three bone skulls
// and a red rage haze rising off the shoulders (thicker the more he swings). 64 px read: wide bare-chested brute
// with two big axe heads and a red smoke plume (no other champion carries two axes).
import { at, cross, frameYZ, m, madd, TAU, type V3 } from './core';
import { aimLW, aimW, fillBox, hipFrame, markTip, LEATHER } from './props';
import type { PropCtx } from './types';

const HAFT = m('#6a4a2c', 'wood');
const IRON = m('#8c9096', 'metal');
const BONE = '#e6dcc0';
const HAZE = '#c8302a';

function axeIn(c: PropCtx, off: boolean): void {
  const { st, rig } = c;
  const hand = off ? rig.handL : rig.handR;
  const dir = off ? aimLW(c) : aimW(c);
  const b = frameYZ(hand.o, dir, cross(dir, rig.chest.y));
  const len = 52;
  if (!off) markTip(c, hand.o, madd(hand.o, dir, len + 8));
  st.add(madd(hand.o, dir, 16), 3.3, (p) => {
    p.fill(st.capsule(madd(hand.o, dir, -10), madd(hand.o, dir, len), 2.2, 1.9), HAFT, { lw: 1.2 });
    // bearded head: a wide wedge to one side of the haft top, a thin spike on the other
    fillBox(st, p, b, 1, 15, len - 14, len + 2, -1.4, 1.4, IRON, { lw: 1.5 });
    fillBox(st, p, b, -6, 1, len - 4, len + 1, -1.2, 1.2, IRON, { lw: 1.2 });
    fillBox(st, p, b, 12, 15.5, len - 17, len + 5, -1.6, 1.6, m('#c8ccd2', 'metal'), { lw: 1 });
  });
}

/** One hand axe per fist; the right one reports its tip for the strike smear. */
export function warAxes(c: PropCtx): void {
  axeIn(c, false);
  axeIn(c, true);
}

/** Three bone skulls hanging from the belt by thongs. */
export function skullBelt(c: PropCtx): void {
  const { st, rig, pose } = c;
  for (const [side, drop] of [[1, 9], [-1, 11], [0.2, 7]] as const) {
    const b = hipFrame(rig, side >= 0 ? 1 : -1, 2);
    const top = at(b, [side === 0.2 ? 6 : 0, -1, 4]);
    const o: V3 = [top[0], top[1] - drop - Math.sin(pose.t * TAU + side) * 0.8, top[2]];
    st.add(o, 1.2, (p) => {
      const a = st.p(top);
      const q = st.p(o);
      const k = st.view.k;
      p.line([a, q], LEATHER.c, 0.9 * k);
      p.dot(q.x, q.y, 3.6 * k, 3.3 * k, BONE);
      p.dot(q.x - 1.1 * k, q.y - 0.4 * k, 0.8 * k, 0.9 * k, '#1a1420');
      p.dot(q.x + 1.1 * k, q.y - 0.4 * k, 0.8 * k, 0.9 * k, '#1a1420');
    });
  }
}

/** Red haze wisps rising off the shoulders; more of them with the swing (pose.glow = attack/cast intensity). */
export function rageHaze(c: PropCtx): void {
  const { st, rig, pose } = c;
  const n = 5 + Math.round(pose.glow * 4);
  for (let i = 0; i < n; i++) {
    const u = (pose.t * 0.9 + i / n) % 1;
    const side = i % 2 ? 1 : -1;
    const o = at(rig.chest, [side * (rig.body.shW * 0.9 + Math.sin(u * 6 + i) * 4), 8 + u * 46, -2 + Math.cos(u * 5 + i * 2) * 4]);
    st.add(o, 3.2, (p) => {
      const q = st.p(o);
      p.ctx.save();
      p.ctx.globalAlpha = 0.7 * (1 - u);
      const r = (2.4 + u * 3 + (i % 3) * 0.5) * st.view.k;
      p.dot(q.x, q.y, r, r * 1.3, HAZE);
      p.ctx.restore();
    });
  }
}
