// GPU resource release for three.js subtrees. three.js never frees geometries, materials or textures on its own:
// a renderer.dispose() alone leaks them (every match and every main-menu backdrop builds a new World).
import * as THREE from 'three';

function disposeMaterial(mat: THREE.Material, seen: Set<object>): void {
  if (seen.has(mat)) return;
  seen.add(mat);
  const textures = (v: unknown): void => {
    if (v instanceof THREE.Texture && !seen.has(v)) {
      seen.add(v);
      v.dispose();
    }
  };
  for (const v of Object.values(mat)) textures(v);
  const uniforms = (mat as THREE.ShaderMaterial).uniforms;
  if (uniforms) for (const u of Object.values(uniforms)) textures(u?.value);
  mat.dispose();
}

/** Dispose every geometry, material (incl. custom depth materials), texture and instance buffer below `root`. */
export function disposeTree(root: THREE.Object3D): void {
  const seen = new Set<object>();
  root.traverse((o) => {
    const m = o as THREE.Mesh & Partial<Pick<THREE.InstancedMesh, 'isInstancedMesh'>>;
    if (m.geometry && !seen.has(m.geometry)) {
      seen.add(m.geometry);
      m.geometry.dispose();
    }
    const mats = m.material === undefined ? [] : Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) disposeMaterial(mat, seen);
    if (o.customDepthMaterial) disposeMaterial(o.customDepthMaterial, seen);
    if (o.customDistanceMaterial) disposeMaterial(o.customDistanceMaterial, seen);
    if (m.isInstancedMesh) (o as THREE.InstancedMesh).dispose();
  });
}
