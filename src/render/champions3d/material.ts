// Gouache material for the 3D champions (style C "Gouache-Dämmerung"). Same idea and constants as the style lab's
// PAINT shader (src/stylelab/scene.ts makeMat): Lambert lighting is measured as a "tone", then quantised into three
// hard value steps; shadows shift toward cool violet, a warm band sits on the terminator and a restrained fresnel rim
// lights the silhouette. Extras for figures: per-vertex glow (lanterns, prisms, embers) and a small stepped spec
// highlight on metal, both via one vec2 attribute `aFx` (x = glow, y = metal) so every champion uses ONE program.
// The outline is an inverted hull pushed out in screen space (constant pixel width), coloured with the darkened
// local colour baked into the hull's vertex colours.
import * as THREE from 'three';

/** Lighting the gouache shading is calibrated against. Defaults = style-lab variant C. */
export interface GouacheLight {
  sunColor: string;
  sunIntensity: number;
  /** direction TOWARD the sun (world space, need not be normalised) */
  sunDir: [number, number, number];
  hemiSky: string;
  hemiIntensity: number;
  shadowTint: string;
  rim: string;
  spec: string;
}

export const VARIANT_C_LIGHT: GouacheLight = {
  sunColor: '#ffb877',
  sunIntensity: 2.9,
  sunDir: [0.74, 0.42, -0.4],
  hemiSky: '#7a68b0',
  hemiIntensity: 1.05,
  shadowTint: '#3a2d5a',
  rim: '#ffbf72',
  spec: '#fff4dc',
};

const lumLin = (hex: string): number => {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};

/** Uniform objects shared by every champion material (update once → all instances follow). */
export interface GouacheUniforms {
  uShadow: { value: THREE.Color };
  uRim: { value: THREE.Color };
  uSun: { value: THREE.Color };
  uSpecC: { value: THREE.Color };
  uToneRef: { value: number };
  /** figures sit a little brighter than terrain so they read on the dark ground */
  uLift: { value: number };
}

export function makeGouacheUniforms(l: GouacheLight = VARIANT_C_LIGHT): GouacheUniforms {
  const u: GouacheUniforms = {
    uShadow: { value: new THREE.Color() },
    uRim: { value: new THREE.Color() },
    uSun: { value: new THREE.Color() },
    uSpecC: { value: new THREE.Color() },
    uToneRef: { value: 1 },
    uLift: { value: 1.06 },
  };
  setGouacheLight(u, l);
  return u;
}

export function setGouacheLight(u: GouacheUniforms, l: GouacheLight): void {
  const sun = new THREE.Vector3(...l.sunDir).normalize();
  u.uShadow.value.set(l.shadowTint);
  u.uRim.value.set(l.rim);
  u.uSun.value.set(l.sunColor);
  u.uSpecC.value.set(l.spec);
  // tone of a fully lit, upward-facing surface = 1.0 (lambert: (sun * N.L + hemi) / PI), same as the lab
  u.uToneRef.value = (lumLin(l.sunColor) * l.sunIntensity * sun.y + lumLin(l.hemiSky) * l.hemiIntensity) / Math.PI;
}

const VERT_DECL = `
attribute vec2 aFx;
varying vec2 vFx;
`;
const FRAG_DECL = `
uniform vec3 uShadow; uniform vec3 uRim; uniform vec3 uSun; uniform vec3 uSpecC;
uniform float uToneRef; uniform float uLift; uniform vec4 uTint;
varying vec2 vFx;
`;
// identical value logic to the lab's PAINT block, plus glow / metal spec / per-instance tint
const PAINT = `
  float labBase = max(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.02);
  float tone = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722)) / labBase / uToneRef;
  vec3 dc = diffuseColor.rgb * uLift;
  vec3 shadowC = mix(dc * 0.38, uShadow, 0.38);
  vec3 midC = mix(dc * 0.66, uShadow, 0.14);
  vec3 litC = dc * mix(vec3(1.0), uSun, 0.35) * 1.12;
  vec3 labCol = mix(shadowC, midC, smoothstep(0.26, 0.31, tone));
  labCol = mix(labCol, litC, smoothstep(0.55, 0.6, tone));
  labCol += uRim * 0.12 * (1.0 - clamp(abs(tone - 0.575) / 0.07, 0.0, 1.0));
  vec3 vdir = normalize(vViewPosition);
  float fres = pow(1.0 - clamp(abs(dot(vdir, normal)), 0.0, 1.0), 3.0);
  labCol += uRim * fres * 0.5 * smoothstep(0.2, 0.5, tone);
  #if NUM_DIR_LIGHTS > 0
    // metal: one hard spec stroke where the half vector lines up (only on lit side)
    vec3 hv = normalize(directionalLights[0].direction + vdir);
    float sp = step(0.93, dot(normal, hv)) * vFx.y * smoothstep(0.3, 0.45, tone);
    labCol = mix(labCol, uSpecC, sp * 0.85);
  #endif
  labCol += uRim * fres * 0.25 * vFx.y;
  // glow: self-lit, ignores the light steps
  labCol = mix(labCol, dc * 1.25 + 0.08, clamp(vFx.x, 0.0, 1.0));
  labCol = mix(labCol, uTint.rgb, uTint.a);
  gl_FragColor = vec4(labCol, diffuseColor.a);
`;

/** Creates a champion body material. `shared` uniforms are referenced, uTint is per material (hit flash etc.). */
export function makeGouacheMaterial(shared: GouacheUniforms): THREE.MeshLambertMaterial & { userData: { tint: { value: THREE.Vector4 } } } {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  const tint = { value: new THREE.Vector4(1, 1, 1, 0) };
  m.userData.tint = tint;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, { uTint: tint });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_DECL)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vFx = aFx;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_DECL).replace('#include <opaque_fragment>', PAINT);
  };
  m.customProgramCacheKey = () => 'champ3d-gouache';
  return m as THREE.MeshLambertMaterial & { userData: { tint: { value: THREE.Vector4 } } };
}

/** Outline uniforms: pixel width and the drawing-buffer size (set per render target / viewport). */
export interface OutlineUniforms {
  uOutlinePx: { value: number };
  uViewport: { value: THREE.Vector2 };
}
export function makeOutlineUniforms(px = 1.6): OutlineUniforms {
  return { uOutlinePx: { value: px }, uViewport: { value: new THREE.Vector2(1920, 1080) } };
}

/** Inverted hull: back faces only, pushed outward along the smoothed normal by a constant number of pixels. */
export function makeOutlineMaterial(u: OutlineUniforms): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uOutlinePx; uniform vec2 uViewport;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
  #ifdef USE_SKINNING
    vec3 olN = transformedNormal;
  #else
    vec3 olN = normalMatrix * normal;
  #endif
  vec4 olClip = projectionMatrix * vec4(olN, 0.0);
  vec2 olDir = olClip.xy;
  float olLen = length(olDir);
  if (olLen > 1e-5) gl_Position.xy += (olDir / olLen) * uOutlinePx * 2.0 / uViewport * gl_Position.w;
  gl_Position.z += 0.00002 * gl_Position.w;`,
      );
  };
  m.customProgramCacheKey = () => 'champ3d-outline';
  return m;
}
