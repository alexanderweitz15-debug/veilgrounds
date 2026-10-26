// Hark, Ottilie's grey wolf: quadruped rig + faceted fur body and its own procedural clips
// (idle breathing / tail wag, gallop, lunge-bite, howl, death roll, sit for recall).
import { ConeGeometry as CONE } from 'three';
import type { Kit } from '../champions/types';
import type { Anim3D } from './anim';
import { PoseBuf } from './anim';
import { Ctx } from './ctx';
import { ell } from './humanoid';
import { T, type Vec, type Weights } from './mesh';
import type { BoneDef, Landmarks } from './rig';

const FUR = '#8d8a86';
const FUR_L = '#c9c2b4';
const FUR_D = '#55524f';

export const WOLF_BONES: BoneDef[] = [];
const add = (name: string, parent: string | null, p: Vec) => WOLF_BONES.push({ name, parent: parent === null ? -1 : WOLF_BONES.findIndex((b) => b.name === parent), p });
add('root', null, [0, 0, 0]);
add('hips', 'root', [0, 62, -30]);
add('chest', 'hips', [0, 64, 16]);
add('neck', 'chest', [0, 70, 30]);
add('head', 'neck', [0, 80, 44]);
add('tail0', 'hips', [0, 66, -46]);
add('tail1', 'tail0', [0, 56, -60]);
for (const s of [1, -1]) {
  const n = s > 0 ? 'L' : 'R';
  add(`fUp${n}`, 'chest', [s * 8.5, 60, 24]);
  add(`fLo${n}`, `fUp${n}`, [s * 8.5, 34, 22]);
  add(`fPaw${n}`, `fLo${n}`, [s * 8.5, 5, 24]);
  add(`hUp${n}`, 'hips', [s * 8.5, 58, -34]);
  add(`hLo${n}`, `hUp${n}`, [s * 8.5, 32, -42]);
  add(`hPaw${n}`, `hLo${n}`, [s * 8.5, 5, -36]);
}

export function buildWolf(): Ctx {
  const c = new Ctx({ id: 'hark' } as Kit, { H: 90 } as Landmarks, WOLF_BONES.map((b) => ({ ...b, p: [...b.p] as Vec })));
  const b = c.b;
  const H = c.idx('hips');
  const C = c.idx('chest');
  // body: loft along z (local y → world z via Rx(+90°); local z → world -y)
  const torsoW = (p: { z: number }): Weights => {
    const t = Math.max(0, Math.min(1, (p.z + 10) / 22));
    return [
      [H, 1 - t],
      [C, t],
    ];
  };
  c.weights(torsoW as never).paint(FUR);
  const st: [number, number, number, number][] = [
    // z, centre y, half width, half height
    [-50, 63, 7, 8],
    [-42, 63, 10.5, 12],
    [-26, 64, 11, 13],
    [-6, 67, 10.5, 11.5],
    [12, 65, 12.5, 17],
    [26, 67, 11, 15],
    [33, 70, 7, 9],
  ];
  const rings: Vec[][] = st.map(([z, y, w, h]) => ell(0, 0, 0, w, h, 8).map(([x, , zz]) => [x, y - zz, z] as Vec));
  // ell() gives points around y with u=0 at +z; we mapped its z into -y (u=0 → belly). Order rings along +z.
  b.rings(rings, true, true, true);
  // belly / chest light fur
  c.paint(FUR_L);
  b.blob([0, 52, 16], [9, 7, 12], 0);
  b.blob([0, 58, 30], [7, 8, 5], 0);
  // ridge of darker fur along the back
  c.paint(FUR_D);
  for (let i = 0; i < 6; i++) {
    const z = -40 + i * 13;
    b.blob([0, 77 - Math.abs(z - 10) * 0.06 + (i === 4 ? 4 : 0), z], [5, 3.5, 8], 0, i);
  }
  // neck + ruff
  c.on('neck').paint(FUR);
  b.limb([0, 68, 26], [0, 80, 44], 9, 7, 7);
  c.paint(FUR_L);
  b.blob([0, 70, 36], [10, 9, 6], 0);
  c.paint(FUR_D);
  b.blob([0, 80, 34], [8, 5, 7], 0);
  // collar + brass tag (Ottilie's)
  c.paint({ c: '#6a4630', k: 'leather' });
  b.push(T(0, 74, 38, 1.0, 0, 0));
  b.loft([{ c: [0, -1.2, 0], rx: 8.6, rz: 7.2 }, { c: [0, 1.2, 0], rx: 8.6, rz: 7.2 }], 8, false, false);
  b.pop();
  c.paint({ c: '#c9973f', k: 'metal' });
  b.box(0, 67, 43, 2.6, 3, 1);
  // head
  c.on('head').paint(FUR);
  b.blob([0, 84, 46], [7.5, 7, 8.5], 1);
  b.rings([ell(0, 0, 0, 5.2, 4.5, 6).map(([x, , z]) => [x, 82 - z, 52] as Vec), ell(0, 0, 0, 3, 2.6, 6).map(([x, , z]) => [x, 79.5 - z, 66] as Vec)], true, false, true);
  c.paint(FUR_L);
  b.box(0, 76.5, 59, 6, 3, 13, 0.7, 0.8);
  c.paint('#1a1420');
  b.box(0, 80.5, 66.5, 3.2, 2.4, 2);
  c.paint('#e0a040', { glow: 0.5 });
  for (const s of [1, -1]) b.box(s * 3.6, 86, 53.5, 2.4, 1.2, 1);
  c.paint(FUR_D);
  for (const s of [1, -1]) b.geo(new CONE(3.4, 9, 4), T(s * 4.6, 93, 43, -0.2, 0, s * -0.2));
  // legs
  for (const s of [1, -1] as const) {
    const n = s > 0 ? 'L' : 'R';
    for (const [up, lo, paw] of [
      [`fUp${n}`, `fLo${n}`, `fPaw${n}`],
      [`hUp${n}`, `hLo${n}`, `hPaw${n}`],
    ] as const) {
      const pu = c.bindP[c.idx(up)]!;
      const pl = c.bindP[c.idx(lo)]!;
      const pp = c.bindP[c.idx(paw)]!;
      const hind = up.startsWith('h');
      c.on(up).paint(FUR);
      b.limb([pu.x, pu.y + 6, pu.z], [pl.x, pl.y, pl.z], hind ? 7.5 : 5.5, 3.6, 6);
      c.on(lo).paint(hind ? FUR : FUR_L);
      b.limb([pl.x, pl.y + 2, pl.z], [pp.x, pp.y + 1, pp.z], 3.2, 2.4, 5);
      c.on(paw).paint(FUR_D);
      b.box(pp.x, 2.5, pp.z + 2.5, 5, 5, 8, 0.8, 0.8);
    }
  }
  // bushy tail (two bones)
  const t0 = c.idx('tail0');
  const t1 = c.idx('tail1');
  c.weights((p) =>
    p.y > 58
      ? [[t0, 1]]
      : [
          [t0, Math.max(0, (p.y - 40) / 18)],
          [t1, 1 - Math.max(0, (p.y - 40) / 18)],
        ],
  ).paint(FUR);
  b.limb([0, 67, -46], [0, 58, -58], 3.5, 6, 6);
  b.limb([0, 58, -58], [0, 40, -66], 6, 2, 6);
  c.paint(FUR_L);
  b.blob([0, 40, -66], [3, 4, 3], 0);
  return c;
}

// ------------------------------------------------------------------------------------------------ clips
function set(p: PoseBuf, bone: Record<string, number>, name: string, x: number, y = 0, z = 0): void {
  const i = bone[name];
  if (i === undefined) return;
  p.e[i * 3] += x;
  p.e[i * 3 + 1] += y;
  p.e[i * 3 + 2] += z;
}

/** Writes the wolf pose for `anim` at time t (s) / normalised u (one-shots) into out (cleared). */
export function wolfPose(bone: Record<string, number>, anim: Anim3D, t: number, u: number, out: PoseBuf): void {
  out.e.fill(0);
  out.off.set(0, 0, 0);
  out.rootP.set(0, 0, 0);
  out.rootR.set(0, 0, 0);
  const S = (n: string, x: number, y = 0, z = 0) => set(out, bone, n, x, y, z);
  const br = Math.sin(t * 2.2);
  if (anim === 'idle' || anim === 'attack' || anim === 'cast') {
    S('chest', br * 0.015);
    S('head', Math.sin(t * 0.5) * 0.08, Math.sin(t * 0.37) * 0.3);
    S('tail0', 0.35, Math.sin(t * 3.1) * 0.25);
    S('tail1', 0.2, Math.sin(t * 3.1 - 0.8) * 0.3);
  }
  if (anim === 'run') {
    const a = u * Math.PI * 2;
    const sa = Math.sin(a);
    const ca = Math.cos(a);
    // rotary gallop: front pair leads hind pair by ~half a cycle
    S('fUpL', -sa * 0.75);
    S('fUpR', -Math.sin(a + 0.6) * 0.75);
    S('fLoL', Math.max(0, ca) * -0.2 + Math.max(0, -ca) * 0.9);
    S('fLoR', Math.max(0, Math.cos(a + 0.6)) * -0.2 + Math.max(0, -Math.cos(a + 0.6)) * 0.9);
    S('hUpL', Math.sin(a + Math.PI) * 0.8);
    S('hUpR', Math.sin(a + Math.PI + 0.6) * 0.8);
    S('hLoL', -0.3 - Math.max(0, Math.cos(a + Math.PI)) * 0.6);
    S('hLoR', -0.3 - Math.max(0, Math.cos(a + Math.PI + 0.6)) * 0.6);
    S('hips', sa * 0.12);
    S('chest', -sa * 0.14);
    S('neck', 0.25 + sa * 0.08);
    S('head', -0.1 - sa * 0.08);
    S('tail0', 0.05, Math.sin(a) * 0.15);
    S('tail1', -0.1);
    out.off.y = Math.abs(Math.sin(a)) * 5 - 3;
  }
  if (anim === 'attack') {
    // crouch → lunge with the head snapping forward → back
    const k = u < 0.35 ? u / 0.35 : u < 0.55 ? 1 - (u - 0.35) / 0.2 : 0;
    const l = u < 0.35 ? 0 : u < 0.55 ? (u - 0.35) / 0.2 : Math.max(0, 1 - (u - 0.55) / 0.45);
    S('hips', -0.15 * k + 0.05 * l);
    S('chest', 0.15 * k - 0.1 * l);
    S('neck', 0.3 * k - 0.35 * l);
    S('head', 0.25 * k + 0.25 * l);
    S('hUpL', -0.4 * k + 0.4 * l);
    S('hUpR', -0.4 * k + 0.4 * l);
    S('hLoL', 0.3 * k);
    S('hLoR', 0.3 * k);
    S('fUpL', 0.3 * k - 0.6 * l);
    S('fUpR', 0.3 * k - 0.5 * l);
    out.off.set(0, -8 * k + 4 * l, -6 * k + 22 * l);
  }
  if (anim === 'cast') {
    // howl: sit back, head up
    const k = Math.sin(Math.min(1, u * 1.4) * Math.PI) ** 0.5;
    S('neck', -0.9 * k);
    S('head', -0.5 * k);
    S('hips', -0.25 * k);
    S('hUpL', -0.6 * k);
    S('hUpR', -0.6 * k);
    S('hLoL', 0.9 * k);
    S('hLoR', 0.9 * k);
    out.off.y = -10 * k;
  }
  if (anim === 'recall') {
    // sit
    S('hips', -0.7);
    S('chest', 0.35);
    S('hUpL', -1.0);
    S('hUpR', -1.0);
    S('hLoL', 1.9);
    S('hLoR', 1.9);
    S('hPawL', -1.1);
    S('hPawR', -1.1);
    S('fUpL', 0.35);
    S('fUpR', 0.35);
    S('neck', -0.2);
    S('head', Math.sin(t * 0.6) * 0.1, Math.sin(t * 0.4) * 0.25);
    S('tail0', -0.6);
    S('tail1', -0.4);
    out.off.set(0, -18, -12);
  }
  if (anim === 'death') {
    const k = Math.min(1, u * 1.6);
    out.rootR.set(0, 0, -1.45 * k * k);
    out.rootP.set(-14 * k, 2 * k, 0);
    S('fUpL', -0.3 * k);
    S('fUpR', 0.4 * k);
    S('hUpL', 0.2 * k);
    S('hUpR', -0.5 * k);
    S('neck', 0.3 * k);
    S('head', 0.2 * k);
    S('tail1', 0.5 * k);
  }
}
