// Sound triggers: a tiny publish/subscribe layer between gameplay code and sounds, so animation events (A3: hitFrame,
// release, footstep) and game feel (A8: killConfirm) can start sounds without importing the synthesis code.
//
//   emitTrigger('footstep', { x, y, src: eid, rel: Rel.Own });   // from the animation system
//   const off = onTrigger('killConfirm', (p) => mySound(p));      // extra or replacement handler
//
// sfx.ts registers one default handler per trigger (`installDefaultTriggers`); handlers run in registration order.
import type { PlayOpts } from './manager';

export type TriggerName =
  /** The frame of an attack animation where the hit lands. */
  | 'hitFrame'
  /** The frame where a projectile or ability effect leaves the caster. */
  | 'release'
  /** A foot touches the ground. */
  | 'footstep'
  /** The local player's champion got a champion kill or assist (game-feel confirmation). */
  | 'killConfirm';

export interface TriggerPayload extends PlayOpts {
  x?: number;
  y?: number;
  /** release: ability id and ability type (see playCast). */
  abilityId?: string;
  abilityType?: string;
  ultimate?: boolean;
  /** hitFrame / footstep: heavier unit (big champion). */
  heavy?: boolean;
}

export type TriggerHandler = (p: TriggerPayload) => void;

const handlers: Record<TriggerName, TriggerHandler[]> = { hitFrame: [], release: [], footstep: [], killConfirm: [] };

/** Subscribe; returns the unsubscribe function. */
export function onTrigger(name: TriggerName, fn: TriggerHandler): () => void {
  const list = handlers[name];
  list.push(fn);
  return () => {
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };
}

/** Fire a trigger. A throwing handler never breaks the caller (the render loop). */
export function emitTrigger(name: TriggerName, payload: TriggerPayload = {}): void {
  const list = handlers[name];
  for (let i = 0; i < list.length; i++) {
    try {
      list[i]!(payload);
    } catch (e) {
      console.warn('audio trigger handler failed', name, e);
    }
  }
}

export function triggerHandlerCount(name: TriggerName): number {
  return handlers[name].length;
}
