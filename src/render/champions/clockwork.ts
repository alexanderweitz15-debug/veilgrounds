// Henrike Federwerk props (ADC, "the Springwright"): a brass mainspring drum on the back with a tall winding key standing
// above her shoulder (turns while she runs and winds on every shot), a spring-loaded crossbow with a visible coil, and two
// small gears at the hip. 64 px read: slim girl with a T-shaped key rising behind her head and a drum on her back
// (Aurel's clock-face pack is round and flat; this one is a deep drum with a key).
import { at, frameYZ, lerp3, m, madd, mix, norm, sub, TAU, type V3 } from './core';
import { aimW, backFrame, cyl, hipFrame } from './props';
import type { PropCtx } from './types';

const BRASS = m('#d9a441', 'metal');
const BRASS_DARK = m('#8a6a2a', 'metal');
const STEEL = m('#9aa4b0', 'metal');
const WOOD = m('#6a4a2e', 'wood');
const COPPER = m('#c06a3a', 'metal');

/** Brass drum with a visible coiled spring and a T-key on a long shaft; the key turns with the gait and winds on attacks. */
export function mainspringPack(c: PropCtx): void {
  const { st, rig, pose } = c;
  const bk = backFrame(rig, 2, 4);
  const spin = pose.t * TAU * (pose.anim === 'run' ? 2 : 0.5) + Math.max(0, pose.act) * 2.2;
  // drum: a short cylinder along the back normal
  st.add(madd(bk.o, bk.z, 8), -0.2, (p) => {
    p.fill(cyl(st, { ...bk, o: madd(bk.o, bk.z, 2) }, 0, 14, 21, 21, 20), BRASS, { lw: 1.7 });
    p.fill(cyl(st, { ...bk, o: madd(bk.o, bk.z, 2) }, 14, 17, 18, 18, 20), BRASS_DARK, { lw: 1.4 });
    if (st.faces(bk.z) > -0.05) {
      // coiled spring face: spiral of dark steel on the drum cap
      const face = { ...bk, o: madd(bk.o, bk.z, 19) };
      const pts: V3[] = [];
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * TAU * 3 + spin * 0.15;
        const r = 3 + (i / 40) * 14;
        pts.push(at(face, [Math.cos(a) * r, Math.sin(a) * r, 0.2]));
      }
      p.line(st.pts2(pts), '#2a2218', 2.2 * st.view.k);
      p.line(st.pts2(pts), STEEL.c, 1 * st.view.k);
    }
  });
  // key: shaft up from the drum, T-bar on top turning around the shaft axis
  const base = madd(bk.o, bk.y, 18);
  const top = madd(base, bk.y, 38);
  const bar = madd(madd(top, bk.x, Math.cos(spin) * 15), bk.z, Math.sin(spin) * 6);
  const bar2 = madd(madd(top, bk.x, -Math.cos(spin) * 15), bk.z, -Math.sin(spin) * 6);
  st.add(top, 0.8, (p) => {
    p.fill(st.capsule(base, top, 2.6, 2.2), STEEL, { lw: 1.3 });
    p.fill(st.capsule(bar2, bar, 2.4, 2.4), BRASS, { lw: 1.3 });
    p.fill(st.sphere(bar, 4.2), BRASS, { lw: 1.2 });
    p.fill(st.sphere(bar2, 4.2), BRASS, { lw: 1.2 });
  });
}

/** Spring crossbow held at the aim: stock, steel limbs bowed forward and a coil spring across the prod; flashes on fire. */
export function springCrossbow(c: PropCtx): void {
  const { st, rig, pose } = c;
  const hand = rig.handR.o;
  const dir = aimW(c);
  const f = frameYZ(hand, dir, rig.chest.z);
  const fire = pose.anim === 'attack' ? Math.max(0, pose.act) : 0;
  const prod = madd(hand, dir, 26);
  const side = norm(sub(at(f, [1, 0, 0]), f.o));
  const draw = 1 - fire * 0.7;
  st.add(lerp3(hand, prod, 0.5), 3.3, (p) => {
    p.fill(st.capsule(madd(hand, dir, -16), madd(hand, dir, 30), 3.2, 2.6), WOOD, { lw: 1.4 });
    // limbs: two arms swept forward from the prod, string to the notch
    const tipL = madd(madd(prod, side, 22), dir, 7);
    const tipR = madd(madd(prod, side, -22), dir, 7);
    p.fill(st.capsule(prod, tipL, 2.4, 1.6), STEEL, { lw: 1.3 });
    p.fill(st.capsule(prod, tipR, 2.4, 1.6), STEEL, { lw: 1.3 });
    const nock = madd(prod, dir, -10 * draw);
    p.line(st.pts2([tipL, nock, tipR]), '#e8e0cc', 1.2 * st.view.k);
    // coil spring along the stock
    const coil: V3[] = [];
    for (let i = 0; i <= 14; i++) coil.push(madd(madd(madd(hand, dir, 2 + i * 1.6), f.x, i % 2 ? 3 : -3), f.y, 0));
    p.line(st.pts2(coil), COPPER.c, 1.7 * st.view.k);
    if (fire > 0.4) {
      const q = st.p(madd(prod, dir, 24));
      p.dot(q.x, q.y, 3.4 * st.view.k, 3.4 * st.view.k, mix('#ffd98a', '#ffffff', 0.5));
    }
  });
  c.st.tip ??= { grip: hand, tip: madd(prod, dir, 12) };
}

/** Two small brass gears riding at the right hip, counter-rotating; they spin faster while running. */
export function hipGears(c: PropCtx): void {
  const { st, rig, pose } = c;
  const hf = hipFrame(rig, 1, 3);
  const spin = pose.t * TAU * (pose.anim === 'run' ? 3 : 1);
  for (const [ox, oy, r, n, dir] of [[2, 0, 7.5, 9, 1], [11, -6, 5.5, 7, -1]] as const) {
    const o = at(hf, [ox, oy, 2]);
    st.add(o, 2.4, (p) => {
      const pts: V3[] = [];
      for (let i = 0; i < n * 2; i++) {
        const a = spin * dir + (i / (n * 2)) * TAU;
        const rr = i % 2 ? r : r * 0.78;
        pts.push(at(hf, [ox + Math.cos(a) * rr, oy + Math.sin(a) * rr, 2]));
      }
      p.fill(st.poly(pts), dir > 0 ? BRASS : COPPER, { lw: 1.3 });
      const q = st.p(o);
      p.dot(q.x, q.y, 1.6 * st.view.k, 1.6 * st.view.k, '#2a2218');
    });
  }
}
