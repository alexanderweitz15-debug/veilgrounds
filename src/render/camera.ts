// LoL-like fixed-angle camera: looks north, fixed pitch, pans over the map, optional lock on the champion.
import * as THREE from 'three';
import { MAP_SIZE } from './coords';

export const PITCH = THREE.MathUtils.degToRad(56);
const FOV = 38;
const MIN_DIST = 2000;
// LoL: the default zoom is the maximum (no zooming out past it)
const MAX_DIST = 2750;

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  /** Focus point on the ground (sim coordinates). */
  tx = 8000;
  ty = 8000;
  dist = 2750;
  private readonly ray = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly v = new THREE.Vector3();
  private readonly ndc = new THREE.Vector2();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(FOV, aspect, 50, 12000);
    this.apply();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  focus(x: number, y: number): void {
    this.tx = x;
    this.ty = y;
    this.clamp();
  }

  pan(dx: number, dy: number): void {
    this.tx += dx;
    this.ty += dy;
    this.clamp();
  }

  zoom(delta: number): void {
    this.dist = THREE.MathUtils.clamp(this.dist + delta, MIN_DIST, MAX_DIST);
  }

  private clamp(): void {
    this.tx = THREE.MathUtils.clamp(this.tx, 600, MAP_SIZE - 600);
    this.ty = THREE.MathUtils.clamp(this.ty, 300, MAP_SIZE - 900);
  }

  apply(): void {
    const c = this.camera;
    c.position.set(this.tx, Math.sin(PITCH) * this.dist, -this.ty + Math.cos(PITCH) * this.dist);
    c.lookAt(this.tx, 0, -this.ty);
    c.updateMatrixWorld();
  }

  /** Ground point (sim coords) under normalized device coords, or null if the ray misses the ground. */
  groundAtNdc(nx: number, ny: number): { x: number; y: number } | null {
    this.ndc.set(nx, ny);
    this.ray.setFromCamera(this.ndc, this.camera);
    const hit = this.ray.ray.intersectPlane(this.plane, this.v);
    return hit ? { x: hit.x, y: -hit.z } : null;
  }

  /** Sim point at height h -> CSS pixel position within a viewport of w x h. */
  project(x: number, y: number, height: number, w: number, hgt: number): { sx: number; sy: number; behind: boolean } {
    this.v.set(x, height, -y).project(this.camera);
    return { sx: (this.v.x * 0.5 + 0.5) * w, sy: (-this.v.y * 0.5 + 0.5) * hgt, behind: this.v.z > 1 };
  }

  /** Ground footprint of the view (4 sim points, for the minimap frustum). */
  footprint(): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (const [nx, ny] of [[-1, 1], [1, 1], [1, -1], [-1, -1]] as const) {
      const p = this.groundAtNdc(nx, ny) ?? this.groundAtNdc(nx, ny * 0.6) ?? { x: this.tx, y: this.ty };
      out.push(p);
    }
    return out;
  }
}
