// Data types shared by the champion sprite renderer: kit (what a champion is made of), pose (one animation
// frame) and rig (the solved skeleton). See kits.ts for the 26 champion kits.
import type { Basis, Mat, Stage, V3 } from './core';

export const ANIMS = ['idle', 'run', 'attack', 'cast', 'death'] as const;
export type Anim = (typeof ANIMS)[number];
export const DIRS = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'] as const;
export type Dir = (typeof DIRS)[number];

export type HairStyle = 'none' | 'crop' | 'short' | 'long' | 'bun' | 'tied' | 'braid' | 'wild' | 'bob';
export type BeardStyle = 'full' | 'short' | 'mustache' | 'stubble' | 'braided';
export type HatKind = 'wide' | 'tricorn' | 'cap' | 'helm' | 'kerchief' | 'veil' | 'band' | 'goggles' | 'bearhood' | 'wolfhood';

/** How the champion carries its gear when idle/running. */
export type Hold = 'relaxed' | 'bow' | 'pistols' | 'rifle' | 'shoulder' | 'pole' | 'shield' | 'yoke' | 'guard' | 'hook' | 'spindle' | 'blade' | 'fists';
export type AttackStyle = 'bow' | 'pistols' | 'rifle' | 'chop' | 'slash' | 'thrust' | 'swipe' | 'bash' | 'throw' | 'staff' | 'ring';
export type CastStyle = 'raise' | 'forward' | 'slam' | 'ring' | 'spin';

export interface BodySpec {
  /** soles to crown (px in the 256 master) */
  H: number;
  headR: number;
  /** half shoulder width */
  shW: number;
  /** half hip width */
  hipW: number;
  /** half chest depth */
  chestD: number;
  /** limb thickness multiplier */
  girth: number;
  /** 0..1 */
  belly: number;
  /** forward hunch (rad) */
  hunch: number;
  /** hip height / H */
  legs: number;
  /** stance half-width */
  stance: number;
  /** bust/chest shape for women: 0..1 (subtle) */
  bust: number;
}

export interface Outfit {
  skin: string;
  /** torso / shirt (or coat body when coat is set) */
  top: Mat;
  sleeves?: Mat;
  forearms?: Mat;
  hands?: Mat;
  legs: Mat;
  boots: Mat;
  bootH?: number;
  /** long garment below the waist (coat skirt, robe, dress). len: 0 = hips, 1 = knees, 1.5 = ankles */
  coat?: { mat: Mat; len: number; flare: number; open?: Mat; split?: boolean; tatter?: boolean; collar?: Mat };
  apron?: { mat: Mat; len: number };
  belt?: { mat: Mat; buckle?: Mat; y?: number };
  /** diagonal strap across the chest; items drawn along it */
  strap?: { mat: Mat; items?: 'shells' | 'knives' | 'vials' | 'studs'; itemMat?: Mat; flip?: boolean };
  scarf?: { mat: Mat; tail: number };
  cape?: { mat: Mat; len: number; tatter?: boolean; short?: boolean };
  hood?: { mat: Mat; dark?: boolean };
  hat?: { kind: HatKind; mat: Mat; band?: Mat };
  hair?: { style: HairStyle; mat: Mat };
  beard?: { style: BeardStyle; mat: Mat };
  pauldrons?: { mat: Mat; size: number; spikes?: boolean };
  plate?: Mat; // chest plate
  pouches?: { mat: Mat; n: number };
  face?: { brows?: number; blindfold?: Mat; monocle?: boolean; eyes?: string; jaw?: Mat; old?: boolean; scar?: boolean; paint?: string };
  shawl?: Mat;
  tabard?: Mat;
  vents?: Mat;
}

export interface Pose {
  bob: number;
  lean: number;
  twist: number;
  hipYaw: number;
  roll: number;
  headTilt: number;
  headYaw: number;
  footL: V3;
  footR: V3;
  handL: V3;
  handR: V3;
  poleL: V3;
  poleR: V3;
  /** chest-local main-hand aim (one-handed props) */
  aim: V3;
  /** chest-local off-hand aim */
  aimL: V3;
  fall: number;
  /** cloth sway: + = trailing backwards (running), 0 = hanging */
  sway: number;
  /** generic action parameter: bow draw / recoil flash / bell swing (0..1) */
  act: number;
  /** cast glow 0..1 */
  glow: number;
  /** 0..1 knee bend */
  crouch: number;
  /** animation name + phase for props that want it */
  anim: Anim;
  t: number;
  frame: number;
}

export interface Rig {
  body: BodySpec;
  pelvis: Basis;
  chest: Basis;
  head: Basis;
  neck: V3;
  shL: V3;
  shR: V3;
  elL: V3;
  elR: V3;
  wrL: V3;
  wrR: V3;
  handL: Basis;
  handR: Basis;
  hipL: V3;
  hipR: V3;
  knL: V3;
  knR: V3;
  anL: V3;
  anR: V3;
  footL: Basis;
  footR: Basis;
  /** lengths */
  arm: number;
  upper: number;
  fore: number;
  thigh: number;
  shin: number;
  limb: { ua: number; fa: number; th: number; sh: number; hand: number };
  waistY: number;
}

export interface PropCtx {
  st: Stage;
  rig: Rig;
  pose: Pose;
  kit: Kit;
}

export interface Kit {
  id: string;
  name: string;
  /** world height of the sprite cell (same scale as SPRITE_SIZE in src/render/sprites.ts) */
  world: number;
  /** per-anim frame count override (0 = anim not baked, e.g. minions have no cast) */
  frames?: Partial<Record<Anim, number>>;
  /** outer contour width multiplier (smaller figures get a bolder contour so it matches the champions on screen) */
  ink?: number;
  body: Partial<BodySpec>;
  outfit: Outfit;
  hold: Hold;
  attack: AttackStyle;
  cast: CastStyle;
  /** prop painters (signature items) */
  props: ((c: PropCtx) => void)[];
  gait?: 'normal' | 'heavy' | 'light' | 'prowl';
  /** one-line look description (report / lab) */
  look: string;
  /** the one 64 px feature */
  feature: string;
}
