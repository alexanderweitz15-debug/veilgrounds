// Graphics presets and settings resolution. Pure (no three.js import): the settings panel in the main bundle uses it,
// three.js stays in the lazily loaded game chunk. The shadow filter patch lives in quality.ts.
import type { GraphicsPreset, Settings } from '../settings';

export interface QualityPreset {
  shadows: boolean;
  shadowMap: number;
  /** 5-tap instead of three's 17-tap PCF (each tap is a hardware 2x2 compare, so edges stay soft). */
  fastPcf: boolean;
  /** Max device pixel ratio (render scale). */
  pixelRatio: number;
  antialias: boolean;
  /** Particle emission multiplier. */
  particles: number;
  /** Detailed ground (4096 texture, detail shader, full border trees); fixed when the terrain is built. */
  terrainDetail: boolean;
}

export const PRESET_IDS: readonly GraphicsPreset[] = ['veryLow', 'low', 'medium', 'high', 'veryHigh'];

// veryLow = low at 0.75x resolution, veryHigh = high with a 4096 shadow map and 2x resolution.
export const QUALITY: Record<GraphicsPreset, QualityPreset> = {
  veryLow: { shadows: false, shadowMap: 1024, fastPcf: true, pixelRatio: 0.75, antialias: false, particles: 0.25, terrainDetail: false },
  low: { shadows: false, shadowMap: 1024, fastPcf: true, pixelRatio: 1, antialias: false, particles: 0.5, terrainDetail: false },
  medium: { shadows: true, shadowMap: 2048, fastPcf: true, pixelRatio: 1, antialias: true, particles: 1, terrainDetail: true },
  high: { shadows: true, shadowMap: 2048, fastPcf: false, pixelRatio: 1.5, antialias: true, particles: 1, terrainDetail: true },
  veryHigh: { shadows: true, shadowMap: 4096, fastPcf: false, pixelRatio: 2, antialias: true, particles: 1.25, terrainDetail: true },
};

export type GfxFields = Pick<Settings, 'gfxShadows' | 'gfxShadowMap' | 'gfxSoftShadows' | 'gfxPixelRatio' | 'gfxAntialias' | 'gfxParticles' | 'gfxTerrainDetail'>;

/** Preset -> the individual settings fields (what the panel shows and what 'custom' starts from). */
export function presetFields(p: GraphicsPreset): GfxFields {
  const q = QUALITY[p];
  return { gfxShadows: q.shadows, gfxShadowMap: q.shadowMap, gfxSoftShadows: !q.fastPcf, gfxPixelRatio: q.pixelRatio, gfxAntialias: q.antialias, gfxParticles: Math.round(q.particles * 100), gfxTerrainDetail: q.terrainDetail };
}

/** The individual fields as the panel shows them: the settings' own for 'custom', else the named preset's. */
export function currentFields(s: Pick<Settings, 'graphics'> & GfxFields): GfxFields {
  return s.graphics === 'custom' ? s : presetFields(s.graphics);
}

const num = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** The settings as one preset: the named preset, or the individual fields for 'custom' (bad values are clamped). */
export function resolveQuality(s: Pick<Settings, 'graphics'> & Partial<GfxFields>): QualityPreset {
  if (s.graphics !== 'custom') return QUALITY[s.graphics] ?? QUALITY.medium;
  const m = QUALITY.medium;
  const map = num(s.gfxShadowMap, 1024, 4096, m.shadowMap);
  return {
    shadows: s.gfxShadows ?? m.shadows,
    shadowMap: [1024, 2048, 4096].reduce((a, b) => (Math.abs(b - map) < Math.abs(a - map) ? b : a)),
    fastPcf: !(s.gfxSoftShadows ?? !m.fastPcf),
    pixelRatio: num(s.gfxPixelRatio, 0.5, 2, m.pixelRatio),
    antialias: s.gfxAntialias ?? m.antialias,
    particles: num(s.gfxParticles, 0, 150, m.particles * 100) / 100,
    terrainDetail: s.gfxTerrainDetail ?? m.terrainDetail,
  };
}

/** Name of the preset whose fields equal `f`, else 'custom' (setting a toggle back to a preset's values re-selects it). */
export function matchPreset(f: GfxFields): GraphicsPreset | 'custom' {
  return PRESET_IDS.find((p) => { const g = presetFields(p); return (Object.keys(g) as (keyof GfxFields)[]).every((k) => g[k] === f[k]); }) ?? 'custom';
}

/** Renderer pixel ratio: device ratio capped by the preset, times the render scale slider (percent). */
export function effectivePixelRatio(dpr: number, q: QualityPreset, renderScalePct: number): number {
  return Math.max(0.25, (Math.min(dpr, q.pixelRatio) * num(renderScalePct, 50, 100, 100)) / 100);
}
