// Procedural animation for the 3D humanoids. A pose = FK Euler angles for body/leg/cloth bones + two-bone IK
// targets for the arms (wrist position authored in bind model space, elbow pole, optional prop aim). Layers:
// hold (how the champion carries its gear) → locomotion (idle breathing / weight shift, run cycle with arm swing and
// cloth lag) → action key poses (attack / cast / death / recall, eased between keys). The result is written as local
// quaternions into the bones; clip switches cross-fade with slerp. Everything runs on preallocated buffers.
import * as THREE from 'three';
import type { AttackStyle, CastStyle, Hold } from '../champions/types';
import type { Landmarks } from './rig';

export const ANIMS_3D = ['idle', 'run', 'attack', 'cast', 'death', 'recall'] as const;
export type Anim3D = (typeof ANIMS_3D)[number];
/** Default clip lengths in seconds (attack/cast can be overridden per setAnim call). */
export const CLIP_LEN: Record<Anim3D, number> = { idle: 3.2, run: 0.72, attack: 0.7, cast: 0.8, death: 1.25, recall: 8 };
export const LOOPS: Record<Anim3D, boolean> = { idle: true, run: true, attack: false, cast: false, death: false, recall: true };

type V = [number, number, number];

export interface ArmKey {
  /** wrist target (bind model space; mirrored automatically for 'both') */
  t?: V;
  /** elbow pole direction */
  pole?: V;
  /** direction the held prop's axis should point (model space); undefined = hand continues the forearm */
  aim?: V;
}
export interface Key {
  at: number;
  fk?: Record<string, V | undefined>;
  L?: ArmKey;
  R?: ArmKey;
  /** hips offset */
  off?: V;
  /** root bone offset / rotation (death fall, spin) */
  rootP?: V;
  rootR?: V;
  /** bow string draw 0..1 */
  draw?: number;
}

export interface AnimProfile {
  hold: Hold;
  attack: AttackStyle;
  cast: CastStyle;
  gait: 'normal' | 'heavy' | 'light' | 'prowl';
  L: Landmarks;
  /** bone index by name */
  bone: Record<string, number>;
  nBones: number;
  /** per champion tweaks */
  stride?: number;
}

// ------------------------------------------------------------------------------------------------ pose buffer
export class PoseBuf {
  readonly e: Float32Array;
  readonly armT = [new THREE.Vector3(), new THREE.Vector3()];
  readonly armPole = [new THREE.Vector3(), new THREE.Vector3()];
  readonly armAim = [new THREE.Vector3(), new THREE.Vector3()];
  readonly hasAim = [false, false];
  readonly off = new THREE.Vector3();
  readonly rootP = new THREE.Vector3();
  readonly rootR = new THREE.Vector3();
  draw = 0;
  constructor(n: number) {
    this.e = new Float32Array(n * 3);
  }
  copy(o: PoseBuf): void {
    this.e.set(o.e);
    for (let i = 0; i < 2; i++) {
      this.armT[i]!.copy(o.armT[i]!);
      this.armPole[i]!.copy(o.armPole[i]!);
      this.armAim[i]!.copy(o.armAim[i]!);
      this.hasAim[i] = o.hasAim[i]!;
    }
    this.off.copy(o.off);
    this.rootP.copy(o.rootP);
    this.rootR.copy(o.rootR);
    this.draw = o.draw;
  }
}

// ------------------------------------------------------------------------------------------------ holds
/** Arm setup per hold (left arm = s +1, right arm = s -1). Values are fractions/offsets of the landmarks. */
interface HoldArm {
  t: (L: Landmarks) => V;
  pole: V;
  aim?: V;
}
interface HoldDef {
  L: HoldArm;
  R: HoldArm;
  crouch?: number;
  /** how much the arms swing while running (0..1) */
  swing: [number, number];
  lean?: number;
}

const hang = (s: 1 | -1, fwd = 3, out = 5): HoldArm => ({
  t: (L) => [s * (L.shX + out), L.shoulderY - 3 - (L.upper + L.fore) * 0.95, fwd],
  pole: [s * 0.4, 0, -1],
});

const HOLDS: Record<Hold, HoldDef> = {
  relaxed: { L: hang(1), R: hang(-1), swing: [1, 1] },
  bow: {
    L: { t: (L) => [L.shX + 4, L.waist - 6, 12], pole: [0.6, -0.2, -1], aim: [0, 1, 0.06] },
    R: hang(-1),
    swing: [0.35, 1],
  },
  pistols: {
    L: { t: (L) => [L.shX - 1, L.waist - 2, 20], pole: [0.5, -0.5, -1], aim: [0.05, -0.15, 1] },
    R: { t: (L) => [-(L.shX - 1), L.waist - 2, 20], pole: [-0.5, -0.5, -1], aim: [-0.05, -0.15, 1] },
    swing: [0.4, 0.4],
  },
  rifle: {
    R: { t: (L) => [-(L.shX - 5), L.waist, 12], pole: [-0.6, -0.4, -1], aim: [0.35, 0.3, 1] },
    L: { t: (L) => [-(L.shX - 5) + 0.35 * 24, L.waist + 0.3 * 24, 12 + 24], pole: [0.6, -0.6, -0.4] },
    swing: [0.2, 0.25],
  },
  shoulder: {
    R: { t: (L) => [-(L.shX - 2), L.chestY - 8, 13], pole: [-0.6, -1, 0], aim: [-0.25, 0.75, -0.6] },
    L: hang(1),
    swing: [1, 0.15],
  },
  pole: {
    R: { t: (L) => [-(L.shX + 3), L.waist - 4, 14], pole: [-0.5, -0.3, -1], aim: [0, 1, 0] },
    L: hang(1),
    swing: [0.9, 0.3],
  },
  shield: {
    L: { t: (L) => [L.shX - 9, L.chestY - 14, 20], pole: [1, -0.6, -0.3], aim: [0, 1, 0.1] },
    R: { t: (L) => [-(L.shX + 4), L.waist - 8, 10], pole: [-0.4, 0, -1], aim: [0, 0.6, 1] },
    swing: [0.2, 0.6],
  },
  yoke: {
    L: { t: (L) => [L.shX + 9, L.waist + 4, 7], pole: [0.8, -0.3, -0.6] },
    R: { t: (L) => [-(L.shX + 9), L.waist + 4, 7], pole: [-0.8, -0.3, -0.6] },
    swing: [0.25, 0.25],
  },
  guard: {
    L: { t: (L) => [L.shX - 4, L.chestY - 10, 20], pole: [0.8, -0.8, -0.3], aim: [0.15, 0.2, 1] },
    R: { t: (L) => [-(L.shX - 4), L.chestY - 6, 22], pole: [-0.8, -0.8, -0.3], aim: [-0.15, 0.2, 1] },
    crouch: 0.28,
    swing: [0.5, 0.5],
    lean: 0.18,
  },
  hook: {
    R: { t: (L) => [-(L.shX + 7), L.waist - 12, 7], pole: [-0.5, 0, -1], aim: [0, -1, 0] },
    L: { t: (L) => [L.shX - 1, L.waist - 2, 15], pole: [0.6, -0.4, -1] },
    swing: [0.6, 0.35],
  },
  spindle: {
    L: { t: (L) => [L.shX - 6, L.waist + 1, 17], pole: [0.6, -0.4, -1], aim: [0, -1, 0.05] },
    R: { t: (L) => [-(L.shX - 6), L.waist + 1, 17], pole: [-0.6, -0.4, -1], aim: [0, -1, 0.05] },
    swing: [0.3, 0.3],
  },
  blade: {
    R: { t: (L) => [-(L.shX + 4), L.waist - 6, 14], pole: [-0.5, -0.2, -1], aim: [-0.1, -0.35, 1] },
    L: hang(1, 6, 4),
    swing: [0.9, 0.5],
  },
  fists: {
    L: { t: (L) => [L.shX - 1, L.waist + 3, 18], pole: [0.7, -0.5, -0.8], aim: [0, 0, 1] },
    R: { t: (L) => [-(L.shX - 1), L.waist + 3, 18], pole: [-0.7, -0.5, -0.8], aim: [0, 0, 1] },
    swing: [0.5, 0.5],
  },
};

export function holdOf(h: Hold): HoldDef {
  return HOLDS[h];
}

// ------------------------------------------------------------------------------------------------ action key poses
// Arm targets in these keys are functions of the landmarks so the same move fits every body.
type KeyFn = (L: Landmarks) => Key[];

const sh = (L: Landmarks): number => L.shoulderY - 3;
const reach = (L: Landmarks): number => L.upper + L.fore;

const ATTACKS: Record<AttackStyle, KeyFn> = {
  // left hand pushes the bow out at shoulder height, right hand draws to the cheek, releases, settles
  bow: (L) => [
    { at: 0 },
    {
      at: 0.28,
      fk: { spine: [0, -0.3, 0], chest: [0, -0.25, 0], head: [0, 0.45, 0] },
      L: { t: [L.shX * 0.55, sh(L) + 2, reach(L) * 0.95], pole: [1, 0, -0.2], aim: [0.05, 1, 0.05] },
      R: { t: [-2, sh(L) + 2, reach(L) * 0.9], pole: [-1, 0, 0] },
      draw: 0,
    },
    {
      at: 0.62,
      fk: { spine: [0, -0.4, 0], chest: [0, -0.35, 0], head: [0, 0.6, 0] },
      L: { t: [L.shX * 0.6, sh(L) + 3, reach(L) * 0.98], pole: [1, 0, -0.2], aim: [0.05, 1, 0.05] },
      R: { t: [-L.shX * 0.2, sh(L) + 6, 8], pole: [-1, 0.1, -0.3] },
      draw: 1,
    },
    {
      at: 0.7,
      fk: { spine: [0, -0.4, 0], chest: [0, -0.35, 0], head: [0, 0.6, 0] },
      L: { t: [L.shX * 0.6, sh(L) + 3, reach(L) * 0.98], pole: [1, 0, -0.2], aim: [0.05, 1, 0.05] },
      R: { t: [-L.shX * 1.1, sh(L) + 4, -2], pole: [-1, 0, 0] },
      draw: 0,
    },
    { at: 1 },
  ],
  pistols: (L) => [
    { at: 0 },
    { at: 0.18, R: { t: [-L.shX * 0.6, sh(L) - 1, reach(L) * 0.97], pole: [-1, -0.3, 0], aim: [0, 0, 1] }, fk: { chest: [0, 0.15, 0] } },
    { at: 0.26, R: { t: [-L.shX * 0.6, sh(L) + 8, reach(L) * 0.82], pole: [-1, -0.3, 0], aim: [0, 0.6, 1] }, fk: { chest: [-0.05, 0.15, 0] } },
    { at: 0.5, L: { t: [L.shX * 0.6, sh(L) - 1, reach(L) * 0.97], pole: [1, -0.3, 0], aim: [0, 0, 1] }, fk: { chest: [0, -0.15, 0] } },
    { at: 0.58, L: { t: [L.shX * 0.6, sh(L) + 8, reach(L) * 0.82], pole: [1, -0.3, 0], aim: [0, 0.6, 1] }, fk: { chest: [-0.05, -0.15, 0] } },
    { at: 1 },
  ],
  rifle: (L) => {
    const aimP: Key = {
      at: 0.3,
      fk: { spine: [0.05, 0.25, 0], chest: [0, 0.2, 0], head: [0.1, -0.35, 0] },
      R: { t: [-L.shX * 0.55, sh(L) - 2, 10], pole: [-1, -0.5, 0], aim: [0, 0.02, 1] },
      L: { t: [-L.shX * 0.3, sh(L) - 4, 40], pole: [1, -0.6, 0] },
    };
    return [
      { at: 0 },
      aimP,
      { ...aimP, at: 0.5 },
      {
        at: 0.56,
        fk: { spine: [-0.08, 0.25, 0], chest: [-0.08, 0.2, 0], head: [0.05, -0.35, 0] },
        R: { t: [-L.shX * 0.55, sh(L) + 2, 4], pole: [-1, -0.5, 0], aim: [0, 0.25, 1] },
        L: { t: [-L.shX * 0.3, sh(L) + 4, 32], pole: [1, -0.6, 0] },
      },
      { at: 1 },
    ];
  },
  // two-handed overhead chop (Brom): wind up high behind the head, slam down in front, hold, recover
  chop: (L) => [
    { at: 0 },
    {
      at: 0.38,
      fk: { spine: [-0.18, 0.15, 0], chest: [-0.12, 0, 0] },
      R: { t: [-6, L.crown + 8, -6], pole: [-1, 0.3, 0.2], aim: [0, 0.4, -1] },
      L: { t: [6, L.crown + 2, -2], pole: [1, 0.3, 0.2] },
      off: [0, 2, -2],
    },
    {
      at: 0.55,
      fk: { spine: [0.45, 0, 0], chest: [0.2, 0, 0], thighL: [-0.6, 0, 0], shinL: [0.6, 0, 0], thighR: [0.15, 0, 0] },
      R: { t: [-4, L.waist - 4, reach(L) * 0.9], pole: [-1, 0, -0.3], aim: [0, -0.7, 1] },
      L: { t: [4, L.waist + 2, reach(L) * 0.75], pole: [1, 0, -0.3] },
      off: [0, -8, 6],
    },
    {
      at: 0.72,
      fk: { spine: [0.45, 0, 0], chest: [0.2, 0, 0], thighL: [-0.6, 0, 0], shinL: [0.6, 0, 0], thighR: [0.15, 0, 0] },
      R: { t: [-4, L.waist - 6, reach(L) * 0.9], pole: [-1, 0, -0.3], aim: [0, -0.75, 1] },
      L: { t: [4, L.waist, reach(L) * 0.75], pole: [1, 0, -0.3] },
      off: [0, -8, 6],
    },
    { at: 1 },
  ],
  // one-handed horizontal slash from the right side across the front
  slash: (L) => [
    { at: 0 },
    { at: 0.32, fk: { spine: [0.05, -0.55, 0], chest: [0, -0.35, 0], head: [0, 0.5, 0] }, R: { t: [-L.shX * 1.9, sh(L) + 2, -6], pole: [-0.2, -1, -0.3], aim: [-0.6, 0.3, -0.6] } },
    {
      at: 0.5,
      fk: { spine: [0.15, 0.55, 0], chest: [0.05, 0.35, 0], head: [0, -0.5, 0], thighR: [-0.4, 0, 0], shinR: [0.4, 0, 0] },
      R: { t: [L.shX * 1.2, L.chestY - 6, reach(L) * 0.8], pole: [0, -1, -0.5], aim: [0.9, 0, 0.5] },
      off: [0, -4, 6],
    },
    { at: 0.62, fk: { spine: [0.15, 0.55, 0], chest: [0.05, 0.35, 0], head: [0, -0.5, 0] }, R: { t: [L.shX * 1.4, L.chestY - 10, reach(L) * 0.55], pole: [0, -1, -0.5], aim: [0.8, -0.2, 0.2] }, off: [0, -3, 4] },
    { at: 1 },
  ],
  // pull back then lunge forward along the aim (lance, spear, glass arm, banner)
  thrust: (L) => [
    { at: 0 },
    {
      at: 0.35,
      fk: { spine: [-0.1, 0.35, 0], chest: [0, 0.2, 0], head: [0, -0.4, 0] },
      R: { t: [-L.shX * 1.1, L.chestY - 4, -6], pole: [-1, -0.5, -0.3], aim: [0.15, 0.05, 1] },
      L: { t: [L.shX * 0.4, L.chestY - 4, 22], pole: [1, -0.5, 0] },
      off: [0, -2, -4],
    },
    {
      at: 0.52,
      fk: { spine: [0.3, -0.15, 0], chest: [0.1, -0.1, 0], head: [-0.15, 0.2, 0], thighR: [-0.75, 0, 0], shinR: [0.7, 0, 0], thighL: [0.35, 0, 0] },
      R: { t: [-L.shX * 0.25, L.chestY - 2, reach(L) * 1.0], pole: [-1, -0.4, 0], aim: [0.05, 0.02, 1] },
      L: { t: [L.shX * 0.9, L.waist, -4], pole: [1, 0, -0.5] },
      off: [0, -9, 16],
    },
    {
      at: 0.68,
      fk: { spine: [0.3, -0.15, 0], chest: [0.1, -0.1, 0], head: [-0.15, 0.2, 0], thighR: [-0.75, 0, 0], shinR: [0.7, 0, 0], thighL: [0.35, 0, 0] },
      R: { t: [-L.shX * 0.25, L.chestY - 2, reach(L) * 0.98], pole: [-1, -0.4, 0], aim: [0.05, 0.02, 1] },
      L: { t: [L.shX * 0.9, L.waist, -4], pole: [1, 0, -0.5] },
      off: [0, -9, 16],
    },
    { at: 1 },
  ],
  // alternating claw / dagger rakes, low and fast
  swipe: (L) => [
    { at: 0 },
    { at: 0.2, fk: { spine: [0.2, -0.4, 0] }, R: { t: [-L.shX * 1.5, sh(L) + 6, 4], pole: [-0.5, -1, -0.5], aim: [-0.3, 1, 0.3] } },
    { at: 0.36, fk: { spine: [0.35, 0.35, 0] }, R: { t: [L.shX * 0.6, L.waist - 6, reach(L) * 0.85], pole: [-0.5, -1, -0.5], aim: [0.4, -0.6, 1] }, off: [0, -5, 8] },
    { at: 0.52, fk: { spine: [0.2, 0.4, 0] }, L: { t: [L.shX * 1.5, sh(L) + 6, 4], pole: [0.5, -1, -0.5], aim: [0.3, 1, 0.3] } },
    { at: 0.7, fk: { spine: [0.35, -0.35, 0] }, L: { t: [-L.shX * 0.6, L.waist - 6, reach(L) * 0.85], pole: [0.5, -1, -0.5], aim: [-0.4, -0.6, 1] }, off: [0, -5, 8] },
    { at: 1 },
  ],
  // shield shove: step in, shield arm punches forward, weapon follows low
  bash: (L) => [
    { at: 0 },
    { at: 0.3, fk: { spine: [-0.05, 0.35, 0], chest: [0, 0.15, 0] }, L: { t: [L.shX * 0.8, L.chestY - 10, 8], pole: [1, -0.6, -0.3], aim: [0.3, 1, 0] }, off: [0, -3, -4] },
    {
      at: 0.48,
      fk: { spine: [0.3, -0.25, 0], chest: [0.1, -0.1, 0], thighL: [-0.7, 0, 0], shinL: [0.6, 0, 0], thighR: [0.3, 0, 0] },
      L: { t: [L.shX * 0.2, L.chestY - 6, reach(L) * 0.9], pole: [1, -0.6, -0.3], aim: [0, 1, 0.2] },
      R: { t: [-L.shX * 1.1, L.waist + 4, 18], pole: [-0.5, -1, -0.5], aim: [0, 0.4, 1] },
      off: [0, -8, 16],
    },
    { at: 0.66, fk: { spine: [0.3, -0.25, 0], chest: [0.1, -0.1, 0], thighL: [-0.7, 0, 0], shinL: [0.6, 0, 0], thighR: [0.3, 0, 0] }, L: { t: [L.shX * 0.2, L.chestY - 6, reach(L) * 0.85], pole: [1, -0.6, -0.3], aim: [0, 1, 0.2] }, off: [0, -8, 14] },
    { at: 1 },
  ],
  // overhand throw with the right arm (hook, daggers, sling, spindles)
  throw: (L) => [
    { at: 0 },
    { at: 0.36, fk: { spine: [-0.15, 0.5, 0], chest: [-0.05, 0.25, 0], head: [0, -0.5, 0] }, R: { t: [-L.shX * 1.5, L.crown, -14], pole: [-0.6, -0.4, -1], aim: [0, 1, -0.4] }, L: { t: [L.shX * 1.1, sh(L) - 4, 22], pole: [1, -0.5, 0] } },
    {
      at: 0.52,
      fk: { spine: [0.35, -0.35, 0], chest: [0.15, -0.15, 0], head: [-0.2, 0.3, 0], thighR: [-0.5, 0, 0], shinR: [0.5, 0, 0] },
      R: { t: [-L.shX * 0.2, sh(L) - 8, reach(L) * 0.95], pole: [-1, -0.5, 0], aim: [0, -0.2, 1] },
      L: { t: [L.shX * 1.2, L.waist, -6], pole: [1, 0, -0.5] },
      off: [0, -6, 10],
    },
    { at: 0.7, fk: { spine: [0.3, -0.3, 0], chest: [0.1, -0.1, 0] }, R: { t: [L.shX * 0.2, L.waist - 2, reach(L) * 0.7], pole: [-1, -0.5, 0], aim: [0.2, -0.6, 1] }, off: [0, -4, 8] },
    { at: 1 },
  ],
  // staff / pole: swing the head forward and down in an arc
  staff: (L) => [
    { at: 0 },
    { at: 0.35, fk: { spine: [-0.15, 0.2, 0] }, R: { t: [-L.shX * 1.1, sh(L) + 10, 6], pole: [-1, -0.4, -0.5], aim: [0.1, 0.8, -0.6] }, L: { t: [L.shX * 0.4, sh(L) - 4, 16], pole: [1, -0.5, 0] } },
    {
      at: 0.55,
      fk: { spine: [0.35, -0.1, 0], chest: [0.1, 0, 0], thighR: [-0.5, 0, 0], shinR: [0.5, 0, 0] },
      R: { t: [-L.shX * 0.5, L.chestY - 6, reach(L) * 0.92], pole: [-1, -0.4, 0], aim: [0.05, 0.25, 1] },
      L: { t: [L.shX * 0.2, L.waist + 2, 20], pole: [1, -0.5, 0] },
      off: [0, -6, 10],
    },
    { at: 0.72, fk: { spine: [0.3, -0.1, 0], chest: [0.1, 0, 0] }, R: { t: [-L.shX * 0.5, L.chestY - 8, reach(L) * 0.88], pole: [-1, -0.4, 0], aim: [0.05, 0.2, 1] }, off: [0, -5, 8] },
    { at: 1 },
  ],
  // yoke carriers: whole-body twist that swings the bell / buckets
  ring: () => [
    { at: 0 },
    { at: 0.3, fk: { spine: [0.05, -0.55, 0.06], chest: [0, -0.35, 0], hips: [0, -0.2, 0], dangleR: [0.2, 0, -0.9], dangleL: [0.2, 0, -0.5] }, off: [0, -2, 0] },
    { at: 0.55, fk: { spine: [0.15, 0.6, -0.08], chest: [0.05, 0.35, 0], hips: [0, 0.2, 0], dangleR: [0.2, 0, 1.0], dangleL: [0.2, 0, 0.6] }, off: [0, -5, 6] },
    { at: 0.75, fk: { spine: [0.08, 0.2, 0], chest: [0, 0.1, 0], dangleR: [0, 0, 0.4], dangleL: [0, 0, 0.2] }, off: [0, -2, 3] },
    { at: 1 },
  ],
};

const CASTS: Record<CastStyle, KeyFn> = {
  // prop / hand up high
  raise: (L) => [
    { at: 0 },
    { at: 0.3, fk: { spine: [-0.12, 0, 0], head: [-0.3, 0, 0] }, R: { t: [-L.shX * 0.9, L.crown + reach(L) * 0.5, 8], pole: [-1, 0, -0.3], aim: [0, 1, 0.1] }, L: { t: [L.shX * 1.4, sh(L) + 4, 16], pole: [1, -0.5, 0] } },
    { at: 0.72, fk: { spine: [-0.12, 0, 0], head: [-0.3, 0, 0] }, R: { t: [-L.shX * 0.9, L.crown + reach(L) * 0.55, 10], pole: [-1, 0, -0.3], aim: [0, 1, 0.1] }, L: { t: [L.shX * 1.5, sh(L) + 8, 16], pole: [1, -0.5, 0] } },
    { at: 1 },
  ],
  // both hands push forward
  forward: (L) => [
    { at: 0 },
    { at: 0.28, fk: { spine: [-0.08, 0, 0] }, R: { t: [-L.shX * 0.8, sh(L) - 4, 12], pole: [-1, -0.5, -0.2] }, L: { t: [L.shX * 0.8, sh(L) - 4, 12], pole: [1, -0.5, -0.2] }, off: [0, 0, -3] },
    {
      at: 0.45,
      fk: { spine: [0.22, 0, 0], thighL: [-0.5, 0, 0], shinL: [0.45, 0, 0] },
      R: { t: [-L.shX * 0.45, sh(L) - 2, reach(L) * 0.95], pole: [-1, -0.5, -0.2] },
      L: { t: [L.shX * 0.45, sh(L) - 2, reach(L) * 0.95], pole: [1, -0.5, -0.2] },
      off: [0, -5, 9],
    },
    { at: 0.75, fk: { spine: [0.2, 0, 0], thighL: [-0.5, 0, 0], shinL: [0.45, 0, 0] }, R: { t: [-L.shX * 0.45, sh(L) - 3, reach(L) * 0.92], pole: [-1, -0.5, -0.2] }, L: { t: [L.shX * 0.45, sh(L) - 3, reach(L) * 0.92], pole: [1, -0.5, -0.2] }, off: [0, -5, 8] },
    { at: 1 },
  ],
  // both arms up, then slam down with a crouch
  slam: (L) => [
    { at: 0 },
    { at: 0.35, fk: { spine: [-0.2, 0, 0] }, R: { t: [-L.shX * 0.7, L.crown + 10, 4], pole: [-1, 0, 0], aim: [0, 1, 0] }, L: { t: [L.shX * 0.7, L.crown + 10, 4], pole: [1, 0, 0] }, off: [0, 3, 0] },
    {
      at: 0.52,
      fk: { spine: [0.55, 0, 0], chest: [0.15, 0, 0], thighL: [-0.9, 0, 0], shinL: [1.1, 0, 0], thighR: [-0.4, 0, 0], shinR: [1.2, 0, 0], footL: [-0.2, 0, 0], footR: [-0.6, 0, 0] },
      R: { t: [-L.shX * 0.6, L.waist - 20, reach(L) * 0.8], pole: [-1, 0, 0], aim: [0, -1, 0.6] },
      L: { t: [L.shX * 0.6, L.waist - 20, reach(L) * 0.8], pole: [1, 0, 0] },
      off: [0, -20, 8],
    },
    {
      at: 0.75,
      fk: { spine: [0.5, 0, 0], chest: [0.15, 0, 0], thighL: [-0.9, 0, 0], shinL: [1.1, 0, 0], thighR: [-0.4, 0, 0], shinR: [1.2, 0, 0], footL: [-0.2, 0, 0], footR: [-0.6, 0, 0] },
      R: { t: [-L.shX * 0.6, L.waist - 22, reach(L) * 0.8], pole: [-1, 0, 0], aim: [0, -1, 0.6] },
      L: { t: [L.shX * 0.6, L.waist - 22, reach(L) * 0.8], pole: [1, 0, 0] },
      off: [0, -20, 8],
    },
    { at: 1 },
  ],
  ring: (L) => ATTACKS.ring(L),
  // full spin on the spot, arms out
  spin: (L) => [
    { at: 0 },
    { at: 0.2, fk: { spine: [0.2, 0.4, 0] }, R: { t: [-L.shX * 2.2, sh(L) - 2, 4], pole: [0, -1, -0.3] }, L: { t: [L.shX * 2.2, sh(L) - 2, 4], pole: [0, -1, -0.3] }, rootR: [0, 0, 0], off: [0, -6, 0] },
    { at: 0.7, fk: { spine: [0.2, -0.2, 0] }, R: { t: [-L.shX * 2.2, sh(L) - 2, 4], pole: [0, -1, -0.3] }, L: { t: [L.shX * 2.2, sh(L) - 2, 4], pole: [0, -1, -0.3] }, rootR: [0, Math.PI * 2, 0], off: [0, -6, 0] },
    { at: 1, rootR: [0, Math.PI * 2, 0] },
  ],
};

const DEATH: KeyFn = (L) => [
  { at: 0 },
  { at: 0.18, fk: { spine: [-0.35, 0.1, 0], head: [-0.4, 0, 0] }, R: { t: [-L.shX * 1.8, sh(L) - 10, 6], pole: [0, -1, 0] }, L: { t: [L.shX * 1.8, sh(L) - 12, 6], pole: [0, -1, 0] }, off: [0, -2, -4] },
  {
    at: 0.45,
    fk: { spine: [0.35, 0.15, 0], head: [0.4, 0, 0], thighL: [-1.0, 0, 0.1], shinL: [1.6, 0, 0], thighR: [-0.8, 0, -0.1], shinR: [1.5, 0, 0], footL: [-0.4, 0, 0], footR: [-0.4, 0, 0] },
    R: { t: [-L.shX * 1.2, L.waist - 20, 10], pole: [0, -1, 0] },
    L: { t: [L.shX * 1.2, L.waist - 20, 12], pole: [0, -1, 0] },
    off: [0, -(L.kneeY * 0.7), 4],
  },
  {
    at: 1,
    fk: { spine: [-0.1, 0.2, 0], head: [-0.3, 0.6, 0], thighL: [-0.5, 0, 0.15], shinL: [0.6, 0, 0], thighR: [-0.1, 0, -0.2], shinR: [0.3, 0, 0], footL: [0.5, 0, 0], footR: [0.6, 0, 0] },
    R: { t: [-L.shX * 2.2, sh(L) + 10, -4], pole: [0, 0, -1] },
    L: { t: [L.shX * 2.0, L.waist, -6], pole: [0, 0, -1] },
    off: [0, 0, 0],
    rootR: [-1.52, 0, 0],
    rootP: [0, L.chestD + 2, -6],
  },
];

const KNEEL: KeyFn = (L) => {
  const drop = L.kneeY - 4;
  const k: Key = {
    at: 0.06,
    fk: { spine: [0.28, 0, 0], chest: [0.05, 0, 0], head: [0.35, 0, 0], thighL: [-1.45, 0, 0.12], shinL: [1.45, 0, 0], thighR: [0.12, 0, -0.06], shinR: [1.62, 0, 0], footR: [0.55, 0, 0] },
    L: { t: [L.shX * 0.2, L.chestY - 4, 18], pole: [1, -1, 0], aim: [0, 1, 0.4] },
    R: { t: [L.hipX + 2, L.hipY - 8, L.hipY - L.kneeY + 6], pole: [-1, 0, 0] },
    off: [0, -drop, -4],
  };
  return [{ at: 0 }, k, { ...k, at: 1 }];
};

export function actionKeys(anim: Anim3D, p: AnimProfile): Key[] | null {
  switch (anim) {
    case 'attack':
      return ATTACKS[p.attack](p.L);
    case 'cast':
      return CASTS[p.cast](p.L);
    case 'death':
      return DEATH(p.L);
    case 'recall':
      return KNEEL(p.L);
    default:
      return null;
  }
}

// ------------------------------------------------------------------------------------------------ evaluation
const ease = (t: number): number => t * t * (3 - 2 * t);
const tv = new THREE.Vector3();

function setE(p: PoseBuf, i: number | undefined, x: number, y: number, z: number): void {
  if (i === undefined) return;
  p.e[i * 3] = x;
  p.e[i * 3 + 1] = y;
  p.e[i * 3 + 2] = z;
}
function addE(p: PoseBuf, i: number | undefined, x: number, y: number, z: number): void {
  if (i === undefined) return;
  p.e[i * 3] += x;
  p.e[i * 3 + 1] += y;
  p.e[i * 3 + 2] += z;
}

/** Base pose: hold arms + hunch + crouch (+ the hold-specific stance). */
export function baseHold(p: AnimProfile, out: PoseBuf): void {
  out.e.fill(0);
  out.off.set(0, 0, 0);
  out.rootP.set(0, 0, 0);
  out.rootR.set(0, 0, 0);
  out.draw = 0;
  const h = HOLDS[p.hold];
  const L = p.L;
  const b = p.bone;
  for (let s = 0; s < 2; s++) {
    const a = s === 0 ? h.L : h.R;
    const t = a.t(L);
    out.armT[s]!.set(t[0], t[1], t[2]);
    out.armPole[s]!.set(a.pole[0], a.pole[1], a.pole[2]).normalize();
    out.hasAim[s] = !!a.aim;
    if (a.aim) out.armAim[s]!.set(a.aim[0], a.aim[1], a.aim[2]).normalize();
  }
  const hunch = L.hunch + (h.lean ?? 0) + (p.gait === 'prowl' ? 0.12 : 0);
  setE(out, b.spine, hunch * 0.6, 0, 0);
  setE(out, b.chest, hunch * 0.5, 0, 0);
  setE(out, b.neck, -hunch * 0.5, 0, 0);
  setE(out, b.head, -hunch * 0.45, 0, 0);
  const crouch = (h.crouch ?? 0) + (p.gait === 'prowl' ? 0.22 : 0);
  if (crouch > 0) applyCrouch(out, p, crouch);
  // stance: feet a little apart
  const st = (L.stance - 9) * 0.006 + 0.03;
  addE(out, b.thighL, 0, 0, st);
  addE(out, b.thighR, 0, 0, -st);
  addE(out, b.footL, 0, 0, -st);
  addE(out, b.footR, 0, 0, st);
}

function applyCrouch(out: PoseBuf, p: AnimProfile, c: number): void {
  const b = p.bone;
  const th = p.L.hipY - p.L.kneeY;
  addE(out, b.thighL, -c, 0, 0);
  addE(out, b.thighR, -c, 0, 0);
  addE(out, b.shinL, c * 2, 0, 0);
  addE(out, b.shinR, c * 2, 0, 0);
  addE(out, b.footL, -c, 0, 0);
  addE(out, b.footR, -c, 0, 0);
  addE(out, b.spine, c * 0.6, 0, 0);
  out.off.y -= th * (1 - Math.cos(c)) * 2;
}

/** Idle: breathing, slow weight shift, a glance around. t in seconds. */
export function idleLayer(p: AnimProfile, out: PoseBuf, t: number, seed: number): void {
  const b = p.bone;
  const br = Math.sin((t / 3.2) * Math.PI * 2 + seed);
  const ws = Math.sin((t / 6.3) * Math.PI * 2 + seed * 1.7);
  addE(out, b.chest, -0.025 * br, 0, 0);
  addE(out, b.spine, 0.01 * br, 0, 0);
  addE(out, b.hips, 0, ws * 0.04, ws * 0.035);
  out.off.x += ws * 1.6;
  addE(out, b.thighL, 0, 0, -ws * 0.035);
  addE(out, b.thighR, 0, 0, -ws * 0.035);
  addE(out, b.footL, 0, 0, 0);
  addE(out, b.spine, 0, 0, -ws * 0.03);
  addE(out, b.head, 0.03 * br, Math.sin(t * 0.37 + seed) * 0.18, 0);
  out.armT[0]!.y += br * 0.6;
  out.armT[1]!.y += br * 0.6;
  addE(out, b.cape0, 0.05 + br * 0.015, 0, 0);
  addE(out, b.cape1, 0.04 + Math.sin(t * 1.3 + seed) * 0.03, 0, Math.sin(t * 0.9) * 0.03);
  const d = Math.sin(t * 1.1 + seed) * 0.05;
  addE(out, b.dangleR, d, 0, d * 0.5);
  addE(out, b.dangleL, -d * 0.7, 0, d * 0.4);
}

/** Run cycle; phase 0..1 (two steps). */
export function runLayer(p: AnimProfile, out: PoseBuf, phase: number): void {
  const b = p.bone;
  const L = p.L;
  const a = phase * Math.PI * 2;
  const heavy = p.gait === 'heavy';
  const light = p.gait === 'light';
  const stride = (p.stride ?? 1) * (heavy ? 0.6 : light ? 0.85 : 0.75);
  const sa = Math.sin(a);
  const ca = Math.cos(a);
  const swingL = Math.max(0, ca);
  const swingR = Math.max(0, -ca);
  addE(out, b.thighL, -sa * stride, 0, 0);
  addE(out, b.thighR, sa * stride, 0, 0);
  addE(out, b.shinL, 0.2 + swingL * swingL * 1.3 * stride + Math.max(0, -sa) * 0.25, 0, 0);
  addE(out, b.shinR, 0.2 + swingR * swingR * 1.3 * stride + Math.max(0, sa) * 0.25, 0, 0);
  addE(out, b.footL, -sa * 0.25 + swingL * 0.3, 0, 0);
  addE(out, b.footR, sa * 0.25 + swingR * 0.3, 0, 0);
  const bob = (heavy ? 3.5 : 2.6) * Math.cos(2 * a);
  out.off.y += bob - (heavy ? 5 : 3.5);
  out.off.x += sa * 1.2;
  const lean = heavy ? 0.18 : light ? 0.24 : 0.2;
  addE(out, b.spine, lean, 0, 0);
  addE(out, b.hips, 0, sa * 0.16, 0);
  addE(out, b.chest, 0, -sa * 0.22, 0);
  addE(out, b.neck, -lean * 0.6, sa * 0.1, 0);
  addE(out, b.head, -lean * 0.3, 0, 0);
  // arms: swing opposite to the legs, amount from the hold
  const h = HOLDS[p.hold];
  const k = (L.upper + L.fore) * 0.45;
  out.armT[0]!.z += sa * k * h.swing[0];
  out.armT[0]!.y += Math.abs(sa) * 3 * h.swing[0];
  out.armT[1]!.z -= sa * k * h.swing[1];
  out.armT[1]!.y += Math.abs(sa) * 3 * h.swing[1];
  // cloth lag
  const tL = -sa * stride;
  const tR = sa * stride;
  addE(out, b.skirtF, Math.min(tL, tR) * 0.9 - 0.05, 0, 0);
  addE(out, b.skirtB, Math.max(tL, tR) * 0.7 + 0.18, 0, 0);
  addE(out, b.cape0, 0.38 + Math.sin(2 * a) * 0.06, 0, 0);
  addE(out, b.cape1, 0.3 + Math.sin(2 * a + 1.2) * 0.12, 0, Math.sin(a) * 0.08);
  addE(out, b.dangleR, 0.25 + Math.sin(2 * a) * 0.12, 0, sa * 0.12);
  addE(out, b.dangleL, 0.25 + Math.sin(2 * a + 0.5) * 0.12, 0, -sa * 0.12);
}

/** Apply action key poses at normalised time u on top of `out` (which holds the base). */
export function applyKeys(p: AnimProfile, keys: Key[], u: number, out: PoseBuf, base: PoseBuf): void {
  let i = 0;
  while (i < keys.length - 2 && u > keys[i + 1]!.at) i++;
  const k0 = keys[i]!;
  const k1 = keys[Math.min(i + 1, keys.length - 1)]!;
  const span = Math.max(1e-4, k1.at - k0.at);
  const f = ease(Math.min(1, Math.max(0, (u - k0.at) / span)));
  // fk bones listed in either key
  const seen = SEEN;
  seen.clear();
  for (const k of [k0, k1]) {
    if (!k.fk) continue;
    for (const name in k.fk) {
      if (seen.has(name)) continue;
      seen.add(name);
      const bi = p.bone[name];
      if (bi === undefined) continue;
      const a0 = k0.fk?.[name];
      const a1 = k1.fk?.[name];
      for (let c = 0; c < 3; c++) {
        const bv = base.e[bi * 3 + c]!;
        const v0 = a0 ? bv + a0[c]! : bv;
        const v1 = a1 ? bv + a1[c]! : bv;
        out.e[bi * 3 + c] = v0 + (v1 - v0) * f;
      }
    }
  }
  for (let s = 0; s < 2; s++) {
    const a0 = s === 0 ? k0.L : k0.R;
    const a1 = s === 0 ? k1.L : k1.R;
    if (!a0 && !a1) continue;
    lerpV(out.armT[s]!, a0?.t, a1?.t, base.armT[s]!, f);
    lerpV(out.armPole[s]!, a0?.pole, a1?.pole, base.armPole[s]!, f);
    out.armPole[s]!.normalize();
    const has0 = a0?.aim ? true : base.hasAim[s]!;
    const has1 = a1?.aim ? true : base.hasAim[s]!;
    if (has0 || has1) {
      lerpV(out.armAim[s]!, a0?.aim, a1?.aim, base.hasAim[s] ? base.armAim[s]! : tv.set(0, -1, 0), f);
      out.armAim[s]!.normalize();
      out.hasAim[s] = true;
    }
  }
  const o0 = k0.off ?? ZERO;
  const o1 = k1.off ?? ZERO;
  out.off.x += o0[0] + (o1[0] - o0[0]) * f;
  out.off.y += o0[1] + (o1[1] - o0[1]) * f;
  out.off.z += o0[2] + (o1[2] - o0[2]) * f;
  const r0 = k0.rootR ?? ZERO;
  const r1 = k1.rootR ?? ZERO;
  out.rootR.set(r0[0] + (r1[0] - r0[0]) * f, r0[1] + (r1[1] - r0[1]) * f, r0[2] + (r1[2] - r0[2]) * f);
  const p0 = k0.rootP ?? ZERO;
  const p1 = k1.rootP ?? ZERO;
  out.rootP.set(p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f, p0[2] + (p1[2] - p0[2]) * f);
  const d0 = k0.draw ?? 0;
  const d1 = k1.draw ?? 0;
  out.draw = d0 + (d1 - d0) * f;
}
const SEEN = new Set<string>();
const ZERO: V = [0, 0, 0];

function lerpV(out: THREE.Vector3, a: V | undefined, b: V | undefined, base: THREE.Vector3, f: number): void {
  const ax = a ? a[0] : base.x;
  const ay = a ? a[1] : base.y;
  const az = a ? a[2] : base.z;
  const bx = b ? b[0] : base.x;
  const by = b ? b[1] : base.y;
  const bz = b ? b[2] : base.z;
  out.set(ax + (bx - ax) * f, ay + (by - ay) * f, az + (bz - az) * f);
}

// ------------------------------------------------------------------------------------------------ IK solve
const _S = new THREE.Vector3();
const _T = new THREE.Vector3();
const _E = new THREE.Vector3();
const _u = new THREE.Vector3();
const _pp = new THREE.Vector3();
const _d1 = new THREE.Vector3();
const _d2 = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _qU = new THREE.Quaternion();
const _qF = new THREE.Quaternion();
const _qH = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();
const _qD = new THREE.Quaternion();

/**
 * Two-bone IK in the chest frame (the clavicle is kept at identity, so chest frame = clavicle frame).
 * shoulder/target are relative to the chest bind position. Writes local quaternions for upper arm, forearm, hand.
 * holdHand / holdAim: the hand's chest-frame rotation and prop aim in the hold pose (props are authored there).
 */
export function solveArm(
  shoulder: THREE.Vector3,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  l1: number,
  l2: number,
  aim: THREE.Vector3 | null,
  holdHand: THREE.Quaternion,
  holdAim: THREE.Vector3 | null,
  outU: THREE.Quaternion,
  outF: THREE.Quaternion,
  outH: THREE.Quaternion,
  outWrist?: THREE.Vector3,
  outHandChest?: THREE.Quaternion,
): void {
  _S.copy(shoulder);
  _T.copy(target);
  _u.subVectors(_T, _S);
  let D = _u.length();
  if (D < 1e-3) {
    _u.set(0, -1, 0);
    D = 1e-3;
  } else _u.divideScalar(D);
  D = Math.min(D, (l1 + l2) * 0.999);
  D = Math.max(D, Math.abs(l1 - l2) + 0.5);
  const a = (l1 * l1 - l2 * l2 + D * D) / (2 * D);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _pp.copy(pole).addScaledVector(_u, -pole.dot(_u));
  if (_pp.lengthSq() < 1e-6) _pp.set(0, 0, -1).addScaledVector(_u, -_u.z);
  _pp.normalize();
  _E.copy(_S).addScaledVector(_u, a).addScaledVector(_pp, h);
  _T.copy(_S).addScaledVector(_u, D);
  if (outWrist) outWrist.copy(_T);
  _d1.subVectors(_E, _S).normalize();
  _d2.subVectors(_T, _E).normalize();
  // hinge axis: bind has upper (0,-1,0), forearm bends to +z, x = d1 x pole direction
  _x.crossVectors(_d1, _pp).normalize();
  if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0);
  _y.copy(_d1).negate();
  _z.crossVectors(_x, _y).normalize();
  _m.makeBasis(_x, _y, _z);
  _qU.setFromRotationMatrix(_m);
  _y.copy(_d2).negate();
  _z.crossVectors(_x, _y).normalize();
  _x.crossVectors(_y, _z).normalize();
  _m.makeBasis(_x, _y, _z);
  _qF.setFromRotationMatrix(_m);
  if (aim && holdAim) {
    _qD.setFromUnitVectors(holdAim, aim);
    _qH.copy(_qD).multiply(holdHand);
  } else _qH.copy(_qF);
  if (outHandChest) outHandChest.copy(_qH);
  outU.copy(_qU);
  _qInv.copy(_qU).invert();
  outF.copy(_qInv).multiply(_qF);
  _qInv.copy(_qF).invert();
  outH.copy(_qInv).multiply(_qH);
}

