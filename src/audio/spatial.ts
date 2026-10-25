// Spatial mix relative to the camera: pan + distance attenuation, off-screen sounds quieter, the own champion always
// audible. Pure functions writing into a reusable result object (no allocation per sound).

/** Relation of the sound source to the local player (only set for champions; minions/towers stay `Rel.Neutral`). */
export const Rel = { Neutral: 0, Own: 1, Ally: 2, Enemy: 3 } as const;
export type RelValue = (typeof Rel)[keyof typeof Rel];

export interface Listener {
  x: number;
  y: number;
  /** Hearing radius in map units: nothing further away is played. */
  hearRadius: number;
  /** Half-width of what the camera shows in map units; beyond it a source is "off-screen". */
  screenRadius: number;
}

export function createListener(): Listener {
  return { x: 0, y: 0, hearRadius: 2600, screenRadius: 1300 };
}

export interface Spatial {
  gain: number;
  pan: number;
  /** 0 = at the listener, 1 = on the screen edge, > 1 off-screen (distance / screenRadius). */
  nearness: number;
}

export const MIN_AUDIBLE_GAIN = 0.02;
/** Gain at the screen edge; beyond it the sound falls off quadratically to 0 at the hearing radius. */
const EDGE_GAIN = 0.7;
const NEAR_GAIN_LOSS = 0.3;
const OWN_MIN_GAIN = 0.85;
const OWN_PAN_LIMIT = 0.5;

/**
 * Fills `out` and returns true when the sound is audible. Own-champion sounds are never culled and never quieter than
 * OWN_MIN_GAIN, with the pan limited so a champion at a screen edge does not sound hard-panned.
 */
export function spatialize(l: Listener, x: number, y: number, rel: RelValue, out: Spatial): boolean {
  const dx = x - l.x;
  const dy = y - l.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const s = l.screenRadius;
  out.nearness = d / s;
  let pan = dx / s;
  let g: number;
  if (d <= s) {
    g = 1 - NEAR_GAIN_LOSS * (d / s);
  } else {
    const t = (d - s) / Math.max(1, l.hearRadius - s);
    g = t >= 1 ? 0 : EDGE_GAIN * (1 - t) * (1 - t);
  }
  if (rel === Rel.Own) {
    g = Math.max(g, OWN_MIN_GAIN);
    pan = Math.max(-OWN_PAN_LIMIT, Math.min(OWN_PAN_LIMIT, pan));
  } else if (g < MIN_AUDIBLE_GAIN) {
    return false;
  }
  out.gain = g;
  out.pan = pan > 1 ? 1 : pan < -1 ? -1 : pan;
  return true;
}

/** Bonus on a cue's base priority by relation. Own is forced to PRIORITY_OWN by `priorityOf`. */
const REL_BONUS = [0, 60, 10, 25] as const;
/** Up to this much extra priority for a sound near the camera centre (on-screen only). */
const NEAR_BONUS = 10;

/** own champion > enemy champion near you > allied champion > minions / far; base comes from the cue table. */
export function priorityOf(base: number, rel: RelValue, nearness: number, ownPriority: number): number {
  if (rel === Rel.Own) return ownPriority;
  const near = nearness < 1 ? NEAR_BONUS * (1 - nearness) : 0;
  const p = base + REL_BONUS[rel]! + near;
  return p >= ownPriority ? ownPriority - 1 : p;
}
