// Zinna Funkenlauf props (ADC arc marksman, "the Arc Gunner"): a long rifle wrapped in copper coils with a glowing blue
// muzzle, and two thin antenna rods on her back with a flickering blue arc between the tips. 64 px read: small gunner
// with two spiky antennae and a bright blue spark (no other marksman has antennae).
import { at, frameYZ, m, madd, norm, ring, sub, TAU, type V3 } from './core';
import { backFrame, glowOrb } from './props';
import type { PropCtx } from './types';

const BARREL = m('#6a727c', 'metal');
const COPPER = m('#c8743a', 'metal');
const SPARK = '#8ad0ff';

/** Rifle held in both hands: dark barrel, five copper coil rings, glowing muzzle (brighter on attack). */
export function coilRifle(c: PropCtx): void {
  const { st, rig, pose } = c;
  const d = norm(sub(rig.handL.o, rig.handR.o));
  const stock = madd(rig.handR.o, d, -20);
  const tip = madd(rig.handL.o, d, 44);
  const f = frameYZ(stock, d, rig.chest.y);
  st.add(madd(rig.handR.o, d, 12), 3.45, (p) => {
    p.fill(st.capsule(stock, tip, 3.4, 2.6), BARREL, { lw: 1.3 });
    for (let i = 0; i < 5; i++) {
      const y = 34 + i * 12;
      p.fill(st.hull([...ring(f, y, 5.6, 5.6, 10), ...ring(f, y + 5, 5.6, 5.6, 10)]), COPPER, { lw: 1 });
    }
    glowOrb(st, p, madd(tip, d, 3), 3 + (pose.anim === 'attack' ? 2 : 0), SPARK, 0.8 + pose.glow * 0.8);
  });
}

/** Two antenna rods from the upper back leaning outwards; a jagged blue arc jumps between the tips. */
export function backAntennae(c: PropCtx): void {
  const { st, rig, pose } = c;
  const bk = backFrame(rig, 8, 1);
  const tips: V3[] = [];
  for (const s of [1, -1]) {
    const base = at(bk, [s * 6, 0, 0]);
    const tip = at(bk, [s * 17, 48, -4]);
    tips.push(tip);
    st.add(base, -0.8, (p) => {
      p.fill(st.capsule(base, tip, 1.6, 1), m('#b0663a', 'metal'), { lw: 1 });
      glowOrb(st, p, tip, 2, SPARK, 0.7);
    });
  }
  st.add(tips[0]!, 3.2, (p) => {
    const k = st.view.k;
    const pts = [];
    for (let i = 0; i <= 5; i++) {
      const u = i / 5;
      const o = at(bk, [(1 - 2 * u) * 17, 48 + Math.sin(pose.t * TAU * 6 + i * 2.3) * 5 * Math.sin(u * Math.PI), -4]);
      pts.push(st.p(o));
    }
    p.ctx.save();
    p.ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(pose.t * TAU * 3));
    p.line(pts, SPARK, 1.6 * k);
    p.ctx.restore();
  });
}
