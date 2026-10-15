// Exact ability hitbox geometry for ground telegraphs ("Hitbox = sichtbare Fläche"). Pure: no THREE, no DOM.
// Mirrors the sim math in src/sim/systems/abilities.ts (castAbility wind-up, execute, lineSegment, cone case,
// dash plan) and src/sim/systems/projectiles.ts (line hit = swept segment within unit radius + width/2). Like the
// sim, shapes are the ability area itself; a unit is hit when its hitbox circle touches the shape.
// Verified against the sim in tests/telegraph.test.ts.
import type { AbilityData, Ranked } from '../sim/champions/schema';
import { sec } from '../sim/types';

/** Strip from A to B with full thickness `width` (sim: segment distance <= width/2 + unit radius). */
export interface LineShape {
  k: 'line';
  ax: number;
  ay: number;
  bx: number;
  by: number;
  width: number;
}
export interface CircleShape {
  k: 'circle';
  x: number;
  y: number;
  r: number;
}
/** Sector at (x, y) facing unit (dx, dy): half angle in degrees (data `angle` is the full angle), radius `range`. */
export interface ConeShape {
  k: 'cone';
  x: number;
  y: number;
  dx: number;
  dy: number;
  halfAngleDeg: number;
  range: number;
}
export type Shape = LineShape | CircleShape | ConeShape;

export interface CastTelegraph {
  shapes: Shape[];
  /** Sim ticks from the cast tick to the tick the shape resolves / the projectile spawns (dashes: the dash ends). */
  ticks: number;
  /** Circle centred on the caster while shown (self AoEs). */
  follow?: boolean;
  /** Projected (dash end point): walls or hooks can shorten it. */
  approx?: boolean;
  /** What takes over at the end of `ticks`: the line projectile, or a sim `zone` event (delayed/persistent AoE).
   *  Absent: the shape resolves instantly at the end (render flashes it). */
  next?: 'projectile' | 'zone';
}

/**
 * Zones whose hook owns the hits on a line the data does not declare (`line` missing in the JSON): the hook geometry
 * equals the generic line zone of that kind (radius = half length, width = thickness).
 * wren_w (wren.ts wren_w_ash_carpet): 900 x 200 strip from Wren's cast position along the cast direction = forward.
 * lysa_e (lysa.ts lysa_e_tripwire): wire across the cast direction centred on the zone centre, +-radius, width = perpendicular.
 */
const HOOK_LINE: Record<string, 'forward' | 'perpendicular'> = { wren_w: 'forward', lysa_e: 'perpendicular' };

/** The ability as its hitbox behaves (hook-defined line zones resolved to their line). */
export function hitboxAbility(ab: AbilityData): AbilityData {
  const line = ab.line ?? HOOK_LINE[ab.id];
  return line && line !== ab.line ? { ...ab, line } : ab;
}

/** Does the sim emit a `zone` event when this cast's wind-up ends? (execute(): delay > 0 or zone duration > 0) */
export function emitsZone(ab: AbilityData, rank: number): boolean {
  if (ab.type === 'skillshot_circle' || ab.type === 'zone' || ab.type === 'summon') {
    return sec(ab.delay ?? 0) > 0 || (ab.type === 'zone' && sec(rankVal(ab.duration, rank)) > 0);
  }
  return ab.type === 'self' && sec(ab.delay ?? 0) > 0;
}

/** Ranked value for rank (1-based), same as sim rv(). */
export const rankVal = (v: Ranked | undefined, rank: number): number =>
  v === undefined ? 0 : typeof v === 'number' ? v : (v[Math.max(0, Math.min(v.length - 1, rank - 1))] ?? 0);

/**
 * Wind-up ticks: castTime, plus the delay for blinks, cones and line skillshots (sim: sec() of the sum).
 * timeMult: passive cast-speed hooks (Aurel's balance wheel 0.7); the client does not know it and uses 1.
 */
export function windupTicks(ab: AbilityData, timeMult = 1): number {
  const delayed = ab.type === 'blink' || ab.type === 'cone' || ab.type === 'skillshot_line';
  return sec((ab.castTime + (delayed ? (ab.delay ?? 0) : 0)) * timeMult);
}

/** Cast direction caster -> cursor; caster facing if the cursor is on the caster. */
export function castDir(ox: number, oy: number, cx: number, cy: number, fx: number, fy: number): [number, number] {
  const dx = cx - ox;
  const dy = cy - oy;
  const l = Math.sqrt(dx * dx + dy * dy);
  return l > 0 ? [dx / l, dy / l] : [fx, fy];
}

/** Line zone segment (ability.line), same as sim lineSegment(). */
export function lineZone(ab: AbilityData, ox: number, oy: number, cx: number, cy: number, dx: number, dy: number): LineShape {
  const r = ab.radius ?? 0;
  const w = ab.width ?? 0;
  if (ab.line === 'forward') return { k: 'line', ax: ox, ay: oy, bx: ox + dx * 2 * r, by: oy + dy * 2 * r, width: w };
  return { k: 'line', ax: cx + dy * r, ay: cy - dx * r, bx: cx - dy * r, by: cy + dx * r, width: w };
}

/**
 * Telegraph for a cast started by a caster at (ox, oy) facing (fx, fy) aiming at cursor (cx, cy). null = nothing to
 * draw on the ground (targeted abilities, buffs without radius, summons without radius, blinks without radius).
 */
export function castTelegraph(ab: AbilityData, rank: number, ox: number, oy: number, cx: number, cy: number, fx: number, fy: number, timeMult = 1): CastTelegraph | null {
  ab = hitboxAbility(ab);
  const [dx, dy] = castDir(ox, oy, cx, cy, fx, fy);
  const range = rankVal(ab.range, rank);
  const cursorDist = Math.sqrt((cx - ox) * (cx - ox) + (cy - oy) * (cy - oy));
  const ticks = windupTicks(ab, timeMult);
  const r = ab.radius ?? 0;
  switch (ab.type) {
    case 'skillshot_line':
      return { shapes: [{ k: 'line', ax: ox, ay: oy, bx: ox + dx * range, by: oy + dy * range, width: ab.width ?? 60 }], ticks, next: 'projectile' };
    case 'skillshot_circle':
    case 'zone':
    case 'summon': {
      const d = Math.min(range, cursorDist);
      const x = ox + dx * d;
      const y = oy + dy * d;
      const next = emitsZone(ab, rank) ? ('zone' as const) : undefined;
      if (ab.line) return { shapes: [lineZone(ab, ox, oy, x, y, dx, dy)], ticks, next };
      return r > 0 ? { shapes: [{ k: 'circle', x, y, r }], ticks, next } : null;
    }
    case 'cone':
      return { shapes: [{ k: 'cone', x: ox, y: oy, dx, dy, halfAngleDeg: (ab.angle ?? 60) / 2, range }], ticks };
    case 'self':
      return r > 0 ? { shapes: [{ k: 'circle', x: ox, y: oy, r }], ticks, follow: true, next: emitsZone(ab, rank) ? 'zone' : undefined } : null;
    case 'blink': {
      if (r <= 0) return null;
      const d = Math.min(range, cursorDist);
      return { shapes: [{ k: 'circle', x: ox + dx * d, y: oy + dy * d, r }], ticks, approx: true };
    }
    case 'dash': {
      const w = ab.width ?? 0;
      if (r <= 0 && w <= 0) return null;
      const dist = ab.flags?.includes('ground_target') ? Math.min(ab.distance ?? range, cursorDist) : (ab.distance ?? range);
      const ex = ox + dx * dist;
      const ey = oy + dy * dist;
      const shapes: Shape[] = [];
      // width on a dash: path hitbox (stops at the first enemy it touches, e.g. Oleth E)
      if (w > 0) shapes.push({ k: 'line', ax: ox, ay: oy, bx: ex, by: ey, width: w });
      if (r > 0) shapes.push({ k: 'circle', x: ex, y: ey, r });
      // sim: first dash step on the wind-up end tick, resolve on the step that covers the distance
      const steps = Math.ceil(dist / ((ab.speed ?? 1200) / 30) - 1e-9);
      return { shapes, ticks: ticks + Math.max(0, steps - 1), approx: true };
    }
    case 'targeted':
      return null;
  }
}

/** In-flight strip of a line projectile: from its position to the end of its range. */
export function projectileStrip(x: number, y: number, dx: number, dy: number, left: number, width: number): LineShape {
  return { k: 'line', ax: x, ay: y, bx: x + dx * left, by: y + dy * left, width };
}

/** Fill progress 0..1 of a zone event at (fractional) sim tick t. */
export function zoneProgress(start: number, at: number, t: number): number {
  return Math.min(1, Math.max(0, (t - start) / Math.max(1, at - start)));
}
