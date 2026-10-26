// Shared material helpers: gouache world shading (style C), toon shading, inverted-hull outlines and the
// fog-of-war shader patch.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MAP_SIZE } from './coords';

/** Fog texture (alpha = fogged), shared by every fog-patched material. Set by FogOfWar. */
export const fogUniform: { value: THREE.Texture | null } = { value: null };

let gradient: THREE.DataTexture | null = null;
/** Two-tone ramp: hard light/shadow split, no PBR gloss. */
export function toonGradient(): THREE.DataTexture {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([120, 255]), 2, 1, THREE.RedFormat);
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
  }
  return gradient;
}

export function toon(params: THREE.MeshToonMaterialParameters): THREE.MeshToonMaterial {
  return withFog(new THREE.MeshToonMaterial({ gradientMap: toonGradient(), ...params }));
}

// Fog of war look: fogged ground keeps its painted shapes but sinks into a desaturated violet dusk; the edge is
// feathered by the fog texture (fog.ts) and broken up with a little world-space noise so it reads painterly.
const FOW_HEAD = `uniform sampler2D fogTex;
varying vec2 vFogUv;
float fowHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fowNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fowHash(i), fowHash(i + vec2(1.0, 0.0)), f.x), mix(fowHash(i + vec2(0.0, 1.0)), fowHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;
const FOW_APPLY = `
        vec2 fowJit = vec2(fowNoise(vFogUv * 90.0), fowNoise(vFogUv * 90.0 + 17.3)) - 0.5;
        float fogA = texture2D(fogTex, vFogUv + fowJit * 0.006).a;
        fogA = smoothstep(0.08, 0.92, fogA);
        float fowL = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
        vec3 fowC = mix(vec3(fowL), gl_FragColor.rgb, 0.35) * vec3(0.46, 0.43, 0.56) + vec3(0.03, 0.022, 0.055);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fowC, fogA * 0.92);`;
const FOW_VERT = `#include <project_vertex>
        vec4 fogWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fogWp = instanceMatrix * fogWp;
        #endif
        fogWp = modelMatrix * fogWp;
        vFogUv = vec2(fogWp.x / ${MAP_SIZE.toFixed(1)}, -fogWp.z / ${MAP_SIZE.toFixed(1)});`;

function patchFog(sh: THREE.WebGLProgramParametersWithUniforms): void {
  sh.uniforms.fogTex = fogUniform;
  sh.vertexShader = `varying vec2 vFogUv;
` + sh.vertexShader.replace('#include <project_vertex>', FOW_VERT);
  sh.fragmentShader = FOW_HEAD + sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>' + FOW_APPLY);
}

/**
 * Sink fragments outside own-team vision into the violet dusk. Works for plain and instanced meshes. All patched
 * materials share one shader source, so the program cache key stays valid.
 */
export function withFog<T extends THREE.Material>(m: T): T {
  m.onBeforeCompile = patchFog;
  return m;
}

// ------------------------------------------------------------------------------------------------ gouache world
/** World lighting (style C "Gouache-Dämmerung"): low warm evening sun from behind-right, violet sky fill. */
export const WORLD_LIGHT = {
  sun: '#ffb877',
  sunIntensity: 2.9,
  /** direction toward the sun (three.js axes: x east, y up, -z north) */
  sunDir: new THREE.Vector3(0.66, 0.5, -0.36).normalize(),
  sky: '#7a68b0',
  ground: '#2c2a22',
  hemiIntensity: 1.05,
  /** distance haze / background */
  haze: '#221c2c',
};
const lumLin = (hex: string): number => {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};
const GOUACHE_UNI = {
  uShadowTint: { value: new THREE.Color('#3a2d5a') },
  uRim: { value: new THREE.Color('#ffbf72') },
  uSunTint: { value: new THREE.Color(WORLD_LIGHT.sun) },
  // tone of fully lit flat ground = 1.0 (lambert: (sun * N.L + hemi sky) / PI)
  uToneRef: { value: (lumLin(WORLD_LIGHT.sun) * WORLD_LIGHT.sunIntensity * WORLD_LIGHT.sunDir.y + lumLin(WORLD_LIGHT.sky) * WORLD_LIGHT.hemiIntensity) / Math.PI },
  uDetail: { value: null as THREE.Texture | null },
};
/** World-space brush-stroke detail texture (terrain.ts) blended into gouache materials created with detail. */
export const detailUniform = GOUACHE_UNI.uDetail;

const GOUACHE_HEAD = `uniform vec3 uShadowTint; uniform vec3 uRim; uniform vec3 uSunTint; uniform float uToneRef;
uniform sampler2D uDetail; varying vec2 vWorldXZ;
`;
// three hard value steps, shadows shift to cool violet, warm terminator band, fresnel rim on lit forms
const GOUACHE_PAINT = `
  float gBase = max(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.02);
  float tone = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722)) / gBase / uToneRef;
  vec3 dc = diffuseColor.rgb;
  vec3 shadowC = mix(dc * 0.42, uShadowTint, 0.34);
  vec3 midC = mix(dc * 0.7, uShadowTint, 0.12);
  vec3 litC = dc * mix(vec3(1.0), uSunTint, 0.3) * 1.08;
  vec3 gCol = mix(shadowC, midC, smoothstep(0.24, 0.32, tone));
  gCol = mix(gCol, litC, smoothstep(0.52, 0.6, tone));
  gCol += uRim * 0.1 * (1.0 - clamp(abs(tone - 0.56) / 0.07, 0.0, 1.0));
  float fres = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 3.0);
  gCol += uRim * fres * GOUACHE_RIM * smoothstep(0.2, 0.5, tone);
  gl_FragColor = vec4(gCol, diffuseColor.a);
`;
const DETAIL = `#include <map_fragment>
  #ifdef GOUACHE_DETAIL
    vec3 gDet = texture2D(uDetail, vWorldXZ / 900.0).rgb * 0.6 + texture2D(uDetail, vWorldXZ / 2600.0 + 0.37).rgb * 0.4;
    diffuseColor.rgb *= mix(vec3(1.0), gDet * 2.0, 0.55);
  #endif`;

/**
 * Painted world material (Lambert lighting re-graded into gouache value steps) with the fog-of-war patch.
 * `detail` multiplies the world-space brush texture into the albedo (ground); `rim` scales the fresnel rim light.
 */
export function gouache(params: THREE.MeshLambertMaterialParameters, o: { detail?: boolean; rim?: number } = {}): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial(params);
  const rim = (o.rim ?? 0.45).toFixed(3);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, GOUACHE_UNI);
    sh.vertexShader =
      `varying vec2 vWorldXZ;
` +
      sh.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 gWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          gWp = instanceMatrix * gWp;
        #endif
        gWp = modelMatrix * gWp;
        vWorldXZ = gWp.xz;`,
      );
    if (o.detail) sh.fragmentShader = `#define GOUACHE_DETAIL
` + sh.fragmentShader;
    sh.fragmentShader = GOUACHE_HEAD + sh.fragmentShader.replace('#include <map_fragment>', DETAIL).replace('#include <opaque_fragment>', GOUACHE_PAINT.replace('GOUACHE_RIM', rim));
    patchFog(sh);
  };
  m.customProgramCacheKey = () => `gouache-${o.detail ? 1 : 0}-${rim}`;
  return m;
}

/**
 * Painted sprites in the gouache world: the same light grade as the world (warm sun tint when lit, cool violet
 * when in the shadow of a tower/tree/wall), so billboards stop looking pasted on. The sprite counts as flat ground
 * (normal up, no rim) and samples the shadow map once at its feet, nudged toward the sun so its own cast shadow
 * does not darken it. Composes with later onBeforeCompile patches (UV rects, feet depth).
 */
export function gouacheSprite(params: THREE.MeshLambertMaterialParameters): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial(params);
  const sun = WORLD_LIGHT.sunDir;
  const nudge = `vec3(${(sun.x * 70).toFixed(2)}, 18.0, ${(sun.z * 70).toFixed(2)})`;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, GOUACHE_UNI);
    sh.vertexShader = sh.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      #if defined( USE_SHADOWMAP )
        vec4 gFoot = vec4(0.0, 0.0, 0.0, 1.0);
        #ifdef USE_INSTANCING
          gFoot = instanceMatrix * gFoot;
        #endif
        worldPosition = vec4((modelMatrix * gFoot).xyz + ${nudge}, 1.0);
      #endif`,
    );
    sh.fragmentShader = GOUACHE_HEAD.replace('varying vec2 vWorldXZ;', '') +
      sh.fragmentShader
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);')
        .replace('#include <opaque_fragment>', GOUACHE_PAINT.replace('GOUACHE_RIM', '0.0'));
  };
  m.customProgramCacheKey = () => 'gouache-sprite';
  return m;
}

const outlineMats = new Map<number, THREE.MeshBasicMaterial>();
/** Inverted hull outline material: back faces pushed out along smooth normals. */
export function outlineMaterial(thickness: number): THREE.MeshBasicMaterial {
  let m = outlineMats.get(thickness);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: 0x1c1622, side: THREE.BackSide });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `vec3 transformed = position + normal * ${thickness.toFixed(3)};`);
    };
    m.customProgramCacheKey = () => 'outline' + thickness;
    outlineMats.set(thickness, m);
  }
  return m;
}

/** Thick dark outline mesh for a (flat shaded) geometry. Placed as a sibling with the same transform. */
export function outlineMesh(geo: THREE.BufferGeometry, thickness = 6): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.getAttribute('position').clone());
  const merged = mergeVertices(g, 0.5);
  merged.computeVertexNormals();
  return new THREE.Mesh(merged, outlineMaterial(thickness));
}

/** Add a constant vertex color attribute so parts can be merged into one draw call. */
export function paint(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  g.computeVertexNormals(); // non-indexed: per-face normals = flat low-poly look
  return g;
}
