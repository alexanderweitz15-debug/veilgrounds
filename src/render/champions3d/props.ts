// Signature props of the 26 champions as low-poly meshes. Held props are authored in the HOLD pose (model space,
// how the champion carries the item while idle) and bound rigidly to the hand / forearm bone; back items ride on the
// chest bone; hanging items (bell, buckets, hook, lantern, trap) get their own pendulum bone ("dangleL/R").
import * as THREE from 'three';
import { m as mat, type Mat } from '../champions/core';
import { holdOf } from './anim';
import type { Ctx } from './ctx';
import { ell } from './humanoid';
import { T, type Vec } from './mesh';

type V3 = THREE.Vector3;
const v = (x: number, y: number, z: number): V3 => new THREE.Vector3(x, y, z);
const arr = (p: V3): Vec => [p.x, p.y, p.z];

const WOOD = mat('#6a4a2a', 'wood');
const WOOD_D = mat('#4a3424', 'wood');
const BRASS = mat('#c9973f', 'metal');
const COPPER = mat('#a8643c', 'metal');
const IRON = mat('#6a6e76', 'metal');
const IRON_D = mat('#4a4c54', 'metal');
const STEEL = mat('#b9c2cc', 'metal');
const LEATHER = mat('#6a4630', 'leather');
const ROPE = mat('#a08a62', 'cloth');

// ------------------------------------------------------------------------------------------------ helpers
/** Hold-pose point in the fist of `side` (L / R) and the hold aim of that hand. */
function grip(c: Ctx, side: 'L' | 'R', depth = 0.48): { g: V3; aim: V3; down: V3 } {
  const M = c.holdM[c.idx(`hand${side}`)]!;
  const q = new THREE.Quaternion().setFromRotationMatrix(M);
  const down = v(0, -1, 0).applyQuaternion(q);
  const w = v(M.elements[12]!, M.elements[13]!, M.elements[14]!);
  const g = w.clone().addScaledVector(down, c.L.hand * depth);
  const h = holdOf(c.kit.hold)[side];
  const aim = h.aim ? v(...h.aim).normalize() : down.clone();
  return { g, aim, down };
}

/** Cylinder-ish rod between two points. */
function rod(c: Ctx, a: V3, b: V3, r0: number, r1 = r0, n = 6): void {
  c.b.limb(arr(a), arr(b), r0, r1, n);
}

/** Orthonormal frame with +y along `axis` (+z as close to `fwd` as possible). */
function frame(o: V3, axis: V3, fwd = v(0, 0, 1)): THREE.Matrix4 {
  const y = axis.clone().normalize();
  let x = new THREE.Vector3().crossVectors(y, fwd);
  if (x.lengthSq() < 1e-4) x = new THREE.Vector3().crossVectors(y, v(1, 0, 0));
  x.normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(o);
}

function torus(c: Ctx, m4: THREE.Matrix4, R: number, r: number, seg = 10, tube = 4, arc = Math.PI * 2): void {
  c.b.geo(new THREE.TorusGeometry(R, r, tube, seg, arc), m4);
}

// ------------------------------------------------------------------------------------------------ bows
function bow(c: Ctx, len: number, wood: Mat, o: { fire?: boolean; grip?: Mat } = {}): void {
  const { g, aim } = grip(c, 'L');
  c.held('handL').paint(wood);
  const F = frame(g, aim, v(0, 0, 1));
  const pts: V3[] = [];
  const N = 8;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * 2 - 1;
    const bulge = 7 * (1 - t * t) - (Math.abs(t) > 0.78 ? (Math.abs(t) - 0.78) * 26 : 0);
    pts.push(v(0, (t * len) / 2, bulge + 1.5).applyMatrix4(F));
  }
  for (let i = 0; i < N; i++) {
    const mid = Math.abs(i + 0.5 - N / 2) / (N / 2);
    rod(c, pts[i]!, pts[i + 1]!, 1.9 - mid * 0.9, 1.9 - Math.abs(i + 1.5 - N / 2) / (N / 2) * 0.9, 5);
  }
  c.paint(o.grip ?? LEATHER);
  rod(c, v(0, -6, 7.5).applyMatrix4(F), v(0, 6, 7.5).applyMatrix4(F), 2.5, 2.5, 6);
  if (o.fire) {
    c.paint('#ff9a4a', { glow: 1 });
    for (const p of [pts[0]!, pts[N]!]) c.b.blob(arr(p), [2.6, 2.6, 2.6], 0);
  }
  // string: tips on the bow hand, middle vertex on the 'string' bone (pulled by the draw hand)
  const top = pts[N]!.clone();
  const bot = pts[0]!.clone();
  const mid = top.clone().lerp(bot, 0.5);
  const sb = c.addBone('string', 'handL', arr(mid));
  const midBind = c.bindP[sb]!;
  c.held('handL').paint('#e8e0c8');
  c.b.set({ weights: (p) => (p.distanceTo(midBind) < 1.6 ? [[sb, 1]] : [[c.idx('handL'), 1]]) });
  const side = v(0.45, 0, 0);
  for (const [a, b] of [
    [top, mid],
    [mid, bot],
  ] as const) {
    c.b.quad(arr(a.clone().sub(side)), arr(b.clone().sub(side)), arr(b.clone().add(side)), arr(a.clone().add(side)));
    c.b.quad(arr(a.clone().add(side)), arr(b.clone().add(side)), arr(b.clone().sub(side)), arr(a.clone().sub(side)));
  }
  c.b.set({ weights: null });
}

function quiver(c: Ctx, m: Mat, fletch: string, smoulder = false): void {
  const L = c.L;
  c.on('chest').paint(m);
  const base = v(-L.shW * 0.3, L.waist + 4, -L.chestD - 5);
  const top = v(L.shW * 0.45, L.shoulderY + 8, -L.chestD - 7);
  rod(c, base, top, 4.2, 5, 6);
  c.paint(smoulder ? mat('#ff8a3a', 'glow') : mat(fletch, 'cloth'), smoulder ? { glow: 0.9 } : {});
  const dir = top.clone().sub(base).normalize();
  for (let i = 0; i < 4; i++) {
    const p = top.clone().addScaledVector(dir, 3).add(v(Math.sin(i * 1.7) * 2.2, 0, Math.cos(i * 1.7) * 2));
    c.b.box(p.x, p.y + 4, p.z, 1.6, 8, 1.6, 0.4);
  }
}

// ------------------------------------------------------------------------------------------------ poles & blades
function pole(c: Ctx, side: 'L' | 'R', below: number, above: number, r: number, m: Mat): { g: V3; aim: V3; top: V3; bot: V3 } {
  const { g, aim } = grip(c, side);
  c.held(`hand${side}`).paint(m);
  const bot = g.clone().addScaledVector(aim, -below);
  const top = g.clone().addScaledVector(aim, above);
  rod(c, bot, top, r, r * 0.85, 6);
  return { g, aim, top, bot };
}

function blade(c: Ctx, side: 'L' | 'R', len: number, w: number, m: Mat, o: { curve?: number; hilt?: Mat; guard?: boolean; dir?: V3 } = {}): void {
  const { g, aim } = grip(c, side);
  const dir = o.dir ?? aim;
  c.held(`hand${side}`);
  const F = frame(g, dir, v(0, 1, 0));
  c.paint(o.hilt ?? LEATHER);
  c.b.push(F);
  c.b.box(0, -2, 0, 2.2, 9, 2.2);
  if (o.guard !== false) {
    c.paint(BRASS);
    c.b.box(0, 3, 0, w * 2.2, 1.4, 2.2);
  }
  c.paint(m);
  const cv = o.curve ?? 0;
  const segs = 3;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    const x0 = cv * t0 * t0 * len * 0.18;
    const x1 = cv * t1 * t1 * len * 0.18;
    const w0 = w * (1 - t0 * 0.35);
    const w1 = i === segs - 1 ? 0.2 : w * (1 - t1 * 0.35);
    const y0 = 4 + t0 * len;
    const y1 = 4 + t1 * len;
    c.b.plate(
      [
        [x0 - w0 * 0.5, y0],
        [x0 + w0 * 0.5, y0],
        [x1 + w1 * 0.5, y1],
        [x1 - w1 * 0.5, y1],
      ],
      0.9,
      T(0, 0, 0, 0, Math.PI / 2, 0),
    );
  }
  c.b.pop();
}

// ------------------------------------------------------------------------------------------------ per champion
type PropFn = (c: Ctx) => void;

export const PROPS3D: Record<string, PropFn> = {
  ilvane: (c) => {
    const L = c.L;
    const { top } = pole(c, 'R', 46, 66, 1.3, WOOD);
    c.paint('#a58ae0', { glow: 0.85 });
    c.b.geo(new THREE.ConeGeometry(5.5, 13, 6), T(top.x, top.y + 3, top.z));
    c.paint(BRASS);
    c.b.box(top.x, top.y - 5, top.z, 4.4, 2, 4.4);
    // loom frame on the back
    c.on('chest').paint(WOOD_D);
    const z = -L.chestD - 6;
    const y0 = L.waist - 2;
    const y1 = L.shoulderY + 22;
    for (const s of [1, -1]) c.b.box(s * 13, (y0 + y1) / 2, z, 2.6, y1 - y0, 2.6);
    for (const y of [y0 + 4, y1 - 2, (y0 + y1) / 2 + 6]) c.b.box(0, y, z, 30, 2.4, 2.6);
    c.paint('#b49cf0', { glow: 0.45 });
    for (let i = -2; i <= 2; i++) c.b.box(i * 4.6, (y0 + y1) / 2 + 1, z - 0.4, 0.7, y1 - y0 - 8, 0.7);
  },
  thessaly: (c) => {
    const { top, aim } = pole(c, 'R', 38, 96, 1.15, BRASS);
    c.paint('#fff0c0', { glow: 1 });
    c.b.geo(new THREE.OctahedronGeometry(5.5, 0), frame(top.clone().addScaledVector(aim, 5), aim).multiply(new THREE.Matrix4().makeScale(0.8, 1.6, 0.8)));
    c.paint(BRASS);
    for (const s of [1, -1]) c.b.box(top.x + s * 4, top.y - 2, top.z, 6, 1.4, 1.2);
  },
  kaelen: (c) => {
    const L = c.L;
    blade(c, 'R', 20, 3, STEEL, { guard: true });
    blade(c, 'L', 18, 2.8, STEEL, { guard: true });
    c.on('hips').paint(LEATHER);
    c.b.box(-L.hipW * 1.0, L.hipY - 4, -L.chestD * 0.5, 4.5, 11, 12, 0.95);
    c.paint(mat('#4a3224', 'leather'));
    c.b.box(-L.hipW * 1.0 - 0.5, L.hipY + 1.5, -L.chestD * 0.5, 5, 2, 12.6);
  },
  renn: (c) => {
    const L = c.L;
    blade(c, 'R', 56, 5.5, STEEL, { curve: 1 });
    // seven blades fanned like a star on the back
    c.on('chest');
    const hub = v(0, L.chestY + 3, -L.chestD - 4);
    for (let i = 0; i < 7; i++) {
      const a = -1.35 + (i / 6) * 2.7;
      const dir = v(Math.sin(a), Math.cos(a), -0.15).normalize();
      const F = frame(hub.clone().addScaledVector(dir, 6), dir, v(0, 0, -1));
      c.b.push(F);
      c.paint(LEATHER);
      c.b.box(0, 3, 0, 2, 9, 2);
      c.paint(BRASS);
      c.b.box(0, 8, 0, 6, 1.4, 2);
      c.paint(STEEL);
      const len = 44 + (3 - Math.abs(i - 3)) * 4;
      c.b.plate(
        [
          [-2.4, 9],
          [2.4, 9],
          [1.6, 9 + len * 0.8],
          [0, 9 + len],
          [-1.6, 9 + len * 0.8],
        ],
        0.9,
      );
      c.b.pop();
    }
    c.paint(mat('#4a3a30', 'leather'));
    c.b.blob(arr(hub), [6, 6, 3], 0);
  },
  aurel: (c) => {
    const L = c.L;
    const { top } = pole(c, 'R', 44, 60, 1.2, WOOD_D);
    c.paint(BRASS);
    c.b.box(top.x, top.y - 16, top.z, 1, 24, 1);
    c.b.geo(new THREE.CylinderGeometry(4.5, 4.5, 1.6, 8), T(top.x, top.y - 29, top.z, Math.PI / 2, 0, 0));
    c.b.blob([top.x, top.y + 2, top.z], [2.6, 2.6, 2.6], 0);
    // clock face backpack
    c.on('chest');
    const cz = -L.chestD - 7;
    const cy = L.chestY + 5;
    c.paint(BRASS);
    c.b.geo(new THREE.CylinderGeometry(19, 19, 6, 14), T(0, cy, cz, Math.PI / 2, 0, 0));
    c.paint('#efe4c8');
    c.b.geo(new THREE.CylinderGeometry(15.5, 15.5, 1, 14), T(0, cy, cz - 3.2, Math.PI / 2, 0, 0));
    c.paint('#2a2228');
    c.b.box(0, cy + 5, cz - 3.9, 1.2, 11, 0.6);
    c.b.push(T(3, cy - 1, cz - 3.9, 0, 0, -1.1));
    c.b.box(0, 0, 0, 1.2, 8, 0.6);
    c.b.pop();
    c.paint(COPPER);
    for (const [x, y, r] of [
      [16, cy + 16, 7],
      [-14, cy + 17, 5.5],
      [18, cy - 10, 5],
    ] as const) {
      c.b.geo(new THREE.CylinderGeometry(r, r, 2.5, 8), T(x, y, cz + 1, Math.PI / 2, 0, 0));
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        c.b.box(x + Math.cos(a) * r, y + Math.sin(a) * r, cz + 1, 2, 2, 2.4);
      }
    }
    c.paint(LEATHER);
    for (const s of [1, -1]) c.b.box(s * L.shW * 0.42, L.shoulderY - 2, -L.chestD * 0.2, 3, 2, L.chestD * 2.2);
  },
  seraphyne: (c) => {
    const { top, aim } = pole(c, 'R', 40, 88, 1.25, COPPER);
    c.paint(BRASS);
    for (let k = 0; k < 3; k++) torus(c, frame(top.clone().addScaledVector(aim, -8 - k * 6), aim).multiply(T(0, 0, 0, Math.PI / 2, 0, 0)), 3.2 - k * 0.3, 0.7, 8, 3);
    c.paint('#cfe0ff', { glow: 0.9 });
    const F = frame(top, aim);
    for (const s of [1, -1]) {
      const a = top.clone();
      const b = v(s * 4, 16, 0).applyMatrix4(F);
      const d = v(s * 1, 22, 0).applyMatrix4(F);
      rod(c, a, b, 1, 0.8, 4);
      rod(c, b, d, 0.8, 0.2, 4);
    }
  },
  brom: (c) => {
    const { g, aim } = grip(c, 'R');
    c.held('handR').paint(WOOD);
    const bot = g.clone().addScaledVector(aim, -26);
    const top = g.clone().addScaledVector(aim, 70);
    rod(c, bot, top, 2.3, 2.6, 6);
    // root wraps along the haft
    c.paint(mat('#5a3e26', 'wood'));
    for (let k = 0; k < 5; k++) {
      const p = g.clone().addScaledVector(aim, -18 + k * 18);
      c.b.blob(arr(p), [3.6, 4.4, 3.6], 0, k);
    }
    c.b.blob(arr(bot), [4.5, 4, 4.5], 0);
    // big axe head at the top, blade facing up/forward
    const F = frame(top.clone().addScaledVector(aim, -6), aim, v(0, 1, 0.3));
    c.b.push(F);
    c.paint(IRON_D);
    c.b.box(0, 0, 0, 7, 12, 7);
    c.paint(STEEL);
    c.b.plate(
      [
        [-2, -7],
        [22, -17],
        [26, 0],
        [22, 17],
        [-2, 7],
      ],
      2.4,
      T(0, 0, 0, 0, -Math.PI / 2, 0),
    );
    c.b.pop();
  },
  oleth: (c) => {
    const L = c.L;
    const { top, aim } = pole(c, 'R', 45, 130, 1.4, WOOD_D);
    c.paint(BRASS);
    c.b.blob(arr(top.clone().addScaledVector(aim, 3)), [3, 3, 3], 0);
    const bar = top.clone().addScaledVector(aim, -6);
    c.b.box(bar.x, bar.y, bar.z, 34, 2, 2);
    c.paint(mat('#7a2e2a', 'cloth'));
    const w = 15;
    const hgt = 46;
    const pts: [number, number][] = [
      [-w, 0],
      [-w, -hgt],
      [0, -hgt + 8],
      [w, -hgt],
      [w, 0],
    ];
    c.b.plate(pts, 1, T(bar.x, bar.y - 1, bar.z + 1.5, 0, 0, 0));
    c.paint(BRASS);
    c.b.geo(new THREE.CylinderGeometry(5, 5, 1.2, 8), T(bar.x, bar.y - 20, bar.z + 2.5, Math.PI / 2, 0, 0));
    // stone tablet on the back
    c.on('chest').paint(mat('#8a8680', 'stone'));
    const z = -L.chestD - 4;
    c.b.box(0, L.chestY + 2, z, 22, 32, 5, 0.85, 1);
    c.paint('#5a5650');
    for (let i = 0; i < 4; i++) c.b.box(0, L.chestY + 10 - i * 6, z - 2.6, 14 - (i % 2) * 4, 1.2, 0.6);
    c.paint(LEATHER);
    for (const s of [1, -1]) c.b.box(s * L.shW * 0.45, L.shoulderY - 2, -L.chestD * 0.2, 3, 2, L.chestD * 2.3);
  },
  harrow: (c) => {
    const L = c.L;
    // ram-head tower shield on the left forearm
    const fa = c.holdM[c.idx('fArmL')]!;
    const q = new THREE.Quaternion().setFromRotationMatrix(fa);
    const down = v(0, -1, 0).applyQuaternion(q);
    const elbow = v(fa.elements[12]!, fa.elements[13]!, fa.elements[14]!);
    const mid = elbow.clone().addScaledVector(down, L.fore * 0.5).add(v(0, -2, 7));
    c.held('fArmL');
    const F = new THREE.Matrix4().makeTranslation(mid.x, mid.y, mid.z);
    c.b.push(F);
    c.paint(mat('#5a4636', 'wood'));
    c.b.rings([ell(0, -34, 0, 17, 5, 8, 0.85, 1.15), ell(0, 0, 0, 17, 5, 8, 0.85, 1.15), ell(0, 22, 0, 17, 5, 8, 0.85, 1.15)], false);
    c.b.rings([ell(0, -34, -1, 17, 5, 8, 0.85, 1.15), ell(0, 0, -1, 17, 5, 8, 0.85, 1.15), ell(0, 22, -1, 17, 5, 8, 0.85, 1.15)].map((r) => r.slice().reverse()), false);
    c.paint(IRON);
    c.b.box(0, 22.5, 4, 32, 2.4, 3);
    c.b.box(0, -34.5, 4, 32, 2.4, 3);
    for (const s of [1, -1]) c.b.box(s * 15.5, -6, 2.4, 2.4, 58, 3);
    // ram head
    c.paint(mat('#c8bca4', 'stone'));
    c.b.blob([0, 4, 7], [6, 8, 5], 0);
    c.b.blob([0, -4, 9], [4, 5, 4], 0);
    c.paint(mat('#8a7a60', 'stone'));
    for (const s of [1, -1]) torus(c, T(s * 7, 6, 7, 0, s * 0.4, 0), 5, 2, 7, 4, Math.PI * 1.5);
    c.b.pop();
    // short maul in the right hand
    const { g, aim } = grip(c, 'R');
    c.held('handR').paint(WOOD);
    const top = g.clone().addScaledVector(aim, 26);
    rod(c, g.clone().addScaledVector(aim, -8), top, 1.5, 1.6, 5);
    c.paint(IRON);
    c.b.push(frame(top, aim, v(1, 0, 0)));
    c.b.box(0, 3, 0, 14, 8, 8);
    c.b.pop();
  },
  isolde: (c) => {
    const L = c.L;
    // glass shard arm: crystal blade along the right forearm, well past the hand
    const fa = c.holdM[c.idx('fArmR')]!;
    const q = new THREE.Quaternion().setFromRotationMatrix(fa);
    const down = v(0, -1, 0).applyQuaternion(q);
    const elbow = v(fa.elements[12]!, fa.elements[13]!, fa.elements[14]!);
    c.held('fArmR').paint('#a8dce4', { metal: 0.8, glow: 0.18 });
    const F = frame(elbow.clone().addScaledVector(down, 2), down, v(-1, 0, 0));
    c.b.push(F);
    c.b.rings([ell(0, 0, 0, 4.2, 3, 6), ell(0, L.fore * 0.6, 0.5, 5, 3.4, 6), ell(0, L.fore + 18, 0, 3.8, 1.8, 6), ell(0, L.fore + 46, 0, 0.3, 0.3, 6)], true, true, true);
    c.paint('#e4f6f8', { metal: 1, glow: 0.3 });
    c.b.box(-3.8, L.fore + 10, 0, 0.8, 26, 0.8, 0.4);
    c.b.pop();
    // copper wire spool on the back (ring with a hole)
    c.on('chest').paint(COPPER);
    torus(c, T(0, L.chestY + 2, -L.chestD - 7), 13, 4.4, 12, 6);
    c.paint(mat('#7a3e22', 'metal'));
    torus(c, T(0, L.chestY + 2, -L.chestD - 7), 9, 1.4, 12, 3);
    c.on('hips').paint(COPPER);
    for (const s of [1, -1]) torus(c, T(s * L.hipW * 1.1, L.hipY - 1, 0, 0, Math.PI / 2, 0), 4.5, 1.6, 8, 4);
  },
  dagny: (c) => {
    const L = c.L;
    const fa = c.holdM[c.idx('fArmL')]!;
    const q = new THREE.Quaternion().setFromRotationMatrix(fa);
    const down = v(0, -1, 0).applyQuaternion(q);
    const elbow = v(fa.elements[12]!, fa.elements[13]!, fa.elements[14]!);
    const mid = elbow.clone().addScaledVector(down, L.fore * 0.55).add(v(1, 0, 9));
    c.held('fArmL').paint(IRON_D);
    c.b.push(T(mid.x, mid.y, mid.z, -0.2, 0, 0));
    c.b.rings([ell(0, -14, 0, 10, 10, 10), ell(0, -7, 0, 17, 15, 10), ell(0, 5, 0, 17, 15, 10), ell(0, 12, 0, 11, 10, 10)], true, true, true);
    c.paint('#ff9e45', { glow: 1 });
    c.b.loft([{ c: [0, -1.5, 0], rx: 17.4, rz: 15.4 }, { c: [0, 0.5, 0], rx: 17.4, rz: 15.4 }], 10, false, false);
    c.paint(IRON);
    c.b.limb([0, 4, 13], [0, 9, 22], 3, 1.6, 5);
    torus(c, T(0, 13, 0, 0, 0, 0), 8, 1.1, 8, 3, Math.PI);
    c.b.pop();
    // smith hammer
    const { g, aim } = grip(c, 'R');
    c.held('handR').paint(WOOD);
    const top = g.clone().addScaledVector(aim, 24);
    rod(c, g.clone().addScaledVector(aim, -7), top, 1.4, 1.5, 5);
    c.paint(IRON_D);
    c.b.push(frame(top, aim, v(1, 0, 0)));
    c.b.box(0, 2.5, 0, 6, 6, 13, 1, 1);
    c.b.pop();
    // steam vents on the back
    c.on('chest').paint(IRON);
    for (const s of [1, -1]) {
      c.b.limb([s * L.shW * 0.5, L.chestY, -L.chestD - 2], [s * L.shW * 0.62, L.shoulderY + 12, -L.chestD - 4], 2.4, 2, 6);
      c.paint('#e8e4dc', { glow: 0.25 });
      c.b.blob([s * L.shW * 0.64, L.shoulderY + 17, -L.chestD - 4], [3.5, 4, 3.5], 0);
      c.paint(IRON);
    }
  },
  vessa: (c) => {
    for (const side of ['L', 'R'] as const) {
      const { g, aim } = grip(c, side, 0.65);
      c.held(`hand${side}`).paint(STEEL);
      const up = v(0, 1, 0);
      const across = new THREE.Vector3().crossVectors(aim, up).normalize();
      for (let k = -1; k <= 1; k++) {
        const base = g.clone().addScaledVector(across, k * 1.8);
        const tip = base.clone().addScaledVector(aim, 18).addScaledVector(up, -4 + Math.abs(k) * 1.5);
        const midp = base.clone().addScaledVector(aim, 10).addScaledVector(up, 1);
        rod(c, base, midp, 0.9, 0.7, 4);
        rod(c, midp, tip, 0.7, 0.15, 4);
      }
    }
    const L = c.L;
    c.on('chest').paint(mat('#d8ccb0', 'stone'));
    for (let i = 0; i < 7; i++) {
      const a = -0.9 + (i / 6) * 1.8;
      c.b.blob([Math.sin(a) * L.shW * 0.5, L.neckBase - 4 - Math.cos(a) * 3, Math.cos(a) * L.chestD * 0.95], [1.3, 1.6, 1.3], 0);
    }
  },
  nyx: (c) => {
    blade(c, 'R', 26, 2.2, mat('#a8a4c0', 'metal'), { guard: false });
    blade(c, 'L', 24, 2.2, mat('#a8a4c0', 'metal'), { guard: false });
    const L = c.L;
    c.on('chest').paint(mat('#2a2238', 'cloth'));
    for (const [x, h, z] of [
      [10, 16, -4],
      [-12, 20, -6],
      [3, 12, -10],
    ] as const)
      c.b.geo(new THREE.ConeGeometry(3.5, h, 4), T(x, L.shoulderY + 6 + h / 2, z, -0.3, x * 0.05, x * -0.02));
  },
  grimald: (c) => {
    const L = c.L;
    // net bundle rolled across the back
    c.on('chest').paint(mat('#8a7a5a', 'cloth'));
    c.b.geo(new THREE.CylinderGeometry(8.5, 8.5, 34, 8), T(0, L.shoulderY + 2, -L.chestD - 8, 0, 0, Math.PI / 2 - 0.15));
    c.paint(ROPE);
    for (const s of [-1, 0, 1]) c.b.geo(new THREE.CylinderGeometry(9, 9, 2, 8), T(s * 11, L.shoulderY + 2 + s * 1.6, -L.chestD - 8, 0, 0, Math.PI / 2 - 0.15));
    // jaw trap on a short chain from the right fist
    const { g } = grip(c, 'R');
    c.held('handR').paint(IRON);
    for (let k = 0; k < 3; k++) c.b.box(g.x, g.y - 3 - k * 4, g.z, k % 2 ? 0.8 : 2.4, 4, k % 2 ? 2.4 : 0.8);
    const dp = g.clone().add(v(0, -14, 0));
    c.addBone('dangleR', 'handR', arr(dp));
    c.held('dangleR').paint(IRON_D);
    const jc = dp.clone().add(v(0, -12, 0));
    c.b.box(jc.x, jc.y - 3, jc.z, 15, 2.5, 6);
    c.paint(STEEL);
    for (const s of [1, -1]) {
      torus(c, T(jc.x, jc.y, jc.z + s * 2.5, s * 0.6, 0, 0), 9, 1.1, 8, 3, Math.PI);
      for (let k = 0; k < 4; k++) {
        const a = 0.35 + (k / 3) * 2.4;
        c.b.geo(new THREE.ConeGeometry(0.9, 3.4, 3), T(jc.x + Math.cos(a) * 8.4, jc.y + Math.sin(a) * 8.4 * Math.cos(0.6), jc.z + s * 2.5 + s * Math.sin(a) * 5, s * 0.6, 0, a - Math.PI / 2));
      }
    }
    c.paint(IRON);
    c.b.box(dp.x, dp.y - 4, dp.z, 1, 8, 1);
  },
  lio: (c) => {
    const L = c.L;
    for (const side of ['L', 'R'] as const) {
      const { g, aim } = grip(c, side, 0.4);
      c.held(`hand${side}`).paint(mat('#7a7470', 'stone'));
      c.b.push(frame(g, aim, v(0, 1, 0)));
      c.b.box(0, 1, 0, 11, 11, 10, 0.9, 0.9);
      c.b.box(0, -6.5, 0, 9, 6, 9, 1.1, 1.1);
      c.paint(BRASS);
      c.b.box(0, -2.5, 0, 11.6, 2.2, 10.6);
      c.b.box(0, 6.6, 0, 9.6, 1.6, 8.6);
      c.paint('#ffb04a', { glow: 0.9 });
      c.b.box(0, 3, 5.2, 4, 3, 0.6);
      c.b.pop();
    }
    c.on('hips').paint(LEATHER);
    c.b.box(L.hipW * 1.0, L.hipY - 4, 3, 5, 7, 6, 0.85);
    c.paint('#ffcf6a', { glow: 0.9 });
    c.b.blob([L.hipW * 1.0 + 1.5, L.hipY - 0.5, 5], [2.4, 2.4, 2.4], 0);
    c.paint(ROPE);
    torus(c, T(-L.hipW * 1.05, L.hipY - 3, 2, 0, Math.PI / 2, 0), 4, 0.9, 8, 3);
  },
  ottilie: (c) => {
    quiver(c, LEATHER, '#9aa08a');
    bow(c, 140, mat('#6a4a2a', 'wood'));
  },
  mira: (c) => {
    quiver(c, mat('#7a5232', 'leather'), '#e8e0c8');
    bow(c, 186, mat('#8a5a2e', 'wood'));
  },
  corvin: (c) => {
    const L = c.L;
    for (const side of ['L', 'R'] as const) {
      const { g, aim } = grip(c, side, 0.35);
      c.held(`hand${side}`);
      const F = frame(g, aim, v(0, 1, 0));
      c.b.push(F);
      c.paint(WOOD_D);
      c.b.box(0, -2, -3.5, 2.6, 6, 7, 1, 1);
      c.paint(IRON_D);
      c.b.box(0, 9, 1.5, 2.6, 22, 2.6);
      c.paint(BRASS);
      c.b.geo(new THREE.CylinderGeometry(3.8, 3.8, 7, 8), T(0, 2.5, 1.5));
      c.b.box(0, 19.5, 1.5, 3.4, 1.6, 3.4);
      c.b.pop();
    }
    c.on('hips').paint(mat('#e2d8c0', 'stone'));
    c.b.limb([L.hipW * 0.9, L.hipY + 2, -4], [L.hipW * 1.2, L.hipY - 12, 4], 3.4, 1, 6);
    c.paint(BRASS);
    c.b.box(L.hipW * 0.88, L.hipY + 3, -4, 3.4, 2, 3.4);
  },
  lysa: (c) => {
    const L = c.L;
    const { g, aim } = grip(c, 'R');
    c.held('handR');
    const F = frame(g, aim, v(0, 1, 0));
    c.b.push(F);
    c.paint(WOOD_D);
    c.b.box(0, -14, -2, 3, 22, 6, 1, 0.7);
    c.paint(STEEL);
    c.b.rings([ell(0, -3, 0.8, 1.9, 1.9, 6), ell(0, 70, 0.8, 1.6, 1.6, 6), ell(0, 112, 0.8, 0.15, 0.15, 6)], true, true, true);
    // needle eye at the back + brass scope
    c.paint(BRASS);
    c.b.geo(new THREE.CylinderGeometry(1.6, 1.8, 18, 6), T(0, 14, 4.6));
    c.b.box(0, 14, 3.2, 1, 3, 2);
    c.paint('#a83a32');
    c.b.box(0, 40, 0.8, 0.6, 70, 0.6);
    c.b.pop();
    c.on('hips').paint(WOOD);
    c.b.geo(new THREE.CylinderGeometry(3.6, 3.6, 7, 8), T(-L.hipW * 1.15, L.hipY - 3, 2, 0, 0, Math.PI / 2));
    c.paint('#a83a32');
    c.b.geo(new THREE.CylinderGeometry(4, 4, 5, 8), T(-L.hipW * 1.15, L.hipY - 3, 2, 0, 0, Math.PI / 2));
  },
  tobin: (c) => {
    const L = c.L;
    const { g, aim } = grip(c, 'R');
    c.held('handR');
    const F = frame(g, aim, v(0, 1, 0));
    c.b.push(F);
    c.paint(WOOD);
    c.b.box(0, -13, -2, 4, 22, 8, 1, 0.7);
    c.paint(IRON_D);
    c.b.rings([ell(0, -3, 1, 4, 4, 8), ell(0, 52, 1, 3.4, 3.4, 8)], true, true, true);
    c.paint(BRASS);
    for (const y of [4, 22, 40]) c.b.loft([{ c: [0, y, 1], rx: 4.6, rz: 4.6 }, { c: [0, y + 3, 1], rx: 4.5, rz: 4.5 }], 8, false, false);
    c.paint(STEEL);
    c.b.box(0, 60, 1, 1.4, 16, 1.4);
    c.b.geo(new THREE.ConeGeometry(3.6, 10, 4), T(0, 72, 1));
    for (const s of [1, -1]) {
      c.b.push(T(s * 2.5, 66, 1, 0, 0, s * 0.7));
      c.b.box(0, 0, 0, 1, 7, 1, 0.3);
      c.b.pop();
    }
    c.b.pop();
    c.on('hips').paint(ROPE);
    torus(c, T(L.hipW * 1.15, L.hipY - 4, 0, 0, Math.PI / 2, 0), 6, 1.8, 10, 4);
  },
  wren: (c) => {
    quiver(c, mat('#3a3030', 'leather'), '#c8c0b8', true);
    bow(c, 146, mat('#4a3428', 'wood'), { fire: true, grip: mat('#c06a3a', 'metal') });
  },
  ferris: (c) => {
    const L = c.L;
    const { top, aim } = pole(c, 'R', 40, 136, 1.3, WOOD_D);
    c.paint(IRON);
    const arm = top.clone().add(v(0, 0, 12));
    rod(c, top.clone().addScaledVector(aim, -3), arm, 1, 1, 4);
    c.addBone('dangleR', 'handR', arr(arm));
    c.held('dangleR').paint(BRASS);
    const lc = arm.clone().add(v(0, -12, 0));
    c.b.box(lc.x, lc.y + 7, lc.z, 8, 2, 8, 0.6);
    c.b.box(lc.x, lc.y - 6, lc.z, 8, 2, 8);
    for (const sx of [1, -1]) for (const sz of [1, -1]) c.b.box(lc.x + sx * 3.6, lc.y, lc.z + sz * 3.6, 1, 12, 1);
    c.paint('#ffd98a', { glow: 1 });
    c.b.box(lc.x, lc.y, lc.z, 6, 10, 6);
    c.paint(IRON);
    c.b.box(arm.x, arm.y - 2.5, arm.z, 0.8, 5, 0.8);
    c.on('hips').paint(LEATHER);
    c.b.box(-L.hipW * 1.05, L.hipY - 6, -2, 5, 12, 13, 0.95);
  },
  gorvam: (c) => {
    const { g } = grip(c, 'R');
    c.held('handR').paint(IRON);
    const dp = g.clone().add(v(0, -2, 0));
    c.addBone('dangleR', 'handR', arr(dp));
    c.held('dangleR').paint(IRON);
    for (let k = 0; k < 6; k++) c.b.box(dp.x, dp.y - 3 - k * 4.4, dp.z, k % 2 ? 1 : 3.2, 4.8, k % 2 ? 3.2 : 1);
    const hc = dp.clone().add(v(0, -42, 0));
    c.paint(IRON_D);
    c.b.box(hc.x, hc.y + 13, hc.z, 4, 6, 4);
    torus(c, T(hc.x, hc.y, hc.z, 0, Math.PI / 2, Math.PI), 10, 3, 9, 5, Math.PI * 1.25);
    c.paint(STEEL);
    c.b.geo(new THREE.ConeGeometry(3.2, 9, 4), T(hc.x, hc.y + 4, hc.z - 10, 0.3, 0, 0));
  },
  hagen: (c) => yokeProp(c, 'bell', 'bucket', false),
  oda: (c) => yokeProp(c, 'bucket', 'bucket', true),
  kiran: (c) => {
    const L = c.L;
    const spinPts: V3[] = [];
    for (const side of ['L', 'R'] as const) {
      const { g, aim } = grip(c, side);
      c.held(`hand${side}`).paint(WOOD);
      const bot = g.clone().addScaledVector(aim, 20);
      rod(c, g.clone().addScaledVector(aim, -3), bot, 0.8, 0.6, 4);
      c.paint(WOOD_D);
      c.b.geo(new THREE.CylinderGeometry(4, 4, 1.6, 8), frame(g.clone().addScaledVector(aim, 15), aim));
      c.paint('#c0443a');
      c.b.geo(new THREE.ConeGeometry(2.8, 7, 6), frame(g.clone().addScaledVector(aim, 7), aim.clone().negate()));
      spinPts.push(g.clone().addScaledVector(aim, 4));
    }
    // taut red thread between the two spindles: each end skinned to its own hand
    const hl = c.idx('handL');
    const hr = c.idx('handR');
    c.held('handL').paint('#c0443a', { glow: 0.35 });
    const a = spinPts[0]!;
    const b = spinPts[1]!;
    // author in hold space; transform ends separately (the held matrices differ per hand)
    const ML = c.b.mat.clone();
    c.held('handR');
    const MR = c.b.mat.clone();
    c.b.mat.identity();
    const pa = a.clone().applyMatrix4(ML);
    const pb = b.clone().applyMatrix4(MR);
    c.b.set({ weights: (p) => (p.distanceTo(pa) < p.distanceTo(pb) ? [[hl, 1]] : [[hr, 1]]) });
    const off = v(0, 0.5, 0);
    c.b.quad(arr(pa.clone().sub(off)), arr(pb.clone().sub(off)), arr(pb.clone().add(off)), arr(pa.clone().add(off)));
    c.b.quad(arr(pa.clone().add(off)), arr(pb.clone().add(off)), arr(pb.clone().sub(off)), arr(pa.clone().sub(off)));
    c.b.set({ weights: null });
    // threads wound around both forearms
    for (const side of ['L', 'R'] as const) {
      const s = side === 'L' ? 1 : -1;
      c.on(`fArm${side}`).paint('#c0443a');
      const el = c.bindP[c.idx(`fArm${side}`)]!;
      for (let k = 0; k < 3; k++) c.b.loft([{ c: [s * L.shX, el.y - 6 - k * 5, el.z], rx: 3.9, rz: 3.9 }, { c: [s * L.shX, el.y - 4.8 - k * 5, el.z], rx: 3.9, rz: 3.9 }], 6, false, false);
    }
  },
};

function yokeProp(c: Ctx, right: 'bell' | 'bucket', left: 'bell' | 'bucket', water: boolean): void {
  const L = c.L;
  const y = L.shoulderY + 3;
  const z = -2.5;
  const half = L.shW + 20;
  c.on('chest').paint(WOOD);
  c.b.limb([-half, y + 3, z], [-L.shW * 0.4, y, z], 2.2, 2.6, 6);
  c.b.limb([-L.shW * 0.4, y, z], [L.shW * 0.4, y, z], 2.6, 2.6, 6);
  c.b.limb([L.shW * 0.4, y, z], [half, y + 3, z], 2.6, 2.2, 6);
  for (const s of [1, -1] as const) {
    const kind = s > 0 ? left : right;
    const name = s > 0 ? 'dangleL' : 'dangleR';
    const p: Vec = [s * (half - 2), y + 3, z];
    c.addBone(name, 'chest', p);
    c.held(name).paint(ROPE);
    const drop = kind === 'bell' ? 14 : 26;
    c.b.box(p[0], p[1] - drop / 2, p[2], 0.8, drop, 0.8);
    const cy = p[1] - drop;
    if (kind === 'bell') {
      c.paint(BRASS);
      c.b.geo(new THREE.LatheGeometry([new THREE.Vector2(2, 0), new THREE.Vector2(6, -2), new THREE.Vector2(8.5, -10), new THREE.Vector2(11, -20), new THREE.Vector2(14, -25), new THREE.Vector2(13, -26), new THREE.Vector2(0.5, -26)].reverse(), 10), T(p[0], cy, p[2]));
      c.paint(IRON_D);
      c.b.blob([p[0], cy - 25, p[2]], [3, 3, 3], 0);
    } else {
      c.paint(WOOD);
      c.b.rings([ell(p[0], cy - 22, p[2], 8, 8, 8), ell(p[0], cy - 6, p[2], 10, 10, 8)], true, true, false);
      c.paint(IRON);
      for (const yy of [cy - 19, cy - 9]) c.b.loft([{ c: [p[0], yy, p[2]], rx: 9.2, rz: 9.2 }, { c: [p[0], yy + 1.6, p[2]], rx: 9.4, rz: 9.4 }], 8, false, false);
      c.b.box(p[0], cy - 4, p[2], 20, 0.8, 0.8);
      if (water) {
        c.paint('#7fb0bc', { metal: 0.6 });
        c.b.geo(new THREE.CylinderGeometry(9.2, 9.2, 0.6, 8), T(p[0], cy - 8, p[2]));
      }
    }
  }
}
