// Corvin Pulver hooks: six-shot drum with reload (passive), double shot (Q), powder keg (W), reload (E), volley (R).

import type { Sim } from '../sim';
import { sec } from '../types';
import { dir, rotate } from '../vec';
import { fireAbilityProjectile } from '../systems/projectiles';
import { attackProjectileSpeed } from '../systems/attack';
import { applyEffects, enemiesInRadius, rv } from '../systems/abilities';
import { petsOf, removePet, spawnPet } from '../summons';
import type { ChampionHooks, ChampionVisuals, EffectCtx, VisualObject } from './hooks';
import { abilityOf, stateMap, tickCtx } from './dagny';
import { peekState } from './util';

const DRUM = 6;
const RELOAD = sec(1.5);

interface Drum {
  shots: number;
  /** Reload ends at this tick (0 = not reloading). */
  reloadUntil: number;
  /** Attack timer as it would have been without the reload (restored by E). */
  normalReady: number;
}
const drums = (sim: Sim): Map<number, Drum> => stateMap<Drum>(sim, 'corvinDrum');
function drum(sim: Sim, eid: number): Drum {
  let d = drums(sim).get(eid);
  if (!d) drums(sim).set(eid, (d = { shots: DRUM, reloadUntil: 0, normalReady: 0 }));
  if (d.reloadUntil > 0 && sim.tick >= d.reloadUntil) (d.shots = DRUM), (d.reloadUntil = 0);
  return d;
}

export const corvinShots = (sim: Sim, eid: number): number => drum(sim, eid).shots;
export const corvinReloading = (sim: Sim, eid: number): boolean => drum(sim, eid).reloadUntil > sim.tick;

/** Spend one shot; an empty drum starts the reload (no autos until it ends). Returns false if none was left. */
function useShot(sim: Sim, eid: number): boolean {
  const d = drum(sim, eid);
  if (d.shots <= 0) return false;
  d.shots--;
  if (d.shots === 0) {
    const { Atk } = sim.c;
    d.reloadUntil = sim.tick + RELOAD;
    d.normalReady = Atk.nextReady[eid]!;
    Atk.nextReady[eid] = Math.max(Atk.nextReady[eid]!, d.reloadUntil);
  }
  return true;
}

/**
 * Passive badge: shots left in the drum (reload timer while reloading); the last shot (+50 %) glows as an empowered
 * auto. W: blast ring (300) with the keg's fuse timer around each own keg (the keg body is a pet unit).
 */
function corvinVisuals(sim: Sim, eid: number): ChampionVisuals {
  const d = peekState<Drum>(sim, 'corvinDrum')?.get(eid);
  // drum() refills lazily: mirror it without writing
  const reloading = !!d && d.reloadUntil > sim.tick;
  const shots = !d || (d.reloadUntil > 0 && sim.tick >= d.reloadUntil) ? DRUM : d.shots;
  const v: ChampionVisuals = { passive: { stacks: shots, max: DRUM, ...(reloading ? { cdLeft: d.reloadUntil - sim.tick, cdTotal: RELOAD } : {}), ready: !reloading && shots === 1 } };
  if (!reloading && shots === 1 && sim.c.Unit.alive[eid]) v.empowered = 4;
  const ks = peekState<Keg>(sim, 'corvinKegs');
  const objects: VisualObject[] = [];
  for (const k of ks ? petsOf(sim, eid, 'corvin_keg') : []) {
    const info = ks!.get(k);
    if (!info || info[0] !== sim.c.Unit.serial[k]) continue;
    const { Pos } = sim.c;
    objects.push({ key: String(k), tag: 'corvin_w_keg', x: Pos.x[k]!, y: Pos.y[k]!, r: abilityOf(sim, eid, 1).radius ?? 300, shape: 'ring', left: Math.max(0, info[2] - sim.tick), total: info[3] });
  }
  if (objects.length) v.objects = objects;
  return v;
}

export const hooks: ChampionHooks = {
  visuals: corvinVisuals,
  ownsHits: ['corvin_w', 'corvin_r'],
  passive: {
    corvin_drum: {
      onSpawn(sim, eid) {
        drum(sim, eid);
      },
      // attack.fire sets Atk.nextReady before onAutoFire, so the reload can push the attack timer back here
      onAutoFire(sim, eid) {
        useShot(sim, eid);
        // the last shot of the drum deals +50 %: an extra half-damage instance
        if (drum(sim, eid).shots === 0) return [0.5];
      },
      onAutoHit(sim, eid, target) {
        kegHit(sim, eid, target);
      },
    },
  },
  effects: {
    // Shot 1 = this resolution; shot 2 is a homing projectile launched from 0.3 s of travel behind Corvin
    // (deterministic delay without a timer). Its hit resolves Q again with tag 'second'.
    // ponytail: item on-hit effects are not applied by Q shots.
    corvin_q_double_shot(sim, ctx) {
      if (ctx.tag === 'second') return void useShot(sim, ctx.caster);
      if (!useShot(sim, ctx.caster) || drum(sim, ctx.caster).shots === 0 || ctx.target < 0) return;
      const { Pos } = sim.c;
      const speed = attackProjectileSpeed(sim, ctx.caster) || 2000;
      const ox = Pos.x[ctx.caster]!;
      const oy = Pos.y[ctx.caster]!;
      const [dx, dy] = dir(ox, oy, Pos.x[ctx.target]!, Pos.y[ctx.target]!);
      const back = speed * 0.3;
      fireAbilityProjectile(sim, ctx, { target: ctx.target, x: ox - dx * back, y: oy - dy * back, speed, tag: 'second' });
    },
    corvin_w_powder_keg(sim, ctx) {
      placeKeg(sim, ctx);
    },
    corvin_e_reload(sim, ctx) {
      if (ctx.phase !== 'dashStart') return;
      const d = drum(sim, ctx.caster);
      if (d.reloadUntil > sim.tick) {
        d.reloadUntil = 0;
        d.shots = 3;
        sim.c.Atk.nextReady[ctx.caster] = Math.max(sim.tick, d.normalReady);
      } else d.shots = Math.min(DRUM, d.shots + 3);
    },
    // Owned hits: the cone resolution fires 6 bullets evenly across the cone; each bullet hit (tag 'bullet') applies
    // the damage to the first unit it meets (minions block).
    corvin_r_volley(sim, ctx) {
      if (ctx.tag === 'bullet') return void applyEffects(sim, ctx, 'hit');
      if (ctx.phase !== 'cast') return;
      const half = (ctx.ability.angle ?? 25) / 2;
      for (let i = 0; i < 6; i++) {
        const [dx, dy] = rotate(ctx.dx, ctx.dy, -half + (2 * half * (i + 0.5)) / 6);
        fireAbilityProjectile(sim, ctx, { dx, dy, speed: ctx.ability.speed ?? 2400, width: ctx.ability.width ?? 50, range: 1200, flags: ['blocked_by_minions'], tag: 'bullet' });
      }
    },
  },
};

// ------------------------------------------------------------------ W keg

/** Keg eid -> [serial, rank, fuse end tick, fuse ticks]. */
type Keg = [number, number, number, number];
/** Kegs of all Corvins. */
const kegs = (sim: Sim): Map<number, Keg> => stateMap<Keg>(sim, 'corvinKegs');

/** Owned hits: W only places the keg (1 HP, 3 s, targetable only by Corvin's autos). */
function placeKeg(sim: Sim, ctx: EffectCtx): void {
  if (ctx.phase !== 'cast') return;
  for (const [e, [serial]] of [...kegs(sim)]) if (sim.c.Unit.serial[e] !== serial || !sim.c.Unit.alive[e]) kegs(sim).delete(e);
  const ticks = sec(rv(ctx.ability.duration, ctx.rank) || 3);
  const keg = spawnPet(sim, { owner: ctx.caster, tag: 'corvin_keg', x: ctx.x, y: ctx.y, ticks, hp: 1, radius: 40, ownerOnly: true });
  kegs(sim).set(keg, [sim.c.Unit.serial[keg]!, ctx.rank, sim.tick + ticks, ticks]);
}

/** Corvin's auto hit a keg: it explodes, the W damage and slow hit enemies within 300. */
function kegHit(sim: Sim, eid: number, target: number): void {
  const k = kegs(sim).get(target);
  if (!k || k[0] !== sim.c.Unit.serial[target]) return;
  kegs(sim).delete(target);
  const { Pos } = sim.c;
  const [x, y] = [Pos.x[target]!, Pos.y[target]!];
  removePet(sim, target);
  const hits = enemiesInRadius(sim, eid, x, y, abilityOf(sim, eid, 1).radius ?? 300);
  applyEffects(sim, tickCtx(sim, eid, 1, k[1], hits, x, y), 'hit');
}
