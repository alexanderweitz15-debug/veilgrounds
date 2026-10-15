// Shared material helpers: two-tone toon shading, inverted-hull outlines and the fog-of-war shader patch.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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

/**
 * Darken fragments outside own-team vision. Works for plain and instanced meshes. All patched materials share
 * one shader source, so the program cache key stays valid.
 */
export function withFog<T extends THREE.Material>(m: T): T {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.fogTex = fogUniform;
    sh.vertexShader =
      'varying vec2 vFogUv;\n' +
      sh.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 fogWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fogWp = instanceMatrix * fogWp;
        #endif
        fogWp = modelMatrix * fogWp;
        vFogUv = vec2(fogWp.x / 16000.0, -fogWp.z / 16000.0);`,
      );
    sh.fragmentShader =
      'uniform sampler2D fogTex;\nvarying vec2 vFogUv;\n' +
      sh.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        float fogA = texture2D(fogTex, vFogUv).a;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(0.36, 0.36, 0.46), fogA);`,
      );
  };
  return m;
}

const outlineMats = new Map<number, THREE.MeshBasicMaterial>();
/** Inverted hull outline material: back faces pushed out along smooth normals. */
function outlineMaterial(thickness: number): THREE.MeshBasicMaterial {
  let m = outlineMats.get(thickness);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: 0x15110e, side: THREE.BackSide });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `vec3 transformed = position + normal * ${thickness.toFixed(1)};`);
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
