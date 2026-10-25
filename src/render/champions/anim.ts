// Animation: builds a Pose per (kit, anim, frame). Hands are authored as chest-local targets (solved with IK),
// feet as ground targets. Holds (idle/run carry), attack styles and cast styles are shared across champions.
//
// Frame layout (champions; minions keep the older, shorter layout through kit.frames):
//   idle   4  breathing + weight shift loop (frame 0 = neutral rest pose: portraits / head anchor / bar height)
//   run    8  contact / down / passing / up per step, counter-rotating shoulders, trailing cloth
//   attack 5  anticipation, coil, STRIKE (= the sim's hit point, ATTACK_HIT), follow-through, recover
//   cast   4  gather, RELEASE (CAST_RELEASE), follow-through, self-buff flex (CAST_FLEX)
//   death  3  recoil, knees buckle, down
// The game stretches attack/cast frames over the actual wind-up: state machine in render/anim/machine.ts, playback table
// (fps, loop, event frames per id) in render/anim/data.ts, format in docs/ANIM-FORMAT.md. This file only paints poses.
import { lerp3, norm, TAU, type V3 } from './core';
import { bodyOf } from './humanoid';
import type { Anim, Kit, Pose } from './types';

export const FRAMES: Record<Anim, number> = { idle: 4, run: 8, attack: 5, cast: 4, death: 3 };
/** The frame layout before the animation pass (minions, carts, monsters, Hark). */
export const LEGACY_FRAMES: Record<Anim, number> = { idle: 4, run: 6, attack: 4, cast: 0, death: 3 };
/** suggested playback rates (frames per second) of the legacy layout */
export const FPS: Record<Anim, number> = { idle: 5, run: 11, attack: 12, cast: 9, death: 7 };
/** playback rates of the champion layout (attack/cast are normally stretched to the wind-up instead) */
export const CHAMP_FPS: Record<Anim, number> = { idle: 3.2, run: 14, attack: 13, cast: 12, death: 8 };
export const LOOP: Record<Anim, boolean> = { idle: true, run: true, attack: false, cast: false, death: false };
/** attack frame that shows the impact / release (the sim's hit point) */
export const ATTACK_HIT = 2;
/** cast frames: release of a directed spell, and the self-buff flex */
export const CAST_RELEASE = 1;
export const CAST_FLEX = 3;

export const framesOfKit = (kit: Kit, anim: Anim): number => kit.frames?.[anim] ?? FRAMES[anim];

interface Hands {
  handL: V3;
  handR: V3;
  aim?: V3;
  aimL?: V3;
  poleL?: V3;
  poleR?: V3;
  lean?: number;
  twist?: number;
  crouch?: number;
  act?: number;
  glow?: number;
  headTilt?: number;
  bob?: number;
  breath?: number;
  fwd?: number; // step forward with the lead foot
}

const D_AIM: V3 = [0, 0, 1];
const D_POLE_L: V3 = [0.5, -0.1, -1];
const D_POLE_R: V3 = [-0.5, -0.1, -1];

function base(kit: Kit, anim: Anim, frame: number): Pose {
  const b = bodyOf(kit);
  return {
    bob: 0,
    shift: 0,
    breath: 0,
    lean: 0,
    twist: 0,
    hipYaw: 0,
    roll: 0,
    headTilt: 0,
    headYaw: 0,
    footL: [b.stance, 0, 1],
    footR: [-b.stance, 0, -1],
    handL: [0, 0, 0],
    handR: [0, 0, 0],
    poleL: D_POLE_L,
    poleR: D_POLE_R,
    aim: D_AIM,
    aimL: D_AIM,
    fall: 0,
    sway: 0,
    act: 0,
    glow: 0,
    crouch: 0,
    anim,
    t: frame / Math.max(1, framesOfKit(kit, anim)),
    frame,
  };
}

const num = (a: number | undefined, b: number | undefined, t: number): number => (a ?? 0) + ((b ?? 0) - (a ?? 0)) * t;
const dir = (a: V3 | undefined, b: V3 | undefined, d: V3, t: number): V3 => norm(lerp3(a ?? d, b ?? d, t));
/** In-between of two hand keys (positions linear, directions re-normalised). */
function mixH(a: Hands, b: Hands, t: number): Hands {
  return {
    handL: lerp3(a.handL, b.handL, t),
    handR: lerp3(a.handR, b.handR, t),
    aim: dir(a.aim, b.aim, D_AIM, t),
    aimL: dir(a.aimL, b.aimL, D_AIM, t),
    poleL: dir(a.poleL, b.poleL, D_POLE_L, t),
    poleR: dir(a.poleR, b.poleR, D_POLE_R, t),
    lean: num(a.lean, b.lean, t),
    twist: num(a.twist, b.twist, t),
    crouch: num(a.crouch, b.crouch, t),
    act: num(a.act, b.act, t),
    glow: num(a.glow, b.glow, t),
    headTilt: num(a.headTilt, b.headTilt, t),
    bob: num(a.bob, b.bob, t),
    breath: num(a.breath, b.breath, t),
    fwd: num(a.fwd, b.fwd, t),
  };
}
const up = (v: V3, dy: number, dx = 0, dz = 0): V3 => [v[0] + dx, v[1] + dy, v[2] + dz];

/** Carry pose for idle/run. `swing` = arm swing phase (−1..1) for free arms. */
function hold(kit: Kit, swing: number, running: boolean): Hands {
  const b = bodyOf(kit);
  const A = b.H * 0.385;
  const S = b.shW;
  const light = kit.gait === 'light';
  // free arm: swings opposite to the leg, elbow bends more on the forward swing
  const free = (side: number, ph: number): V3 => [side * (S + 3), -A * 0.86 + Math.max(0, ph) * (running ? 9 : 2) + Math.abs(ph) * 3, 3 + ph * A * (light ? 0.5 : 0.42)];
  const sw = running ? swing : swing * 0.08;
  switch (kit.hold) {
    case 'bow':
      return { handL: [S * 0.75, -A * 0.5, A * 0.38 + sw * 3], handR: free(-1, -sw), aimL: norm([0.05, 1, 0.22]) };
    case 'pistols':
      return {
        handL: [S + 2, -A * 0.74, A * 0.18 + sw * A * 0.3],
        handR: [-(S + 2), -A * 0.74, A * 0.18 - sw * A * 0.3],
        aim: norm([0, -0.75, 1]),
        aimL: norm([0, -0.75, 1]),
      };
    case 'rifle':
      return { handR: [-S * 0.65, -A * 0.6, A * 0.18 + sw * 2], handL: [S * 0.3, -A * 0.3 + sw * 1.5, A * 0.55], poleL: [1, -0.6, 0], poleR: [-1, -0.4, -0.4] };
    case 'shoulder':
      return { handR: [-(S + 3), -A * 0.38, A * 0.28 - sw * 2], handL: [-S * 0.25, -A * 0.72, A * 0.5 + sw * 2], poleR: [-1, -0.6, 0.2], poleL: [0.6, -1, 0] };
    case 'pole':
      return { handR: [-(S + 3), -A * 0.42, A * 0.36], handL: free(1, sw), aim: norm([0, 1, running ? 0.45 : 0.06]), poleR: [-1, -0.5, -0.4] };
    case 'cane':
      // old man: leans on the planted staff in front, other hand behind the back
      return running
        ? { handR: [-(S + 1), -A * 0.35, A * 0.5], handL: free(1, sw * 0.6), aim: norm([0, 1, 0.55]), poleR: [-1, -0.5, -0.4] }
        : { handR: [-S * 0.75, -A * 0.4, A * 0.62], handL: [S * 0.35, -A * 0.62, -A * 0.42], aim: norm([-0.08, 1, -0.12]), poleR: [-1, -0.2, -0.3], poleL: [1, -0.3, -0.2] };
    case 'port':
      // lance diagonal across the body, point up past the left shoulder
      return {
        handR: [-S * 0.55, -A * 0.68 + sw * 2, A * 0.42],
        handL: [S * 0.25, -A * 0.12 + sw * 2, A * 0.55],
        aim: norm([0.55, 1, running ? 0.35 : 0.12]),
        poleR: [-1, -0.6, -0.2],
        poleL: [1, -0.5, -0.3],
      };
    case 'overhead':
      // spear sloped back over the right shoulder, off hand free
      return { handR: [-(S + 2), -A * 0.22, A * 0.32], handL: free(1, sw), aim: norm([-0.1, 0.75, -1]), poleR: [-1, -0.8, 0.2] };
    case 'shield':
      return {
        handL: [S * 0.45, -A * 0.4, A * 0.58 + sw * 2],
        handR: free(-1, -sw * 0.6),
        aimL: [0, 0, 1],
        aim: norm([0, -1, 0.25]),
        poleL: [1, -0.4, -0.2],
      };
    case 'yoke':
      return { handL: [S + 5, A * 0.02, A * 0.14], handR: [-(S + 5), A * 0.02, A * 0.14], poleL: [1, -1, 0], poleR: [-1, -1, 0] };
    case 'jug':
      // big water jug on the left shoulder, steadied by the left hand; right hand free
      return { handL: [S * 0.55, A * 0.42, A * 0.12], handR: free(-1, -sw), poleL: [1, -0.2, -0.4] };
    case 'palm':
      // right hand out in front, palm up, drifting in a small circle with the idle sway; left hand in the coat
      return { handR: [-(S + 9) + sw * 4, -A * 0.34 + Math.abs(sw) * 3, A * 0.7], handL: [S * 0.4, -A * 0.66, A * 0.22], aim: norm([0, 1, 0.15]), poleR: [-1, -0.3, -0.2], poleL: [1, -0.6, -0.3] };
    case 'guard':
      return {
        handR: [-S * 0.8, -A * 0.5, A * 0.5 - sw * 6],
        handL: [S * 0.8, -A * 0.45, A * 0.42 + sw * 6],
        aim: norm([0.15, -0.35, 1]),
        aimL: norm([-0.15, -0.35, 1]),
        crouch: 0.28,
        poleL: [1, -0.4, -0.5],
        poleR: [-1, -0.4, -0.5],
      };
    case 'hook':
      return { handR: [-(S + 4), -A * 0.78, A * 0.12 - sw * 8], handL: [S + 3, -A * 0.55, A * 0.32 + sw * 4], poleL: [1, -0.5, -0.2] };
    case 'spindle':
      return { handR: [-S * 0.45, -A * 0.48, A * 0.5], handL: [S * 0.45, -A * 0.5, A * 0.48], aim: norm([0, 1, 0.2]), poleL: [1, -0.6, -0.3], poleR: [-1, -0.6, -0.3] };
    case 'blade':
      return { handR: [-(S + 3), -A * 0.72, A * 0.28 - sw * 6], handL: free(1, sw), aim: norm([-0.15, -0.55, 1]) };
    case 'fists':
      return { handR: [-(S + 1), -A * 0.55, A * 0.32 - sw * 10], handL: [S + 1, -A * 0.55, A * 0.32 + sw * 10], poleL: [1, -0.6, -0.2], poleR: [-1, -0.6, -0.2] };
    default:
      return { handL: free(1, sw), handR: free(-1, -sw) };
  }
}

/** Attack keys: [wind-up, strike, follow-through] (+ optional explicit 5-key list). */
function attackKeys(kit: Kit): Hands[] {
  const b = bodyOf(kit);
  const A = b.H * 0.385;
  const S = b.shW;
  const h = hold(kit, 0, false);
  // 5 keys from wind / strike / follow: half wind-up, coiled (overshoot), strike, follow-through, settle back
  const five = (wind: Hands, strike: Hands, follow: Hands, coil: Partial<Hands> = {}): Hands[] => [
    { ...mixH(h, wind, 0.55), crouch: (wind.crouch ?? 0) * 0.6 + 0.08 },
    { ...wind, ...coil, crouch: Math.max(wind.crouch ?? 0, 0.12) + (coil.crouch ?? 0) },
    strike,
    follow,
    { ...mixH(follow, h, 0.6), act: 0, glow: (follow.glow ?? 0) * 0.3 },
  ];
  switch (kit.attack) {
    case 'bow':
      return [
        { handL: [S * 0.35, -A * 0.08, A * 0.9], handR: [-S * 0.1, -A * 0.06, A * 0.7], aimL: norm([0.1, 1, 0.08]), act: 0.15, twist: 0.25, poleR: [-1, 0.1, -0.6] },
        { handL: [S * 0.25, -A * 0.02, A * 0.98], handR: [-S * 0.78, A * 0.04, A * 0.0], aimL: norm([0.12, 1, 0.05]), act: 1, twist: 0.42, lean: -0.05, poleR: [-1, 0.2, -0.6], breath: 1 },
        { handL: [S * 0.25, -A * 0.02, A * 0.98], handR: [-S * 1.25, A * 0.12, -A * 0.22], aimL: norm([0.12, 1, 0.05]), act: 0, twist: 0.42, lean: -0.02, poleR: [-1, 0.3, -0.4] },
        { handL: [S * 0.3, -A * 0.08, A * 0.94], handR: [-S * 1.15, A * 0.02, -A * 0.12], aimL: norm([0.12, 1, 0.1]), act: 0, twist: 0.32, poleR: [-1, 0.2, -0.4] },
        { handL: [S * 0.6, -A * 0.35, A * 0.6], handR: [-(S + 3), -A * 0.6, A * 0.1], aimL: norm([0.05, 1, 0.2]), act: 0, twist: 0.1 },
      ];
    case 'pistols':
      return [
        { handR: [-S * 0.6, -A * 0.3, A * 0.65], handL: [S + 2, -A * 0.7, A * 0.2], aim: norm([0, -0.3, 1]), aimL: norm([0, -0.7, 1]), twist: 0.1 },
        { handR: [-S * 0.55, -A * 0.08, A * 0.92], handL: [S + 2, -A * 0.68, A * 0.24], aim: [0, 0, 1], aimL: norm([0, -0.7, 1]), twist: 0.18, lean: 0.03 },
        { handR: [-S * 0.6, A * 0.02, A * 0.8], handL: [S + 2, -A * 0.66, A * 0.22], aim: norm([0, 0.5, 1]), aimL: norm([0, -0.7, 1]), act: 1, twist: 0.22, lean: -0.06 },
        { handR: [-(S + 2), -A * 0.55, A * 0.32], handL: [S * 0.6, A * 0.02, A * 0.8], aim: norm([0, -0.6, 1]), aimL: norm([0, 0.5, 1]), act: 2, twist: -0.22, lean: -0.04 },
        { handR: [-(S + 2), -A * 0.7, A * 0.2], handL: [S + 2, -A * 0.7, A * 0.22], aim: norm([0, -0.75, 1]), aimL: norm([0, -0.75, 1]), twist: -0.05 },
      ];
    case 'rifle':
      return [
        { handR: [-S * 0.72, -A * 0.3, A * 0.2], handL: [S * 0.15, -A * 0.2, A * 0.7], twist: 0.18, poleR: [-1, -0.3, 0], poleL: [1, -1, 0], crouch: 0.08 },
        { handR: [-S * 0.75, -A * 0.12, A * 0.2], handL: [S * 0.05, -A * 0.12, A * 0.8], twist: 0.26, poleR: [-1, -0.3, 0], poleL: [1, -1, 0], crouch: 0.15, breath: 1 },
        { handR: [-S * 0.75, -A * 0.08, A * 0.1], handL: [S * 0.05, -A * 0.02, A * 0.76], twist: 0.26, act: 1, lean: -0.12, poleR: [-1, -0.3, 0], poleL: [1, -1, 0], crouch: 0.1 },
        { handR: [-S * 0.75, -A * 0.1, A * 0.05], handL: [S * 0.05, A * 0.04, A * 0.7], twist: 0.22, act: 0.3, lean: -0.1, poleR: [-1, -0.3, 0], poleL: [1, -1, 0] },
        { handR: [-S * 0.68, -A * 0.45, A * 0.2], handL: [S * 0.25, -A * 0.25, A * 0.6], twist: 0.08 },
      ];
    case 'chop':
      return five(
        { handR: [-S * 0.25, A * 0.6, A * 0.02], handL: [S * 0.05, A * 0.5, A * 0.08], lean: -0.22, twist: 0.15, poleR: [-1, 0.5, 0], poleL: [1, 0.5, 0], headTilt: -0.15, breath: 1 },
        { handR: [-S * 0.1, -A * 0.5, A * 0.75], handL: [S * 0.1, -A * 0.4, A * 0.5], lean: 0.42, crouch: 0.38, fwd: 1, poleR: [-1, -0.3, 0], poleL: [1, -0.3, 0] },
        { handR: [-S * 0.25, -A * 0.66, A * 0.55], handL: [S * 0.15, -A * 0.58, A * 0.4], lean: 0.36, crouch: 0.32, fwd: 0.9, poleR: [-1, -0.3, 0], poleL: [1, -0.3, 0] },
        { lean: -0.06, twist: 0.05, crouch: -0.05 },
      );
    case 'slash':
      return five(
        { handR: [-S * 1.35, A * 0.18, -A * 0.28], handL: [S + 3, -A * 0.55, A * 0.25], aim: norm([-0.6, 0.6, -0.4]), twist: -0.55, poleR: [-1, 0.2, -0.3], breath: 1 },
        { handR: [-S * 0.1, -A * 0.1, A * 0.9], handL: [S + 3, -A * 0.6, A * 0.05], aim: norm([0.5, 0.0, 1]), twist: 0.2, lean: 0.2, fwd: 1 },
        { handR: [S * 0.95, -A * 0.35, A * 0.5], handL: [S + 4, -A * 0.68, -A * 0.12], aim: norm([1, -0.35, 0.35]), twist: 0.6, lean: 0.22, fwd: 1 },
        { twist: -0.65 },
      );
    case 'thrust':
      return five(
        { handR: [-(S + 3), -A * 0.25, -A * 0.3], handL: [S * 0.45, -A * 0.3, A * 0.28], aim: norm([0, 0.05, 1]), twist: -0.35, lean: -0.06, breath: 1 },
        { handR: [-S * 0.45, -A * 0.1, A * 1.0], handL: [S * 0.2, -A * 0.15, A * 0.62], aim: norm([0, 0, 1]), twist: 0.24, lean: 0.32, fwd: 1, crouch: 0.22 },
        { handR: [-S * 0.5, -A * 0.16, A * 0.9], handL: [S * 0.3, -A * 0.2, A * 0.55], aim: norm([0, -0.05, 1]), twist: 0.2, lean: 0.26, fwd: 1, crouch: 0.2 },
        { twist: -0.1 },
      );
    case 'swipe':
      return [
        { ...mixH(h, { handR: [-(S + 6), A * 0.15, -A * 0.1], handL: [S + 6, A * 0.1, -A * 0.05], aim: norm([-0.3, 1, 0.2]), aimL: norm([0.3, 1, 0.2]) }, 0.5), crouch: 0.42, lean: 0.12 },
        { handR: [-(S + 7), A * 0.2, -A * 0.15], handL: [S + 7, A * 0.15, -A * 0.1], aim: norm([-0.3, 1, 0.2]), aimL: norm([0.3, 1, 0.2]), crouch: 0.5, lean: 0.06, breath: 1 },
        { handR: [-S * 0.2, -A * 0.45, A * 0.95], handL: [S + 6, A * 0.1, A * 0.05], aim: norm([0.2, -0.6, 1]), aimL: norm([0.3, 1, 0.2]), crouch: 0.32, lean: 0.42, fwd: 1, twist: 0.28 },
        { handR: [-S * 0.6, -A * 0.6, A * 0.3], handL: [S * 0.2, -A * 0.4, A * 0.95], aim: norm([0, -1, 0.5]), aimL: norm([-0.2, -0.6, 1]), crouch: 0.36, lean: 0.45, fwd: 1, twist: -0.28 },
        { handR: [-S * 0.8, -A * 0.5, A * 0.5], handL: [S * 0.8, -A * 0.45, A * 0.42], aim: norm([0.15, -0.35, 1]), aimL: norm([-0.15, -0.35, 1]), crouch: 0.3, lean: 0.2, fwd: 0.4 },
      ];
    case 'bash':
      return [
        { handL: [S * 0.4, -A * 0.35, A * 0.7], handR: [-(S + 2), -A * 0.1, -A * 0.1], aim: norm([0, 0.6, -0.3]), aimL: [0, 0, 1], twist: -0.1, crouch: 0.15 },
        { handL: [S * 0.35, -A * 0.35, A * 0.45], handR: [-(S + 2), A * 0.35, -A * 0.3], aim: norm([0, 1, -0.3]), aimL: [0, 0, 1], twist: -0.25, lean: -0.08, breath: 1 },
        { handL: [S * 0.6, -A * 0.4, A * 0.5], handR: [-S * 0.3, -A * 0.3, A * 0.85], aim: norm([0, -0.7, 1]), aimL: norm([0.3, 0, 1]), twist: 0.32, lean: 0.36, fwd: 1, crouch: 0.22 },
        { handL: [S * 0.55, -A * 0.42, A * 0.45], handR: [-S * 0.1, -A * 0.55, A * 0.65], aim: norm([0.2, -1, 0.5]), aimL: norm([0.3, 0, 1]), twist: 0.38, lean: 0.32, fwd: 1, crouch: 0.25 },
        { handL: [S * 0.45, -A * 0.4, A * 0.58], handR: [-(S + 3), -A * 0.7, A * 0.2], aim: norm([0, -1, 0.3]), aimL: [0, 0, 1], lean: 0.1, fwd: 0.4 },
      ];
    case 'throw':
      return [
        { ...mixH(h, { handR: [-(S + 4), A * 0.35, -A * 0.35], handL: [S + 2, -A * 0.3, A * 0.5], aim: norm([0, 1, -0.6]) }, 0.5), twist: -0.2, crouch: 0.1 },
        { handR: [-(S + 3), A * 0.48, -A * 0.3], handL: [S + 2, -A * 0.2, A * 0.65], aim: norm([0, 1, -0.4]), twist: -0.45, lean: -0.14, poleR: [-1, 0.6, -0.2], breath: 1 },
        { handR: [-S * 0.4, -A * 0.05, A * 0.95], handL: [S + 3, -A * 0.6, -A * 0.1], aim: norm([0, -0.1, 1]), twist: 0.38, lean: 0.3, fwd: 1, act: 1 },
        { handR: [-S * 0.05, -A * 0.6, A * 0.5], handL: [S + 3, -A * 0.75, -A * 0.05], aim: norm([0, -0.8, 0.6]), twist: 0.3, lean: 0.24, fwd: 0.8, act: 0.6 },
        { ...mixH({ handR: [-S * 0.05, -A * 0.6, A * 0.5], handL: [S + 3, -A * 0.75, 0] }, h, 0.6), twist: 0.08, lean: 0.06 },
      ];
    case 'ring':
      return [
        { handL: [S + 5, A * 0.06, A * 0.12], handR: [-(S + 5), A * 0.02, A * 0.12], twist: -0.12, act: -0.3, crouch: 0.1 },
        { handL: [S + 5, A * 0.1, A * 0.1], handR: [-(S + 5), -A * 0.02, A * 0.1], twist: -0.3, act: -0.8, lean: -0.08, breath: 1 },
        { handL: [S + 5, -A * 0.0, A * 0.1], handR: [-(S + 5), A * 0.1, A * 0.1], twist: 0.32, act: 1, lean: 0.22, fwd: 1, crouch: 0.15 },
        { handL: [S + 5, A * 0.05, A * 0.12], handR: [-(S + 5), A * 0.05, A * 0.12], twist: 0.18, act: 0.55, lean: 0.15, fwd: 0.8 },
        { handL: [S + 5, A * 0.02, A * 0.14], handR: [-(S + 5), A * 0.02, A * 0.14], act: 0.15, twist: 0.04 },
      ];
    case 'staff':
    default:
      return five(
        { handR: [-(S + 2), -A * 0.05, A * 0.05], handL: [S + 3, -A * 0.45, A * 0.4], aim: norm([0, 1, -0.35]), lean: -0.12, glow: 0.45, breath: 1, twist: -0.12 },
        { handR: [-S * 0.6, -A * 0.0, A * 0.92], handL: [S + 3, -A * 0.55, A * 0.15], aim: norm([0, 0.55, 1]), lean: 0.22, glow: 1, fwd: 0.8, twist: 0.22 },
        { handR: [-S * 0.6, -A * 0.08, A * 0.86], handL: [S + 3, -A * 0.62, A * 0.12], aim: norm([0, 0.4, 1]), lean: 0.2, glow: 0.6, fwd: 0.8, twist: 0.2 },
        { glow: 0.6 },
      );
  }
}

/** Cast keys: gather, release, follow-through, self-buff flex. */
function castKeys(kit: Kit): Hands[] {
  const b = bodyOf(kit);
  const A = b.H * 0.385;
  const S = b.shW;
  const h = hold(kit, 0, false);
  const flex: Hands = {
    ...h,
    handL: up(h.handL, A * 0.14, 3),
    handR: up(h.handR, A * 0.14, -3),
    lean: -0.16,
    breath: 1,
    crouch: 0.12,
    glow: 1,
    headTilt: -0.18,
    act: 0,
  };
  let gather: Hands;
  let release: Hands;
  switch (kit.cast) {
    case 'raise':
      gather = { ...h, handR: [-S * 0.6, -A * 0.55, A * 0.45], handL: [S * 0.6, -A * 0.55, A * 0.45], crouch: 0.3, glow: 0.45, aim: norm([0, 1, 0.3]), lean: 0.08 };
      release = { ...h, handR: [-(S + 2), A * 0.78, A * 0.18], handL: [S + 2, A * 0.72, A * 0.18], lean: -0.22, glow: 1, aim: norm([0, 1, 0]), headTilt: -0.28, breath: 1, poleR: [-1, 0, -0.5], poleL: [1, 0, -0.5] };
      break;
    case 'slam':
      gather = { ...h, handR: [-S * 0.3, A * 0.58, -A * 0.12], handL: [S * 0.2, A * 0.48, 0], lean: -0.24, glow: 0.5, aim: norm([0, 1, -0.3]), poleR: [-1, 0.5, 0], poleL: [1, 0.5, 0], breath: 1 };
      release = { ...h, handR: [-S * 0.2, -A * 0.78, A * 0.6], handL: [S * 0.2, -A * 0.72, A * 0.5], lean: 0.48, crouch: 0.62, glow: 1, aim: norm([0, -1, 0.4]), fwd: 1 };
      break;
    case 'ring':
      gather = { ...h, twist: -0.4, act: -1, lean: -0.08, glow: 0.35, crouch: 0.1 };
      release = { ...h, twist: 0.42, act: 1, lean: 0.16, glow: 1, crouch: 0.22, fwd: 0.6 };
      break;
    case 'spin':
      gather = { ...h, twist: -0.75, crouch: 0.4, glow: 0.45, lean: 0.12 };
      release = { ...h, twist: 0.85, crouch: 0.42, glow: 1, lean: 0.22, fwd: 0.6 };
      break;
    case 'forward':
    default:
      gather = { ...h, handR: [-(S + 2), -A * 0.2, -A * 0.18], handL: [S + 2, -A * 0.2, -A * 0.12], twist: -0.22, lean: -0.1, glow: 0.45, crouch: 0.18, breath: 1 };
      release = { ...h, handR: [-S * 0.45, -A * 0.05, A * 0.98], handL: [S * 0.45, -A * 0.08, A * 0.95], twist: 0.12, lean: 0.26, glow: 1, fwd: 1, aim: norm([0, 0.2, 1]), poleR: [-1, -0.4, 0], poleL: [1, -0.4, 0] };
  }
  const follow = { ...mixH(release, h, 0.35), glow: 0.65, fwd: (release.fwd ?? 0) * 0.8, act: (release.act ?? 0) * 0.4 };
  return [gather, release, follow, flex];
}

/** Picks n of the authored keys (fewer frames: drop the first anticipation key, keep the strike). */
function pick(keys: Hands[], n: number, f: number): Hands {
  if (n >= keys.length) return keys[Math.min(f, keys.length - 1)]!;
  const L = keys.length;
  const i = L === 5 && n === 4 ? [0, 2, 3, 4][f]! : Math.round((Math.min(f, n - 1) * (L - 1)) / Math.max(1, n - 1));
  return keys[Math.min(i, L - 1)]!;
}

function apply(p: Pose, h: Hands): void {
  p.handL = h.handL;
  p.handR = h.handR;
  if (h.aim) p.aim = h.aim;
  if (h.aimL) p.aimL = h.aimL;
  if (h.poleL) p.poleL = h.poleL;
  if (h.poleR) p.poleR = h.poleR;
  if (h.lean !== undefined) p.lean += h.lean;
  if (h.twist !== undefined) p.twist += h.twist;
  if (h.crouch !== undefined) p.crouch = Math.max(p.crouch, h.crouch);
  if (h.act !== undefined) p.act = h.act;
  if (h.glow !== undefined) p.glow = h.glow;
  if (h.headTilt !== undefined) p.headTilt += h.headTilt;
  if (h.bob !== undefined) p.bob += h.bob;
  if (h.breath !== undefined) p.breath = Math.max(p.breath, h.breath);
  if (h.fwd) {
    const b = 14 * h.fwd;
    p.footR = [p.footR[0], 0, p.footR[2] - b * 0.6];
    p.footL = [p.footL[0], 0, p.footL[2] + b];
  }
}

export function poseFor(kit: Kit, anim: Anim, frame: number): Pose {
  const n = Math.max(1, framesOfKit(kit, anim));
  const f = ((frame % n) + n) % n;
  const p = base(kit, anim, f);
  const b = bodyOf(kit);
  const gait = kit.gait ?? 'normal';
  if (gait === 'prowl') {
    p.crouch = 0.3;
    p.lean += 0.22;
  }
  const A = b.H * 0.385;
  const S = b.shW;
  switch (anim) {
    case 'idle': {
      // frame 0 = neutral rest (sin 0); breathing in on 1, weight drifts onto the right leg and back
      const t = (f / n) * TAU;
      const bouncy = kit.hold === 'guard' || kit.hold === 'fists';
      const heavy = gait === 'heavy';
      p.breath = 0.5 - 0.5 * Math.cos(t);
      p.bob = bouncy ? -Math.abs(Math.sin(t)) * 1.6 : -0.3 - Math.sin(t) * 0.35;
      p.shift = -Math.sin(t) * (heavy ? 1.0 : 1.6);
      p.roll = Math.sin(t) * (heavy ? 0.018 : 0.03);
      p.headTilt = Math.sin(t + 1) * 0.035;
      p.headYaw = Math.sin(t * 0.5 + 0.6) * 0.08 - 0.04;
      p.sway = Math.sin(t - 0.8) * 0.14;
      apply(p, hold(kit, Math.sin(t), false));
      const lift = p.breath * 1.3;
      p.handL = [p.handL[0], p.handL[1] + lift * 0.6 + Math.sin(t) * 0.8, p.handL[2]];
      p.handR = [p.handR[0], p.handR[1] + lift * 0.6 + Math.sin(t + 0.6) * 0.8, p.handR[2]];
      break;
    }
    case 'run': {
      // t = 0: right foot planted in front (contact); the body is lowest at contacts, highest mid-stride
      const t = (f / n) * TAU;
      const heavy = gait === 'heavy';
      const light = gait === 'light';
      const stride = heavy ? 13 : light ? 20 : 17;
      const lift = heavy ? 8 : light ? 13 : 11;
      const swingR = Math.max(0, -Math.sin(t));
      const swingL = Math.max(0, Math.sin(t));
      // swing foot: knee lifts early, foot reaches forward before it lands
      p.footR = [-b.stance * 0.75, lift * Math.pow(swingR, 0.7), stride * Math.cos(t) + swingR * 3];
      p.footL = [b.stance * 0.75, lift * Math.pow(swingL, 0.7), -stride * Math.cos(t) + swingL * 3];
      p.bob = (heavy ? 3.4 : 2.8) * Math.abs(Math.sin(t)) - 1.8;
      p.lean += heavy ? 0.12 : light ? 0.26 : 0.2;
      p.hipYaw = Math.cos(t) * 0.12;
      p.twist = -Math.cos(t) * 0.24;
      // weight over the stance leg, hip drops on the swing side
      p.shift = -Math.sin(t) * 1.4;
      p.roll = Math.sin(t) * 0.035;
      p.headTilt = -Math.abs(Math.sin(t)) * 0.03;
      // cloth trails behind and flutters a beat after the body bounce
      p.sway = 0.85 + 0.18 * Math.sin(2 * t - 1.2);
      apply(p, hold(kit, Math.cos(t), true));
      const jog = Math.sin(2 * t - 0.8) * 1.6;
      p.handL = [p.handL[0], p.handL[1] + jog, p.handL[2]];
      p.handR = [p.handR[0], p.handR[1] + jog, p.handR[2]];
      break;
    }
    case 'attack': {
      apply(p, pick(attackKeys(kit), n, f));
      if (kit.hold === 'guard') p.crouch = Math.max(p.crouch, 0.25);
      const hitF = n >= 5 ? ATTACK_HIT : 1;
      p.sway = f < hitF ? 0.25 : f === hitF ? -0.45 : f === hitF + 1 ? -0.2 : 0.1;
      // sprite revision: stronger anticipation on the coil (deeper crouch, more wind-up twist, weight back) and
      // a little overshoot on the follow-through; keys and frame layout unchanged
      if (f === hitF - 1) {
        p.crouch = Math.min(0.7, p.crouch + 0.08);
        p.twist *= 1.22;
        p.lean -= 0.05;
        p.bob -= 1.2;
      } else if (f === hitF + 1) {
        p.lean += 0.05;
        p.twist *= 1.1;
      }
      break;
    }
    case 'cast': {
      apply(p, pick(castKeys(kit), n, f));
      p.sway = f === CAST_RELEASE ? 0.55 : f === CAST_FLEX ? -0.3 : 0.15;
      break;
    }
    case 'death': {
      apply(p, hold(kit, 0, false));
      if (f === 0) {
        // recoil: thrown back, arms flung, one knee giving way
        p.lean = -0.38;
        p.headTilt = -0.35;
        p.roll = 0.05;
        p.handL = [S + 9, A * 0.18, -A * 0.18];
        p.handR = [-(S + 8), A * 0.05, -A * 0.25];
        p.bob = -3;
        p.crouch = 0.2;
        p.sway = -0.7;
        p.footL = [b.stance, 0, 7];
      } else if (f === 1) {
        p.fall = 0.75;
        p.crouch = 0.6;
        p.lean = -0.08;
        p.roll = 0.08;
        p.headTilt = -0.25;
        p.handL = [S + A * 0.55, -A * 0.05, -A * 0.05];
        p.handR = [-(S + A * 0.55), -A * 0.15, A * 0.05];
        p.sway = -0.45;
      } else {
        p.fall = 1.48;
        p.crouch = 0.15;
        p.headTilt = 0.18;
        p.headYaw = 0.35;
        p.handL = [S + A * 0.62, -A * 0.25, -A * 0.1];
        p.handR = [-(S + A * 0.55), -A * 0.3, A * 0.15];
        p.footL = [b.stance + 6, 0, 3];
        p.footR = [-b.stance - 4, 0, -3];
        p.sway = 0;
      }
      p.glow = 0;
      break;
    }
  }
  // spirits hover: a slow float bob on top of everything but the fall
  if (b.float > 0 && anim !== 'death') p.bob += Math.sin((f / n) * TAU * (anim === 'run' ? 2 : 1)) * 2.4;
  // the jug stays on the shoulder whatever the arms do
  if (kit.hold === 'jug' && anim !== 'death') {
    const h = hold(kit, 0, false);
    p.handL = up(h.handL, anim === 'run' ? Math.sin((f / n) * TAU * 2) * 1.2 : 0);
    p.poleL = h.poleL!;
  }
  return p;
}

/** Midpoint helper for props that need a point between the hands. */
export const between = (a: V3, b: V3, t = 0.5): V3 => lerp3(a, b, t);
