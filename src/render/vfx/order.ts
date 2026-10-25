// A4 VFX: draw-order rule of the ground layer ("readability before spectacle").
// Transparent objects are sorted by renderOrder first. Particles (and all own pulses, columns, ground objects)
// do not write depth, so whatever is drawn LATER always shows on top of them, wherever it lies in 3D. Therefore:
//   enemy telegraphs (fill + rim) are drawn after every other effect, so no own (or ally, or neutral) effect can
//   cover an enemy skillshot / ground area. Pings and the screen vignette stay above.
// Values are the single source for src/render/fx.ts, particles and groundObjects (tests/vfxReadability.test.ts).
export const RENDER_ORDER = {
  /** Unit rings, terrain decals. */
  decal: 1,
  /** Own / ally / neutral telegraph fill and rim, cast pulses, range circles, ground objects. */
  fill: 2,
  rim: 3,
  /** Light columns (level-up, recall). */
  column: 4,
  /** GPU particles: alpha-blended first, additive glow above. */
  vfxNormal: 5,
  vfxAdditive: 6,
  /** Enemy telegraphs: above everything that is not UI. */
  enemyFill: 8,
  enemyRim: 9,
  ping: 10,
  screen: 100,
} as const;

/** renderOrder of a telegraph part: enemy ones sit above all effects, own ones below the particles. */
export function telegraphOrder(enemy: boolean, part: 'fill' | 'rim'): number {
  return enemy ? (part === 'fill' ? RENDER_ORDER.enemyFill : RENDER_ORDER.enemyRim) : part === 'fill' ? RENDER_ORDER.fill : RENDER_ORDER.rim;
}

/** Every order an own / neutral effect may use (all strictly below the enemy telegraph orders). */
export const NON_ENEMY_ORDERS: readonly number[] = [RENDER_ORDER.decal, RENDER_ORDER.fill, RENDER_ORDER.rim, RENDER_ORDER.column, RENDER_ORDER.vfxNormal, RENDER_ORDER.vfxAdditive];

/** The rule itself: true when `order` of a non-enemy effect can never cover an enemy telegraph. */
export const coversEnemyTelegraph = (order: number): boolean => order >= RENDER_ORDER.enemyFill;
