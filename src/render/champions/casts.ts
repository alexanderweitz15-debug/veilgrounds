// Per-ability cast poses (agent F): every champion bakes two cast families, A (gather, release, follow) and B
// (gather, release), plus the shared self-buff flex; each ability slot (Q W E R = 0..3) plays one family, chosen
// from the ability's type (skillshots draw/push, ground circles lob, cones sweep, self AoEs stomp, dashes lunge,
// targeted spells point). Canvas-free so tests and the sprite renderer can read it.
//
// cast frame layout (anim.ts FRAMES.cast = 6):  0 gatherA  1 releaseA  2 followA  3 gatherB  4 releaseB  5 flex
import type { CastStyle } from './types';

export interface CastFamilies {
  a: CastStyle;
  b: CastStyle;
  /** family per slot Q W E R: 0 = a, 1 = b */
  slots: [0 | 1, 0 | 1, 0 | 1, 0 | 1];
}

const F = (a: CastStyle, b: CastStyle, s: string): CastFamilies => ({ a, b, slots: [...s].map((c) => (c === 'b' ? 1 : 0)) as CastFamilies['slots'] });

export const CAST_FAMILIES: Record<string, CastFamilies> = {
  aurel: F('lob', 'draw', 'baba'), // Q bolt drawn, W/R clock zones lobbed, E rewind blink
  brom: F('stomp', 'sweep', 'aabb'), // Q/W whirl and sap, E bough sweep, R root grab
  corvin: F('point', 'lob', 'abab'), // Q shot, W keg lobbed, E roll, R powder cone
  dagny: F('stomp', 'sweep', 'abab'), // Q/E kettle stance, W steam cone, R charge
  ferris: F('forward', 'raise', 'abbb'), // Q light bolt, W/E lantern lifted for allies, R beacon
  gorvam: F('draw', 'stomp', 'abab'), // Q hook drawn, W/R chain stomp, E chain lob
  grimald: F('point', 'stomp', 'abab'), // Q bite, W roar stomp, E net thrown, R charge
  hagen: F('ring', 'raise', 'abaa'), // bells; W blessing raised
  harrow: F('point', 'slam', 'abbb'), // Q maul, W/E brace, R banner planted
  ilvane: F('forward', 'raise', 'abab'), // Q thread, W web raised, E skitter dash, R fan
  isolde: F('spin', 'sweep', 'abab'), // Q glass spin, W shard cone, E wire dash, R dome
  kaelen: F('draw', 'spin', 'abba'), // Q knife drawn, W dash + E whirl spin, R execute drawn
  kiran: F('forward', 'raise', 'abbb'), // Q thread pushed, W/E/R threads raised
  lio: F('draw', 'lob', 'abbb'), // Q spark drawn, W hop, E/R stones lobbed
  lysa: F('forward', 'raise', 'baba'), // Q thimble raised, W/R needle shots, E tripwire raised
  mira: F('draw', 'raise', 'babb'), // Q focus, W arrow drawn, E tumble, R volley raised
  nyx: F('forward', 'raise', 'abab'), // Q dagger, W shroud raised, E dash, R veil
  oda: F('forward', 'lob', 'abba'), // Q/R water pushed, W pool lobbed, E jug to an ally
  oleth: F('point', 'slam', 'abab'), // Q verdict, W aegis slam, E charge, R walls
  ottilie: F('draw', 'raise', 'abab'), // Q arrow drawn, W Hark called, E dash, R howl raised
  renn: F('point', 'spin', 'abab'), // Q cut, W/R blade whirl, E blink
  seraphyne: F('forward', 'raise', 'abab'), // Q bolt, W storm called, E blink, R strike called
  sev: F('forward', 'raise', 'abab'), // Q fireball pushed, W blink, E gaze, R eye raised
  thessaly: F('point', 'raise', 'abaa'), // Q/E/R light pointed, W prism raised
  tobin: F('draw', 'lob', 'abba'), // Q harpoon drawn, W dash, E net lobbed, R wave
  vessa: F('point', 'stomp', 'abba'), // Q pounce, W/E howl stomp, R dash
  wren: F('forward', 'raise', 'babb'), // Q embers raised, W ash pushed, E wing dash, R firestorm called down
};

/** Cast family (0 = A, 1 = B) of a slot for an id; unknown ids / extra slots (Sev's R choices) use A / the R slot. */
export function castFamily(id: string, slot: number): 0 | 1 {
  const f = CAST_FAMILIES[id];
  if (!f) return 0;
  return f.slots[Math.max(0, Math.min(3, slot))]!;
}

/** Styles whose release pose already is a self-buff / self-AoE pose (the generic flex frame is not needed). */
const SELF_STYLES: ReadonlySet<CastStyle> = new Set<CastStyle>(['stomp', 'raise', 'ring', 'spin', 'slam']);
/** Does a `self` ability of `slot` play its family's release instead of the shared flex frame? */
export function castSelfPose(id: string, slot: number): boolean {
  const f = CAST_FAMILIES[id];
  if (!f) return false;
  return SELF_STYLES.has(f.slots[Math.max(0, Math.min(3, slot))] ? f.b : f.a);
}

/** The two styles of a kit: the table, else the kit's own cast style for both. */
export function castStylesOf(id: string, fallback: CastStyle): [CastStyle, CastStyle] {
  const f = CAST_FAMILIES[id];
  return f ? [f.a, f.b] : [fallback, fallback];
}
