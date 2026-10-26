// Graphics quality presets ("Grafikqualität"). Measured at 1920x1080 on an Intel Iris Xe (Phase 6): the shadow pass
// was ~13 of 26 ms GPU per frame (~4 ms map render, ~9 ms 17-tap PCF lookups on the full-screen ground).
// Measured GPU ms/frame at 1080p after the change: high 18.5, medium 13.7, no shadows 8.9 (render scale 0.85
// brought nothing measurable there, so low keeps 1x and only drops shadows + MSAA).
// low: no shadows, no MSAA | medium: shadows with a 5-tap PCF, DPR capped at 1 | high: original 17-tap PCF, 1.5x DPR.
// Antialiasing and the PCF filter are fixed when the renderer is created (next match); the rest applies live.
import * as THREE from 'three';
export * from './gfxPreset';

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
