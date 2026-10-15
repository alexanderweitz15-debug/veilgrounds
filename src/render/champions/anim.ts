// Animation: builds a Pose per (kit, anim, frame). Hands are authored as chest-local targets (solved with IK),
// feet as ground targets. Holds (idle/run carry), attack styles (4 key frames) and cast styles (3 key frames)
// are shared across champions.
import { lerp3, norm, TAU, type V3 } from './core';
import { bodyOf } from './humanoid';
import type { Anim, Kit, Pose } from './types';

export const FRAMES: Record<Anim, number> = { idle: 4, run: 6, attack: 4, cast: 3, death: 3 };
/** suggested playback rates (frames per second); attack/cast should be stretched to the actual wind-up */
export const FPS: Record<Anim, number> = { idle: 5, run: 11, attack: 12, cast: 9, death: 7 };
export const LOOP: Record<Anim, boolean> = { idle: true, run: true, attack: false, cast: false, death: false };

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
  fwd?: number; // step forward with the lead foot
}

function base(kit: Kit, anim: Anim, frame: number): Pose {
  const b = bodyOf(kit);
  return {
    bob: 0,
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
    poleL: [0.5, -0.1, -1],
    poleR: [-0.5, -0.1, -1],
    aim: [0, 0, 1],
    aimL: [0, 0, 1],
    fall: 0,
    sway: 0,
    act: 0,
    glow: 0,
    crouch: 0,
    anim,
    t: frame / FRAMES[anim],
    frame,
  };
}

/** Carry pose for idle/run. `swing` = arm swing phase (−1..1) for free arms. */
function hold(kit: Kit, swing: number, running: boolean): Hands {
  const b = bodyOf(kit);
  const A = b.H * 0.385;
  const S = b.shW;
  const free = (side: number, ph: number): V3 => [side * (S + 3), -A * 0.86 + Math.abs(ph) * 4, 3 + ph * A * 0.42];
  const sw = running ? swing : swing * 0.08;
  switch (kit.hold) {
    case 'bow':
      return { handL: [S * 0.75, -A * 0.5, A * 0.38], handR: free(-1, -sw), aimL: norm([0.05, 1, 0.22]) };
    case 'pistols':
      return {
        handL: [S + 2, -A * 0.74, A * 0.18 + sw * A * 0.3],
        handR: [-(S + 2), -A * 0.74, A * 0.18 - sw * A * 0.3],
        aim: norm([0, -0.75, 1]),
        aimL: norm([0, -0.75, 1]),
      };
    case 'rifle':
      return { handR: [-S * 0.65, -A * 0.6, A * 0.18], handL: [S * 0.3, -A * 0.3, A * 0.55], poleL: [1, -0.6, 0], poleR: [-1, -0.4, -0.4] };
    case 'shoulder':
      return { handR: [-(S + 3), -A * 0.38, A * 0.28], handL: [-S * 0.25, -A * 0.72, A * 0.5], poleR: [-1, -0.6, 0.2], poleL: [0.6, -1, 0] };
    case 'pole':
      return { handR: [-(S + 3), -A * 0.42, A * 0.36], handL: free(1, sw), aim: norm([0, 1, running ? 0.45 : 0.06]), poleR: [-1, -0.5, -0.4] };
    case 'shield':
      return {
        handL: [S * 0.45, -A * 0.4, A * 0.58],
        handR: free(-1, -sw * 0.6),
        aimL: [0, 0, 1],
        aim: norm([0, -1, 0.25]),
        poleL: [1, -0.4, -0.2],
      };
    case 'yoke':
      return { handL: [S + 5, A * 0.02, A * 0.14], handR: [-(S + 5), A * 0.02, A * 0.14], poleL: [1, -1, 0], poleR: [-1, -1, 0] };
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
      return { handR: [-(S + 4), -A * 0.78, A * 0.12 - sw * 8], handL: [S + 3, -A * 0.55, A * 0.32], poleL: [1, -0.5, -0.2] };
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

function attackKeys(kit: Kit): Hands[] {
  const b = bodyOf(kit);
  const A = b.H * 0.385;
  const S = b.shW;
  switch (kit.attack) {
    case 'bow':
      return [
        { handL: [S * 0.3, -A * 0.05, A * 0.92], handR: [-S * 0.2, -A * 0.08, A * 0.75], aimL: norm([0.1, 1, 0.08]), act: 0.2, twist: 0.2 },
        { handL: [S * 0.25, -A * 0.02, A * 0.98], handR: [-S * 0.7, A * 0.02, A * 0.02], aimL: norm([0.12, 1, 0.05]), act: 1, twist: 0.35, poleR: [-1, 0.2, -0.6] },
        { handL: [S * 0.25, -A * 0.02, A * 0.98], handR: [-S * 1.2, A * 0.1, -A * 0.2], aimL: norm([0.12, 1, 0.05]), act: 0, twist: 0.35, poleR: [-1, 0.3, -0.4] },
        { handL: [S * 0.6, -A * 0.35, A * 0.6], handR: [-(S + 3), -A * 0.6, A * 0.1], aimL: norm([0.05, 1, 0.2]), act: 0, twist: 0.1 },
      ];
    case 'pistols':
      return [
        { handR: [-S * 0.6, -A * 0.1, A * 0.9], handL: [S + 2, -A * 0.7, A * 0.2], aim: [0, 0, 1], aimL: norm([0, -0.7, 1]), twist: 0.15 },
        { handR: [-S * 0.6, -A * 0.0, A * 0.82], handL: [S + 2, -A * 0.7, A * 0.2], aim: norm([0, 0.45, 1]), aimL: norm([0, -0.7, 1]), act: 1, twist: 0.2, lean: -0.05 },
        { handR: [-(S + 2), -A * 0.6, A * 0.3], handL: [S * 0.6, -A * 0.0, A * 0.82], aim: norm([0, -0.6, 1]), aimL: norm([0, 0.45, 1]), act: 1, twist: -0.2 },
        { handR: [-(S + 2), -A * 0.7, A * 0.2], handL: [S + 2, -A * 0.7, A * 0.2], aim: norm([0, -0.75, 1]), aimL: norm([0, -0.75, 1]) },
      ];
    case 'rifle':
      return [
        { handR: [-S * 0.75, -A * 0.12, A * 0.2], handL: [S * 0.05, -A * 0.12, A * 0.8], twist: 0.25, poleR: [-1, -0.3, 0], poleL: [1, -1, 0] },
        { handR: [-S * 0.75, -A * 0.1, A * 0.15], handL: [S * 0.05, -A * 0.06, A * 0.78], twist: 0.25, act: 1, lean: -0.08, poleR: [-1, -0.3, 0], poleL: [1, -1, 0] },
        { handR: [-S * 0.75, -A * 0.08, A * 0.08], handL: [S * 0.05, A * 0.02, A * 0.72], twist: 0.22, act: 0.3, lean: -0.12, poleR: [-1, -0.3, 0], poleL: [1, -1, 0] },
        { handR: [-S * 0.65, -A * 0.5, A * 0.2], handL: [S * 0.3, -A * 0.28, A * 0.58] },
      ];
    case 'chop':
      return [
        { handR: [-S * 0.3, A * 0.45, -A * 0.25], handL: [S * 0.05, A * 0.35, -A * 0.1], lean: -0.15, twist: 0.2, poleR: [-1, 0.5, 0], poleL: [1, 0.5, 0], headTilt: -0.1 },
        { handR: [-S * 0.2, A * 0.6, A * 0.05], handL: [S * 0.05, A * 0.5, A * 0.1], lean: -0.2, poleR: [-1, 0.5, 0], poleL: [1, 0.5, 0], headTilt: -0.15 },
        { handR: [-S * 0.1, -A * 0.5, A * 0.75], handL: [S * 0.1, -A * 0.4, A * 0.5], lean: 0.4, crouch: 0.35, fwd: 1, poleR: [-1, -0.3, 0], poleL: [1, -0.3, 0] },
        { handR: [-S * 0.3, -A * 0.55, A * 0.6], handL: [S * 0.15, -A * 0.5, A * 0.45], lean: 0.25, crouch: 0.2, fwd: 0.6 },
      ];
    case 'slash':
      return [
        { handR: [-S * 1.3, A * 0.15, -A * 0.25], handL: [S + 3, -A * 0.6, A * 0.2], aim: norm([-0.6, 0.6, -0.4]), twist: -0.5, poleR: [-1, 0.2, -0.3] },
        { handR: [-S * 0.6, -A * 0.05, A * 0.85], handL: [S + 3, -A * 0.6, A * 0.1], aim: norm([0.2, 0.1, 1]), twist: 0.0, lean: 0.15, fwd: 0.8 },
        { handR: [S * 0.9, -A * 0.3, A * 0.55], handL: [S + 4, -A * 0.65, -A * 0.1], aim: norm([1, -0.3, 0.4]), twist: 0.55, lean: 0.2, fwd: 1 },
        { handR: [S * 0.2, -A * 0.6, A * 0.4], handL: [S + 3, -A * 0.75, A * 0.0], aim: norm([0.5, -0.6, 0.6]), twist: 0.25, lean: 0.1, fwd: 0.5 },
      ];
    case 'thrust':
      return [
        { handR: [-(S + 2), -A * 0.25, -A * 0.25], handL: [S * 0.4, -A * 0.3, A * 0.3], aim: norm([0, 0.05, 1]), twist: -0.3, lean: -0.05 },
        { handR: [-S * 0.5, -A * 0.1, A * 0.98], handL: [S * 0.2, -A * 0.15, A * 0.6], aim: norm([0, 0, 1]), twist: 0.2, lean: 0.3, fwd: 1, crouch: 0.2 },
        { handR: [-S * 0.45, -A * 0.12, A * 1.0], handL: [S * 0.25, -A * 0.15, A * 0.62], aim: norm([0, 0, 1]), twist: 0.25, lean: 0.32, fwd: 1, crouch: 0.25 },
        { handR: [-(S + 2), -A * 0.4, A * 0.4], handL: [S * 0.7, -A * 0.5, A * 0.3], aim: norm([0, 0.3, 1]), lean: 0.1, fwd: 0.4 },
      ];
    case 'swipe':
      return [
        { handR: [-(S + 6), A * 0.15, -A * 0.1], handL: [S + 6, A * 0.1, -A * 0.05], aim: norm([-0.3, 1, 0.2]), aimL: norm([0.3, 1, 0.2]), crouch: 0.4, lean: 0.1 },
        { handR: [-S * 0.2, -A * 0.45, A * 0.95], handL: [S + 6, A * 0.1, A * 0.05], aim: norm([0.2, -0.6, 1]), aimL: norm([0.3, 1, 0.2]), crouch: 0.3, lean: 0.4, fwd: 1, twist: 0.25 },
        { handR: [-S * 0.6, -A * 0.6, A * 0.3], handL: [S * 0.2, -A * 0.4, A * 0.95], aim: norm([0, -1, 0.5]), aimL: norm([-0.2, -0.6, 1]), crouch: 0.35, lean: 0.45, fwd: 1, twist: -0.25 },
        { handR: [-S * 0.8, -A * 0.5, A * 0.5], handL: [S * 0.8, -A * 0.45, A * 0.42], aim: norm([0.15, -0.35, 1]), aimL: norm([-0.15, -0.35, 1]), crouch: 0.3, lean: 0.2, fwd: 0.4 },
      ];
    case 'bash':
      return [
        { handL: [S * 0.35, -A * 0.35, A * 0.3], handR: [-(S + 2), A * 0.25, -A * 0.3], aim: norm([0, 1, -0.3]), aimL: [0, 0, 1], twist: -0.2, lean: -0.05 },
        { handL: [S * 0.3, -A * 0.3, A * 0.9], handR: [-(S + 2), A * 0.3, -A * 0.2], aim: norm([0, 1, 0]), aimL: [0, 0, 1], twist: 0.15, lean: 0.3, fwd: 1 },
        { handL: [S * 0.6, -A * 0.4, A * 0.5], handR: [-S * 0.3, -A * 0.3, A * 0.85], aim: norm([0, -0.7, 1]), aimL: norm([0.3, 0, 1]), twist: 0.3, lean: 0.35, fwd: 1, crouch: 0.2 },
        { handL: [S * 0.45, -A * 0.4, A * 0.58], handR: [-(S + 3), -A * 0.7, A * 0.2], aim: norm([0, -1, 0.3]), aimL: [0, 0, 1], lean: 0.1, fwd: 0.4 },
      ];
    case 'throw':
      return [
        { handR: [-(S + 4), A * 0.35, -A * 0.35], handL: [S + 2, -A * 0.3, A * 0.5], aim: norm([0, 1, -0.6]), twist: -0.4, lean: -0.15, poleR: [-1, 0.6, -0.2] },
        { handR: [-(S + 2), A * 0.5, -A * 0.1], handL: [S + 2, -A * 0.25, A * 0.6], aim: norm([0, 1, 0.2]), twist: -0.3, lean: -0.1, poleR: [-1, 0.6, -0.2] },
        { handR: [-S * 0.4, -A * 0.05, A * 0.95], handL: [S + 3, -A * 0.6, -A * 0.1], aim: norm([0, -0.1, 1]), twist: 0.35, lean: 0.3, fwd: 1, act: 1 },
        { handR: [-S * 0.1, -A * 0.55, A * 0.5], handL: [S + 3, -A * 0.75, A * 0.0], aim: norm([0, -0.8, 0.6]), twist: 0.25, lean: 0.2, fwd: 0.6 },
      ];
    case 'ring':
      return [
        { handL: [S + 5, A * 0.1, A * 0.1], handR: [-(S + 5), -A * 0.0, A * 0.1], twist: -0.2, act: -0.6, lean: -0.05 },
        { handL: [S + 5, -A * 0.0, A * 0.1], handR: [-(S + 5), A * 0.1, A * 0.1], twist: 0.3, act: 1, lean: 0.2, fwd: 1 },
        { handL: [S + 5, A * 0.05, A * 0.12], handR: [-(S + 5), A * 0.05, A * 0.12], twist: 0.15, act: 0.5, lean: 0.15, fwd: 0.8 },
        { handL: [S + 5, A * 0.02, A * 0.14], handR: [-(S + 5), A * 0.02, A * 0.14], act: 0.15 },
      ];
    case 'staff':
    default:
      return [
        { handR: [-(S + 2), -A * 0.1, A * 0.1], handL: [S + 3, -A * 0.5, A * 0.35], aim: norm([0, 1, -0.3]), lean: -0.1, glow: 0.3 },
        { handR: [-S * 0.6, -A * 0.0, A * 0.9], handL: [S + 3, -A * 0.55, A * 0.2], aim: norm([0, 0.55, 1]), lean: 0.2, glow: 1, fwd: 0.8, twist: 0.2 },
        { handR: [-S * 0.6, -A * 0.05, A * 0.88], handL: [S + 3, -A * 0.6, A * 0.15], aim: norm([0, 0.45, 1]), lean: 0.2, glow: 0.6, fwd: 0.8, twist: 0.2 },
        { handR: [-(S + 3), -A * 0.42, A * 0.36], handL: [S + 3, -A * 0.75, A * 0.1], aim: norm([0, 1, 0.1]), glow: 0.1 },
      ];
  }
}

function castKeys(kit: Kit): Hands[] {
  const b = bodyOf(kit);
  const A = b.H * 0.385;
  const S = b.shW;
  const h = hold(kit, 0, false);
  switch (kit.cast) {
    case 'raise':
      return [
        { ...h, handR: [-S * 0.6, -A * 0.55, A * 0.45], handL: [S * 0.6, -A * 0.55, A * 0.45], crouch: 0.25, glow: 0.4, aim: norm([0, 1, 0.3]) },
        { ...h, handR: [-(S + 2), A * 0.75, A * 0.15], handL: [S + 2, A * 0.7, A * 0.15], lean: -0.2, glow: 1, aim: norm([0, 1, 0]), headTilt: -0.25, poleR: [-1, 0, -0.5], poleL: [1, 0, -0.5] },
        { ...h, handR: [-S * 0.5, A * 0.05, A * 0.95], handL: [S * 0.5, A * 0.0, A * 0.9], lean: 0.2, glow: 0.7, aim: norm([0, 0.3, 1]), fwd: 0.8 },
      ];
    case 'slam':
      return [
        { ...h, handR: [-S * 0.3, A * 0.55, -A * 0.1], handL: [S * 0.2, A * 0.45, 0], lean: -0.2, glow: 0.5, aim: norm([0, 1, -0.3]), poleR: [-1, 0.5, 0], poleL: [1, 0.5, 0] },
        { ...h, handR: [-S * 0.2, -A * 0.75, A * 0.6], handL: [S * 0.2, -A * 0.7, A * 0.5], lean: 0.45, crouch: 0.6, glow: 1, aim: norm([0, -1, 0.4]), fwd: 1 },
        { ...h, crouch: 0.3, lean: 0.2, glow: 0.4, fwd: 0.6 },
      ];
    case 'ring':
      return [
        { ...h, twist: -0.35, act: -1, lean: -0.05, glow: 0.3 },
        { ...h, twist: 0.4, act: 1, lean: 0.15, glow: 1, crouch: 0.2 },
        { ...h, twist: 0.0, act: 0.4, glow: 0.6 },
      ];
    case 'spin':
      return [
        { ...h, twist: -0.7, crouch: 0.35, glow: 0.4, lean: 0.1 },
        { ...h, twist: 0.8, crouch: 0.4, glow: 1, lean: 0.2, fwd: 0.5 },
        { ...h, twist: 0.2, crouch: 0.2, glow: 0.5 },
      ];
    case 'forward':
    default:
      return [
        { ...h, handR: [-(S + 2), -A * 0.2, -A * 0.15], handL: [S + 2, -A * 0.2, -A * 0.1], twist: -0.2, lean: -0.1, glow: 0.4, crouch: 0.15 },
        { ...h, handR: [-S * 0.45, -A * 0.05, A * 0.98], handL: [S * 0.45, -A * 0.08, A * 0.95], twist: 0.1, lean: 0.25, glow: 1, fwd: 1, aim: norm([0, 0.2, 1]), poleR: [-1, -0.4, 0], poleL: [1, -0.4, 0] },
        { ...h, handR: [-S * 0.5, -A * 0.1, A * 0.9], handL: [S * 0.5, -A * 0.12, A * 0.85], lean: 0.2, glow: 0.6, fwd: 0.8, aim: norm([0, 0.2, 1]) },
      ];
  }
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
  if (h.fwd) {
    const b = 14 * h.fwd;
    p.footR = [p.footR[0], 0, p.footR[2] - b * 0.6];
    p.footL = [p.footL[0], 0, p.footL[2] + b];
  }
}

export function poseFor(kit: Kit, anim: Anim, frame: number): Pose {
  const n = FRAMES[anim];
  const f = ((frame % n) + n) % n;
  const p = base(kit, anim, f);
  const b = bodyOf(kit);
  const gait = kit.gait ?? 'normal';
  if (gait === 'prowl') {
    p.crouch = 0.3;
    p.lean += 0.22;
  }
  switch (anim) {
    case 'idle': {
      const t = (f / n) * TAU;
      p.bob = Math.sin(t) * 1.1 - 0.4;
      p.headTilt = Math.sin(t + 1) * 0.03;
      p.sway = Math.sin(t) * 0.12;
      apply(p, hold(kit, Math.sin(t), false));
      p.handL = [p.handL[0], p.handL[1] + Math.sin(t) * 1.2, p.handL[2]];
      p.handR = [p.handR[0], p.handR[1] + Math.sin(t + 0.6) * 1.2, p.handR[2]];
      break;
    }
    case 'run': {
      const t = (f / n) * TAU;
      const heavy = gait === 'heavy';
      const stride = heavy ? 12 : gait === 'light' ? 20 : 17;
      const lift = heavy ? 6 : 10;
      p.footR = [-b.stance * 0.8, lift * Math.max(0, -Math.sin(t)), stride * Math.cos(t)];
      p.footL = [b.stance * 0.8, lift * Math.max(0, Math.sin(t)), -stride * Math.cos(t)];
      p.bob = (heavy ? 3 : 2.4) * Math.abs(Math.sin(t)) - 1.6;
      p.lean += heavy ? 0.1 : 0.2;
      p.twist = -Math.cos(t) * 0.12;
      p.hipYaw = Math.cos(t) * 0.1;
      p.sway = 0.9;
      apply(p, hold(kit, Math.cos(t), true));
      break;
    }
    case 'attack': {
      const keys = attackKeys(kit);
      apply(p, keys[f]!);
      if (kit.hold === 'guard') p.crouch = Math.max(p.crouch, 0.25);
      p.sway = f === 2 ? -0.4 : 0.2;
      break;
    }
    case 'cast': {
      const keys = castKeys(kit);
      apply(p, keys[f]!);
      p.sway = f === 1 ? 0.5 : 0.1;
      break;
    }
    case 'death': {
      apply(p, hold(kit, 0, false));
      const A = b.H * 0.385;
      const S = b.shW;
      if (f === 0) {
        p.lean = -0.35;
        p.headTilt = -0.3;
        p.handL = [S + 8, A * 0.15, -A * 0.15];
        p.handR = [-(S + 8), A * 0.1, -A * 0.2];
        p.bob = -2;
        p.sway = -0.6;
        p.footL = [b.stance, 0, 6];
      } else if (f === 1) {
        p.fall = 0.75;
        p.crouch = 0.55;
        p.lean = -0.1;
        p.headTilt = -0.2;
        p.handL = [S + A * 0.55, -A * 0.05, -A * 0.05];
        p.handR = [-(S + A * 0.55), -A * 0.15, A * 0.05];
        p.sway = -0.4;
      } else {
        p.fall = 1.48;
        p.crouch = 0.15;
        p.headTilt = 0.15;
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
  return p;
}

/** Midpoint helper for props that need a point between the hands. */
export const between = (a: V3, b: V3, t = 0.5): V3 => lerp3(a, b, t);
