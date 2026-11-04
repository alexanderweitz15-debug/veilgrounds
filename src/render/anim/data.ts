// Animation data table (A3): per sprite id the playback overrides on top of the defaults. Format: docs/ANIM-FORMAT.md.
// Frame COUNTS are not here: they are baked into the atlas and therefore live with the art (`kit.frames` in
// champions/kits.ts, `frames` of a SpriteDrawer). This table only describes how the baked frames play.
import { CAST_FLEX, CAST_RELEASE } from '../champions/anim';
import { ANIMS, type Anim } from '../champions/types';
import type { CastKind, ClipEvent, ClipSet, ClipSpec } from './types';

export interface ClipOverride {
  /** playback rate, frames per second */
  fps?: number;
  loop?: boolean;
  /** replaces the default frame events of this anim */
  events?: ClipEvent[];
}

export interface AnimOverride {
  clips?: Partial<Record<Anim, ClipOverride>>;
  /** cast kind per ability slot 0..3 (Q W E R) when the ability's `type` does not say it right */
  castKinds?: Partial<Record<0 | 1 | 2 | 3, CastKind>>;
  /** run clip plays at nominal fps at this movement speed (default DEFAULT_REF_SPEED) */
  refSpeed?: number;
}

/**
 * Per-id overrides. Empty on purpose: every champion plays on the defaults below until its art (A11 / A26) needs
 * something else, e.g. a different strike frame for a new attack animation:
 *
 *   vargrim: { clips: { attack: { events: [{ frame: 3, name: 'hitFrame' }] }, run: { fps: 18 } }, refSpeed: 400 },
 */
export const ANIM_OVERRIDES: Record<string, AnimOverride> = {};

/** movement speed at which a run cycle plays at its nominal rate (a typical champion) */
export const DEFAULT_REF_SPEED = 340;

/** What the atlas baked for an id (frames, rates, strike frame, loop flags). */
export interface ClipBase {
  /** frames baked per anim */
  frames: Record<Anim, number>;
  /** frames per second per anim (atlas.rate[id]) */
  fps: Record<Anim, number>;
  /** attack strike frame (atlas.hit[id]) */
  hit: number;
  loop: Record<Anim, boolean>;
}

/** Default frame events of an anim with `n` frames; `hit` = attack strike frame. */
export function defaultEvents(anim: Anim, n: number, hit: number): ClipEvent[] {
  if (n <= 0) return [];
  switch (anim) {
    case 'run':
      // contact frames: right foot planted at 0, left foot at the half cycle
      return n >= 2 ? [{ frame: 0, name: 'footstep' }, { frame: Math.floor(n / 2), name: 'footstep' }] : [];
    case 'attack':
      return [{ frame: Math.min(n - 1, Math.max(0, hit)), name: 'hitFrame' }];
    case 'cast':
      return [{ frame: Math.min(n - 1, CAST_RELEASE), name: 'release' }];
    case 'death':
      return [{ frame: n - 1, name: 'land' }];
    default:
      return [];
  }
}

const eventFrame = (events: readonly ClipEvent[], name: ClipEvent['name']): number | undefined => events.find((e) => e.name === name)?.frame;

/** Resolves the clip set of one id from what the atlas baked plus the override table. */
export function buildClipSet(id: string, base: ClipBase, overrides: Record<string, AnimOverride> = ANIM_OVERRIDES): ClipSet {
  const ov = overrides[id];
  const clips = {} as Record<Anim, ClipSpec>;
  for (const anim of ANIMS) {
    const o = ov?.clips?.[anim];
    const frames = Math.max(0, base.frames[anim]);
    const hit = anim === 'attack' ? (eventFrame(o?.events ?? [], 'hitFrame') ?? base.hit) : base.hit;
    clips[anim] = {
      frames,
      fps: o?.fps ?? base.fps[anim],
      loop: o?.loop ?? base.loop[anim],
      events: o?.events ?? defaultEvents(anim, frames, hit),
    };
  }
  const hit = eventFrame(clips.attack.events, 'hitFrame') ?? base.hit;
  const castN = clips.cast.frames;
  return {
    id,
    clips,
    hit: Math.min(Math.max(0, clips.attack.frames - 1), hit),
    release: Math.min(Math.max(0, castN - 1), eventFrame(clips.cast.events, 'release') ?? CAST_RELEASE),
    flex: Math.min(Math.max(0, castN - 1), CAST_FLEX),
    refSpeed: ov?.refSpeed ?? DEFAULT_REF_SPEED,
    castKinds: [ov?.castKinds?.[0], ov?.castKinds?.[1], ov?.castKinds?.[2], ov?.castKinds?.[3]],
  };
}

/** Strike frame override of an id (atlas.hitOf reads it so the atlas and the machine agree), or undefined. */
export function hitOverride(id: string): number | undefined {
  return eventFrame(ANIM_OVERRIDES[id]?.clips?.attack?.events ?? [], 'hitFrame');
}
/** fps overrides of an id applied to a base rate table. */
export function applyRateOverrides(id: string, rates: Record<Anim, number>): Record<Anim, number> {
  const o = ANIM_OVERRIDES[id]?.clips;
  if (!o) return rates;
  const r = { ...rates };
  for (const anim of ANIMS) r[anim] = o[anim]?.fps ?? r[anim];
  return r;
}

/** Problems of a clip set (empty = valid): event frames out of range, missing hit/release event, bad rates. */
export function validateClipSet(cs: ClipSet): string[] {
  const out: string[] = [];
  for (const anim of ANIMS) {
    const c = cs.clips[anim];
    if (!(c.fps > 0) && c.frames > 1 && (anim === 'idle' || anim === 'run' || anim === 'death')) out.push(`${cs.id}.${anim}: fps must be > 0`);
    for (const ev of c.events) if (!Number.isInteger(ev.frame) || ev.frame < 0 || ev.frame >= c.frames) out.push(`${cs.id}.${anim}: event ${ev.name} on frame ${ev.frame} outside 0..${c.frames - 1}`);
  }
  const hits = cs.clips.attack.events.filter((e) => e.name === 'hitFrame').length;
  if (cs.clips.attack.frames > 0 && hits !== 1) out.push(`${cs.id}.attack: needs exactly one hitFrame event (has ${hits})`);
  const rel = cs.clips.cast.events.filter((e) => e.name === 'release').length;
  if (cs.clips.cast.frames > 0 && rel !== 1) out.push(`${cs.id}.cast: needs exactly one release event (has ${rel})`);
  if (!(cs.refSpeed > 0)) out.push(`${cs.id}: refSpeed must be > 0`);
  return out;
}

/** Layout fingerprint of an id's baked frames, e.g. '4.8.5.4.3': append it to the atlas strip cache key. */
export const layoutKey = (frames: Record<Anim, number>): string => ANIMS.map((a) => frames[a]).join('.');
