// Brigga Bollwerk props (support banner tank, "the Standard Bearer"): a tall battle standard strapped to her back with a
// red-and-gold swallow-tail pennant, a big round shield with a brass boss on the left arm. 64 px read: broad armoured
// figure with a tall banner pole behind the head and a round shield disc (no other champion has a pennant).
import { at, frameYZ, m, madd, ring, TAU, type V3 } from './core';
import { backFrame, BRASS, ribbon } from './props';
import type { PropCtx } from './types';

const POLE = m('#6a4a2c', 'wood');
const CLOTH_RED = m('#b02a32', 'cloth');
const CLOTH_GOLD = m('#e0b040', 'cloth');
const SHIELD = m('#8a8e98', 'metal');
const SHIELD_RIM = m('#c8a040', 'metal');

/** Tall pole up the back, pennant streaming sideways with a wave. */
export function battleStandard(c: PropCtx): void {
  const { st, rig, pose } = c;
  const bk = backFrame(rig, -6, 1);
  const base = at(bk, [4, 0, 0]);
  const top = at(bk, [4, 98, -3]);
  st.add(base, -0.8, (p) => {
    p.fill(st.capsule(base, top, 1.9, 1.4), POLE, { lw: 1.1 });
    p.fill(st.hull([...ring(frameYZ(top, [0, 1, 0], rig.chest.z), 0, 2.2, 2.2, 8), ...ring(frameYZ(top, [0, 1, 0], rig.chest.z), 4, 1, 1, 6)]), BRASS, { lw: 1 });
  });
  const pts: V3[] = [];
  for (let i = 0; i <= 6; i++) {
    const u = i / 6;
    pts.push(at(bk, [4 + u * 30 + pose.sway * u * 6, 90 - u * 4 + Math.sin(pose.t * TAU * 2 + u * 4) * 3 * u, -3 - u * 6]));
  }
  st.add(pts[3]!, 1.2, (p) => {
    p.fill(ribbon(st, pts, 9, 5), CLOTH_RED, { lw: 1.2 });
    p.fill(ribbon(st, pts.map((q) => [q[0], q[1] - 1, q[2]] as V3).slice(0, 5), 3, 1.5), CLOTH_GOLD, { lw: 0.6, rim: false });
  });
}

/** Round shield held out on the left arm: steel disc, gold rim, brass boss. */
export function roundShield(c: PropCtx): void {
  const { st, rig } = c;
  const o = madd(rig.handL.o, rig.chest.z, 7);
  const f = frameYZ(o, rig.chest.z, rig.chest.y);
  st.add(o, 3.4, (p) => {
    p.fill(st.hull([...ring(f, 0, 17, 17, 16), ...ring(f, 3, 17, 17, 16)]), SHIELD_RIM, { lw: 1.5 });
    p.fill(st.hull([...ring(f, 3, 14.5, 14.5, 16), ...ring(f, 4.5, 14.5, 14.5, 16)]), SHIELD, { lw: 1 });
    p.fill(st.hull([...ring(f, 4.5, 4.4, 4.4, 10), ...ring(f, 7.5, 2.6, 2.6, 8)]), BRASS, { lw: 1.2 });
  });
}
