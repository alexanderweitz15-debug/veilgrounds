// Gerwin Totenglocke props (jungle summoner, "the Crypt Keeper"): a long pole with a big tarnished bell swinging from its
// hook, a ring of iron keys at the belt and pale green ghost lights drifting round the hood. 64 px read: gaunt hooded
// figure with a tall pole and a dark bell, green wisps (no other champion has a bell on a pole).
import { at, frameYZ, m, madd, ring, TAU, type V3 } from './core';
import { aimW, BRASS, hipFrame, IRON } from './props';
import type { PropCtx } from './types';

const POLE = m('#8a7658', 'wood');
const BELL = m('#d2b45a', 'metal');
const GHOST = '#b8f0c8';

/** Pole in the right hand; the bell hangs from the top and swings with the animation. */
export function tollBell(c: PropCtx): void {
  const { st, rig, pose } = c;
  const dir = aimW(c);
  const base = madd(rig.handR.o, dir, -50);
  const top = madd(rig.handR.o, dir, 100);
  st.add(rig.handR.o, 3.0, (p) => {
    p.fill(st.capsule(base, top, 2.4, 1.9), POLE, { lw: 1.2 });
    const hang = madd(top, rig.chest.z, Math.sin(pose.t * TAU * 2) * 4 + pose.glow * 5);
    const o: V3 = [hang[0], hang[1] - 14, hang[2]];
    const f = frameYZ(o, [0, 1, 0], rig.chest.z);
    p.line([st.p(top), st.p(o)], '#2a2420', 1.4 * st.view.k);
    p.fill(st.hull([...ring(f, 0, 3, 3, 8), ...ring(f, -5, 9, 9, 10), ...ring(f, -15, 13.5, 13.5, 10)]), BELL, { lw: 1.5 });
    p.fill(st.hull([...ring(f, -15, 13.5, 13.5, 10), ...ring(f, -16.5, 12, 12, 10)]), IRON, { lw: 1 });
  });
}

/** Iron key ring hanging from the belt (jingles with the run). */
export function keyRing(c: PropCtx): void {
  const { st, rig, pose } = c;
  const b = hipFrame(rig, -1, 2);
  const top = at(b, [0, -1, 3]);
  for (let i = 0; i < 3; i++) {
    const o: V3 = [top[0] + (i - 1) * 2.4, top[1] - 9 - i * 1.5 - Math.sin(pose.t * TAU * 2 + i) * 0.8, top[2]];
    st.add(o, 1.2, (p) => {
      const a = st.p(top);
      const q = st.p(o);
      const k = st.view.k;
      p.line([a, q], '#2a2420', 0.9 * k);
      p.dot(q.x, q.y, 1.8 * k, 2.6 * k, i === 1 ? BRASS.c : IRON.c);
    });
  }
}

/** Pale green ghost lights drifting round the hood. */
export function ghostLight(c: PropCtx): void {
  const { st, rig, pose } = c;
  for (let i = 0; i < 5; i++) {
    const u = (pose.t * 0.7 + i / 5) % 1;
    const a = i * 2.2 + pose.t * TAU * 0.5;
    const o = at(rig.head, [Math.sin(a) * 20, -6 + u * 34, Math.cos(a) * 14]);
    st.add(o, 3.6, (p) => {
      const q = st.p(o);
      const k = st.view.k;
      p.ctx.save();
      p.ctx.globalAlpha = 0.85 * (1 - u);
      p.dot(q.x, q.y, (2 + (i % 2)) * k, (2.6 + (i % 2)) * k, GHOST);
      p.ctx.restore();
    });
  }
}
