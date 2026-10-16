// Utility-model data access (src/data/bots/values.json): gold equivalents, horizons, weights, rank curves and style
// factors. No utility number lives in code; this module only types and interpolates the JSON.

import valuesJson from '../../data/bots/values.json';
import { PROFILES } from '../profiles';
import type { BotParams, PlaystyleAxis } from '../contract';

export const VALUES = valuesJson;
export type Values = typeof valuesJson;

/** Rank curve: anchors by rank name (subset allowed), interpolated over the continuous skill. */
export type RankCurve = Partial<Record<string, number>>;

/** Value of a rank curve at a continuous skill (linear between the nearest given anchors, clamped at the ends). */
export function rankCurve(curve: RankCurve, skill: number): number {
  const pts = PROFILES.filter((p) => curve[p.rank] !== undefined).map((p) => [p.skill, curve[p.rank]!] as const);
  if (!pts.length) return 0;
  if (skill <= pts[0]![0]) return pts[0]![1];
  for (let i = 1; i < pts.length; i++) {
    const [s1, v1] = pts[i]!;
    if (skill <= s1) {
      const [s0, v0] = pts[i - 1]!;
      return s1 === s0 ? v1 : v0 + ((v1 - v0) * (skill - s0)) / (s1 - s0);
    }
  }
  return pts[pts.length - 1]![1];
}

interface StyleSpec {
  knob?: string;
  invert?: boolean;
  axis?: string;
  perStep?: number[];
  clamp?: number[];
}

/**
 * Style factor of a candidate (spec §5: farm axis x farm utility, roam axis x roam utility, aggression x trade ...,
 * 0.6 .. 1.6): an existing knob, or a linear axis mapping from values.json until the knob exists.
 */
export function styleFactor(id: string, p: BotParams): number {
  const s = (VALUES.style as Record<string, StyleSpec | string>)[id];
  if (!s || typeof s === 'string') return 1;
  const [lo, hi] = s.clamp ?? [0, 10];
  const clamp = (x: number): number => Math.max(lo!, Math.min(hi!, x));
  if (s.knob) {
    const k = (p.knobs as Record<string, number>)[s.knob];
    if (k === undefined) return 1;
    return clamp(s.invert ? 1 / Math.max(0.05, k) : k);
  }
  if (s.axis) {
    const a = p.playstyle[s.axis as PlaystyleAxis] ?? 0;
    const step = a < 0 ? s.perStep?.[0] ?? 0 : s.perStep?.[1] ?? s.perStep?.[0] ?? 0;
    return clamp(1 + a * step);
  }
  return 1;
}
