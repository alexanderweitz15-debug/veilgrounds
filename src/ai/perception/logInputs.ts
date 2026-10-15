// Enemy positions in decision-log inputs (spec test 7), following K's convention on DecisionLogEntry.inputs
// (contract.ts, checked by checkFogConvention in src/ai/log.ts): `<p>X`, `<p>Y`, `<p>Src` plus `<p>Slot` for
// 'seen' and `<p>R` (> 0) for 'cloud'. L's internal sources map onto it: seen -> 'seen'; cloud / audio (blurred
// heard cast) / ping (ally ping) / prior (timer estimate) -> 'cloud' with a radius. `<p>Tick` = tick of the
// underlying sighting/cue (-1 for priors). Behaviour code writes enemy coordinates ONLY through these helpers.

import { AUDIO_BLUR } from '../../sim/snapshot';
import type { PosSource, TrackMem } from './types';

type Inputs = Record<string, number | string | boolean>;

export interface LoggedPos {
  x: number;
  y: number;
  src: PosSource;
  tick: number;
  /** Uncertainty radius for non-'seen' sources. */
  r?: number;
}

const PING_R = 800;

/** Believed enemy position from a track: seen position if perceived now, else its cloud, else last anchor. */
export function trackPos(t: TrackMem): LoggedPos | null {
  if (t.visibleNow) return { x: t.lastX, y: t.lastY, src: 'seen', tick: t.lastTick };
  if (t.cloud && t.anchor) return { x: t.cloud.x, y: t.cloud.y, src: 'cloud', tick: t.anchor.tick, r: t.cloud.r };
  if (t.anchor) return { x: t.anchor.x, y: t.anchor.y, src: t.anchor.src, tick: t.anchor.tick, r: t.anchor.src === 'audio' ? AUDIO_BLUR : PING_R };
  return null;
}

/** Add an enemy track position to log inputs under prefix `p`. */
export function logTrack(inputs: Inputs, p: string, t: TrackMem | undefined): Inputs {
  const pos = t ? trackPos(t) : null;
  if (pos && t) logPos(inputs, p, pos, t.slot);
  return inputs;
}

export function logPos(inputs: Inputs, p: string, pos: LoggedPos, slot?: number): Inputs {
  // tags first: the log shortener keeps the first 32 keys, a cut must never leave an untagged X/Y pair
  inputs[`${p}Src`] = pos.src === 'seen' ? 'seen' : 'cloud';
  if (pos.src !== 'seen') inputs[`${p}R`] = Math.max(1, Math.round(pos.r ?? PING_R));
  if (slot !== undefined) inputs[`${p}Slot`] = slot;
  inputs[`${p}X`] = Math.round(pos.x);
  inputs[`${p}Y`] = Math.round(pos.y);
  inputs[`${p}Tick`] = pos.tick;
  return inputs;
}

/** Map point / own unit (K's 'static' / 'self' / 'ally' sources). */
export function logPoint(inputs: Inputs, p: string, pt: { x: number; y: number }, src: 'static' | 'self' | 'ally'): Inputs {
  inputs[`${p}Src`] = src;
  inputs[`${p}X`] = Math.round(pt.x);
  inputs[`${p}Y`] = Math.round(pt.y);
  return inputs;
}
