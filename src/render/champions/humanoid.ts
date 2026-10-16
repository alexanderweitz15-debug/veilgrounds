// Shared humanoid rig: solves the skeleton for a pose (2-bone IK for arms and legs) and paints the body with
// its clothing as depth-sorted volumes (convex hulls of projected 3D rings, tapered capsules, surface bands).
import {
  add,
  at,
  dirOf,
  frameYZ,
  hash,
  ik,
  INK,
  lerp3,
  m,
  madd,
  mix,
  norm,
  ring,
  rotX,
  rotY,
  rotZ,
  scl,
  sub,
  TAU,
  type Basis,
  type Mat,
  type Painter,
  type Shape,
  type Stage,
  type V3,
  hull2,
  smoothPath,
  shapeFrom,
} from './core';
import type { BodySpec, Kit, Pose, Rig } from './types';
import { digiFoot, drawBeastHead, drawTail, drawWisp } from './beast';

export const DEFAULT_BODY: BodySpec = {
  H: 180,
  headR: 13.8,
  shW: 22,
  hipW: 14.5,
  chestD: 11.5,
  girth: 1.08,
  belly: 0,
  hunch: 0,
  legs: 0.48,
  stance: 9,
  bust: 0,
  digi: 0,
  float: 0,
};

/**
 * Gameplay-size exaggeration (sprite revision, docs/style/sprite-research.md rule d): champions get a larger head and
 * hands so faces, hair and grips survive the 112 px cell. Minions (legacy frame layout, `kit.frames`) are already
 * chunky and keep their proportions.
 */
export const HEAD_EXAG = 1.1;
export const HAND_EXAG = 1.15;
const exagOf = (kit: Kit): number => (kit.frames ? 0 : 1);

export function bodyOf(kit: Kit): BodySpec {
  const b = { ...DEFAULT_BODY, ...kit.body };
  b.headR *= 1 + (HEAD_EXAG - 1) * exagOf(kit);
  return b;
}

const rotYXZ = (v: V3, yaw: number, pitch: number, roll: number): V3 => rotY(rotX(rotZ(v, roll), pitch), yaw);

export function solveRig(kit: Kit, pose: Pose): Rig {
  const b = bodyOf(kit);
  const g = b.girth;
  const hipH = b.H * b.legs;
  // digitigrade: the heel stands off the ground, thigh + shin only reach down to it
  const heelH = b.digi * 0.85;
  const thigh = (hipH - 6 - heelH) * 0.5;
  const shin = thigh;
  const headTop = b.H;
  const headC = headTop - b.headR * 1.02;
  const neckLen = b.headR * 0.55;
  const shoulderY = headC - b.headR * 0.92 - neckLen;
  const torso = shoulderY - hipH - 3;
  const upper = b.H * 0.2;
  const fore = b.H * 0.185;
  const crouchDrop = pose.crouch * thigh * 0.45;

  // pelvis: yaw + lean + roll around the hip centre
  const po: V3 = [pose.shift, hipH + 3 + pose.bob - crouchDrop + b.float, 0];
  const pf = (v: V3) => rotYXZ(v, pose.hipYaw, pose.lean * 0.4, pose.roll);
  const pelvis: Basis = { o: po, x: pf([1, 0, 0]), y: pf([0, 1, 0]), z: pf([0, 0, 1]) };
  // chest: more lean (+hunch) and the twist; the spine counters the hip roll (contrapposto) and lifts on a breath
  const cf = (v: V3) => rotYXZ(v, pose.hipYaw + pose.twist, pose.lean + b.hunch, -pose.roll * 0.6);
  const chestO = madd(po, cf([0, 1, 0]), torso + pose.breath * 1.6);
  const chest: Basis = { o: chestO, x: cf([1, 0, 0]), y: cf([0, 1, 0]), z: cf([0, 0, 1]) };
  const neck = at(chest, [0, neckLen * 0.6, -b.chestD * 0.15 + b.hunch * 6]);
  const hf = (v: V3) => rotYXZ(rotYXZ(v, pose.headYaw, pose.headTilt - b.hunch * 0.7, 0), pose.hipYaw + pose.twist, pose.lean * 0.6 + b.hunch, pose.roll);
  const headO = add(neck, hf([0, b.headR * 0.92 + neckLen * 0.4, b.headR * 0.08]));
  const head: Basis = { o: headO, x: hf([1, 0, 0]), y: hf([0, 1, 0]), z: hf([0, 0, 1]) };

  const shL = at(chest, [b.shW, -2, 0]);
  const shR = at(chest, [-b.shW, -2, 0]);
  const pole = (p: V3): V3 => norm(dirOf(chest, p));
  const [elL, wrL] = ik(shL, at(chest, pose.handL), upper, fore, pole(pose.poleL));
  const [elR, wrR] = ik(shR, at(chest, pose.handR), upper, fore, pole(pose.poleR));
  const handB = (el: V3, wr: V3): Basis => {
    const y = norm(sub(wr, el));
    const fb = frameYZ(wr, y, chest.z);
    return { ...fb, o: madd(wr, y, 4.2 * g) };
  };

  const hipL = at(pelvis, [b.hipW * 0.62, -3, 0]);
  const hipR = at(pelvis, [-b.hipW * 0.62, -3, 0]);
  const ankH = 6;
  const kneePole = norm(add(pelvis.z, [0, 0.15, 0]));
  const footT = (f: V3): V3 => {
    const r = rotY(f, pose.hipYaw * 0.5);
    return [r[0], r[1] + ankH + heelH, r[2] - b.digi * 0.42];
  };
  const toeT = (f: V3): V3 => {
    const r = rotY(f, pose.hipYaw * 0.5);
    return [r[0], r[1] + 3, r[2] + b.digi * 0.25];
  };
  const [knL, anL] = ik(hipL, footT(pose.footL), thigh, shin, kneePole);
  const [knR, anR] = ik(hipR, footT(pose.footR), thigh, shin, kneePole);
  const footYaw = rotY([0, 0, 1], pose.hipYaw * 0.7);
  const footB = (an: V3, side: number): Basis => frameYZ(an, [0, 1, 0], rotY(footYaw, side * 0.12));

  return {
    body: b,
    pelvis,
    chest,
    head,
    neck,
    shL,
    shR,
    elL,
    elR,
    wrL,
    wrR,
    handL: handB(elL, wrL),
    handR: handB(elR, wrR),
    hipL,
    hipR,
    knL,
    knR,
    anL,
    anR,
    footL: footB(anL, 1),
    footR: footB(anR, -1),
    toeL: toeT(pose.footL),
    toeR: toeT(pose.footR),
    arm: upper + fore,
    upper,
    fore,
    thigh,
    shin,
    limb: { ua: 6.6 * g, fa: 5.6 * g, th: 9 * g, sh: 6.6 * g, hand: 5.4 * g * (1 + (HAND_EXAG - 1) * exagOf(kit)) },
    waistY: torso,
  };
}

/** Limb volume: hull of rings along a bone; spec = [t along bone, radius, optional back offset]. */
function limbHull(st: Stage, rig: Rig, a: V3, b: V3, spec: number[][]): Shape {
  const d = norm(sub(b, a));
  const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const pts: V3[] = [];
  for (const [t, r, back] of spec) {
    const f = frameYZ(madd(a, d, t! * L), d, rig.pelvis.z);
    pts.push(...ring(f, 0, r!, r!, 10, back ?? 0));
  }
  return st.hull(pts);
}

// ------------------------------------------------------------------------------------------------ torso surface
/** Point on the torso surface: a = angle around (0 = front, +PI/2 = left side), t = 0 waist … 1 shoulders. */
export function torsoPt(rig: Rig, a: number, t: number, out = 0): { p: V3; n: V3 } {
  const b = rig.body;
  const w0 = waistDims(b);
  const w1 = { rx: b.shW - 2.5, rz: b.chestD };
  const pw = at(rig.pelvis, [Math.sin(a) * (w0.rx + out), 7, Math.cos(a) * (w0.rz + out) + b.belly * 3]);
  const pc = at(rig.chest, [Math.sin(a) * (w1.rx + out), -7, Math.cos(a) * (w1.rz + out)]);
  const cw = at(rig.pelvis, [0, 7, b.belly * 3]);
  const cc = at(rig.chest, [0, -7, 0]);
  const p = lerp3(pw, pc, t);
  const c = lerp3(cw, cc, t);
  return { p, n: norm(sub(p, c)) };
}
function waistDims(b: BodySpec): { rx: number; rz: number } {
  return { rx: b.hipW * 0.95 + b.belly * 7, rz: b.chestD * 0.86 + b.belly * 9 };
}

/** Visible band around the torso: t(a) gives the centre height per angle (tilted bands = straps). */
export function torsoBand(st: Stage, rig: Rig, tOf: (a: number) => number, half: number, out = 0.6, n = 40): Shape | null {
  const vis: boolean[] = [];
  const top: V3[] = [];
  const bot: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU - Math.PI;
    const t = tOf(a);
    const c = torsoPt(rig, a, t, out);
    vis.push(st.faces(c.n) > -0.02);
    top.push(torsoPt(rig, a, t + half, out).p);
    bot.push(torsoPt(rig, a, t - half, out).p);
  }
  // rotate so we start on an invisible sample, then take the first contiguous visible run
  let s = vis.indexOf(false);
  if (s < 0) s = 0;
  const run: number[] = [];
  for (let k = 1; k <= n; k++) {
    const i = (s + k) % n;
    if (vis[i]) run.push(i);
    else if (run.length) break;
  }
  if (run.length < 2) return null;
  const pts = [...run.map((i) => st.p(top[i]!)), ...run.reverse().map((i) => st.p(bot[i]!))];
  const path = new Path2D();
  pts.forEach((p, i) => (i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)));
  path.closePath();
  return shapeFrom(pts, path);
}

/** Visible point on the torso (for buckles, buttons); null when facing away. */
export function torsoDecal(st: Stage, rig: Rig, a: number, t: number, out = 1): { x: number; y: number } | null {
  const c = torsoPt(rig, a, t, out);
  if (st.faces(c.n) < 0.12) return null;
  return st.p(c.p);
}

// ------------------------------------------------------------------------------------------------ painting
const lineOf = (st: Stage, pts: V3[]) => st.pts2(pts);

export function drawHumanoid(st: Stage, rig: Rig, pose: Pose, kit: Kit): void {
  const o = kit.outfit;
  const b = rig.body;
  const skin = m(o.skin, o.skinKind ?? 'skin');
  const torsoMat = o.coat?.mat ?? o.top;
  const longCoat = o.coat && o.coat.len >= 0.75;

  // ---------------------------------------------------------------- legs
  const leg = (hip: V3, kn: V3, an: V3, foot: Basis, side: number) => {
    const bootH = o.bootH ?? 0.45;
    const bootTop = lerp3(an, kn, bootH);
    const th = rig.limb.th;
    st.add(lerp3(hip, kn, 0.5), longCoat ? -6 : -1, (p) => p.fill(limbHull(st, rig, hip, kn, [[-0.08, th * 1.0], [0.25, th * 1.06], [0.7, th * 0.86], [1.04, th * 0.7]]), o.legs));
    st.add(kn, longCoat ? -3 : -0.5, (p) => {
      const sh2 = rig.limb.sh;
      p.fill(limbHull(st, rig, kn, an, [[-0.04, sh2 * 1.02], [0.28, sh2 * 1.14, -1.6], [0.7, sh2 * 0.8], [1.02, sh2 * 0.66]]), o.legs);
      // boot shaft + cuff
      p.fill(st.capsule(bootTop, an, rig.limb.sh * 1.08, rig.limb.sh * 0.95), o.boots, { stitch: o.boots.k === 'leather' });
      const cuff = st.capsule(bootTop, lerp3(bootTop, an, 0.14), rig.limb.sh * 1.06, rig.limb.sh * 1.02);
      p.fill(cuff, { c: mix(o.boots.c, '#000000', 0.1), k: o.boots.k }, { rim: false });
    });
    if (b.digi > 0) {
      digiFoot(st, rig, an, side > 0 ? rig.toeL : rig.toeR, foot, kit);
      return;
    }
    st.add(madd(foot.o, foot.z, 6), -0.4 + side * 0, (p) => {
      const f = st.hull([
        ...ring(foot, -5, 5.2 * b.girth, 5.5, 8, -2),
        ...ring(foot, -5, 4.6 * b.girth, 4, 8, 9),
        ...ring(foot, 1, 4.4 * b.girth, 4, 6, 0),
      ]);
      p.fill(f, o.boots);
      // sole line
      p.line(lineOf(st, [at(foot, [-4, -5.5, -4]), at(foot, [0, -5.5, 12]), at(foot, [4, -5.5, -4])]), INK, 1.4);
    });
  };
  if (b.float > 0) drawWisp(st, rig, pose, kit);
  else {
    leg(rig.hipL, rig.knL, rig.anL, rig.footL, 1);
    leg(rig.hipR, rig.knR, rig.anR, rig.footR, -1);
    // ---------------------------------------------------------------- hips / pelvis
    st.add(rig.pelvis.o, -0.8, (p) => {
      const sh = st.hull([...ring(rig.pelvis, 4, b.hipW + 2 + b.belly * 5, b.chestD * 0.85 + b.belly * 6, 14), ...ring(rig.pelvis, -6, b.hipW + 1, b.chestD * 0.75, 12)]);
      p.fill(sh, o.legs);
    });
  }
  if (o.tail) drawTail(st, rig, pose, o.tail);

  // ---------------------------------------------------------------- coat skirt / robe
  if (o.coat && o.coat.len > 0.05 && !b.float) {
    const c = o.coat;
    const kneeAvg = lerp3(rig.knL, rig.knR, 0.5);
    const hemY = -(rig.thigh * c.len) - 2;
    const legShift = sub(kneeAvg, at(rig.pelvis, [0, -rig.thigh, 0]));
    const swayBack = -pose.sway * c.len * 10;
    const hemC: V3 = add(at(rig.pelvis, [0, hemY, swayBack]), [legShift[0] * 0.5, 0, legShift[2] * 0.6]);
    const hemB = { ...rig.pelvis, o: hemC };
    const hw = b.hipW + 3 + c.flare * c.len * 9 + b.belly * 6;
    const hz = b.chestD + 2 + c.flare * c.len * 7 + b.belly * 6;
    const coatPts = [...ring(rig.pelvis, 9, b.hipW + 2.5 + b.belly * 7, b.chestD + 1.5 + b.belly * 8, 16, b.belly * 3), ...ring(hemB, 0, hw, hz, 18)];
    st.add(madd(rig.pelvis.o, rig.pelvis.z, 1), 1.5, (p) => {
      const sh = st.hull(coatPts);
      // folds: from waist down to the hem
      const folds: { x: number; y: number }[][] = [];
      for (const a of [-1.1, -0.4, 0.35, 1.0, 2.4, -2.4]) {
        folds.push(lineOf(st, [at(rig.pelvis, [Math.sin(a) * (b.hipW + 2), -2, Math.cos(a) * (b.chestD + 1)]), at(hemB, [Math.sin(a) * hw * 0.98, 0, Math.cos(a) * hz * 0.98])]));
      }
      if (c.tatter) {
        // ragged hem: notches cut out of the bottom
        const hullPts = hull2(st.pts2(coatPts));
        const cy = (sh.y0 + sh.y1) / 2;
        const jag: { x: number; y: number }[] = [];
        hullPts.forEach((q, i) => {
          jag.push(q);
          const nx = hullPts[(i + 1) % hullPts.length]!;
          if (q.y > cy + (sh.y1 - cy) * 0.5 && nx.y > cy + (sh.y1 - cy) * 0.5) jag.push({ x: (q.x + nx.x) / 2, y: (q.y + nx.y) / 2 - 5 - hash(i) * 6 });
        });
        p.fill(shapeFrom(jag, poly(jag)), c.mat, { folds });
      } else p.fill(sh, c.mat, { folds });
      if (c.split) {
        // front split: a dark slit from the waist down (only when the front faces us)
        const f1 = at(rig.pelvis, [0, -4, b.chestD + 2 + b.belly * 8]);
        const f2 = at(hemB, [0, 0, hz]);
        if (st.faces(rig.pelvis.z) > 0.15) p.line(lineOf(st, [f1, f2]), mix(c.mat.c, INK, 0.7), 2.2);
      }
    });
  }

  // ---------------------------------------------------------------- torso
  const torsoAnchor = lerp3(rig.pelvis.o, rig.chest.o, 0.5);
  st.add(torsoAnchor, 0, (p) => {
    const w = waistDims(b);
    const pts = [
      ...ring(rig.pelvis, 7, w.rx, w.rz, 16, b.belly * 3),
      ...ring(rig.pelvis, rig.waistY * 0.42 + 7, w.rx * 0.9 + b.belly * 3, w.rz * 0.95 + b.bust, 16, b.belly * 4 + b.bust),
      ...ring(rig.chest, -rig.waistY * 0.3, b.shW - 2.5 + b.bust, b.chestD + b.bust * 2.5, 16, b.bust * 1.8),
      ...ring(rig.chest, -6, b.shW - 1, b.chestD * 0.95, 16),
      ...ring(rig.chest, 1, b.shW - 5.5, b.chestD * 0.75, 12),
    ];
    const sh = st.hull(pts);
    const folds: { x: number; y: number }[][] = [];
    if (torsoMat.k === 'cloth') {
      for (const a of [-0.7, 0.6]) folds.push(lineOf(st, [torsoPt(rig, a, 0.95).p, torsoPt(rig, a * 0.7, 0.55).p]));
    }
    p.fill(sh, torsoMat, { folds, stitch: torsoMat.k === 'leather' });
    // open coat: shirt panel down the front
    if (o.coat?.open) {
      p.ctx.save();
      p.ctx.clip(sh.path);
      const strip = frontStrip(st, rig, 0.32, 0.0, 1.02);
      if (strip) p.fill(strip, o.coat.open, { lw: 1.6 });
      p.ctx.restore();
      // lapels
      const l1 = torsoDecal(st, rig, 0.36, 1.0, 1.2);
      const l2 = torsoDecal(st, rig, 0.3, 0.55, 1.2);
      const r1 = torsoDecal(st, rig, -0.36, 1.0, 1.2);
      const r2 = torsoDecal(st, rig, -0.3, 0.55, 1.2);
      if (l1 && l2) p.line([l1, l2], INK, 1.6);
      if (r1 && r2) p.line([r1, r2], INK, 1.6);
    }
    if (o.tabard) {
      const strip = frontStrip(st, rig, 0.42, -0.25, 1.0);
      if (strip) p.fill(strip, o.tabard, { lw: 1.6 });
      const back = backStrip(st, rig, 0.42, -0.25, 1.0);
      if (back) p.fill(back, o.tabard, { lw: 1.6 });
    }
    if (o.plate) {
      const plate = torsoBand(st, rig, () => 0.7, 0.3, 1.2, 40);
      if (plate) p.fill(plate, o.plate, { lw: 1.8 });
      for (const a of [-0.5, 0.5]) {
        const r = torsoDecal(st, rig, a, 0.82, 1.6);
        if (r) p.dot(r.x, r.y, 1.4 * st.view.k, 1.4 * st.view.k, mix(o.plate.c, '#fff4dc', 0.5));
      }
    }
    if (o.apron) {
      const ap = frontStrip(st, rig, 0.62, -o.apron.len * 1.5, 0.82, 1.6);
      if (ap) p.fill(ap, o.apron.mat, { stitch: o.apron.mat.k === 'leather', lw: 1.8 });
    }
    // buttons down the front of closed shirts/coats
    if (!o.coat?.open && !o.apron && !o.tabard && torsoMat.k === 'cloth') {
      for (const t of [0.25, 0.5, 0.75]) {
        const q = torsoDecal(st, rig, 0, t, 1.2);
        if (q) p.dot(q.x, q.y, 1.3 * st.view.k, 1.3 * st.view.k, mix(torsoMat.c, '#fff0d0', 0.5));
      }
    }
  });

  // apron skirt part hangs below the waist in front
  if (o.apron) {
    const ap = o.apron;
    st.add(madd(rig.pelvis.o, rig.pelvis.z, 10), 1.8, (p) => {
      if (st.faces(rig.pelvis.z) < -0.1) return;
      const y1 = -rig.thigh * ap.len;
      const z = b.chestD + 2.5 + b.belly * 9;
      const sw = -pose.sway * 6;
      const pts = [
        at(rig.pelvis, [-b.hipW * 0.95, 8, z - 1]),
        at(rig.pelvis, [b.hipW * 0.95, 8, z - 1]),
        at(rig.pelvis, [b.hipW * 1.05, y1, z + 1 + sw]),
        at(rig.pelvis, [-b.hipW * 1.05, y1, z + 1 + sw]),
      ];
      p.fill(st.poly(pts), ap.mat, { stitch: ap.mat.k === 'leather', lw: 1.8 });
      // pocket
      const pk = [at(rig.pelvis, [-b.hipW * 0.5, -2, z + 0.5]), at(rig.pelvis, [b.hipW * 0.1, -2, z + 0.5]), at(rig.pelvis, [b.hipW * 0.1, -10, z + 0.8]), at(rig.pelvis, [-b.hipW * 0.5, -10, z + 0.8])];
      p.fill(st.poly(pk), { c: mix(ap.mat.c, '#000000', 0.12), k: ap.mat.k }, { rim: false, lw: 1.4 });
    });
  }

  // belt + buckle + pouches
  if (o.belt) {
    const be = o.belt;
    st.add(torsoAnchor, 0.4, (p) => {
      const t = be.y ?? 0.06;
      const band = torsoBand(st, rig, () => t, 0.075, 1.3);
      if (band) p.fill(band, be.mat, { lw: 1.6 });
      const q = torsoDecal(st, rig, 0.05, t, 2);
      if (q && be.buckle) {
        const s = st.view.k;
        const sh = rectShape(q.x, q.y, 4.2 * s, 3.6 * s);
        p.fill(sh, be.buckle, { lw: 1.4 });
      }
    });
  }
  if (o.pouches) {
    const pc = o.pouches;
    for (let i = 0; i < pc.n; i++) {
      const a = 1.25 - i * 0.55 + (i % 2 ? -0.1 : 0);
      const c = torsoPt(rig, a, 0.0, 3.5);
      st.add(c.p, 0.6, (p) => {
        const base = frameYZ(c.p, rig.pelvis.y, c.n);
        const sh = st.hull([...ring(base, 2, 3.6, 2.6, 8), ...ring(base, -7, 3.8, 3, 8, 0.5)]);
        p.fill(sh, pc.mat, { stitch: pc.mat.k === 'leather', lw: 1.6 });
        const flap = st.poly([at(base, [-3.8, 2.5, 3]), at(base, [3.8, 2.5, 3]), at(base, [3.4, -2.5, 3.4]), at(base, [-3.4, -2.5, 3.4])]);
        if (st.faces(c.n) > 0) p.fill(flap, { c: mix(pc.mat.c, '#000000', 0.15), k: pc.mat.k }, { lw: 1.3, rim: false });
      });
    }
  }
  if (o.strap) {
    const s = o.strap;
    const dir = s.flip ? -1 : 1;
    const tOf = (a: number) => 0.55 + 0.5 * Math.sin(a * dir + 0.0) * 0.95;
    st.add(torsoAnchor, 0.5, (p) => {
      const band = torsoBand(st, rig, tOf, 0.07, 1.6, 48);
      if (band) p.fill(band, s.mat, { lw: 1.6, stitch: s.mat.k === 'leather' });
      if (s.items) {
        for (let i = -3; i <= 3; i++) {
          const a = i * 0.24;
          const q = torsoDecal(st, rig, a, tOf(a), 2.6);
          if (!q) continue;
          const k = st.view.k;
          const im = s.itemMat ?? m('#c9a24a', 'metal');
          if (s.items === 'shells') p.fill(rectShape(q.x, q.y - 1 * k, 1.8 * k, 3.4 * k), im, { lw: 1.1, rim: false });
          else if (s.items === 'vials') p.fill(rectShape(q.x, q.y - 1 * k, 2 * k, 3.6 * k), im, { lw: 1.1 });
          else if (s.items === 'knives') {
            const blade = poly([
              { x: q.x - 1.4 * k, y: q.y + 1 * k },
              { x: q.x + 1.4 * k, y: q.y + 1 * k },
              { x: q.x, y: q.y - 7 * k },
            ]);
            p.fill(shapeFrom([{ x: q.x - 2 * k, y: q.y - 7 * k }, { x: q.x + 2 * k, y: q.y + 2 * k }], blade), im, { lw: 1.1 });
          } else p.dot(q.x, q.y, 1.4 * k, 1.4 * k, im.c);
        }
      }
    });
  }

  // pauldrons
  if (o.pauldrons) {
    const pd = o.pauldrons;
    for (const [sh, side] of [
      [rig.shL, 1],
      [rig.shR, -1],
    ] as const) {
      st.add(madd(sh, rig.chest.x, side * 2), 2.2, (p) => {
        const base = frameYZ(add(sh, scl(rig.chest.y, 3)), rotDir(rig.chest.y, rig.chest.z, side * 0.5), rig.chest.z);
        const s = pd.size;
        const pts = [...ring(base, 0, 9 * s, 9 * s, 12), ...ring(base, 5 * s, 6.5 * s, 7 * s, 10), ...ring(base, -5 * s, 10 * s, 9.5 * s, 12)];
        if (pd.spikes) pts.push(at(base, [side * 4 * s, 13 * s, 0]));
        p.fill(st.hull(pts), pd.mat, { lw: 1.8 });
        if (pd.mat.k === 'metal') {
          for (const z of [-5, 5]) {
            const r = st.p(at(base, [side * 2, -2 * s, z * s]));
            p.dot(r.x, r.y, 1.2 * st.view.k, 1.2 * st.view.k, mix(pd.mat.c, '#fff4dc', 0.6));
          }
        }
      });
    }
  }

  // ---------------------------------------------------------------- arms
  const arm = (sh: V3, el: V3, wr: V3, hand: Basis, side: number) => {
    const upperM = o.sleeves ?? torsoMat;
    const foreM = o.forearms ?? upperM;
    st.add(lerp3(sh, el, 0.4), 3, (p) => {
      const ua = rig.limb.ua;
      p.fill(limbHull(st, rig, sh, el, [[-0.12, ua * 1.05], [0.12, ua * 1.22], [0.4, ua * 1.04], [0.8, ua * 0.86], [1.04, rig.limb.fa * 0.98]]), upperM);
    });
    st.add(lerp3(el, wr, 0.5), 3.2, (p) => {
      const fa = rig.limb.fa;
      p.fill(limbHull(st, rig, el, wr, [[-0.04, fa * 0.98], [0.25, fa * 1.14], [0.6, fa * 0.92], [1.02, fa * 0.68]]), foreM);
      if (foreM !== upperM || foreM.k === 'leather') {
        const cuff = st.capsule(lerp3(el, wr, 0.62), lerp3(el, wr, 0.9), rig.limb.fa * 1.05, rig.limb.fa * 0.92);
        p.fill(cuff, { c: mix(foreM.c, '#000000', 0.12), k: foreM.k }, { lw: 1.5, stitch: foreM.k === 'leather' });
      }
    });
    st.add(hand.o, 3.6, (p) => {
      const hm = o.hands ?? skin;
      const hs = rig.limb.hand;
      const sh2 = st.hull([...ring(hand, -2, hs * 0.8, hs * 0.55, 8), ...ring(hand, 2.5, hs * 0.95, hs * 0.7, 8), ...ring(hand, 6, hs * 0.75, hs * 0.6, 8)]);
      p.fill(sh2, hm, { lw: 1.6 });
      // thumb
      const th = st.capsule(at(hand, [side * hs * 0.6, -1, hs * 0.5]), at(hand, [side * hs * 0.4, 4, hs * 0.85]), 1.8 * b.girth, 1.5 * b.girth);
      if (st.faces(hand.z) > -0.3) p.fill(th, hm, { lw: 1.3, rim: false });
    });
  };
  arm(rig.shL, rig.elL, rig.wrL, rig.handL, 1);
  arm(rig.shR, rig.elR, rig.wrR, rig.handR, -1);

  // ---------------------------------------------------------------- neck + head
  st.add(rig.neck, 0.6, (p) => {
    p.fill(st.capsule(at(rig.chest, [0, -2, -1]), lerp3(rig.neck, rig.head.o, 0.45), b.headR * 0.5, b.headR * 0.46), skin, { rim: false });
  });
  if (o.shawl) {
    const shawl = o.shawl;
    st.add(add(rig.neck, scl(rig.chest.z, 2)), 0.9, (p) => {
      const base = { ...rig.chest, o: at(rig.chest, [0, 1, 0]) };
      const pts = [...ring(base, 1, b.headR * 0.62, b.chestD * 0.75, 12), ...ring(base, -6, b.shW + 1, b.chestD + 2.5, 16), ...ring(base, -15, b.shW - 1, b.chestD + 2, 14, 1)];
      const folds = [lineOf(st, [at(base, [-6, 0, b.chestD]), at(base, [-9, -14, b.chestD + 2])]), lineOf(st, [at(base, [6, 0, b.chestD]), at(base, [9, -14, b.chestD + 2])])];
      p.fill(st.hull(pts), shawl, { folds });
    });
  }
  if (o.scarf) drawScarf(st, rig, pose, o.scarf.mat, o.scarf.tail);
  drawHead(st, rig, pose, kit);
  if (o.cape) drawCape(st, rig, pose, o.cape);
}

function rotDir(y: V3, z: V3, a: number): V3 {
  // tilt the "up" of a shoulder piece outward
  const x = norm([y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]]);
  return norm(add(scl(y, Math.cos(a)), scl(x, Math.sin(a))));
}

function poly(pts: { x: number; y: number }[]): Path2D {
  const path = new Path2D();
  pts.forEach((p, i) => (i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)));
  path.closePath();
  return path;
}
function rectShape(x: number, y: number, hw: number, hh: number): Shape {
  const pts = [
    { x: x - hw, y: y - hh },
    { x: x + hw, y: y - hh },
    { x: x + hw, y: y + hh },
    { x: x - hw, y: y + hh },
  ];
  return shapeFrom(pts, poly(pts));
}

/** Front panel of the torso between angles ±half (radians), from t0 to t1 (t < 0 extends below the waist). */
function frontStrip(st: Stage, rig: Rig, half: number, t0: number, t1: number, out = 1): Shape | null {
  if (st.faces(rig.chest.z) < -0.05 && st.faces(rig.pelvis.z) < -0.05) return null;
  const pts: V3[] = [];
  const n = 8;
  for (let i = 0; i <= n; i++) pts.push(torsoPt(rig, -half + (2 * half * i) / n, t1, out).p);
  for (let i = n; i >= 0; i--) {
    const a = -half + (2 * half * i) / n;
    if (t0 >= 0) pts.push(torsoPt(rig, a, t0, out).p);
    else {
      const w = torsoPt(rig, a, 0, out).p;
      pts.push(madd(w, rig.pelvis.y, t0 * 30));
    }
  }
  const pp = st.pts2(pts);
  return shapeFrom(pp, poly(pp));
}
function backStrip(st: Stage, rig: Rig, half: number, t0: number, t1: number): Shape | null {
  if (st.faces(rig.chest.z) > 0.05) return null;
  const pts: V3[] = [];
  const n = 8;
  for (let i = 0; i <= n; i++) pts.push(torsoPt(rig, Math.PI - half + (2 * half * i) / n, t1, 1).p);
  for (let i = n; i >= 0; i--) {
    const a = Math.PI - half + (2 * half * i) / n;
    const w = torsoPt(rig, a, Math.max(0, t0), 1).p;
    pts.push(t0 < 0 ? madd(w, rig.pelvis.y, t0 * 30) : w);
  }
  const pp = st.pts2(pts);
  return shapeFrom(pp, poly(pp));
}

// ------------------------------------------------------------------------------------------------ cape / scarf
function drawCape(st: Stage, rig: Rig, pose: Pose, cape: NonNullable<Kit['outfit']['cape']>): void {
  const b = rig.body;
  const L = cape.len * (rig.waistY + rig.thigh * 2);
  const back = -(b.chestD + 2.5);
  const sway = pose.sway;
  const top = [at(rig.chest, [b.shW + 1, 2, back + 3]), at(rig.chest, [-(b.shW + 1), 2, back + 3])];
  const n = 6;
  const bottom: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = (b.shW + 4 + cape.len * 6) * (1 - 2 * u);
    const wob = Math.sin(u * 9 + pose.t * TAU) * 2 * (0.4 + Math.abs(sway));
    const jag = cape.tatter ? (i % 2 ? -L * 0.12 : 0) : 0;
    const p = add(at(rig.pelvis, [x, 0, back - 1 - sway * L * 0.55 + wob]), [0, -(L - rig.waistY) + jag + Math.abs(sway) * L * 0.25, 0]);
    bottom.push(p);
  }
  const anchor = at(rig.chest, [0, -10, back - 4]);
  st.add(anchor, -0.5, (p) => {
    const pts = st.pts2([top[0]!, ...bottom, top[1]!]);
    const path = smoothPathOpen(pts);
    const sh = shapeFrom(pts, path);
    const folds: { x: number; y: number }[][] = [];
    for (const u of [0.25, 0.5, 0.75]) {
      folds.push(lineOf(st, [lerp3(top[0]!, top[1]!, u), bottom[Math.round(u * n)]!]));
    }
    p.fill(sh, cape.mat, { folds });
  });
  // collar over the shoulders, always on top of the torso
  st.add(rig.neck, 0.8, (p) => {
    const base = { ...rig.chest, o: at(rig.chest, [0, 1, -1]) };
    const pts = [...ring(base, 2, b.headR * 0.65, b.chestD * 0.7, 10), ...ring(base, -4, b.shW + 2, b.chestD + 2, 14)];
    p.fill(st.hull(pts), cape.mat, { lw: 1.8 });
  });
}

function smoothPathOpen(pts: { x: number; y: number }[]): Path2D {
  // top edge straight, the rest smoothed
  const h = pts;
  const path = new Path2D();
  path.moveTo(h[0]!.x, h[0]!.y);
  for (let i = 1; i < h.length - 1; i++) {
    const c = h[i]!;
    const nx = h[i + 1]!;
    path.quadraticCurveTo(c.x, c.y, (c.x + nx.x) / 2, (c.y + nx.y) / 2);
  }
  path.lineTo(h[h.length - 1]!.x, h[h.length - 1]!.y);
  path.closePath();
  return path;
}

function drawScarf(st: Stage, rig: Rig, pose: Pose, mat: Mat, tail: number): void {
  const b = rig.body;
  st.add(rig.neck, 0.95, (p) => {
    const base = { ...rig.chest, o: at(rig.chest, [0, 2, 0]) };
    const pts = [...ring(base, 3, b.headR * 0.55, b.chestD * 0.7, 12), ...ring(base, -4, b.headR * 0.75, b.chestD * 0.95, 12)];
    p.fill(st.hull(pts), mat, { lw: 1.8 });
  });
  // trailing tails: a ribbon that streams back with sway and flutters
  const L = 26 * tail;
  const pts: V3[] = [];
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const fl = Math.sin(u * 5 + pose.t * TAU * 1.5) * 3 * u;
    const back = -(b.chestD + 2) - u * L * (0.25 + Math.max(0, pose.sway) * 0.9);
    const down = -u * L * (0.95 - Math.max(0, pose.sway) * 0.55);
    pts.push(at(rig.chest, [b.shW * 0.35 + fl, 1 + down, back]));
  }
  st.add(pts[3]!, -0.3, (p) => {
    const a = st.pts2(pts);
    const w = 4.2 * st.view.k;
    const left = a.map((q, i) => ({ x: q.x - w * (1 - i / (n * 2.2)), y: q.y }));
    const right = a.map((q, i) => ({ x: q.x + w * (1 - i / (n * 2.2)), y: q.y })).reverse();
    const all = [...left, ...right];
    p.fill(shapeFrom(all, poly(all)), mat, { lw: 1.8 });
  });
}

// ------------------------------------------------------------------------------------------------ head
const sphereCache = new Map<number, V3[]>();
function spherePts(n: number): V3[] {
  let s = sphereCache.get(n);
  if (!s) {
    s = [];
    for (let i = 0; i <= n; i++) {
      const lat = -Math.PI / 2 + (i / n) * Math.PI;
      const ring = Math.max(1, Math.round(Math.cos(lat) * n * 2));
      for (let j = 0; j < ring; j++) {
        const lon = (j / ring) * TAU;
        s.push([Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)]);
      }
    }
    sphereCache.set(n, s);
  }
  return s;
}

/** Head-local points on a sphere of radius r*scale passing the predicate (unit sphere coords). */
function sphereSel(head: Basis, r: number, scale: number, pred: (u: V3) => boolean, squash: V3 = [1, 1, 1]): V3[] {
  return spherePts(9)
    .filter(pred)
    .map((u) => at(head, [u[0] * r * scale * squash[0], u[1] * r * scale * squash[1], u[2] * r * scale * squash[2]]));
}

function drawHead(st: Stage, rig: Rig, pose: Pose, kit: Kit): void {
  const o = kit.outfit;
  const r = rig.body.headR;
  const H = rig.head;
  const skin = m(o.skin, o.skinKind ?? 'skin');
  const hairM = o.hair?.mat ?? m('#3a2a22', 'hair');
  const style = o.hair?.style ?? 'short';
  const front = st.faces(H.z);
  const hood = o.hood;
  const behind = madd(H.o, H.z, -r * 0.9);

  // hood back (behind the head when facing us)
  if (hood) {
    st.add(behind, -0.2, (p) => {
      const pts = [
        ...sphereSel(H, r, 1.3, (u) => u[2] < 0.55),
        at(H, [r * 1.25, -r * 1.25, -r * 0.35]),
        at(H, [-r * 1.25, -r * 1.25, -r * 0.35]),
        at(H, [0, -r * 1.35, -r * 1.0]),
        at(H, [0, r * 1.45, -r * 0.2]),
      ];
      p.fill(st.hull(pts), hood.mat, { folds: [lineOf(st, [at(H, [0, r * 1.3, -r * 0.3]), at(H, [0, -r * 0.9, -r * 1.25])])] });
    });
  }
  // nun's veil: long back drape behind the head (in front of it when seen from behind)
  if (o.hat?.kind === 'veil') {
    const veil = o.hat.mat;
    st.add(behind, -0.25, (p) => {
      const pts = [
        ...sphereSel(H, r, 1.2, (u) => u[2] < 0.3),
        at(H, [r * 1.35, -r * 1.9, -r * 0.4]),
        at(H, [-r * 1.35, -r * 1.9, -r * 0.4]),
        at(H, [0, -r * 2.2, -r * 1.1]),
      ];
      p.fill(st.hull(pts), veil, { folds: [st.pts2([at(H, [r * 0.5, r * 0.8, -r]), at(H, [r * 0.9, -r * 1.8, -r * 0.8])]), st.pts2([at(H, [-r * 0.5, r * 0.8, -r]), at(H, [-r * 0.9, -r * 1.8, -r * 0.8])])] });
    });
  }
  // long hair / ponytail / braid behind
  if (style === 'long' || style === 'tied' || style === 'braid' || style === 'bun') {
    st.add(madd(H.o, H.z, -r * 0.95), -0.1, (p) => {
      if (style === 'long') {
        const pts = [
          ...sphereSel(H, r, 1.1, (u) => u[2] < -0.05 && u[1] > -0.4),
          at(H, [r * 1.05, -r * 1.65, -r * 0.35]),
          at(H, [-r * 1.05, -r * 1.65, -r * 0.35]),
          at(H, [r * 0.6, -r * 1.9, -r * 0.65]),
          at(H, [-r * 0.6, -r * 1.9, -r * 0.65]),
        ];
        const strands = [-0.5, 0, 0.5].map((x) => lineOf(st, [at(H, [x * r, r * 0.7, -r]), at(H, [x * r * 1.3, -r * 1.8, -r * 0.7])]));
        p.fill(st.hull(pts), hairM, { folds: strands });
      } else if (style === 'bun') {
        p.fill(st.sphere(at(H, [0, r * 0.55, -r * 0.85]), r * 0.42), hairM);
      } else {
        // ponytail or braid swinging back
        const sw = pose.sway * 0.5;
        const a = at(H, [0, r * 0.2, -r * 0.95]);
        const bb = at(H, [0, -r * 0.6, -r * (1.35 + sw)]);
        const c = at(H, [0, -r * (style === 'braid' ? 1.9 : 1.4), -r * (1.3 + sw * 1.5)]);
        if (style === 'braid') {
          const mid = lerp3(lerp3(a, c, 0.5), bb, 0.6);
          const seg = [a, mid, c];
          for (let i = 0; i < 5; i++) {
            const u = i / 4;
            const q = u < 0.5 ? lerp3(seg[0]!, seg[1]!, u * 2) : lerp3(seg[1]!, seg[2]!, u * 2 - 1);
            p.fill(st.sphere(q, r * (0.27 - i * 0.03)), hairM, { lw: 1.5, rim: false });
          }
          const tie = st.p(c);
          p.dot(tie.x, tie.y, r * 0.12 * st.view.k, r * 0.12 * st.view.k, '#7a3a2a');
        } else {
          p.fill(st.capsule(a, bb, r * 0.3, r * 0.26), hairM);
          p.fill(st.capsule(bb, c, r * 0.26, r * 0.1), hairM);
        }
      }
    });
  }

  // the head + face
  st.add(H.o, 0, (p) => {
    // ears
    for (const side of [1, -1]) {
      const e = at(H, [side * r * 0.97, -r * 0.08, -r * 0.02]);
      if (st.faces(dirOf(H, [side, 0, 0])) < -0.25) continue;
      p.fill(st.sphere(e, r * 0.2), skin, { lw: 1.4, rim: false });
    }
    // skull (slightly egg-shaped with a jaw)
    const skull = st.hull([...sphereSel(H, r, 1, () => true), at(H, [0, -r * 1.12, r * 0.55]), at(H, [r * 0.55, -r * 0.95, r * 0.45]), at(H, [-r * 0.55, -r * 0.95, r * 0.45])]);
    p.fill(skull, skin, { shadow: 0.9 });
    if (front > -0.25) drawFace(st, p, rig, kit, front);
  });

  // hair on top: a cap above the hairline + individual locks (fringe, sideburns, nape) unioned into one shape
  if (style !== 'none') {
    st.add(H.o, 0.3, (p) => {
      const line = style === 'crop' ? 0.4 : 0.26;
      const longish = style === 'long' || style === 'bob';
      const pred = (u: V3) => u[1] > line - (u[2] < 0 ? 0.62 + (longish ? 0.45 : 0) : 0) || (Math.abs(u[0]) > 0.82 && u[1] > -0.25 && u[2] < 0.35);
      const pts = sphereSel(H, r, style === 'wild' ? 1.12 : 1.08, pred);
      if (style === 'bob') pts.push(at(H, [r * 1.08, -r * 0.6, -r * 0.1]), at(H, [-r * 1.08, -r * 0.6, -r * 0.1]), at(H, [0, -r * 0.55, -r * 1.08]));
      const hullPts = hull2(st.pts2(pts));
      const sh = shapeFrom(hullPts, smoothPath(hullPts));
      const lockLen = style === 'crop' ? 0.14 : style === 'wild' ? 0.3 : longish ? 0.26 : 0.2;
      const L = Math.asin(Math.min(0.95, line + 0.1));
      const L2 = Math.asin(Math.max(-0.95, line - lockLen));
      const locks: Shape[] = [];
      const lock = (a: number, lat0: number, lat1: number, w: number, out: number) => {
        const dir = (lat: number, s2: number): V3 => [Math.sin(a) * Math.cos(lat) * s2, Math.sin(lat) * s2, Math.cos(a) * Math.cos(lat) * s2];
        if (st.faces(dirOf(H, dir(lat0, 1))) < -0.2) return;
        const t: V3 = [Math.cos(a), 0, -Math.sin(a)];
        const root = scl(dir(lat0, 1.08), r);
        const tip = scl(dir(lat1, 1.08 + out), r);
        const q = st.pts2([at(H, add(root, scl(t, w * r))), at(H, tip), at(H, add(root, scl(t, -w * r))), at(H, scl(dir(lat0 + 0.3, 1.08), r))]);
        const path = new Path2D();
        path.moveTo(q[0]!.x, q[0]!.y);
        path.quadraticCurveTo((q[0]!.x + q[1]!.x) / 2 + (q[1]!.y - q[0]!.y) * 0.12, (q[0]!.y + q[1]!.y) / 2, q[1]!.x, q[1]!.y);
        path.quadraticCurveTo((q[1]!.x + q[2]!.x) / 2, (q[1]!.y + q[2]!.y) / 2, q[2]!.x, q[2]!.y);
        path.quadraticCurveTo(q[3]!.x, q[3]!.y, q[0]!.x, q[0]!.y);
        path.closePath();
        locks.push(shapeFrom(q, path));
      };
      // sideburns / side locks and nape (drawn under the cap)
      for (const side of [1, -1]) lock(side * 1.45, Math.asin(0.2), Math.asin(longish ? -0.85 : -0.42), 0.22, 0.02);
      for (let i = 0; i < 4; i++) lock(Math.PI - 0.75 + i * 0.5, Math.asin(-0.15), Math.asin(longish ? -0.95 : -0.6), 0.26, 0.04);
      const under = locks.splice(0);
      for (const l of under) p.fill(l, hairM, { lw: 1.6, rim: false });
      const strands: { x: number; y: number }[][] = [];
      for (const u of [-0.45, 0.0, 0.45]) {
        const q0 = st.p(at(H, [u * r * 0.9 - 0.15 * r, r * 1.02, -r * 0.1]));
        const q1 = st.p(at(H, [u * r * 1.0, r * 0.75, r * 0.62]));
        const q2 = st.p(at(H, [u * r * 1.05 + 0.1 * r, line * r + 0.05 * r, r * 0.95]));
        strands.push([q0, q1, q2]);
      }
      p.fill(sh, hairM, { folds: strands, sheen: [st.pts2([at(H, [r * 0.15, r * 0.98, r * 0.3]), at(H, [r * 0.55, r * 0.8, r * 0.45]), at(H, [r * 0.8, r * 0.5, r * 0.45])])] });
      // fringe clumps over the forehead (and spikes for wild hair), drawn over the cap
      const nFront = style === 'wild' ? 6 : 4;
      for (let i = 0; i < nFront; i++) {
        const a = -0.85 + (1.7 * i) / (nFront - 1) + (i % 2 ? 0.07 : -0.04);
        lock(a, L + 0.12, L2 - (i % 2 ? 0.06 : 0), 0.24, style === 'wild' ? 0.1 : 0.03);
      }
      if (style === 'wild') for (let i = 0; i < 4; i++) lock(-1.5 + i * 1.0, Math.asin(0.75), Math.asin(0.4), 0.26, 0.28);
      for (const l of locks) p.fill(l, hairM, { lw: 1.4, rim: false, shadow: 0.6 });
    });
  }
  // beard
  if (o.beard) {
    const bd = o.beard;
    st.add(madd(H.o, H.z, r * 0.6), 0.2, (p) => {
      if (front < -0.35) return;
      if (bd.style === 'mustache' || bd.style === 'stubble') {
        if (bd.style === 'stubble') {
          const pts = sphereSel(H, r, 1.02, (u) => u[1] < -0.25 && u[2] > 0.25);
          if (pts.length > 2) p.fill(st.hull(pts), { c: mix(o.skin, bd.mat.c, 0.45), k: 'skin' }, { lw: 0, rim: false });
        }
        if (front > 0 && bd.style === 'mustache') {
          const L = at(H, [r * 0.42, -r * 0.42, r * 0.92]);
          const R = at(H, [-r * 0.42, -r * 0.42, r * 0.92]);
          const c = at(H, [0, -r * 0.28, r * 1.02]);
          p.fill(st.capsule(c, L, r * 0.15, r * 0.08), bd.mat, { lw: 1.3, rim: false });
          p.fill(st.capsule(c, R, r * 0.15, r * 0.08), bd.mat, { lw: 1.3, rim: false });
        }
        return;
      }
      const long = bd.style === 'full' ? 1.55 : bd.style === 'braided' ? 1.9 : 1.25;
      const pts = [
        ...sphereSel(H, r, 1.08, (u) => u[1] < -0.12 && u[2] > -0.1),
        at(H, [0, -r * long, r * 0.7]),
        at(H, [r * 0.45, -r * (long - 0.25), r * 0.55]),
        at(H, [-r * 0.45, -r * (long - 0.25), r * 0.55]),
      ];
      const strands = [-0.4, 0, 0.4].map((x) => lineOf(st, [at(H, [x * r, -r * 0.5, r * 1.0]), at(H, [x * r * 0.6, -r * (long - 0.1), r * 0.75])]));
      p.fill(st.hull(pts), bd.mat, { folds: strands });
      if (front > 0.1) {
        // mouth opening hint + mustache
        const c = at(H, [0, -r * 0.3, r * 1.06]);
        p.fill(st.capsule(c, at(H, [r * 0.45, -r * 0.45, r * 0.95]), r * 0.15, r * 0.09), { c: mix(bd.mat.c, '#000000', 0.12), k: 'hair' }, { lw: 1.3, rim: false });
        p.fill(st.capsule(c, at(H, [-r * 0.45, -r * 0.45, r * 0.95]), r * 0.15, r * 0.09), { c: mix(bd.mat.c, '#000000', 0.12), k: 'hair' }, { lw: 1.3, rim: false });
      }
      if (bd.style === 'braided') {
        const t = at(H, [0, -r * long, r * 0.7]);
        p.fill(st.capsule(t, madd(t, H.y, -r * 0.5), r * 0.14, r * 0.1), bd.mat, { lw: 1.3 });
        const q = st.p(t);
        p.dot(q.x, q.y, r * 0.16 * st.view.k, r * 0.1 * st.view.k, '#c9a24a');
      }
    });
  }
  // hood top rim over the forehead, face in shadow
  if (hood) {
    st.add(H.o, 0.5, (p) => {
      const pts = [...sphereSel(H, r, 1.32, (u) => u[1] > 0.32 || u[2] < -0.2), at(H, [0, r * 1.45, -r * 0.2])];
      const sh = st.hull(pts);
      if (front > 0 && hood.dark) {
        // deep hood: the face is a dark void with two glints
        const hole = st.hull(sphereSel(H, r, 1.05, (u) => u[2] > 0.15));
        p.fill(hole, m('#120e18', 'cloth'), { flat: true, lw: 0 });
      }
      p.fill(sh, hood.mat, { folds: [lineOf(st, [at(H, [r * 0.5, r * 1.2, r * 0.5]), at(H, [r * 1.1, -r * 0.4, r * 0.4])])] });
      if (front > 0 && hood.dark) {
        for (const side of [1, -1]) {
          const e = st.p(at(H, [side * r * 0.36, -r * 0.1, r * 1.02]));
          p.dot(e.x, e.y, r * 0.12 * st.view.k, r * 0.07 * st.view.k, o.face?.eyes ?? '#c8b8ff');
        }
      }
    });
  }
  if (o.snout || o.ears || o.horns || o.tusks) drawBeastHead(st, rig, kit, front);
  if (o.hat) drawHat(st, rig, o.hat);
}

function jagged(h: { x: number; y: number }[], tooth: number, every: number): { x: number; y: number }[] {
  let cx = 0;
  let cy = 0;
  for (const q of h) {
    cx += q.x;
    cy += q.y;
  }
  cx /= h.length;
  cy /= h.length;
  const out: { x: number; y: number }[] = [];
  h.forEach((q, i) => {
    out.push(q);
    const n = h[(i + 1) % h.length]!;
    if (i % every === 0) {
      const mx = (q.x + n.x) / 2;
      const my = (q.y + n.y) / 2;
      const dx = mx - cx;
      const dy = my - cy;
      const d = Math.hypot(dx, dy) || 1;
      if (dy < d * 0.6) out.push({ x: mx + (dx / d) * tooth, y: my + (dy / d) * tooth });
    }
  });
  return out;
}

function drawFace(st: Stage, p: Painter, rig: Rig, kit: Kit, front: number): void {
  const H = rig.head;
  const r = rig.body.headR;
  const o = kit.outfit;
  const f = o.face ?? {};
  const k = st.view.k;
  const skinM = m(o.skin, o.skinKind ?? 'skin');
  const browC = mix(o.hair?.mat.c ?? '#3a2a22', INK, 0.35);
  const vis = (u: V3) => st.faces(dirOf(H, norm(u)));
  const fr = r / 22.5;
  // eyes
  if (!f.blindfold) {
    for (const side of [1, -1]) {
      const u: V3 = [side * 0.36, -0.04, 0.93];
      const fv = vis(u);
      if (fv < 0.1) continue;
      const e = st.p(at(H, scl(u, r)));
      const squeeze = Math.min(1, 0.35 + fv);
      if (f.eyes) {
        p.dot(e.x, e.y, r * 0.15 * k * squeeze, r * 0.1 * k, f.eyes);
        p.dot(e.x, e.y, r * 0.07 * k * squeeze, r * 0.05 * k, '#ffffff');
      } else {
        const look = st.faces(dirOf(H, [1, 0, 0])) * -0.04 * r * k;
        p.dot(e.x, e.y + r * 0.02 * k, r * 0.16 * k * squeeze, r * 0.2 * k, '#f4ead8');
        p.dot(e.x + look, e.y + r * 0.04 * k, r * 0.105 * k * squeeze, r * 0.15 * k, INK);
        p.dot(e.x + look + r * 0.04 * k, e.y - r * 0.01 * k, r * 0.035 * k, r * 0.035 * k, '#ffffff');
        // upper lid line
        p.line([{ x: e.x - r * 0.19 * k * squeeze, y: e.y - r * 0.06 * k }, { x: e.x, y: e.y - r * 0.15 * k }, { x: e.x + r * 0.19 * k * squeeze, y: e.y - r * 0.09 * k }], INK, 1.9 * fr);
      }
      // brow
      const b0 = st.p(at(H, [side * 0.16 * r, 0.24 * r + (f.old ? -0.02 * r : 0), 0.97 * r]));
      const b1 = st.p(at(H, [side * 0.58 * r, 0.22 * r - (f.brows ?? 0) * 0.08 * r, 0.8 * r]));
      p.line([b0, b1], browC, (f.brows ?? 1) * 2.6 * fr);
      if (f.old) {
        const w0 = st.p(at(H, [side * 0.55 * r, -0.18 * r, 0.82 * r]));
        const w1 = st.p(at(H, [side * 0.68 * r, -0.08 * r, 0.7 * r]));
        p.line([w0, w1], mix(o.skin, INK, 0.5), 1.1 * fr);
      }
    }
  } else {
    const band = [...sphereSel(H, r, 1.04, (u) => Math.abs(u[1] + 0.02) < 0.2 && u[2] > -0.3)];
    if (band.length > 2) p.fill(st.hull(band), f.blindfold, { lw: 1.6 });
  }
  // cheeks (warm)
  if (front > 0.3 && !f.paint && !o.snout && (o.skinKind ?? 'skin') === 'skin') {
    for (const side of [1, -1]) {
      const c = st.p(at(H, [side * 0.55 * r, -0.36 * r, 0.78 * r]));
      p.ctx.globalAlpha = 0.28;
      p.dot(c.x, c.y, r * 0.16 * k, r * 0.1 * k, '#d0605a');
      p.ctx.globalAlpha = 1;
    }
  }
  if (f.paint) {
    const a = st.p(at(H, [0.6 * r, 0.1 * r, 0.78 * r]));
    const b = st.p(at(H, [-0.6 * r, 0.1 * r, 0.78 * r]));
    if (front > 0.2) p.line([a, b], f.paint, 3.2 * fr);
  }
  // nose: small volume (protrudes in profile, casts the shadow crescent in front view)
  const n0 = at(H, [0, 0.0, 0.92 * r]);
  const n1 = at(H, [0, -0.24 * r, 1.12 * r]);
  if (!o.snout) p.fill(st.capsule(n0, n1, 0.1 * r, 0.13 * r), skinM, { lw: 1.2, rim: false, shadow: 1.3 });
  // mouth
  if (front > 0.15 && !o.snout && !(o.beard && (o.beard.style === 'full' || o.beard.style === 'braided'))) {
    const m0 = st.p(at(H, [0.2 * r, -0.5 * r, 0.86 * r]));
    const m1 = st.p(at(H, [-0.2 * r, -0.5 * r, 0.86 * r]));
    const mc = st.p(at(H, [0, -0.53 * r, 0.9 * r]));
    p.line([m0, mc, m1], mix(o.skin, '#5a2030', 0.65), 1.7 * fr);
  }
  if (f.scar && front > 0) {
    const s0 = st.p(at(H, [-0.25 * r, 0.3 * r, 0.95 * r]));
    const s1 = st.p(at(H, [-0.45 * r, -0.3 * r, 0.85 * r]));
    p.line([s0, s1], '#a04a4a', 1.6 * fr);
  }
  if (f.monocle) {
    const u: V3 = [-0.36, -0.04, 0.95];
    if (vis(u) > 0.05) {
      const e = st.p(at(H, scl(u, r * 1.04)));
      const path = new Path2D();
      path.arc(e.x, e.y, r * 0.24 * k, 0, TAU);
      const sh: Shape = { path, x0: e.x - r * 0.24 * k, y0: e.y - r * 0.24 * k, x1: e.x + r * 0.24 * k, y1: e.y + r * 0.24 * k, pts: [] };
      p.fill(sh, m('#bfe4f0', 'glass'), { lw: 2.2, alpha: 0.85 });
      p.line([{ x: e.x + r * 0.2 * k, y: e.y + r * 0.1 * k }, { x: e.x + r * 0.5 * k, y: e.y + r * 0.9 * k }], '#e2a944', 1.4);
    }
  }
  if (f.jaw) {
    const pts = sphereSel(H, r, 1.07, (u) => u[1] < -0.45 && u[2] > -0.1);
    pts.push(at(H, [0, -r * 1.2, r * 0.7]));
    if (pts.length > 2) p.fill(st.hull(pts), f.jaw, { lw: 1.8 });
    const tl = st.p(at(H, [-0.3 * r, -0.62 * r, 1.0 * r]));
    const tr = st.p(at(H, [0.3 * r, -0.62 * r, 1.0 * r]));
    if (front > 0.2) p.line([tl, tr], INK, 1.5);
  }
}

function drawHat(st: Stage, rig: Rig, hat: NonNullable<Kit['outfit']['hat']>): void {
  const H = rig.head;
  const r = rig.body.headR;
  st.add(H.o, 0.7, (p) => {
    switch (hat.kind) {
      case 'wide': {
        const brim = st.hull([...ring(H, r * 0.6, r * 1.75, r * 1.7, 24), ...ring(H, r * 0.68, r * 1.7, r * 1.65, 24)]);
        p.fill(brim, hat.mat, { shadow: 0.6 });
        const crown = st.hull([...ring(H, r * 0.45, r * 1.0, r * 1.0, 16), ...ring(H, r * 1.05, r * 0.85, r * 0.85, 14), ...ring(H, r * 1.25, r * 0.55, r * 0.55, 10)]);
        p.fill(crown, hat.mat);
        if (hat.band) {
          const band = st.hull([...ring(H, r * 0.48, r * 1.01, r * 1.01, 16), ...ring(H, r * 0.68, r * 0.97, r * 0.97, 16)]);
          p.fill(band, hat.band, { lw: 1.4 });
          p.fill(st.hull([...ring(H, r * 0.68, r * 0.95, r * 0.95, 16), ...ring(H, r * 1.08, r * 0.84, r * 0.84, 14), ...ring(H, r * 1.25, r * 0.55, r * 0.55, 10)]), hat.mat, { lw: 1.6 });
        }
        break;
      }
      case 'tricorn': {
        const pts: V3[] = [];
        for (let i = 0; i < 30; i++) {
          const a = (i / 30) * TAU;
          const rr = r * (1.55 + 0.35 * Math.cos(3 * a));
          pts.push(at(H, [Math.sin(a) * rr, r * 0.55 + 0.25 * r * (1 + Math.cos(3 * a)), Math.cos(a) * rr]));
        }
        p.fill(st.hull([...pts, ...ring(H, r * 1.25, r * 0.7, r * 0.7, 10)]), hat.mat);
        const crown = st.hull([...ring(H, r * 0.6, r * 1.0, r * 1.0, 14), ...ring(H, r * 1.3, r * 0.75, r * 0.75, 12)]);
        p.fill(crown, hat.mat, { lw: 1.6 });
        if (hat.band) {
          const q = st.p(at(H, [r * 0.0, r * 0.95, r * 1.25]));
          p.dot(q.x, q.y, r * 0.18 * st.view.k, r * 0.18 * st.view.k, hat.band.c);
        }
        break;
      }
      case 'cap': {
        const crown = st.hull([...ring(H, r * 0.3, r * 1.08, r * 1.08, 16), ...ring(H, r * 0.75, r * 1.12, r * 1.15, 16, r * 0.1), ...ring(H, r * 1.05, r * 0.6, r * 0.6, 10)]);
        p.fill(crown, hat.mat, { folds: [st.pts2([at(H, [0, r * 1.05, 0]), at(H, [0, r * 0.4, r * 1.05])])] });
        const visor = st.hull([at(H, [r * 0.8, r * 0.35, r * 0.6]), at(H, [-r * 0.8, r * 0.35, r * 0.6]), at(H, [r * 0.7, r * 0.28, r * 1.45]), at(H, [-r * 0.7, r * 0.28, r * 1.45]), at(H, [0, r * 0.28, r * 1.6])]);
        p.fill(visor, { c: mix(hat.mat.c, '#000000', 0.25), k: hat.mat.k }, { lw: 1.6 });
        break;
      }
      case 'helm': {
        const dome = st.hull(sphereSel(H, r, 1.14, (u) => u[1] > 0.0));
        p.fill(dome, hat.mat);
        const rim = st.hull([...ring(H, 0, r * 1.2, r * 1.2, 18), ...ring(H, r * 0.12, r * 1.2, r * 1.2, 18)]);
        p.fill(rim, hat.band ?? hat.mat, { lw: 1.6 });
        p.fill(st.capsule(at(H, [0, r * 0.1, r * 1.15]), at(H, [0, -r * 0.45, r * 1.22]), r * 0.1, r * 0.1), hat.band ?? hat.mat, { lw: 1.3 });
        break;
      }
      case 'kerchief': {
        const pts = sphereSel(H, r, 1.12, (u) => u[1] > 0.22 || (u[2] < -0.3 && u[1] > -0.35));
        pts.push(at(H, [0, -r * 0.2, -r * 1.35]));
        p.fill(st.hull(pts), hat.mat, { folds: [st.pts2([at(H, [0, r * 1.1, 0]), at(H, [0, -r * 0.1, -r * 1.3])])] });
        const knot = at(H, [0, -r * 0.3, -r * 1.25]);
        p.fill(st.sphere(knot, r * 0.2), hat.mat, { lw: 1.4 });
        break;
      }
      case 'veil': {
        // nun's veil: cap over the crown (the long back drape is drawn behind the head in drawHead)
        const pts = sphereSel(H, r, 1.18, (u) => u[1] > 0.4 || (u[2] < -0.1 && u[1] > -0.2));
        p.fill(st.hull(pts), hat.mat, { folds: [st.pts2([at(H, [r * 0.6, r * 1.0, 0]), at(H, [r * 1.0, r * 0.2, -r * 0.3])])] });
        if (hat.band) {
          const band = st.hull([...ring(H, r * 0.32, r * 1.14, r * 1.14, 16), ...ring(H, r * 0.52, r * 1.1, r * 1.1, 16)]);
          p.fill(band, hat.band, { lw: 1.4 });
        }
        break;
      }
      case 'band':
      case 'goggles': {
        // strap: the visible front half of a ring around the head
        const pts = ring(H, r * 0.42, r * 1.1, r * 1.1, 28).filter((q) => st.faces(norm(sub(q, at(H, [0, r * 0.42, 0])))) > 0);
        if (pts.length > 1) {
          const pp = st.pts2(pts).sort((a2, b2) => a2.x - b2.x);
          p.rope(pp, hat.mat.c, 3.4);
        }
        if (hat.kind === 'goggles') {
          for (const side of [1, -1]) {
            const c = at(H, [side * r * 0.36, r * 0.5, r * 0.98]);
            if (st.faces(dirOf(H, norm([side * 0.36, 0.5, 0.98]))) < -0.1) continue;
            p.fill(st.sphere(c, r * 0.27), hat.band ?? m('#c06a3a', 'metal'), { lw: 1.6 });
            p.fill(st.sphere(madd(c, H.z, r * 0.06), r * 0.17), m('#9fd0d8', 'glass'), { lw: 1.2 });
          }
        }
        break;
      }
      case 'tophat': {
        // tall stovepipe with a narrow brim (lamplighter)
        p.fill(st.hull([...ring(H, r * 0.62, r * 1.45, r * 1.4, 20), ...ring(H, r * 0.7, r * 1.42, r * 1.38, 20)]), hat.mat, { shadow: 0.6 });
        p.fill(st.hull([...ring(H, r * 0.6, r * 0.92, r * 0.92, 16), ...ring(H, r * 2.35, r * 0.98, r * 0.98, 16)]), hat.mat, { folds: [st.pts2([at(H, [r * 0.3, r * 2.2, r * 0.9]), at(H, [r * 0.3, r * 0.9, r * 0.92])])] });
        if (hat.band) p.fill(st.hull([...ring(H, r * 0.72, r * 0.95, r * 0.95, 16), ...ring(H, r * 1.0, r * 0.96, r * 0.96, 16)]), hat.band, { lw: 1.4 });
        break;
      }
      case 'straw': {
        // conical straw hat (wide, shallow cone) with a woven band
        const tip = at(H, [0, r * 1.75, 0]);
        p.fill(st.hull([...ring(H, r * 0.5, r * 2.05, r * 2.0, 24), tip]), hat.mat, { shadow: 0.6, folds: [st.pts2([tip, at(H, [r * 1.4, r * 0.62, r * 1.3])]), st.pts2([tip, at(H, [-r * 1.4, r * 0.62, r * 1.3])]), st.pts2([tip, at(H, [0, r * 0.55, r * 2])])] });
        if (hat.band) p.line(st.pts2(ring(H, r * 0.85, r * 1.55, r * 1.5, 24).filter((q) => st.faces(norm(sub(q, at(H, [0, r * 0.85, 0])))) > 0).sort((a2, b2) => st.p(a2).x - st.p(b2).x)), hat.band.c, 2.2);
        break;
      }
      case 'bearhood':
      case 'wolfhood': {
        const bear = hat.kind === 'bearhood';
        const pts = [...sphereSel(H, r, 1.25, (u) => u[1] > 0.12 || u[2] < -0.1), at(H, [0, r * 0.5, r * 1.5])];
        let hull = hull2(st.pts2(pts));
        hull = jagged(hull, 3.2 * st.view.k, 2);
        const sh = shapeFrom(hull, poly(hull));
        p.fill(sh, hat.mat);
        // snout over the brow
        const sn0 = at(H, [0, r * 0.62, r * 1.05]);
        const sn1 = at(H, [0, r * 0.52, r * (bear ? 1.75 : 1.95)]);
        p.fill(st.capsule(sn0, sn1, r * (bear ? 0.42 : 0.32), r * (bear ? 0.3 : 0.18)), hat.mat, { lw: 1.6 });
        const nose = st.p(sn1);
        p.dot(nose.x, nose.y, r * 0.12 * st.view.k, r * 0.09 * st.view.k, INK);
        // ears
        for (const side of [1, -1]) {
          const e0 = at(H, [side * r * 0.75, r * 1.05, -r * 0.1]);
          if (bear) p.fill(st.sphere(e0, r * 0.3), hat.mat, { lw: 1.6 });
          else {
            const ear = st.poly([at(H, [side * r * 0.45, r * 1.05, 0]), at(H, [side * r * 1.0, r * 0.95, 0]), at(H, [side * r * 0.85, r * 1.85, -r * 0.1])]);
            p.fill(ear, hat.mat, { lw: 1.6 });
          }
        }
        break;
      }
    }
  });
}
