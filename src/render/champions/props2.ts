// Signature props for the remaining champions (weapons, tools, back items). Same primitives as props.ts.
import { add, at, cross, frameYZ, frameZY, INK, lerp3, m, madd, mix, norm, ring, scl, sub, TAU, type Basis, type Mat, type V3 } from './core';
import { aimLW, aimW, markTip, backFrame, BRASS, bladePts, COPPER, cyl, disc, donut, fillBox, glowOrb, heldBlade, hipFrame, IRON, LEATHER, ribbon, ROPE, STEEL, WOOD, WOOD_DARK } from './props';
import type { PropCtx, Rig } from './types';

/** frame for a one-handed pole: y along `dir`, z toward the character's forward */
const poleFrame = (o: V3, dir: V3, rig: Rig): Basis => frameYZ(o, dir, rig.chest.z);
/** two-handed axis from the off hand to the main hand (or reverse) */
const axis2 = (c: PropCtx, fromOff = true): V3 => norm(fromOff ? sub(c.rig.handR.o, c.rig.handL.o) : sub(c.rig.handL.o, c.rig.handR.o));

function pole(c: PropCtx, from: V3, to: V3, w: number, mat: Mat, bias = 3.25): void {
  const { st } = c;
  st.add(lerp3(from, to, 0.5), bias, (p) => p.fill(st.capsule(from, to, w, w * 0.92), mat, { grain: mat.k === 'wood' ? { x: to[0] - from[0], y: -(to[1] - from[1]) } : undefined, lw: 1.6 }));
}

// ------------------------------------------------------------------------------------------------ Brom: root axe
export function rootAxe(c: PropCtx): void {
  const { st, rig } = c;
  const d = axis2(c);
  const a = madd(rig.handL.o, d, -14);
  const b = madd(rig.handR.o, d, 86);
  markTip(c, rig.handR.o, madd(b, d, 6));
  pole(c, a, b, 3.6, WOOD_DARK, 3.3);
  // roots wrapped around the haft
  st.add(lerp3(a, b, 0.6), 3.35, (p) => {
    for (let i = 0; i < 3; i++) {
      const pts: V3[] = [];
      const side = norm(cross(d, c.rig.chest.y));
      for (let k = 0; k <= 8; k++) {
        const u = k / 8;
        const q = lerp3(lerp3(a, b, 0.15 + i * 0.22), lerp3(a, b, 0.35 + i * 0.22), u);
        pts.push(madd(madd(q, side, Math.sin(u * TAU * 1.5 + i) * 4.5), c.rig.chest.z, Math.cos(u * TAU * 1.5 + i) * 4.5));
      }
      p.rope(st.pts2(pts), '#8a6a3a', 2.4);
    }
  });
  // head: wide bearded blade, perpendicular to the haft, edge facing the character's forward / swing
  const hf = frameYZ(b, d, norm(add(c.rig.chest.x, scl(c.rig.chest.z, 0.35))));
  st.add(b, 3.4, (p) => {
    // bearded axe blade: narrow neck at the haft flaring to a long curved edge
    const blade = [at(hf, [0, 7, 2]), at(hf, [0, -6, 2]), at(hf, [0, -14, 10]), at(hf, [0, -30, 22]), at(hf, [0, -24, 30]), at(hf, [0, -10, 36]), at(hf, [0, 6, 38]), at(hf, [0, 18, 34]), at(hf, [0, 14, 22]), at(hf, [0, 10, 10])];
    const sh = st.poly(blade);
    p.fill(sh, m('#9aa2ac', 'metal'));
    // dark forged cheek + bright honed edge
    p.fill(st.poly([at(hf, [0, 7, 2]), at(hf, [0, -6, 2]), at(hf, [0, -9, 9]), at(hf, [0, 9, 9])]), m('#4e525a', 'metal'), { lw: 1.2, rim: false });
    p.line(st.pts2([at(hf, [0, -27, 25]), at(hf, [0, -10, 34]), at(hf, [0, 6, 36]), at(hf, [0, 16, 33])]), '#f2f0e8', 2);
    p.fill(st.hull([...ring(frameYZ(b, d, c.rig.chest.z), -6, 5, 5, 8), ...ring(frameYZ(b, d, c.rig.chest.z), 8, 5, 5, 8)]), IRON, { lw: 1.4 });
    // back spike
    p.fill(st.poly([at(hf, [0, 4, -4]), at(hf, [0, -4, -4]), at(hf, [0, 0, -14])]), IRON, { lw: 1.4 });
  });
}

// ------------------------------------------------------------------------------------------------ Oleth: banner + stone tablet
export function banner(c: PropCtx, o: { cloth: Mat; emblem: string }): void {
  const { st, rig, pose } = c;
  const dir = aimW(c);
  const base = madd(rig.handR.o, dir, -40);
  const top = madd(rig.handR.o, dir, 128);
  markTip(c, rig.handR.o, top);
  pole(c, base, top, 2.8, WOOD_DARK);
  const cross1 = norm(add(scl(rig.chest.x, 0.6), scl(rig.chest.z, -0.8)));
  const barA = madd(madd(top, dir, -8), cross1, 3);
  const barB = madd(madd(top, dir, -8), cross1, 40);
  st.add(lerp3(barA, barB, 0.5), 3.1, (p) => {
    const sway = pose.sway;
    const pts: V3[] = [barA, barB];
    const down = scl(dir, -1);
    const back = scl(rig.chest.z, -sway * 18);
    const L = 58;
    pts.push(add(madd(barB, down, L), back), add(madd(lerp3(barA, barB, 0.5), down, L - 16), scl(back, 0.8)), add(madd(barA, down, L), scl(back, 0.6)));
    p.fill(st.poly(pts), o.cloth, { folds: [st.pts2([lerp3(barA, barB, 0.33), add(madd(lerp3(barA, barB, 0.3), down, L - 10), scl(back, 0.7))]), st.pts2([lerp3(barA, barB, 0.7), add(madd(lerp3(barA, barB, 0.72), down, L - 8), scl(back, 0.75))])] });
    // emblem: a gold tower / tablet sign
    const c0 = add(madd(lerp3(barA, barB, 0.5), down, 22), scl(back, 0.4));
    const f = frameZY(c0, norm(cross(cross1, dir)), dir);
    const em = st.poly([at(f, [-6, -8, 0]), at(f, [6, -8, 0]), at(f, [6, 5, 0]), at(f, [0, 10, 0]), at(f, [-6, 5, 0])]);
    p.fill(em, m(o.emblem, 'metal'), { lw: 1.4 });
    p.fill(st.capsule(barA, barB, 2.2, 2.2), BRASS, { lw: 1.4 });
    p.fill(st.sphere(top, 4), BRASS, { lw: 1.4 });
  });
}

export function tablet(c: PropCtx): void {
  const { st, rig } = c;
  const bk = backFrame(rig, -6, 3);
  st.add(madd(bk.o, bk.z, 6), 0.1, (p) => {
    const pts: V3[] = [];
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * (i / 10);
      pts.push(at(bk, [Math.cos(a) * 17, 22 + Math.sin(a) * 12, 0]));
    }
    pts.push(at(bk, [-17, -34, 0]), at(bk, [17, -34, 0]));
    const back = pts.map((q) => madd(q, bk.z, 5));
    p.fill(st.hull([...pts, ...back]), m('#a7a196', 'stone'), { lw: 1.8 });
    for (const y of [16, 6, -4, -14, -24]) p.line(st.pts2([at(bk, [-10, y, 5.5]), at(bk, [10, y, 5.5])]), '#6c675e', 1.6);
    // leather straps over the shoulders
    p.fill(ribbon(st, [at(bk, [-12, 26, 2]), at(bk, [-14, 34, -8])], 4, 4), LEATHER, { lw: 1.3 });
    p.fill(ribbon(st, [at(bk, [12, 26, 2]), at(bk, [14, 34, -8])], 4, 4), LEATHER, { lw: 1.3 });
  });
}

// ------------------------------------------------------------------------------------------------ Ferris: lantern pole + satchel
export function lanternPole(c: PropCtx): void {
  const { st, rig, pose } = c;
  const dir = aimW(c);
  const base = madd(rig.handR.o, dir, -46);
  const top = madd(rig.handR.o, dir, 120);
  pole(c, base, top, 2.6, WOOD);
  const hookEnd = madd(madd(top, rig.chest.z, 14), dir, 2);
  st.add(hookEnd, 3.2, (p) => {
    p.line(st.pts2([madd(top, dir, -4), madd(top, dir, 4), hookEnd, madd(hookEnd, [0, -1, 0], 6)]), INK, 3.2);
    p.line(st.pts2([madd(top, dir, -4), madd(top, dir, 4), hookEnd, madd(hookEnd, [0, -1, 0], 6)]), '#2c2a30', 1.6);
    const lo = madd(hookEnd, [0, -1, 0], 8);
    const f = frameYZ(lo, [0, 1, 0], rig.chest.z);
    // cap, glass body, base
    p.fill(st.hull([...ring(f, 0, 3, 3, 8), ...ring(f, -5, 9, 9, 10)]), BRASS, { lw: 1.4 });
    p.fill(st.hull([...ring(f, -5, 8, 8, 10), ...ring(f, -21, 8, 8, 10)]), m('#ffd27a', 'glow'), { lw: 1.6 });
    glowOrb(st, p, at(f, [0, -13, 0]), 4, '#ffcf6a', 0.6 + pose.glow * 0.6);
    for (const a of [0.6, 2.2, 3.8, 5.4]) p.line(st.pts2([at(f, [Math.sin(a) * 8, -5, Math.cos(a) * 8]), at(f, [Math.sin(a) * 8, -21, Math.cos(a) * 8])]), '#8a6a2a', 1.4);
    p.fill(st.hull([...ring(f, -21, 9, 9, 10), ...ring(f, -25, 6, 6, 10)]), BRASS, { lw: 1.4 });
  });
}

export function satchel(c: PropCtx, o: { mat: Mat; side?: number }): void {
  const { st, rig } = c;
  const side = o.side ?? 1;
  const hf = hipFrame(rig, side, 4);
  st.add(madd(hf.o, hf.z, 3), 0.7, (p) => {
    const b: Basis = { o: madd(hf.o, rig.pelvis.y, -2), x: rig.pelvis.z, y: rig.pelvis.y, z: hf.z };
    fillBox(st, p, b, -10, 10, -10, 6, -2, 6, o.mat, { stitch: true });
    fillBox(st, p, b, -10.5, 10.5, -1, 6.5, 5, 7, { c: mix(o.mat.c, '#000000', 0.15), k: o.mat.k }, { lw: 1.4, rim: false });
    const q = st.p(at(b, [0, -1, 7.2]));
    p.dot(q.x, q.y, 1.6 * st.view.k, 1.6 * st.view.k, '#d9a441');
  });
}

// ------------------------------------------------------------------------------------------------ Gorvam: chain + cargo hook
export function chainHook(c: PropCtx): void {
  const { st, rig, pose } = c;
  const hand = rig.handR.o;
  const thrown = pose.anim === 'attack' && pose.act > 0.5;
  const hookPos = thrown ? madd(madd(hand, aimW(c), 80), [0, 1, 0], 6) : madd(add(hand, [0, -18, 0]), rig.chest.z, 10 - pose.sway * 6);
  const mid = add(lerp3(hand, hookPos, 0.5), [0, thrown ? -4 : -8, 0]);
  const links: V3[] = [];
  for (let i = 0; i <= 10; i++) {
    const u = i / 10;
    links.push(lerp3(lerp3(hand, mid, u), lerp3(mid, hookPos, u), u));
  }
  st.add(lerp3(hand, hookPos, 0.5), 3.4, (p) => {
    const pp = st.pts2(links);
    p.rope(pp, '#5c6068', 3.4);
    p.ctx.save();
    p.ctx.setLineDash([3 * st.view.k, 3 * st.view.k]);
    p.line(pp, '#9aa0a8', 1.6);
    p.ctx.restore();
    // the hook: a heavy J with a ring eye
    const dn = thrown ? aimW(c) : ([0, -1, 0] as V3);
    const f = frameYZ(hookPos, scl(dn, -1), rig.chest.z);
    const J: V3[] = [];
    for (let i = 0; i <= 12; i++) {
      const u = i / 12;
      if (u < 0.45) J.push(at(f, [0, -u * 70, 0]));
      else {
        const a = ((u - 0.45) / 0.55) * Math.PI * 1.15;
        J.push(at(f, [0, -32 - Math.sin(a) * 20, 20 - Math.cos(a) * 20]));
      }
    }
    p.fill(ribbon(st, J, 11, 5), m('#6a6e78', 'metal'));
    p.fill(st.poly([J[12]!, madd(J[12]!, f.y, 13), madd(J[11]!, f.z, -5)]), m('#6a6e78', 'metal'), { lw: 1.4 });
    donut(st, frameZY(hookPos, rig.chest.x, f.y), 7.5, 3.4, IRON, p, 2);
  });
}

// ------------------------------------------------------------------------------------------------ Vessa: claw blades
export function claws(c: PropCtx): void {
  const { st, rig } = c;
  for (const off of [false, true]) {
    const hand = off ? rig.handL : rig.handR;
    const dir = off ? aimLW(c) : aimW(c);
    if (!off) markTip(c, hand.o, madd(hand.o, dir, 16));
    const side = norm(cross(dir, rig.chest.y));
    st.add(madd(hand.o, dir, 8), 3.7, (p) => {
      for (let i = -1; i <= 1; i++) {
        const b = frameYZ(madd(hand.o, side, i * 3.6), norm(add(dir, scl(side, i * 0.12))), cross(side, dir));
        p.fill(st.poly(bladePts({ ...b, o: at(b, [0, 3, 0]) }, 30, 4, -1.6, 0.7)), m('#d8dce0', 'metal'), { lw: 1.3 });
      }
      p.fill(st.sphere(hand.o, 5), m('#5a3a2a', 'leather'), { lw: 1.3 });
    });
  }
}

// ------------------------------------------------------------------------------------------------ Harrow: ram-head shield + maul
export function ramShield(c: PropCtx): void {
  const { st, rig } = c;
  const n = aimLW(c);
  const f = frameZY(madd(rig.handL.o, n, 4), n, rig.chest.y);
  st.add(madd(f.o, n, 6), 3.8, (p) => {
    const w = 22;
    const h = 34;
    const face: V3[] = [at(f, [-w, h, 0]), at(f, [w, h, 0]), at(f, [w, -h + 6, 0]), at(f, [0, -h - 4, 0]), at(f, [-w, -h + 6, 0])];
    const backFace = face.map((q) => madd(q, f.z, -4));
    p.fill(st.hull([...face, ...backFace]), m('#4a3a2c', 'wood'), { lw: 1.6 });
    p.fill(st.poly(face), m('#6b5238', 'wood'), { grain: { x: 0, y: 1 } });
    for (const y of [h - 7, -h + 10]) p.fill(st.poly([at(f, [-w, y + 3, 0.5]), at(f, [w, y + 3, 0.5]), at(f, [w, y - 3, 0.5]), at(f, [-w, y - 3, 0.5])]), IRON, { lw: 1.3 });
    // ram head boss: skull + curled horns
    const head = at(f, [0, 2, 4]);
    p.fill(st.hull([...ring(frameYZ(head, f.y, f.z), 6, 7, 6, 10), ...ring(frameYZ(madd(head, f.z, 4), f.y, f.z), -10, 5, 6, 10)]), m('#8d8f94', 'metal'));
    for (const s of [1, -1]) {
      const horn: V3[] = [];
      for (let i = 0; i <= 10; i++) {
        const a = (i / 10) * Math.PI * 1.6;
        horn.push(at(f, [s * (6 + Math.sin(a) * 9 + i * 0.4), 8 - (1 - Math.cos(a)) * 8, 6 + i * 0.3]));
      }
      p.fill(ribbon(st, horn, 6, 2.4), m('#b8a07a', 'metal'), { lw: 1.4 });
    }
    for (const [x, y] of [
      [-w + 4, h - 7],
      [w - 4, h - 7],
      [-w + 4, -h + 10],
      [w - 4, -h + 10],
    ]) {
      const q = st.p(at(f, [x!, y!, 1]));
      p.dot(q.x, q.y, 1.6 * st.view.k, 1.6 * st.view.k, '#cfd3d8');
    }
  });
}

export function maul(c: PropCtx, o: { len: number; head: Mat; ram?: boolean }): void {
  const { st, rig } = c;
  const dir = aimW(c);
  const a = madd(rig.handR.o, dir, -8);
  const b = madd(rig.handR.o, dir, o.len);
  markTip(c, rig.handR.o, madd(b, dir, 10));
  pole(c, a, b, 2.8, WOOD_DARK, 3.35);
  const hf = frameYZ(b, dir, rig.chest.z);
  st.add(b, 3.45, (p) => {
    p.fill(st.hull([...ring(frameZY(at(hf, [0, 0, -10]), hf.z, hf.y), 0, 7, 7, 10), ...ring(frameZY(at(hf, [0, 0, 12]), hf.z, hf.y), 0, 8.5, 8.5, 10)]), o.head);
    p.fill(st.hull([...ring(frameZY(at(hf, [0, 0, 10]), hf.z, hf.y), 0, 9, 9, 10), ...ring(frameZY(at(hf, [0, 0, 13]), hf.z, hf.y), 0, 9, 9, 10)]), IRON, { lw: 1.3 });
  });
}

// ------------------------------------------------------------------------------------------------ Seraphyne: storm spear
export function stormSpear(c: PropCtx): void {
  const { st, rig, pose } = c;
  const dir = aimW(c);
  const a = madd(rig.handR.o, dir, -50);
  const b = madd(rig.handR.o, dir, 100);
  markTip(c, rig.handR.o, madd(b, dir, 30));
  pole(c, a, b, 2.4, m('#3a3440', 'wood'));
  const f = poleFrame(b, dir, rig);
  st.add(b, 3.4, (p) => {
    for (const y of [-34, -26, -18]) p.fill(st.hull([...ring(f, y, 4.4, 4.4, 10), ...ring(f, y + 3, 4.4, 4.4, 10)]), COPPER, { lw: 1.2 });
    // forked copper head (lightning rod)
    p.fill(st.poly([at(f, [-2.4, -6, 0]), at(f, [2.4, -6, 0]), at(f, [1.6, 22, 0]), at(f, [0, 30, 0]), at(f, [-1.6, 22, 0])]), COPPER);
    p.fill(st.poly([at(f, [2, 0, 0]), at(f, [9, 8, 0]), at(f, [10, 18, 0]), at(f, [6, 9, 0])]), COPPER, { lw: 1.4 });
    p.fill(st.poly([at(f, [-2, 0, 0]), at(f, [-9, 8, 0]), at(f, [-10, 18, 0]), at(f, [-6, 9, 0])]), COPPER, { lw: 1.4 });
    const glow = 0.35 + pose.glow * 0.65;
    glowOrb(st, p, at(f, [0, 30, 0]), 3.5, '#a8d8ff', glow);
    // crackle: zigzag between the fork tips
    const z = [at(f, [-10, 18, 0]), at(f, [-4, 24, 2]), at(f, [-2, 19, -2]), at(f, [3, 26, 1]), at(f, [10, 18, 0])];
    p.line(st.pts2(z), '#e8f6ff', 1.8);
    if (pose.glow > 0.5) p.line(st.pts2([at(f, [0, 30, 0]), at(f, [8, 44, 4]), at(f, [2, 50, 0]), at(f, [10, 64, 3])]), '#d8f0ff', 2.2);
  });
}

// ------------------------------------------------------------------------------------------------ Dagny: kettle shield, hammer, steam vents
export function kettleShield(c: PropCtx): void {
  const { st, rig, pose } = c;
  const n = aimLW(c);
  const f = frameZY(madd(rig.handL.o, n, 6), n, rig.chest.y);
  st.add(madd(f.o, n, 8), 3.8, (p) => {
    // pot body seen from its bottom (the shield face): squat sphere-ish hull
    const pts = [...ring(frameZY(f.o, f.y, f.z), 0, 26, 26, 18), ...ring(frameZY(madd(f.o, f.z, 10), f.y, f.z), 0, 22, 22, 16), ...ring(frameZY(madd(f.o, f.z, -12), f.y, f.z), 0, 20, 20, 16)];
    const pot = m('#4e4b50', 'metal');
    p.fill(st.hull(pts), pot);
    // rivet ring + glowing seam
    const rv = disc({ ...f, o: madd(f.o, f.z, 11) }, 17, 10);
    for (const q of rv) {
      const s2 = st.p(q);
      p.dot(s2.x, s2.y, 1.5 * st.view.k, 1.5 * st.view.k, '#a9adb3');
    }
    const seam = disc({ ...f, o: madd(f.o, f.z, 12) }, 7, 12);
    p.fill(st.hull(seam), m('#ff9a45', 'glow'), { lw: 1.4 });
    // spout + handle
    p.fill(st.capsule(at(f, [20, 6, 0]), at(f, [34, 16, -4]), 5, 3), pot, { lw: 1.4 });
    p.line(st.pts2([at(f, [-22, 10, -6]), at(f, [-30, 0, -8]), at(f, [-22, -12, -6])]), INK, 3);
    if (pose.glow > 0.3) glowOrb(st, p, at(f, [36, 20, -4]), 3, '#f0f0f0', pose.glow);
  });
}

export function smithHammer(c: PropCtx): void {
  const { st, rig } = c;
  const dir = aimW(c);
  const a = madd(rig.handR.o, dir, -8);
  const b = madd(rig.handR.o, dir, 34);
  markTip(c, rig.handR.o, madd(b, dir, 8));
  pole(c, a, b, 2.4, WOOD, 3.35);
  const hf = frameYZ(b, dir, rig.chest.z);
  st.add(b, 3.45, (p) => {
    p.fill(st.hull([...ring(frameZY(at(hf, [0, 0, -9]), hf.z, hf.y), 0, 6, 6, 4), ...ring(frameZY(at(hf, [0, 0, 11]), hf.z, hf.y), 0, 6.5, 6.5, 4)]), IRON);
  });
}

export function steamVents(c: PropCtx): void {
  const { st, rig, pose } = c;
  for (const s of [1, -1]) {
    const o = at(rig.chest, [s * (rig.body.shW + 2), 8, -4]);
    st.add(o, 2.4, (p) => {
      const f = frameYZ(o, add(rig.chest.y, scl(rig.chest.z, -0.4)), rig.chest.z);
      p.fill(cyl(st, f, 0, 9, 3.4, 3.4, 10), m('#5c5a60', 'metal'), { lw: 1.4 });
      p.fill(st.hull(ring(f, 9, 3.4, 3.4, 10)), m('#1a1420', 'cloth'), { flat: true, lw: 1.2 });
      const puff = 0.4 + pose.glow * 0.8 + (pose.anim === 'idle' ? Math.sin(pose.t * TAU) * 0.15 : 0);
      for (let i = 0; i < 3; i++) {
        const q = st.p(at(f, [s * i * 2, 14 + i * 7 * puff, -i * 3]));
        p.ctx.globalAlpha = 0.9;
        p.dot(q.x, q.y, (3.5 + i * 2) * puff * st.view.k, (3 + i * 1.6) * puff * st.view.k, i ? '#d8d4dc' : '#f2eff4');
        p.ctx.globalAlpha = 1;
      }
    });
  }
}

// ------------------------------------------------------------------------------------------------ Grimald: bear trap + net
export function bearTrap(c: PropCtx): void {
  const { st, rig, pose } = c;
  const thrown = pose.anim === 'attack' && pose.act > 0.5;
  const hand = rig.handR.o;
  const pos = thrown ? madd(hand, aimW(c), 30) : add(hand, [0, -16, 0]);
  const f = frameZY(pos, rig.chest.z, [0, 1, 0]);
  st.add(pos, 3.5, (p) => {
    p.line(st.pts2([hand, pos]), INK, 3);
    p.line(st.pts2([hand, pos]), '#8a8e96', 1.4);
    // two open jaws (semicircles with teeth) facing the viewer-ish plane
    for (const s of [1, -1]) {
      const pts: V3[] = [];
      for (let i = 0; i <= 12; i++) {
        const a = (i / 12) * Math.PI;
        const r = i % 2 ? 14 : 18;
        pts.push(at(f, [Math.cos(a) * r, s * (2 + Math.sin(a) * r * 0.9), 0]));
      }
      p.fill(st.poly(pts), m('#7d828a', 'metal'), { lw: 1.5 });
    }
    p.fill(st.capsule(at(f, [-20, 0, 0]), at(f, [20, 0, 0]), 2.4, 2.4), IRON, { lw: 1.3 });
    p.fill(st.sphere(pos, 4), IRON, { lw: 1.3 });
  });
}

export function netBundle(c: PropCtx): void {
  const { st, rig } = c;
  const bk = backFrame(rig, 2, 4);
  const f: Basis = { o: bk.o, x: bk.y, y: bk.x, z: bk.z };
  st.add(madd(bk.o, bk.z, 6), 0.1, (p) => {
    const sh = st.hull([...ring(f, -24, 8, 8, 10), ...ring(f, 24, 8, 8, 10), ...ring(f, 0, 11, 11, 10)]);
    p.fill(sh, m('#a49372', 'cloth'));
    p.ctx.save();
    p.ctx.clip(sh.path);
    for (let i = -6; i <= 6; i++) {
      p.line(st.pts2([at(f, [-12, i * 5 - 10, 12]), at(f, [12, i * 5 + 10, 12])]), '#6d5f45', 1.2);
      p.line(st.pts2([at(f, [12, i * 5 - 10, 12]), at(f, [-12, i * 5 + 10, 12])]), '#6d5f45', 1.2);
    }
    p.ctx.restore();
    for (const y of [-14, 14]) p.fill(st.hull([...ring(f, y, 11.5, 11.5, 10), ...ring(f, y + 3, 11.5, 11.5, 10)]), LEATHER, { lw: 1.3 });
  });
}

// ------------------------------------------------------------------------------------------------ Lio: flint gauntlets, sling, spark pouch
export function gauntlets(c: PropCtx): void {
  const { st, rig } = c;
  for (const [hand, el] of [
    [rig.handL, rig.elL],
    [rig.handR, rig.elR],
  ] as const) {
    st.add(madd(hand.o, hand.y, 2), 3.75, (p) => {
      const cuff = frameYZ(lerp3(el, hand.o, 0.55), sub(hand.o, el), rig.chest.z);
      p.fill(st.hull([...ring(cuff, -4, 8, 8, 10), ...ring(cuff, 12, 12, 12, 10)]), BRASS);
      const g = st.hull([...ring(hand, -2, 13, 11.5, 10), ...ring(hand, 7, 14, 12, 10), ...ring(hand, 15, 11, 10, 10)]);
      p.fill(g, m('#6f6a63', 'stone'));
      for (let i = -1; i <= 1; i++) {
        const q = at(hand, [i * 7, 15, 7]);
        p.fill(st.sphere(q, 4.2), m('#c9c0b0', 'stone'), { lw: 1.2 });
      }
      const spark = st.p(at(hand, [0, 14, 8]));
      p.dot(spark.x, spark.y, 1.8 * st.view.k, 1.8 * st.view.k, '#ffd36a');
    });
  }
}

export function sling(c: PropCtx): void {
  const { st, rig, pose } = c;
  const hand = rig.handR.o;
  const swinging = pose.anim === 'attack' && pose.frame < 2;
  const pouch = swinging ? madd(hand, aimW(c), -28) : add(hand, [0, -26, 4 - pose.sway * 8]);
  st.add(pouch, 3.6, (p) => {
    p.line(st.pts2([hand, lerp3(hand, pouch, 0.5), pouch]), INK, 2.6);
    p.line(st.pts2([hand, lerp3(hand, pouch, 0.5), pouch]), ROPE, 1.2);
    p.fill(st.sphere(pouch, 4.5), LEATHER, { lw: 1.3 });
    glowOrb(st, p, madd(pouch, [0, 1, 0], 3), 2.2, '#ffcf5a', 0.7);
  });
}

export function sparkPouch(c: PropCtx): void {
  const { st, rig, pose } = c;
  const hf = hipFrame(rig, 1, 4);
  st.add(madd(hf.o, hf.z, 3), 0.7, (p) => {
    const b = frameYZ(madd(hf.o, rig.pelvis.y, -3), rig.pelvis.y, hf.z);
    p.fill(st.hull([...ring(b, 2, 6, 5, 10), ...ring(b, -10, 7.5, 6.5, 10)]), LEATHER, { stitch: true });
    glowOrb(st, p, at(b, [0, 3, 2]), 3, '#ffbf3a', 0.7 + pose.glow * 0.5);
  });
}

// ------------------------------------------------------------------------------------------------ Aurel: clock backpack + pendulum staff
export function clockPack(c: PropCtx): void {
  const { st, rig, pose } = c;
  const bk = backFrame(rig, 4, 5);
  st.add(madd(bk.o, bk.z, 6), 0.1, (p) => {
    const R = 27;
    // gears peeking out behind the face
    const gear = (o: V3, r: number, n: number, rot: number) => {
      const pts: V3[] = [];
      for (let i = 0; i < n * 2; i++) {
        const a = rot + (i / (n * 2)) * TAU;
        const rr = i % 2 ? r : r * 0.8;
        pts.push(at(bk, [o[0] + Math.cos(a) * rr, o[1] + Math.sin(a) * rr, o[2]]));
      }
      p.fill(st.poly(pts), COPPER, { lw: 1.4 });
    };
    gear([-20, 22, -2], 11, 8, pose.t * 2);
    gear([22, 18, -2], 8, 7, -pose.t * 3);
    p.fill(st.hull([...disc(bk, R, 24), ...disc({ ...bk, o: madd(bk.o, bk.z, 5) }, R, 24)]), BRASS);
    const face = { ...bk, o: madd(bk.o, bk.z, 5.5) };
    if (st.faces(bk.z) > -0.05) {
      p.fill(st.hull(disc(face, R - 4.5, 24)), m('#efe4c8', 'paper'), { lw: 1.4 });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        p.line(st.pts2([at(face, [Math.cos(a) * (R - 6), Math.sin(a) * (R - 6), 0.2]), at(face, [Math.cos(a) * (R - 10), Math.sin(a) * (R - 10), 0.2])]), INK, i % 3 ? 1.1 : 2);
      }
      const h1 = -pose.t * TAU * 0.25 + 1.0;
      const h2 = -pose.t * TAU + 2.6;
      p.line(st.pts2([at(face, [0, 0, 0.4]), at(face, [Math.cos(h1) * 11, Math.sin(h1) * 11, 0.4])]), INK, 2.6);
      p.line(st.pts2([at(face, [0, 0, 0.4]), at(face, [Math.cos(h2) * 17, Math.sin(h2) * 17, 0.4])]), INK, 1.6);
      const q = st.p(at(face, [0, 0, 0.5]));
      p.dot(q.x, q.y, 2 * st.view.k, 2 * st.view.k, '#c06a3a');
    }
  });
}

export function pendulumStaff(c: PropCtx): void {
  const { st, rig, pose } = c;
  const dir = aimW(c);
  // held near the top like a walking staff when the kit leans on it
  const cane = c.kit.hold === 'cane';
  const base = madd(rig.handR.o, dir, cane ? -104 : -46);
  const top = madd(rig.handR.o, dir, cane ? 30 : 70);
  pole(c, base, top, 2.4, m('#4a3a30', 'wood'));
  const f = poleFrame(top, dir, rig);
  st.add(top, 3.3, (p) => {
    // fork + swinging pendulum disc
    p.fill(st.poly([at(f, [-10, 0, 0]), at(f, [10, 0, 0]), at(f, [11, 20, 0]), at(f, [7, 20, 0]), at(f, [6, 4, 0]), at(f, [-6, 4, 0]), at(f, [-7, 20, 0]), at(f, [-11, 20, 0])]), BRASS, { lw: 1.5 });
    const sw = Math.sin(pose.t * TAU * (pose.anim === 'run' ? 1 : 1)) * 0.5;
    const piv = at(f, [0, 18, 0]);
    const bob = at(f, [Math.sin(sw) * 16, 18 - Math.cos(sw) * 16, 0]);
    p.line(st.pts2([piv, bob]), INK, 2.6);
    p.line(st.pts2([piv, bob]), '#d9a441', 1.2);
    p.fill(st.hull(disc(frameZY(bob, f.z, f.y), 6, 12)), BRASS, { lw: 1.4 });
    if (pose.glow > 0.2) glowOrb(st, p, bob, 3, '#ffe28a', pose.glow);
  });
}

// ------------------------------------------------------------------------------------------------ Corvin: drum pistols, powder horn
export function pistols(c: PropCtx): void {
  const { st, rig, pose } = c;
  for (const off of [false, true]) {
    const hand = off ? rig.handL : rig.handR;
    const dir = off ? aimLW(c) : aimW(c);
    const f = frameYZ(hand.o, dir, rig.chest.y);
    // act 1 = main hand fires (hit frame), act 2 = the off hand follows up
    const fired = pose.anim === 'attack' && (off ? pose.act > 1.5 : pose.act > 0.5 && pose.act < 1.5);
    st.add(madd(hand.o, dir, 8), 3.7, (p) => {
      p.fill(st.capsule(at(f, [0, -2, -2]), at(f, [0, 6, -9]), 2.6, 2.3), WOOD_DARK, { lw: 1.3 });
      p.fill(st.capsule(at(f, [0, 8, 0]), at(f, [0, 30, 0]), 2.4, 2.1), IRON, { lw: 1.3 });
      // oversized drum
      p.fill(st.hull([...ring(f, 4, 6.5, 6.5, 12), ...ring(f, 13, 6.5, 6.5, 12)]), m('#b98a3a', 'metal'), { lw: 1.4 });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        const q = st.p(at(f, [Math.cos(a) * 4, 13.2, Math.sin(a) * 4]));
        if (st.faces(f.y) > 0.2) p.dot(q.x, q.y, 1 * st.view.k, 1 * st.view.k, INK);
      }
      if (fired) {
        const tip = at(f, [0, 34, 0]);
        glowOrb(st, p, tip, 4, '#ffd27a', 1);
        const q = st.p(tip);
        const t2 = st.p(at(f, [0, 46, 0]));
        p.line([q, t2], '#fff0c0', 3);
      }
    });
  }
}

export function powderHorn(c: PropCtx): void {
  const { st, rig } = c;
  const hf = hipFrame(rig, -1, 5);
  st.add(madd(hf.o, hf.z, 4), 0.75, (p) => {
    const pts: V3[] = [];
    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      pts.push(madd(madd(madd(hf.o, rig.pelvis.z, -10 + u * 22), rig.pelvis.y, -4 - Math.sin(u * Math.PI) * 6), hf.z, 1));
    }
    p.fill(ribbon(st, pts, 9, 3), m('#e2d2a8', 'cloth'), { lw: 1.5 });
    p.fill(st.capsule(pts[8]!, madd(pts[8]!, rig.pelvis.z, 3), 1.8, 1.8), BRASS, { lw: 1.2 });
    p.fill(st.capsule(pts[0]!, madd(pts[0]!, rig.pelvis.z, -2), 4.8, 4.8), BRASS, { lw: 1.2 });
  });
}

// ------------------------------------------------------------------------------------------------ Lysa: needle rifle + thread spool
export function needleRifle(c: PropCtx): void {
  const { st, rig, pose } = c;
  const d = axis2(c, false);
  const stock = madd(rig.handR.o, d, -22);
  const tip = madd(rig.handL.o, d, 92);
  const f = frameYZ(rig.handR.o, d, rig.chest.y);
  st.add(lerp3(rig.handR.o, rig.handL.o, 0.5), 3.45, (p) => {
    // stock with the needle's eye (a hole)
    const eye = st.hull([...ring(frameZY(stock, f.z, f.y), 0, 0, 0, 1), at(f, [0, -24, 6]), at(f, [0, -24, -6]), at(f, [0, -6, 4]), at(f, [0, -6, -4]), at(f, [0, -30, 0])]);
    p.fill(eye, m('#c9ced4', 'metal'));
    const hole = st.p(at(f, [0, -21, 0]));
    p.dot(hole.x, hole.y, 2.4 * st.view.k, 1.4 * st.view.k, INK);
    // long tapering barrel
    p.fill(st.poly([...ring(frameYZ(rig.handR.o, d, rig.chest.y), -4, 3.4, 3.4, 6).slice(0, 4), tip]), m('#c9ced4', 'metal'), { lw: 0 });
    p.fill(ribbon(st, [madd(rig.handR.o, d, -6), lerp3(rig.handR.o, tip, 0.5), tip], 6.5, 1.2), m('#c9ced4', 'metal'));
    // brass scope + trigger guard
    p.fill(st.capsule(madd(madd(rig.handR.o, d, 8), f.z, 5), madd(madd(rig.handR.o, d, 30), f.z, 5), 2.6, 2.6), BRASS, { lw: 1.3 });
    // thread from the eye back to the spool
    p.line(st.pts2([at(f, [0, -21, 0]), madd(at(rig.pelvis, [-(rig.body.hipW + 4), 0, 0]), [0, -1, 0], 4)]), '#c8423a', 1.1);
    if (pose.anim === 'attack' && pose.act > 0.5) glowOrb(st, p, madd(tip, d, 2), 3.5, '#fff0d0', 1);
  });
}

export function hipSpool(c: PropCtx, o: { thread: string }): void {
  const { st, rig } = c;
  const hf = hipFrame(rig, -1, 5);
  st.add(madd(hf.o, hf.z, 4), 0.75, (p) => {
    const f: Basis = { o: hf.o, x: rig.pelvis.z, y: rig.pelvis.y, z: hf.z };
    p.fill(st.hull([...disc({ ...f, o: madd(f.o, f.y, 5) }, 6.5, 12), ...disc({ ...f, o: madd(f.o, f.y, -5) }, 6.5, 12)].map((q) => q)), WOOD, { lw: 1.4 });
    p.fill(cyl(st, frameYZ(hf.o, rig.pelvis.y, hf.z), -4, 4, 5.2, 5.2, 12), m(o.thread), { lw: 1.2, rim: false });
  });
}

// ------------------------------------------------------------------------------------------------ Tobin: harpoon gun + rope coil
export function harpoonGun(c: PropCtx): void {
  const { st, rig, pose } = c;
  const d = axis2(c, false);
  const f = frameYZ(rig.handR.o, d, rig.chest.y);
  const fired = pose.anim === 'attack' && pose.act > 0.5;
  st.add(lerp3(rig.handR.o, rig.handL.o, 0.5), 3.45, (p) => {
    p.fill(st.capsule(at(f, [0, -18, -3]), at(f, [0, 4, 0]), 4, 3.4), WOOD, { lw: 1.4 });
    p.fill(st.hull([...ring(f, 2, 8, 8, 10), ...ring(f, 62, 6.5, 6.5, 10)]), m('#5f6a72', 'metal'));
    for (const y of [12, 50]) p.fill(st.hull([...ring(f, y, 8.6, 8.6, 10), ...ring(f, y + 4, 8.4, 8.4, 10)]), BRASS, { lw: 1.2 });
    const hy = fired ? 110 : 62;
    p.fill(st.capsule(at(f, [0, hy - 6, 0]), at(f, [0, hy + 16, 0]), 2.2, 2.2), STEEL, { lw: 1.2 });
    p.fill(st.poly([at(f, [0, hy + 34, 0]), at(f, [9, hy + 14, 0]), at(f, [3, hy + 17, 0]), at(f, [0, hy + 10, 0]), at(f, [-3, hy + 17, 0]), at(f, [-9, hy + 14, 0])]), STEEL, { lw: 1.3 });
    if (fired) p.line(st.pts2([at(f, [0, 62, 0]), at(f, [0, 86, -3]), at(f, [0, hy, 0])]), ROPE, 1.4);
  });
}

export function ropeCoil(c: PropCtx): void {
  const { st, rig } = c;
  const hf = hipFrame(rig, 1, 6);
  st.add(madd(hf.o, hf.z, 4), 0.75, (p) => {
    const f: Basis = { o: madd(hf.o, rig.pelvis.y, -4), x: rig.pelvis.z, y: rig.pelvis.y, z: hf.z };
    donut(st, f, 11, 5, m('#c7ae7a', 'cloth'), p, 3);
    for (const r of [6.5, 8.5]) {
      const pts = disc({ ...f, o: madd(f.o, f.z, 3.2) }, r, 16);
      p.line(st.pts2([...pts, pts[0]!]), '#8a7448', 1);
    }
  });
}

// ------------------------------------------------------------------------------------------------ Ilvane: loom on the back, spindle staff, threads
export function loomBack(c: PropCtx): void {
  const { st, rig, pose } = c;
  const bk = backFrame(rig, 0, 4);
  st.add(madd(bk.o, bk.z, 6), 0.1, (p) => {
    const W = 22;
    const top = 58;
    const bot = -26;
    for (const x of [-W, W]) p.fill(st.capsule(at(bk, [x, bot, 0]), at(bk, [x, top, 0]), 2.6, 2.6), WOOD_DARK, { lw: 1.4 });
    for (const y of [top - 4, bot + 4, 18]) p.fill(st.capsule(at(bk, [-W - 4, y, 1]), at(bk, [W + 4, y, 1]), 2.4, 2.4), WOOD, { lw: 1.3 });
    // warp threads + a woven band
    if (st.faces(bk.z) > -0.6) {
      for (let i = -4; i <= 4; i++) p.line(st.pts2([at(bk, [i * 4.6, top - 4, 1.5]), at(bk, [i * 4.6, bot + 4, 1.5])]), '#c8b8f0', 1);
      p.fill(st.poly([at(bk, [-W, 16, 2]), at(bk, [W, 16, 2]), at(bk, [W, -6, 2]), at(bk, [-W, -6, 2])]), m('#8a72c0'), { lw: 1.3 });
      p.line(st.pts2([at(bk, [-W, 6, 2.5]), at(bk, [W, 6, 2.5])]), '#d8ccff', 1.4);
    }
    for (const x of [-W, W]) p.fill(st.sphere(at(bk, [x, top + 2, 0]), 3.6), m('#b8a4ff', 'glow'), { lw: 1.2 });
    glowOrb(st, p, at(bk, [0, top + 6, 0]), 2, '#c8b4ff', 0.4 + pose.glow * 0.6);
  });
}

export function spindleStaff(c: PropCtx, o: { color: string; len?: number }): void {
  const { st, rig, pose } = c;
  const dir = aimW(c);
  const base = madd(rig.handR.o, dir, -50);
  const top = madd(rig.handR.o, dir, o.len ?? 74);
  pole(c, base, top, 2.2, m('#5a4a6a', 'wood'));
  const f = poleFrame(top, dir, rig);
  st.add(top, 3.3, (p) => {
    // whorl + a fat cone of glowing yarn
    p.fill(st.hull([...ring(f, -18, 3, 3, 10), ...ring(f, -10, 8, 8, 12), ...ring(f, 0, 7, 7, 12), ...ring(f, 6, 2, 2, 8)]), m(o.color, 'cloth'), { folds: [st.pts2([at(f, [-6, -12, 6]), at(f, [6, -4, 6])]), st.pts2([at(f, [-7, -6, 6]), at(f, [5, 2, 6])])] });
    p.fill(st.hull([...ring(f, -22, 10, 10, 12), ...ring(f, -19, 10, 10, 12)]), BRASS, { lw: 1.3 });
    glowOrb(st, p, at(f, [0, 10, 0]), 2.5, o.color, 0.4 + pose.glow * 0.7);
  });
}

export function trailingThreads(c: PropCtx, o: { color: string; arms?: boolean }): void {
  const { st, rig, pose } = c;
  for (const [hand, s] of [
    [rig.handL, 1],
    [rig.handR, -1],
  ] as const) {
    const pts: V3[] = [];
    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      const wob = Math.sin(u * 7 + pose.t * TAU + s) * 4 * u;
      pts.push(madd(madd(madd(hand.o, [0, -1, 0], u * 30), rig.chest.z, -u * (8 + pose.sway * 26)), rig.chest.x, s * (wob + u * 6)));
    }
    st.add(pts[4]!, 3.0, (p) => {
      p.line(st.pts2(pts), o.color, 1.6);
      p.line(st.pts2(pts.map((q) => madd(q, rig.chest.x, s * 3))), mix(o.color, '#ffffff', 0.3), 1);
    });
  }
  if (o.arms) {
    // threads wound around both forearms
    for (const [el, wr] of [
      [rig.elL, rig.wrL],
      [rig.elR, rig.wrR],
    ] as const) {
      st.add(lerp3(el, wr, 0.5), 3.25, (p) => {
        const d = norm(sub(wr, el));
        const f = frameYZ(el, d, rig.chest.z);
        const r = rig.limb.fa + 0.6;
        const L = Math.hypot(...sub(wr, el));
        for (let i = 0; i < 4; i++) {
          const y = 4 + i * ((L - 8) / 4);
          const a = at(f, [-r, y, r * 0.5]);
          const b = at(f, [r, y + 3, r * 0.5]);
          if (st.faces(f.z) > -0.5) p.line(st.pts2([a, at(f, [0, y + 1.5, r * 1.05]), b]), o.color, 1.6);
        }
      });
    }
  }
}

// ------------------------------------------------------------------------------------------------ Kiran: hand spindles + thread
export function handSpindles(c: PropCtx, o: { thread: string }): void {
  const { st, rig, pose } = c;
  const tips: V3[] = [];
  for (const hand of [rig.handL, rig.handR]) {
    const f = frameYZ(madd(hand.o, [0, -1, 0], 4), [0, 1, 0], rig.chest.z);
    tips.push(at(f, [0, 2, 0]));
    st.add(f.o, 3.7, (p) => {
      p.fill(st.capsule(at(f, [0, 12, 0]), at(f, [0, -24, 0]), 1.4, 1.2), WOOD, { lw: 1.1 });
      p.fill(st.hull([...ring(f, -4, 7, 7, 12), ...ring(f, 4, 4, 4, 10)]), m(o.thread), { lw: 1.4 });
      p.fill(st.hull([...ring(f, -18, 6, 6, 12), ...ring(f, -15, 6, 6, 12)]), WOOD_DARK, { lw: 1.2 });
    });
  }
  // a taut thread between the hands, glowing when casting
  st.add(lerp3(tips[0]!, tips[1]!, 0.5), 3.8, (p) => {
    const sag = add(lerp3(tips[0]!, tips[1]!, 0.5), [0, -6 + pose.glow * 6, 0]);
    p.line(st.pts2([tips[0]!, sag, tips[1]!]), o.thread, 1.8);
    if (pose.glow > 0.4) glowOrb(st, p, sag, 2.5, '#ff9a8a', pose.glow);
  });
}

// ------------------------------------------------------------------------------------------------ Thessaly: light lance
export function lightLance(c: PropCtx): void {
  const { st, rig, pose } = c;
  const dir = aimW(c);
  const a = madd(rig.handR.o, dir, -40);
  const b = madd(rig.handR.o, dir, 104);
  markTip(c, rig.handR.o, madd(b, dir, 30));
  pole(c, a, b, 2.2, BRASS);
  const f = poleFrame(b, dir, rig);
  st.add(b, 3.4, (p) => {
    p.fill(st.hull([...ring(f, -8, 5, 5, 8), ...ring(f, 0, 3, 3, 8)]), BRASS, { lw: 1.3 });
    // prism crystal head
    const prism = [at(f, [0, 30, 0]), at(f, [6, 10, 0]), at(f, [0, 2, 5]), at(f, [-6, 10, 0]), at(f, [0, 10, -5]), at(f, [0, 2, -5])];
    p.fill(st.hull(prism), m('#d8f4ff', 'glass'), { lw: 1.6 });
    p.line(st.pts2([at(f, [0, 30, 0]), at(f, [0, 2, 5])]), '#ffffff', 1.1);
    glowOrb(st, p, at(f, [0, 14, 0]), 3.4, '#fff3c0', 0.45 + pose.glow * 0.6);
  });
  // a prism held up in the off hand while casting
  if (pose.glow > 0.3) {
    st.add(rig.handL.o, 3.8, (p) => {
      const g = madd(rig.handL.o, [0, 1, 0], 9);
      const pf = frameYZ(g, [0, 1, 0], rig.chest.z);
      p.fill(st.hull([at(pf, [0, 9, 0]), at(pf, [-6, -5, 0]), at(pf, [6, -5, 0]), at(pf, [0, -5, 6])]), m('#e8f8ff', 'glass'), { lw: 1.4 });
      glowOrb(st, p, g, 3, '#fff6c8', pose.glow);
    });
  }
}

// ------------------------------------------------------------------------------------------------ Daggers / knives
export function daggers(c: PropCtx, o: { len?: number; mat?: Mat }): void {
  heldBlade(c, { len: o.len ?? 30, w: 5, curve: 0.4, mat: o.mat });
  heldBlade(c, { len: o.len ?? 30, w: 5, curve: 0.4, mat: o.mat, off: true });
}

/** Nyx: wisps of shadow rising off the cloak. */
export function shadowWisps(c: PropCtx): void {
  const { st, rig, pose } = c;
  for (let i = 0; i < 3; i++) {
    const o = at(rig.chest, [(i - 1) * 12, 12 + i * 3, -rig.body.chestD - 4]);
    st.add(o, -0.6, (p) => {
      const pts: V3[] = [];
      for (let k = 0; k <= 5; k++) {
        const u = k / 5;
        pts.push(add(o, [Math.sin(u * 5 + pose.t * TAU + i * 2) * 5, u * 24, -u * 6 - pose.sway * 10 * u]));
      }
      p.fill(ribbon(st, pts, 7, 1), m('#2e2440', 'cloth'), { lw: 1.6, rim: false });
    });
  }
}

/** Kaelen: courier satchel across the back + letter sticking out. */
export function courierBag(c: PropCtx): void {
  const { st, rig } = c;
  const bk = backFrame(rig, -22, 3);
  st.add(madd(bk.o, bk.z, 6), 0.1, (p) => {
    fillBox(st, p, bk, -12, 12, -8, 8, 0, 9, m('#7a5232', 'leather'), { stitch: true });
    p.fill(st.poly([at(bk, [-4, 8, 4]), at(bk, [6, 8, 4]), at(bk, [8, 15, 4]), at(bk, [-2, 15, 4])]), m('#efe4c8', 'paper'), { lw: 1.2 });
  });
}

/** Ilvane: four jointed spider legs arching up and out of the back (they twitch with the animation). */
export function spiderLegs(c: PropCtx, o: { mat: Mat; tip: Mat }): void {
  const { st, rig, pose } = c;
  const bk = backFrame(rig, 2, 2);
  for (const s of [1, -1]) {
    for (let i = 0; i < 2; i++) {
      const tw = Math.sin(pose.t * TAU + i * 1.7 + s) * 0.08 + (pose.glow > 0.5 ? 0.12 : 0);
      const root = at(bk, [s * 6, 6 - i * 10, 0]);
      const knee = at(bk, [s * (30 + i * 6), 40 - i * 16 + tw * 30, 10 + i * 4]);
      const tip = at(bk, [s * (46 + i * 10), 4 - i * 26 + tw * 20, 16 + i * 8]);
      st.add(madd(knee, bk.z, 2), -0.2 + i * 0.01, (p) => {
        p.fill(ribbon(st, [root, lerp3(root, knee, 0.5), knee], 6, 4.2), o.mat, { lw: 1.4 });
        p.fill(ribbon(st, [knee, lerp3(knee, tip, 0.6), tip], 4.4, 1), o.mat, { lw: 1.4 });
        p.fill(st.sphere(knee, 3.2), o.tip, { lw: 1.2 });
      });
    }
  }
}

/** Oda: a big clay water jug on the left shoulder, water sloshing out of the mouth when casting. */
export function waterJug(c: PropCtx): void {
  const { st, rig, pose } = c;
  const o = at(rig.chest, [rig.body.shW * 0.95, 16, -3]);
  const up = norm(add(rig.chest.y, scl(rig.chest.x, -0.35)));
  const f = frameYZ(o, up, rig.chest.z);
  st.add(madd(o, rig.chest.z, 2), 2.6, (p) => {
    const clay = m('#b0643c', 'stone');
    p.fill(st.hull([...ring(f, -12, 7, 7, 12), ...ring(f, -2, 14, 14, 14), ...ring(f, 10, 12, 12, 14), ...ring(f, 18, 5, 5, 10)]), clay, { folds: [st.pts2([at(f, [-8, 10, 10]), at(f, [-10, -6, 9])])] });
    p.fill(st.hull([...ring(f, 18, 6.5, 6.5, 10), ...ring(f, 22, 6.5, 6.5, 10)]), m('#8a4a2c', 'stone'), { lw: 1.4 });
    // painted teal band
    p.fill(st.hull([...ring(f, 2, 14.2, 14.2, 14), ...ring(f, 6, 13.8, 13.8, 14)]), m('#4f8a86', 'cloth'), { lw: 1.2, rim: false });
    const mouth = at(f, [0, 23, 0]);
    p.fill(st.sphere(mouth, 4.2), m('#7fb6d0', 'glass'), { lw: 1.2 });
    if (pose.glow > 0.3) glowOrb(st, p, madd(mouth, up, 6), 4, '#a8e0f0', pose.glow);
  });
}

export { WOOD, STEEL, IRON, BRASS, COPPER, LEATHER };
