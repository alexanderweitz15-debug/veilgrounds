// Hook contract for champion-specific logic (src/sim/champions/<id>.ts). Copy mira.ts as the template.
// - passive hooks: listed by id in data `passive.hooks`; event handlers called by the engine.
// - effect hooks: referenced from ability data as { kind: 'hook', id }; called once per resolution.
// Hook state must live in sim.state (never module-level), keyed by entity id.

import type { Sim } from '../sim';
import type { AbilityData } from './schema';

export interface EffectCtx {
  caster: number;
  /** 0..3 = Q W E R. */
  slot: number;
  rank: number;
  ability: AbilityData;
  /** Units hit by this resolution (one projectile hit, one AoE resolution, ...). */
  hits: number[];
  /** Effect center (impact point, zone center, dash end, ...). */
  x: number;
  y: number;
  /** Explicit unit target (targeted abilities), else -1. */
  target: number;
}

export interface PassiveHook {
  /** Champion spawned (set up per-entity state). */
  onSpawn?(sim: Sim, eid: number): void;
  /** Auto-attack hit point (windup finished). Return damage multipliers for extra projectiles/hits, e.g. [0.5]. */
  onAutoFire?(sim: Sim, eid: number, target: number): number[] | void;
  /** Auto-attack damage landed (melee instantly, ranged on projectile impact). */
  onAutoHit?(sim: Sim, eid: number, target: number, damage: number): void;
  /** An ability (slot 0..3) resolved its cast. */
  onCast?(sim: Sim, eid: number, slot: number): void;
}

export type EffectHook = (sim: Sim, ctx: EffectCtx) => void;

export interface ChampionHooks {
  passive?: Record<string, PassiveHook>;
  effects?: Record<string, EffectHook>;
}
