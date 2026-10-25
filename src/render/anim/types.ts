// Animation system types (A3): logical unit states, animation events and the per-id clip description.
// Pure types, no three/canvas, so tests and later render subsystems (VFX, audio, game feel) can import them freely.
import type { Anim, Dir } from '../champions/types';

/** How a cast plays: directed spells release forward, self buffs flex, dashes lunge. */
export type CastKind = 'directed' | 'self' | 'dash';

/**
 * Logical state of a unit's sprite. Several states share one atlas clip (`Anim`): `recall` is the cast clip's gather
 * and flex frames, `release`/`recovery` are the second half of the attack clip.
 */
export type LogicalState =
  | 'idle'
  | 'walk'
  | 'windup' //   attack anticipation, frames 0 .. hit - 1, stretched over the sim's wind-up
  | 'release' //  attack strike frame(s): starts exactly on the sim's damage tick
  | 'recovery' // attack follow-through and settle (orbwalk cancels it)
  | 'cast'
  | 'recall';

/** Events that are tied to a frame of a clip: listed per anim in the data table (see data.ts / docs/ANIM-FORMAT.md). */
export type FrameEventName = 'footstep' | 'hitFrame' | 'release' | 'land';
/** Events of the unit's state machine (no frame number): they happen at a transition. */
export type StateEventName = 'windup' | 'castStart' | 'castCancel' | 'hit' | 'death' | 'recallStart' | 'recallEnd';
export type AnimEventName = FrameEventName | StateEventName;

export const ANIM_EVENT_NAMES: readonly AnimEventName[] = ['footstep', 'hitFrame', 'release', 'land', 'windup', 'castStart', 'castCancel', 'hit', 'death', 'recallStart', 'recallEnd'];

/** One event the animation system raises. The object is reused: read it inside the callback, copy what you keep. */
export interface AnimEvent {
  name: AnimEventName;
  /** sim entity id */
  eid: number;
  /** sprite id in the atlas ('mira', 'minion-melee-0', ...) */
  id: string;
  /** render time (ms, same clock as the game's `now`) */
  t: number;
  /** feet position in world units (interpolated) */
  x: number;
  y: number;
  dir: Dir;
  /** castStart / release / castCancel: ability slot 0..3 (-1 = unknown) */
  slot: number;
  /** castStart / release / castCancel: how the cast plays; otherwise 'directed' */
  kind: CastKind;
  /** footstep: 0 = first foot of the cycle, 1 = second */
  foot: number;
}

export interface ClipEvent {
  /** frame index of the clip on which the event fires (0 .. frames - 1) */
  frame: number;
  name: FrameEventName;
}

/** Playback description of one anim of one sprite id. */
export interface ClipSpec {
  /** number of frames baked per direction (0 = this anim does not exist for the id, e.g. minion cast) */
  frames: number;
  /** playback rate in frames per second for looping / free-running clips (attack and cast are stretched to the sim instead) */
  fps: number;
  loop: boolean;
  events: readonly ClipEvent[];
}

/** Everything the state machine needs to know about one sprite id. */
export interface ClipSet {
  id: string;
  clips: Record<Anim, ClipSpec>;
  /** attack frame that shows the strike (= the sim's damage tick) */
  hit: number;
  /** cast frame of the release */
  release: number;
  /** cast frame of the self-buff flex (also the held frame of recall) */
  flex: number;
  /** movement speed (world units / s) at which the run clip plays at its nominal fps */
  refSpeed: number;
  /** cast kind per ability slot (0..3) when it differs from what the ability type says */
  castKinds: readonly (CastKind | undefined)[];
}
