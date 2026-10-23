// Graphics quality presets ("Grafikqualität"). Measured at 1920x1080 on an Intel Iris Xe (Phase 6): the shadow pass
// was ~13 of 26 ms GPU per frame (~4 ms map render, ~9 ms 17-tap PCF lookups on the full-screen ground).
// Measured GPU ms/frame at 1080p after the change: high 18.5, medium 13.7, no shadows 8.9 (render scale 0.85
// brought nothing measurable there, so low keeps 1x and only drops shadows + MSAA).
// low: no shadows, no MSAA | medium: shadows with a 5-tap PCF, DPR capped at 1 | high: original 17-tap PCF, 1.5x DPR.
// Antialiasing and the PCF filter are fixed when the renderer is created (next match); the rest applies live.
import * as THREE from 'three';
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

type GfxFields = Pick<Settings, 'gfxShadows' | 'gfxShadowMap' | 'gfxSoftShadows' | 'gfxPixelRatio' | 'gfxAntialias' | 'gfxParticles' | 'gfxTerrainDetail'>;

/** Preset -> the individual settings fields (what the panel shows and what 'custom' starts from). */
export function presetFields(p: GraphicsPreset): GfxFields {
  const q = QUALITY[p];
  return { gfxShadows: q.shadows, gfxShadowMap: q.shadowMap, gfxSoftShadows: !q.fastPcf, gfxPixelRatio: q.pixelRatio, gfxAntialias: q.antialias, gfxParticles: Math.round(q.particles * 100), gfxTerrainDetail: q.terrainDetail };
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

const ORIGINAL_PCF = THREE.ShaderChunk.shadowmap_pars_fragment;
const PCF17 = /shadow = \(\s*texture2DCompare\( shadowMap, shadowCoord\.xy \+ vec2\( dx0, dy0 \)[\s\S]*?\) \* \( 1\.0 \/ 17\.0 \);/;
const FAST_PCF = ORIGINAL_PCF.replace(
  PCF17,
  `shadow = (
				texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy3 ), shadowCoord.z )
			) * ( 1.0 / 5.0 );`,
);

if (FAST_PCF === ORIGINAL_PCF) console.warn('quality: PCF patch did not apply (three.js chunk changed); medium uses the full 17-tap filter');

/** Select the PCF shader variant for programs compiled from now on (call before a new renderer compiles). */
export function setFastPcf(on: boolean): void {
  THREE.ShaderChunk.shadowmap_pars_fragment = on ? FAST_PCF : ORIGINAL_PCF;
}
