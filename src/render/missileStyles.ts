// Agent F: missile shape language per ability motif (src/render/abilityMotifs.json motifs). Pure data for fx.ts:
// the same instanced blob is scaled along / across the flight direction and spun or tumbled so an arrow, a lightning
// bolt, a water wave, a thrown keg, a spinning blade and a web disc read as different objects, not as one coloured
// orb with a different hue.

export interface MissileShape {
  /** overall size multiplier */
  size: number;
  /** length along the flight direction (relative to the width) */
  length: number;
  /** vertical thickness */
  thick: number;
  /** sideways width (perpendicular to the flight, on the ground plane) */
  wide: number;
  /** flight height above the ground (world units) */
  height: number;
  /** halo scale relative to the core */
  halo: number;
  /** roll around the flight axis (rad/s): blades, bolts, discs */
  spin: number;
  /** end-over-end tumble (rad/s): thrown kegs, bells, hooks */
  tumble: number;
}

const S = (size: number, length: number, thick: number, wide: number, height: number, halo: number, spin = 0, tumble = 0): MissileShape => ({ size, length, thick, wide, height, halo, spin, tumble });

const BY_MOTIF: Record<string, MissileShape> = {
  // shafts: long, thin, low
  arrow: S(0.8, 4.4, 0.28, 0.28, 95, 1.3),
  bow: S(0.8, 4.4, 0.28, 0.28, 95, 1.3),
  // lightning: long, crackling roll
  bolt: S(1.0, 3.2, 0.42, 0.42, 90, 2.3, 26),
  spark: S(0.9, 2.4, 0.5, 0.5, 90, 2.4, 20),
  // fire / light: fat glowing orbs with a big halo
  flame: S(1.3, 1.5, 1, 1, 80, 2.5),
  sun: S(1.3, 1.3, 1, 1, 85, 2.8),
  lamp: S(1.2, 1.3, 1, 1, 85, 2.6),
  // water: wide flat crests close to the ground
  wave: S(1.0, 1.1, 0.35, 2.8, 28, 1.6),
  drop: S(1.0, 1.4, 0.5, 1.6, 40, 1.7),
  // hooks, chains, anchors: compact, tumbling end over end
  hook: S(1.1, 2.0, 0.8, 0.8, 70, 1.4, 0, 9),
  chain: S(1.0, 2.6, 0.5, 0.5, 70, 1.3, 0, 7),
  // blades: flat, spinning
  dagger: S(0.9, 2.6, 0.22, 0.9, 85, 1.3, 18),
  sword: S(1.0, 3.0, 0.22, 1.0, 85, 1.3, 14),
  axe: S(1.1, 2.2, 0.3, 1.4, 80, 1.3, 11),
  claw: S(0.9, 2.2, 0.3, 1.2, 70, 1.4, 16),
  fang: S(0.9, 2.2, 0.3, 1.0, 70, 1.4, 16),
  // thrown objects: round, tumbling, lobbed high
  bomb: S(1.5, 1.1, 1, 1, 115, 1.5, 0, 10),
  bell: S(1.4, 1.1, 1.1, 1, 110, 1.6, 0, 8),
  horn: S(1.2, 1.4, 0.9, 0.9, 105, 1.5, 0, 8),
  potion: S(1.2, 1.1, 1, 1, 115, 1.7, 0, 12),
  // webs, rings, whorls: flat discs that spin
  web: S(1.2, 0.5, 0.35, 2.8, 60, 1.5, 6),
  spiral: S(1.2, 0.6, 0.4, 2.6, 65, 1.8, 9),
  ring: S(1.2, 0.5, 0.4, 2.6, 65, 1.8, 5),
  gear: S(1.1, 0.8, 0.8, 2.0, 70, 1.6, 12),
  hourglass: S(1.0, 1.4, 1.2, 0.8, 80, 1.8, 0, 5),
  // shadow / moon / wings: wide soft crescents
  moon: S(1.1, 1.4, 0.5, 2.2, 75, 2.8),
  cloak: S(1.1, 1.4, 0.6, 2.2, 75, 2.6),
  wing: S(1.0, 1.6, 0.4, 2.6, 85, 2.2),
  // crystal / glass / eye: faceted, slow roll
  glass: S(0.9, 1.9, 0.9, 0.9, 80, 2.0, 10),
  gem: S(0.9, 1.6, 0.9, 0.9, 80, 2.2, 10),
  snow: S(1.0, 1.4, 1, 1, 80, 2.4, 6),
  eye: S(1.0, 1.4, 0.9, 1.2, 85, 2.6),
  // light staff / banner / shield bolts: upright slabs of light
  staff: S(1.0, 2.6, 1.3, 0.5, 90, 2.4, 8),
  banner: S(1.1, 1.2, 1.8, 0.5, 80, 2.0),
  shield: S(1.2, 0.8, 1.6, 1.6, 70, 1.8),
  // plants
  root: S(1.0, 2.8, 0.5, 0.5, 45, 1.4, 0, 4),
  leaf: S(0.9, 1.8, 0.3, 1.2, 70, 1.5, 7, 3),
};
const DEFAULT = S(1.1, 2.8, 0.75, 0.75, 75, 1.9);
const HOMING = S(1.1, 2.0, 0.75, 0.75, 110, 1.9);

/** Shape for an ability missile of `motif` (null / unknown: the old generic bolt). */
export function missileShape(motif: string | null | undefined, homing: boolean): MissileShape {
  const s = motif ? BY_MOTIF[motif] : undefined;
  if (!s) return homing ? HOMING : DEFAULT;
  return homing ? { ...s, length: Math.min(s.length, 2.2), height: Math.max(s.height, 100) } : s;
}

/** Motifs with a shape of their own (for tests). */
export const SHAPED_MOTIFS: readonly string[] = Object.keys(BY_MOTIF);
