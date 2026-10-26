// Skeleton template for the 3D humanoids. Bind pose: standing, arms hanging, every bone's rotation = identity (so
// all bone axes are model axes: +x = the figure's LEFT, +y up, +z forward). Positions are model units (the body spec's
// H ~ 180). Pose angles in anim.ts are Euler XYZ relative to this bind pose.
import type { BodySpec } from '../champions/types';

export interface BoneDef {
  name: string;
  parent: number;
  /** model-space bind position (joint) */
  p: [number, number, number];
}

export interface Landmarks {
  H: number;
  headR: number;
  crown: number;
  headC: number;
  chin: number;
  neckBase: number;
  shoulderY: number;
  chestY: number;
  waist: number;
  hipY: number;
  kneeY: number;
  ankleY: number;
  shX: number;
  hipX: number;
  upper: number;
  fore: number;
  hand: number;
  footLen: number;
  /** half shoulder width / half hip width / half chest depth / limb girth multiplier */
  shW: number;
  hipW: number;
  chestD: number;
  girth: number;
  belly: number;
  bust: number;
  hunch: number;
  stance: number;
}

export const BONES = [
  'root',
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'clavL',
  'uArmL',
  'fArmL',
  'handL',
  'clavR',
  'uArmR',
  'fArmR',
  'handR',
  'thighL',
  'shinL',
  'footL',
  'thighR',
  'shinR',
  'footR',
  'skirtF',
  'skirtB',
  'cape0',
  'cape1',
] as const;
export type BoneName = (typeof BONES)[number];
export const B = Object.fromEntries(BONES.map((n, i) => [n, i])) as Record<BoneName, number>;

export function landmarks(b: BodySpec): Landmarks {
  const H = b.H;
  const headR = b.headR * (H / 180) ** 0.3;
  const crown = H;
  const headC = crown - headR * 1.02;
  const chin = crown - headR * 2.0;
  const neckBase = chin - headR * 0.42;
  const shoulderY = neckBase - headR * 0.32;
  const hipY = H * b.legs;
  const ankleY = H * 0.045;
  const kneeY = ankleY + (hipY - ankleY) * 0.49;
  const waist = hipY + (shoulderY - hipY) * 0.36;
  const chestY = hipY + (shoulderY - hipY) * 0.7;
  const armLen = H * 0.33;
  return {
    H,
    headR,
    crown,
    headC,
    chin,
    neckBase,
    shoulderY,
    chestY,
    waist,
    hipY,
    kneeY,
    ankleY,
    shX: b.shW * 0.9,
    hipX: b.hipW * 0.58,
    upper: armLen * 0.52,
    fore: armLen * 0.48,
    hand: H * 0.075,
    footLen: H * 0.14,
    shW: b.shW,
    hipW: b.hipW,
    chestD: b.chestD,
    girth: b.girth,
    belly: b.belly,
    bust: b.bust,
    hunch: b.hunch,
    stance: b.stance,
  };
}

export function humanBones(L: Landmarks): BoneDef[] {
  const d: BoneDef[] = [];
  const add = (name: BoneName, parent: BoneName | null, p: [number, number, number]) => d.push({ name, parent: parent === null ? -1 : B[parent], p });
  add('root', null, [0, 0, 0]);
  add('hips', 'root', [0, L.hipY + 2, 0]);
  add('spine', 'hips', [0, L.waist, -1]);
  add('chest', 'spine', [0, L.chestY, -1.5]);
  add('neck', 'chest', [0, L.neckBase - 2, -1]);
  add('head', 'neck', [0, L.chin + L.headR * 0.2, 0]);
  for (const s of [1, -1] as const) {
    const n = s > 0 ? 'L' : 'R';
    add(`clav${n}` as BoneName, 'chest', [s * 3, L.shoulderY - 3, -1.5]);
    add(`uArm${n}` as BoneName, `clav${n}` as BoneName, [s * L.shX, L.shoulderY - 3, -1]);
    add(`fArm${n}` as BoneName, `uArm${n}` as BoneName, [s * L.shX, L.shoulderY - 3 - L.upper, -1]);
    add(`hand${n}` as BoneName, `fArm${n}` as BoneName, [s * L.shX, L.shoulderY - 3 - L.upper - L.fore, -1]);
  }
  for (const s of [1, -1] as const) {
    const n = s > 0 ? 'L' : 'R';
    add(`thigh${n}` as BoneName, 'hips', [s * L.hipX, L.hipY, 0]);
    add(`shin${n}` as BoneName, `thigh${n}` as BoneName, [s * L.hipX * 1.02, L.kneeY, 0.6]);
    add(`foot${n}` as BoneName, `shin${n}` as BoneName, [s * L.hipX * 1.04, L.ankleY, 0]);
  }
  add('skirtF', 'hips', [0, L.hipY + 4, 2]);
  add('skirtB', 'hips', [0, L.hipY + 4, -2]);
  add('cape0', 'chest', [0, L.shoulderY - 2, -L.chestD - 1]);
  add('cape1', 'cape0', [0, (L.shoulderY + L.kneeY) / 2, -L.chestD - 2]);
  return d;
}
