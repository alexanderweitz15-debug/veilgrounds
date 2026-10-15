// Sim <-> render coordinate helpers. Sim: origin bottom-left, y up. Three: X = x, Z = -y, ground at Y = 0.
// Canvas textures (ground, fog, minimap) are y-down: ALWAYS use simToCanvas so nothing ends up mirrored.
import { Kind } from '../sim/types';

export const MAP_SIZE = 16000;

/** Sim point -> pixel on a square canvas of `px` pixels covering the whole map. */
export function simToCanvas(x: number, y: number, px: number): [number, number] {
  return [(x / MAP_SIZE) * px, ((MAP_SIZE - y) / MAP_SIZE) * px];
}

/** Pixel on a square canvas of `px` pixels -> sim point. */
export function canvasToSim(cx: number, cy: number, px: number): [number, number] {
  return [(cx / px) * MAP_SIZE, MAP_SIZE - (cy / px) * MAP_SIZE];
}

/** Client-side vision radii for drawing fog (the sim filters what we receive; this is only the dark overlay). */
export function visionRadius(kind: number): number {
  switch (kind) {
    case Kind.Champion:
      return 1200;
    case Kind.Tower:
      return 1350;
    case Kind.Inhibitor:
    case Kind.Nexus:
      return 1000;
    case Kind.Dummy:
    case Kind.Projectile:
      return 0;
    default:
      return kind >= Kind.MinionMelee && kind <= Kind.MinionSuper ? 1100 : 800;
  }
}

/** Small deterministic PRNG for placeholder scatter (same look every load). */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
