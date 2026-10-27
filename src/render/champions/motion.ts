// Per-champion locomotion and idle data (agent F): how each body moves, read by anim.ts (poses) and atlas.ts (run
// cadence). Canvas-free: tests import it in Node. Units are the 256 master "char units" of the rig (H = 180 for a
// standard human); cadence is frames per second of the 8-frame run cycle.
//
// Cadence follows the champion's movement speed so feet stop sliding: a step covers 2 x stride char units, the
// champion sprite is drawn at UNIT world units per char unit, and a cycle has two steps = 8 frames:
//   cadence = steps/s x 4 = ms / (2 x stride x UNIT) x 4
import type { Kit } from './types';

/** world units per char unit on screen: kit.world / 180 x CHAMPION_SCALE (render/championSprites.ts) ~ 1.78 */
export const UNIT = 1.78;

export type GaitStyle = 'stride' | 'sprint' | 'march' | 'stomp' | 'shuffle' | 'waddle' | 'stalk' | 'skip' | 'swagger' | 'glide' | 'hover' | 'gallop';
export type IdleStyle = 'breathe' | 'heave' | 'bounce' | 'rock' | 'scan' | 'poise' | 'still' | 'hover' | 'preen' | 'tick' | 'sway';

export interface GaitSpec {
  style: GaitStyle;
  /** half step length (char units) */
  stride: number;
  /** swing-foot lift */
  lift: number;
  /** vertical bounce amplitude (one bounce per step) */
  bob: number;
  /** forward lean while running (rad) */
  lean: number;
  /** pelvis shift over the stance leg */
  hipSway: number;
  /** pelvis roll (rad) */
  roll: number;
  /** shoulder counter-rotation (rad) */
  twist: number;
  /** free-arm swing multiplier (1 = standard) */
  arm: number;
  /** head nod per step (rad) */
  headBob: number;
  /** knee bend baseline 0..1 */
  crouch: number;
  /** 0..1: bounding gait - both feet leave the ground mid-step, extra bounce (yordle skip, frog hop) */
  hop: number;
  /** cloth / tail / hair trailing (1 = standard run) */
  sway: number;
  /** run cycle frames per second (atlas.rate) */
  cadence: number;
  /** upper body / arms / head lag behind the legs (rad): loose shoulders trail, stiff ones follow at once */
  drag: number;
  /** stride asymmetry: right stride x (1 + asym), left x (1 - asym) - a limp, a cane, a lead leg */
  asym: number;
  /** bounce shape: 1 = plain |sin|; < 1 sharp, light landings with a long float; > 1 flat, heavy plants */
  impact: number;
}

export interface IdleSpec {
  style: IdleStyle;
  /** chest rise amplitude (1 = standard breath) */
  breath: number;
  /** weight shift amplitude (char units) */
  shift: number;
  /** pelvis roll amplitude (rad) */
  roll: number;
  /** vertical bob amplitude (bouncy idles) */
  bob: number;
  /** head yaw sweep (rad) */
  scan: number;
  /** head tilt amplitude (rad) */
  nod: number;
  /** hand drift amplitude (char units) */
  hands: number;
  /** cloth sway amplitude */
  sway: number;
  /** idle loop frames per second */
  fps: number;
}

export interface MotionSpec {
  gait: GaitSpec;
  idle: IdleSpec;
}

const G = (style: GaitStyle, stride: number, lift: number, bob: number, lean: number, hipSway: number, roll: number, twist: number, arm: number, o: Partial<GaitSpec> = {}): GaitSpec => ({
  style,
  stride,
  lift,
  bob,
  lean,
  hipSway,
  roll,
  twist,
  arm,
  headBob: 0.03,
  crouch: 0,
  hop: 0,
  sway: 1,
  cadence: 0, // filled by cadenceFor
  drag: 0.35,
  asym: 0,
  impact: 1,
  ...o,
});
const I = (style: IdleStyle, breath: number, shift: number, roll: number, o: Partial<IdleSpec> = {}): IdleSpec => ({ style, breath, shift, roll, bob: 0, scan: 0.08, nod: 0.035, hands: 0.8, sway: 0.14, fps: 3.2, ...o });

/** Cadence (fps of the 8-frame cycle) for a movement speed and stride, clamped to what 8 frames can carry. */
export function cadenceFor(ms: number, stride: number): number {
  if (stride <= 0) return 12;
  const fps = (ms / (2 * stride * UNIT)) * 4;
  return Math.round(Math.max(9, Math.min(22, fps)) * 10) / 10;
}

/** Base movement speeds (src/data/champions/*.json base.ms); checked against the data in tests/motion.test.ts. */
export const MS: Record<string, number> = {
  aurel: 335, brom: 340, corvin: 340, dagny: 340, ferris: 335, gorvam: 335, grimald: 340, hagen: 335, harrow: 345,
  ilvane: 335, isolde: 345, kaelen: 345, kiran: 335, lio: 340, lysa: 335, mira: 340, nyx: 340, oda: 335, oleth: 340,
  ottilie: 340, renn: 340, seraphyne: 340, sev: 335, thessaly: 335, tobin: 335, vessa: 345, wren: 335, fenna: 335, vargrim: 345,
};

/** The 27 champions: gait + idle. Style names describe the read at game zoom; numbers are the pose amplitudes. */
const SPECS: Record<string, MotionSpec> = {
  // --- mid
  ilvane: { gait: G('stalk', 18, 9, 1.2, 0.1, 2.2, 0.03, 0.14, 0.5, { headBob: 0.01, sway: 0.9, drag: 0.5, asym: 0, impact: 0.6 }), idle: I('sway', 0.9, 2.4, 0.04, { hands: 1.4, sway: 0.2 }) },
  thessaly: { gait: G('stride', 22, 12, 2.2, 0.14, 1.2, 0.025, 0.2, 0.9, { headBob: 0.015, drag: 0.45, asym: 0, impact: 0.8 }), idle: I('poise', 0.7, 1.0, 0.015, { nod: 0.015, scan: 0.05 }) },
  kaelen: { gait: G('sprint', 24, 15, 3.4, 0.34, 1.4, 0.04, 0.3, 1.25, { crouch: 0.14, headBob: 0.04, drag: 0.25, asym: 0.05, impact: 0.7 }), idle: I('bounce', 1.0, 1.2, 0.02, { bob: 1.8, hands: 1.2, fps: 4 }) },
  renn: { gait: G('march', 19, 10, 2.6, 0.22, 1.5, 0.035, 0.28, 1.0, { drag: 0.2, asym: 0, impact: 1.2 }), idle: I('breathe', 1.2, 1.6, 0.03) },
  aurel: { gait: G('shuffle', 10, 5, 1.3, 0.08, 1.0, 0.03, 0.06, 0.5, { headBob: 0.05, sway: 0.6, drag: 0.3, asym: 0.22, impact: 1.5 }), idle: I('tick', 0.8, 0.9, 0.02, { nod: 0.06, scan: 0.04, fps: 2.8 }) },
  seraphyne: { gait: G('stride', 21, 13, 3.0, 0.24, 1.6, 0.05, 0.26, 1.0, { drag: 0.55, asym: 0, impact: 0.75 }), idle: I('breathe', 1.1, 1.8, 0.035, { hands: 1.1 }) },
  // --- top
  brom: { gait: G('stomp', 22, 11, 4.0, 0.1, 2.2, 0.06, 0.1, 0.7, { headBob: 0.02, sway: 0.7, drag: 0.15, asym: 0, impact: 1.7 }), idle: I('heave', 1.7, 1.2, 0.02, { nod: 0.02, scan: 0.04, hands: 0.6, fps: 2.6 }) },
  oleth: { gait: G('march', 20, 9, 1.6, 0.05, 0.8, 0.0, 0.08, 0.6, { headBob: 0.0, sway: 0.8, drag: 0.1, asym: 0, impact: 1.9 }), idle: I('still', 0.35, 0.5, 0.0, { nod: 0.0, scan: 0.03, hands: 0.3, sway: 0.08, fps: 2.4 }) },
  harrow: { gait: G('stomp', 20, 12, 3.2, 0.14, 2.0, 0.05, 0.12, 0.7, { headBob: 0.035, drag: 0.22, asym: 0.05, impact: 1.45 }), idle: I('heave', 1.5, 1.4, 0.03, { nod: 0.04, fps: 2.8 }) },
  isolde: { gait: G('stride', 19, 11, 2.4, 0.2, 1.4, 0.035, 0.22, 1.0, { drag: 0.4, asym: 0, impact: 0.9 }), idle: I('breathe', 1.0, 1.6, 0.03) },
  dagny: { gait: G('waddle', 11, 7, 2.8, 0.1, 3.2, 0.09, 0.1, 0.8, { headBob: 0.02, drag: 0.3, asym: 0.08, impact: 1.3 }), idle: I('rock', 1.2, 2.6, 0.06, { nod: 0.02, fps: 3 }) },
  // --- jungle
  vessa: { gait: G('stalk', 23, 14, 2.2, 0.3, 1.6, 0.04, 0.3, 0.9, { crouch: 0.3, headBob: 0.02, sway: 1.1, drag: 0.35, asym: 0.03, impact: 0.5 }), idle: I('scan', 1.0, 1.4, 0.03, { scan: 0.22, nod: 0.05, bob: 1.0, fps: 3.6 }) },
  nyx: { gait: G('hover', 0, 0, 1.0, 0.2, 0.5, 0.02, 0.1, 0.4, { headBob: 0.0, sway: 1.15, drag: 0.72, asym: 0.02, impact: 0.5 }), idle: I('hover', 0.6, 0.6, 0.02, { scan: 0.16, nod: 0.03, hands: 1.6, sway: 0.22, fps: 2.6 }) },
  grimald: { gait: G('stomp', 24, 11, 4.2, 0.12, 2.6, 0.07, 0.12, 0.7, { headBob: 0.03, sway: 0.7, drag: 0.18, asym: -0.06, impact: 1.6 }), idle: I('heave', 1.8, 1.4, 0.03, { nod: 0.03, hands: 0.7, fps: 2.5 }) },
  lio: { gait: G('skip', 13, 11, 3.6, 0.2, 1.2, 0.04, 0.2, 1.3, { hop: 1, headBob: 0.05, drag: 0.3, asym: 0.12, impact: 0.55 }), idle: I('bounce', 1.0, 0.8, 0.03, { bob: 2.2, scan: 0.14, nod: 0.06, hands: 1.3, fps: 4.2 }) },
  ottilie: { gait: G('stride', 20, 12, 2.4, 0.2, 1.4, 0.035, 0.2, 1.0, { drag: 0.4, asym: -0.03, impact: 0.95 }), idle: I('scan', 1.0, 1.4, 0.03, { scan: 0.2, nod: 0.03 }) },
  // --- adc
  mira: { gait: G('sprint', 22, 13, 2.6, 0.24, 1.3, 0.035, 0.24, 1.1, { headBob: 0.025, drag: 0.5, asym: 0.03, impact: 0.72 }), idle: I('breathe', 1.0, 2.0, 0.035) },
  corvin: { gait: G('swagger', 19, 9, 2.0, 0.12, 2.8, 0.07, 0.3, 0.9, { headBob: 0.015, drag: 0.38, asym: 0.1, impact: 1.1 }), idle: I('poise', 0.8, 1.6, 0.03, { nod: 0.02, scan: 0.1, hands: 0.5 }) },
  lysa: { gait: G('stride', 18, 10, 1.8, 0.14, 1.4, 0.03, 0.16, 0.8, { headBob: 0.015, drag: 0.32, asym: 0.02, impact: 0.85 }), idle: I('poise', 0.8, 1.0, 0.02, { nod: 0.015, scan: 0.06, hands: 0.5 }) },
  tobin: { gait: G('swagger', 17, 9, 2.4, 0.12, 3.0, 0.09, 0.2, 0.9, { headBob: 0.03, drag: 0.42, asym: -0.1, impact: 1.25 }), idle: I('rock', 1.1, 2.8, 0.07, { nod: 0.03, fps: 2.8 }) },
  wren: { gait: G('stalk', 18, 14, 2.0, 0.22, 1.2, 0.03, 0.18, 0.7, { crouch: 0.1, headBob: 0.08, sway: 1.1, drag: 0.28, asym: 0.06, impact: 0.7 }), idle: I('preen', 0.9, 1.0, 0.03, { scan: 0.3, nod: 0.09, bob: 0.6, fps: 3.8 }) },
  // --- support
  ferris: { gait: G('stride', 21, 11, 2.0, 0.15, 1.2, 0.03, 0.14, 0.8, { drag: 0.36, asym: -0.02, impact: 1 }), idle: I('breathe', 0.9, 1.4, 0.03, { hands: 1.0 }) },
  gorvam: { gait: G('stomp', 26, 10, 4.8, 0.16, 3.0, 0.08, 0.12, 0.6, { headBob: 0.02, sway: 0.6, drag: 0.12, asym: 0.04, impact: 1.8 }), idle: I('heave', 2.0, 1.6, 0.035, { nod: 0.02, hands: 0.8, fps: 2.4 }) },
  hagen: { gait: G('waddle', 12, 6, 2.4, 0.08, 3.4, 0.1, 0.08, 0.6, { headBob: 0.02, sway: 0.8, drag: 0.25, asym: -0.12, impact: 1.4 }), idle: I('rock', 1.1, 3.0, 0.08, { nod: 0.02, hands: 0.4, fps: 2.8 }) },
  kiran: { gait: G('glide', 16, 8, 1.0, 0.1, 1.0, 0.02, 0.1, 0.3, { headBob: 0.0, sway: 0.9, drag: 0.65, asym: 0, impact: 0.55 }), idle: I('still', 0.7, 0.6, 0.01, { nod: 0.0, scan: 0.0, hands: 1.2, fps: 2.8 }) },
  oda: { gait: G('waddle', 12, 9, 3.0, 0.12, 3.0, 0.08, 0.1, 0.8, { hop: 0.6, headBob: 0.03, drag: 0.33, asym: 0.09, impact: 1.15 }), idle: I('bounce', 1.1, 1.6, 0.05, { bob: 1.2, scan: 0.12, nod: 0.04, fps: 3.4 }) },
  // --- new champions (art pending): moth hovers and flutters, the ghost horse gallops (cadence set by hand: a gallop
  // cycle covers ~90 world units of body travel per stance, see cavalry.ts)
  fenna: { gait: G('hover', 0, 0, 1.4, 0.16, 0.6, 0.03, 0.08, 0.4, { headBob: 0.01, sway: 1.3, drag: 0.6, asym: 0, impact: 0.4 }), idle: I('hover', 0.7, 0.7, 0.025, { scan: 0.12, nod: 0.04, hands: 1.4, sway: 0.26, fps: 3 }) },
  vargrim: { gait: G('gallop', 30, 0, 0, 0, 0, 0, 0, 0, { cadence: 10.7, drag: 0.5, asym: 0, impact: 1 }), idle: I('heave', 1.4, 1.0, 0.02, { nod: 0.03, scan: 0.05, fps: 3 }) },
  sev: { gait: G('glide', 18, 9, 1.0, 0.08, 0.8, 0.02, 0.08, 0.3, { headBob: 0.0, sway: 1.2, drag: 0.55, asym: -0.02, impact: 0.6 }), idle: I('still', 0.6, 0.5, 0.01, { nod: 0.01, scan: 0.06, hands: 1.0, sway: 0.18, fps: 2.6 }) },
};
for (const [id, s] of Object.entries(SPECS)) if (!s.gait.cadence) s.gait.cadence = cadenceFor(MS[id] ?? 340, s.gait.stride);

/** Legacy buckets for kits without an entry (minions, carts): the pre-F run cycle. */
const LEGACY: Record<NonNullable<Kit['gait']>, MotionSpec> = {
  normal: { gait: G('stride', 17, 11, 2.8, 0.2, 1.4, 0.035, 0.24, 1.0, { cadence: 14 }), idle: I('breathe', 1, 1.6, 0.03) },
  heavy: { gait: G('stomp', 13, 8, 3.4, 0.12, 1.0, 0.035, 0.24, 1.0, { cadence: 14 }), idle: I('breathe', 1, 1.0, 0.018) },
  light: { gait: G('sprint', 20, 13, 2.8, 0.26, 1.4, 0.035, 0.24, 1.2, { cadence: 14 }), idle: I('breathe', 1, 1.6, 0.03) },
  prowl: { gait: G('stalk', 17, 11, 2.8, 0.2, 1.4, 0.035, 0.24, 1.0, { crouch: 0.3, cadence: 14 }), idle: I('breathe', 1, 1.6, 0.03) },
};

export const MOTION_IDS: readonly string[] = Object.keys(SPECS);
export function motionOf(kit: Pick<Kit, 'id' | 'gait' | 'hold'>): MotionSpec {
  const s = SPECS[kit.id];
  if (s) return s;
  const l = LEGACY[kit.gait ?? 'normal'];
  // the old bouncy guard / fists idle for extra kits
  return kit.hold === 'guard' || kit.hold === 'fists' ? { gait: l.gait, idle: { ...l.idle, bob: 1.6 } } : l;
}
