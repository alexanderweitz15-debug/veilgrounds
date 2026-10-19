// Hook contract for champion-specific logic (src/sim/champions/<id>.ts). Copy mira.ts as the template.
// - passive hooks: listed by id in data `passive.hooks`; event handlers called by the engine.
// - effect hooks: referenced from ability data as { kind: 'hook', id }; called per resolution (see EffectCtx.phase).
// - module-level ChampionHooks.onTick / ownsHits: not referenced from data (work for champions without passives).
// Hook state must live in sim.state (never module-level), keyed by entity id. No Math.random/sin/cos/atan2/pow.
//
// Engine API for hooks (all deterministic, all state in sim.state):
//   src/sim/systems/abilities.ts
//     applyEffects(sim, ctx, which = 'all')     generic (non-hook) effects of ctx.ability on ctx.hits; 'hit' = only
//                                              hit-target effects, 'self' = only self/ally/allies. Fires onAbilityHit.
//     enemiesInRadius(sim, eid, x, y, r)       enemy non-structure units touching the circle (sorted by eid)
//     enemiesOnSegment(sim, eid, ax, ay, bx, by, halfWidth)
//     scaleAmount(sim, scaling, caster, target, rank)  /  effectAmount(sim, ctx, target, i?) = i-th damage effect
//     cooldownLeft / setCooldown / reduceCooldown(sim, eid, slot, ticks)
//     cancelCast(sim, eid, { refund, cooldownTicks? })   abort the current wind-up (e.g. fake hook)
//     openRecast(sim, eid, slot, fromTick, untilTick)   a cast of `slot` in the window becomes a recast (phase 'recast')
//     armNextAuto(sim, ctx, ticks)              next auto of ctx.caster becomes empowered (phase 'empowered');
//                                              `*_next_auto` hook ids arm automatically (ability.duration, default 4 s)
//     channelOf(sim, eid)                       { slot, start, until } while channelling (flag 'channel'), else null
//     displace(sim, src, t, distance, overTicks?)  knockback (>0) / pull (<0); airborne while moving
//     displaceTo(sim, src, t, x, y, overTicks)  move t to a point over time (airborne while moving)
//     lastDashEnd(sim, eid)                     tick the last own dash/blink/Flash ended (-1e9 if never)
//     teleport, landingPoint, nearestAlly, rv(ranked, rank)
//   src/sim/systems/projectiles.ts
//     fireAbilityProjectile(sim, ctx, { dx?, dy?, x?, y?, target?, speed?, width?, range?, flags?, tag?, returning? })
//       ability projectile owned by ctx; hits resolve like the ability's own projectile. `returning`: flies back to the
//       caster at max range, may hit each unit once more. `tag` is passed back in ctx.tag.
//     destroyProjectile(sim, proj)
//   src/sim/summons.ts
//     spawnPet(sim, spec) / setPetBehaviour / petsOf / trackLifetime   temporary fighting units (Kind.Pet, minions)
//     addGroundObject / groundObjects / removeGroundObject              plain ground records (blades, seeds, traps)
//     blockTerrain(sim, cells, ticks) + wallCells / ringCells           temporary impassable terrain (walls, domes)
//   src/sim/damage.ts   dealDamage(sim, src, dst, amount, type, opts), lastDamageTick(sim, src, dst), lastCombatTick
//   src/sim/buffs.ts    addBuff, removeBuffs, hasBuff, hasStat(sim, eid, stat), buffs, reveal, healUnit
//     stat buffs: as ms ad ap armor mr dmgReduction tenacity range(flat) armorPen(pct) invisible untargetable
//                 projImmune (enemy projectiles pass through); negative pct/flat = debuff (e.g. armor -10 %).
//   src/sim/vision.ts   sees(sim, team, eid), seenByOthers(sim, team, eid, exclude)
//
// Effect timing (docs/champion-hooks.md): hooks run in data order together with the generic effects.
// - Dash abilities: hooks run twice, phase 'dashStart' (ctx.dash is the mutable dash plan: reverse dx/dy for
//   backward hops, set target/distance/stopAtEnemy) and phase 'cast' at the dash end with the generic effects.
// - Next-auto abilities: on cast the self/ally effects + hooks run (phase 'cast'); on the empowered auto the 'hit'
//   effects resolve on the auto target and hooks run again with phase 'empowered' (ctx.empowered.damage).
// - Hit ownership (ChampionHooks.ownsHits, ability ids): the generic 'hit' effects are NOT applied on resolution;
//   the hooks get ctx.hits (generic geometry) and call applyEffects(sim, {...ctx, hits}, 'hit') per hit instance.
// - Line projectiles reaching max range call the ability's hooks with phase 'expire' (hits empty, x/y = end).

import type { Sim } from '../sim';
import type { AbilityData } from './schema';
import type { DamageType } from '../types';

/** Mutable dash plan (phase 'dashStart'). */
export interface DashPlan {
  dx: number;
  dy: number;
  distance: number;
  speed: number;
  /** Dash to this unit (ends beside it; it becomes the dash-end hit), -1 = none. */
  target: number;
  /** > 0: stop at the first enemy unit within this half-width of the path (it becomes the only hit). */
  stopAtEnemy: number;
}

export type EffectPhase = 'cast' | 'dashStart' | 'empowered' | 'recast' | 'expire';

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
  phase: EffectPhase;
  /** Cast direction (unit vector) and the raw cursor point. */
  dx: number;
  dy: number;
  cursorX: number;
  cursorY: number;
  /** Multiplier for the generic damage effects that follow in this resolution (a hook listed before damage may set it). */
  dmgMult?: number;
  /** Phase 'dashStart' only. */
  dash?: DashPlan;
  /** Phase 'empowered' only: the empowered auto's pre-mitigation damage. */
  empowered?: { damage: number };
  /** Tag of the projectile from fireAbilityProjectile ('' otherwise); returning projectiles: 'return' on the way back. */
  tag?: string;
}

export interface DamageInfo {
  /** Damage after mitigation (HP + shield). */
  amount: number;
  /** Part absorbed by shields. */
  absorbed: number;
  type: DamageType;
  isAuto: boolean;
}

export interface AutoHitInfo {
  crit: boolean;
  /** Lifesteal healing of this hit lost to full HP (Blutkrone). */
  overheal: number;
}

export interface CastMods {
  cost: number;
  /** Multiplies castTime and delay. */
  timeMult: number;
}

export interface PassiveHook {
  /** Champion spawned (set up per-entity state). */
  onSpawn?(sim: Sim, eid: number): void;
  /** Auto-attack hit point (windup finished). Return damage multipliers for extra projectiles/hits, e.g. [0.5]. */
  onAutoFire?(sim: Sim, eid: number, target: number): number[] | void;
  /** Auto-attack damage landed (melee instantly, ranged on projectile impact). */
  onAutoHit?(sim: Sim, eid: number, target: number, damage: number, info?: AutoHitInfo): void;
  /** An ability (slot 0..3) resolved its cast. */
  onCast?(sim: Sim, eid: number, slot: number): void;
  /** Pure modifier before a cast is accepted (cost, cast time). Must not change state (cast may still be rejected). */
  modifyCast?(sim: Sim, eid: number, slot: number, m: CastMods): void;
  /** A unit was hit by one of this champion's ability resolutions (after its generic effects). */
  onAbilityHit?(sim: Sim, eid: number, target: number, ctx: EffectCtx): void;
  /** Outgoing damage before mitigation (autos, abilities, DoTs). Return the new amount. */
  modifyDamage?(sim: Sim, eid: number, target: number, amount: number, type: DamageType, isAuto: boolean): number;
  /** Outgoing ability heal/shield amount on `target`. Return the new amount. */
  modifyHeal?(sim: Sim, eid: number, target: number, amount: number): number;
  /** One of this champion's pets (summons.spawnPet) took damage from `src` (-1 possible), after mitigation. */
  onPetDamaged?(sim: Sim, eid: number, pet: number, src: number, info: DamageInfo): void;
  /** This champion took damage (after shields), before a possible death. src may be -1. */
  onDamageTaken?(sim: Sim, eid: number, src: number, info: DamageInfo): void;
  /** This champion killed `victim` (any kind: minion, monster, champion, ...). Victim Pos is still valid. */
  onKill?(sim: Sim, eid: number, victim: number): void;
  /** An enemy champion died that this champion killed or damaged within the last 3 s. */
  onTakedown?(sim: Sim, eid: number, victim: number): void;
  /** Own dash, blink or Flash ended (slot 0..3, -1 = Flash). */
  onDashEnd?(sim: Sim, eid: number, slot: number): void;
  /** End of computeChampionStats: adjust Stats (e.g. Stats.armorPenPct) after base + buffs. */
  onComputeStats?(sim: Sim, eid: number): void;
}

export type EffectHook = (sim: Sim, ctx: EffectCtx) => void;

/** Ground shape of a visual object: ring (circle outline), disc (filled), blade (small bar), line (x/y -> x2/y2 strip),
 *  cross (trap X), wall (thick line), dome (big translucent ring), pin (small marker with a stem). */
export type VisualShape = 'ring' | 'disc' | 'blade' | 'line' | 'cross' | 'wall' | 'dome' | 'pin';

/** Something on the map a hook keeps in its own state (dome, wire, bell, banner, ...). Snapshot only. */
export interface VisualObject {
  /** Stable per object while it exists (render pools meshes by it): e.g. `${eid}` or `${eid}:${i}`. */
  key: string;
  tag: string;
  x: number;
  y: number;
  r: number;
  shape: VisualShape;
  /** Line / wall end point. */
  x2?: number;
  y2?: number;
  /** Line end follows this unit (wire pulling a champion): render uses the interpolated unit position. */
  follow?: number;
  /** Ticks left (timer ring); absent = no timer. */
  left?: number;
  total?: number;
  /** Count shown on the object (charges, stacks). */
  n?: number;
  /** Hidden from the enemy team (traps, seeds). */
  hidden?: boolean;
  /** Fill colour hint (CSS hue 0-360); absent = ability hue from the tag prefix or team colour. */
  hue?: number;
}

/** World marker for the own champion: where `slot` can go / what it can hit next (Renn E blades, recast range). */
export interface HintMarker {
  slot: number;
  x: number;
  y: number;
  /** Ring radius. */
  r: number;
  /** In range / usable now (false = dimmed). Default true. */
  ok?: boolean;
  /** Draw a thin line from the champion to the marker. */
  link?: boolean;
}

/** Mark / stack counter on a unit (shown above its health bar while the unit is visible). */
export interface UnitMark {
  target: number;
  id: string;
  /** Stack count (pips) and maximum. */
  n?: number;
  max?: number;
  /** Ticks left. */
  left?: number;
}

/** Passive state for the HUD badge next to the portrait. */
export interface PassiveHud {
  stacks?: number;
  max?: number;
  /** Cooldown ticks left / total. */
  cdLeft?: number;
  cdTotal?: number;
  /** Ready / charged / active (glowing badge). */
  ready?: boolean;
}

/**
 * Snapshot-only visuals of one champion entity (src/sim/snapshot.ts). MUST be read-only: no state creation (read hook
 * maps via `sim.state[key] as Map | undefined`, never hookState/stateMap), no RNG, no events.
 */
export interface ChampionVisuals {
  /** Own champion only (never sent to other teams). */
  hints?: HintMarker[];
  objects?: VisualObject[];
  marks?: UnitMark[];
  /** Own champion only. */
  passive?: PassiveHud;
  /** Next auto is empowered by a hook (slot 0..3, or 4 = passive), beyond the engine's armNextAuto. */
  empowered?: number;
  /** Self buff shown as an aura (hook-kept states without a buff entry): ability slot (0..3) or 4 = passive. */
  aura?: number;
}

export interface ChampionHooks {
  /** Snapshot visuals (read-only, see ChampionVisuals). Called for every champion entity of this id, alive or dead. */
  visuals?(sim: Sim, eid: number): ChampionVisuals | void;
  passive?: Record<string, PassiveHook>;
  effects?: Record<string, EffectHook>;
  /** Called every tick for every champion entity of this champion id, alive or dead, before casts resolve. */
  onTick?(sim: Sim, eid: number): void;
  /** Ability ids whose 'hit' generic effects the hooks apply themselves (hit producers, line geometry, falloff). */
  ownsHits?: string[];
  /**
   * Targeted abilities: is `t` a valid target of `ab` (pure, no state changes)? `base` = the engine rule (enemy fighting
   * unit in vision, not untargetable; ally_target: allied champion). Alive and range are always checked by the engine.
   */
  targetOk?(sim: Sim, caster: number, ab: AbilityData, t: number, base: boolean): boolean;
}
