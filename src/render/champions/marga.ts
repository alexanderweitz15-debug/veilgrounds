// Marga Kartaune props (mid artillery mage, "the Siege Gunner"): a huge brass mortar tube strapped to her back and
// reaching up over the shoulder, a long ramrod with a swab in her hand and a haze of soot puffs above the muzzle.
// 64 px read: short stout figure with a fat brass chimney sticking up behind the head (no other champion has one).
import { add, at, frameYZ, m, madd, norm, ring, scl, type V3 } from './core';
import { aimW, backFrame, BRASS, IRON, LEATHER } from './props';
import type { PropCtx } from './types';

const TUBE = m('#c99a3c', 'metal');
const TUBE_DARK = m('#8a6428', 'metal');
const RAM = m('#6a4a2a', 'wood');
const SWAB = m('#d9d2bc', 'cloth');

/** Axis of the mortar: up the spine, leaning toward the front over the shoulder. */
const tubeAxis = (c: PropCtx): V3 => norm(add(c.rig.chest.y, scl(c.rig.chest.z, 0.38)));

/** Brass mortar tube on the back: flared muzzle, two iron bands, a leather strap round the chest; kicks on cast. */
export function mortarPack(c: PropCtx): void {
  const { st, rig, pose } = c;
  const bk = backFrame(rig, -4, 1);
  const ax = tubeAxis(c);
  const f = frameYZ(at(bk, [11, 2, -4]), ax, rig.chest.z);
  const len = 74 - pose.glow * 6;
  st.add(f.o, 0.3, (p) => {
    p.fill(st.hull([...ring(f, 0, 10.5, 10.5, 12), ...ring(f, len * 0.5, 9.4, 9.4, 12), ...ring(f, len, 8.6, 8.6, 12)]), TUBE, { lw: 1.6 });
    p.fill(st.hull([...ring(f, len, 8.6, 8.6, 12), ...ring(f, len + 6, 13.5, 13.5, 12)]), TUBE_DARK, { lw: 1.4 });
    p.fill(st.hull([...ring(f, len + 5.5, 11.8, 11.8, 12), ...ring(f, len + 6.3, 11.6, 11.6, 12)]), m('#1c1612', 'metal'), { lw: 0.6 });
    for (const y of [len * 0.3, len * 0.72]) p.fill(st.hull([...ring(f, y - 2.5, 10.8, 10.8, 12), ...ring(f, y + 2.5, 10.8, 10.8, 12)]), IRON, { lw: 1 });
    p.fill(st.hull([...ring(f, -4, 6, 6, 10), ...ring(f, 0, 9, 9, 10)]), BRASS, { lw: 1.2 });
  });
  // strap round the body
  const a = at(rig.chest, [-rig.body.shW * 0.9, 4, -rig.body.chestD]);
  const b = at(rig.chest, [rig.body.shW * 0.9, -6, rig.body.chestD * 0.6]);
  st.add(a, 0.6, (p) => p.line(st.pts2([a, b]), LEATHER.c, 3.2 * st.view.k));
}

/** Long ramrod in the right hand with a pale swab on the end. */
export function ramrod(c: PropCtx): void {
  const { st, rig } = c;
  const dir = aimW(c);
  const base = madd(rig.handR.o, dir, -40);
  const top = madd(rig.handR.o, dir, 92);
  st.add(rig.handR.o, 3.0, (p) => {
    p.fill(st.capsule(base, top, 2.4, 2), RAM, { lw: 1.2 });
    const f = frameYZ(top, dir, rig.chest.z);
    p.fill(st.hull([...ring(f, -1, 4.6, 4.6, 8), ...ring(f, 8, 4.2, 4.2, 8), ...ring(f, 11, 1.6, 1.6, 6)]), SWAB, { lw: 1.2 });
  });
}

/** Grey soot puffs rising off the muzzle (denser right after a cast). */
export function sootPuffs(c: PropCtx): void {
  const { st, rig, pose } = c;
  const bk = backFrame(rig, -4, 1);
  const ax = tubeAxis(c);
  const f = frameYZ(at(bk, [11, 2, -4]), ax, rig.chest.z);
  const n = 4 + Math.round(pose.glow * 3);
  for (let i = 0; i < n; i++) {
    const u = (pose.t * 0.9 + i / n) % 1;
    const o = at(f, [Math.sin(u * 5 + i) * 5, 86 + u * 34, Math.cos(u * 4 + i * 2) * 5]);
    st.add(o, 3.4, (p) => {
      const q = st.p(o);
      p.ctx.save();
      p.ctx.globalAlpha = 0.75 * (1 - u);
      const r = (2.6 + u * 3.6 + (i % 2)) * st.view.k;
      p.dot(q.x, q.y, r, r, i % 2 ? '#8a8480' : '#a9a49e');
      p.ctx.restore();
    });
  }
}
