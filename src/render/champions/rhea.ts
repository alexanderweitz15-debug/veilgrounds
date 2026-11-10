// Rhea Doppelbolzen props (ADC repeater marksman, "the Quickshot"): a boxy repeater crossbow with a bolt magazine held
// in both hands, and a very long red scarf streaming out behind her. 64 px read: small gunner, a wide boxy crossbow
// and a long red ribbon (no other marksman has a scarf).
import { at, frameYZ, m, madd, norm, ring, sub, TAU, type V3 } from './core';
import { backFrame, BRASS, fillBox, ribbon } from './props';
import type { PropCtx } from './types';

const WOOD = m('#7a5a36', 'wood');
const STEEL = m('#9aa2ac', 'metal');
const SCARF = m('#c0283a', 'cloth');
const SCARF_DARK = m('#7a1a28', 'cloth');

/** Repeater crossbow: wooden stock, steel prod across the front, a box magazine on top. */
export function repeaterCrossbow(c: PropCtx): void {
  const { st, rig, pose } = c;
  const d = norm(sub(rig.handL.o, rig.handR.o));
  const o = madd(rig.handR.o, d, -14);
  const b = frameYZ(o, d, rig.chest.y);
  st.add(madd(rig.handR.o, d, 14), 3.45, (p) => {
    p.fill(st.capsule(o, madd(rig.handL.o, d, 30), 3.2, 2.6), WOOD, { lw: 1.3 });
    fillBox(st, p, b, -16, 16, 52, 55, -2, 2, STEEL, { lw: 1.4 }); // prod
    fillBox(st, p, b, -3.4, 3.4, 18, 44, 3, 11, BRASS, { lw: 1.4 }); // magazine
    p.fill(st.hull([...ring(frameYZ(madd(o, d, 52), d, rig.chest.y), 0, 1.6, 1.6, 6), ...ring(frameYZ(madd(o, d, 52), d, rig.chest.y), 12, 1, 1, 6)]), STEEL, { lw: 0.8 });
    if (pose.anim === 'attack' && pose.act > 0.5) p.line(st.pts2([madd(o, d, 54), madd(o, d, 80)]), '#fff0d0', 1.6 * st.view.k);
  });
}

/** Very long red scarf from the neck, streaming back and rippling (flatter when she runs). */
export function longScarf(c: PropCtx): void {
  const { st, rig, pose } = c;
  const bk = backFrame(rig, 14, 0);
  const flat = 0.4 + pose.sway * 0.6;
  const pts: V3[] = [];
  for (let i = 0; i <= 10; i++) {
    const u = i / 10;
    const wave = Math.sin(u * 8 - pose.t * TAU * 2) * (2 + u * 8);
    pts.push(at(bk, [wave * 1.6, -2 - u * 24 * (1 - flat * 0.6), u * (14 + 22 * flat) + u * u * 6]));
  }
  st.add(pts[4]!, -0.3, (p) => {
    p.fill(ribbon(st, pts, 10, 5), SCARF, { lw: 1.2, folds: [st.pts2([pts[0]!, pts[3]!, pts[6]!])] });
    p.fill(ribbon(st, pts.slice(0, 5), 2, 1.4), SCARF_DARK, { lw: 0.6, rim: false });
  });
}
