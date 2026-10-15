// Three.js scene root: renderer, morning sun with a camera-following shadow frustum, and all render layers.
import { GroundObjects } from './groundObjects';
import { PingMarkers } from './pings';
import * as THREE from 'three';
import type { MapData } from '../sim/map';
import type { SnapEntity } from '../sim/snapshot';
import { Kind, type SimEvent } from '../sim/types';
import type { ClientState } from '../game/state';
import { CameraRig, PITCH } from './camera';
import { buildTerrain, type Terrain } from './terrain';
import { Structures } from './structures';
import { Units, spriteKeyFor } from './units';
import { buildAtlas, SPRITE_SIZE } from './sprites';
import { Fx } from './fx';
import { FogOfWar } from './fog';
import { WardMarkers } from './wards';
import type { ChampionAtlas } from './champions';

/** Direction toward the sun: low morning light from the east-south-east. */
const SUN_DIR = new THREE.Vector3(0.62, 0.62, 0.48).normalize();
const SHADOW_HALF = 2600;

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly fog: FogOfWar;
  readonly fx = new Fx();
  readonly structures = new Structures();
  readonly ground = new GroundObjects();
  readonly wards = new WardMarkers();
  readonly pings = new PingMarkers();
  private readonly units: Units;
  private readonly terrain: Terrain;
  private readonly sun: THREE.DirectionalLight;
  private readonly up = new THREE.Vector3(0, Math.cos(PITCH), -Math.sin(PITCH));
  private w = 1;
  private h = 1;

  constructor(readonly canvas: HTMLCanvasElement, map: MapData) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color('#1a1d1c');
    this.rig = new CameraRig(1);

    this.scene.add(new THREE.HemisphereLight('#fff1dc', '#3e4a35', 1.1));
    this.sun = new THREE.DirectionalLight('#ffe2b8', 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -SHADOW_HALF;
    sc.right = sc.top = SHADOW_HALF;
    sc.near = 100;
    sc.far = 9000;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 6;
    this.scene.add(this.sun, this.sun.target);

    this.fog = new FogOfWar(map);
    this.terrain = buildTerrain(map, this.renderer.capabilities.getMaxAnisotropy());
    this.units = new Units(buildAtlas(), SUN_DIR);
    this.scene.add(this.terrain.group, this.structures.group, this.units.group, this.fx.group, this.ground.group, this.pings.group, this.wards.group);
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    this.rig.setAspect(w / h);
  }

  /** Switch champions (and Hark) to the animated sprite atlas. */
  setChampionAtlas(atlas: ChampionAtlas): void {
    this.units.setChampionAtlas(atlas);
  }

  /** Switch minions to the animated sprite atlas. */
  setMinionAtlas(atlas: ChampionAtlas): void {
    this.units.setMinionAtlas(atlas);
  }

  onEvent(ev: SimEvent, state: ClientState, now: number): void {
    this.fx.onEvent(ev, state, now);
    if (ev.e === 'cast') this.units.champs?.onCast(ev.src, now);
    else if (ev.e === 'death') this.units.onDeath(ev.eid, now);
    if (ev.e === 'damage') {
      const d = state.byId.get(ev.dst);
      if (d) this.units.flash(d.serial, now);
    } else if (ev.e === 'attack') {
      const s = state.byId.get(ev.src);
      const d = state.byId.get(ev.dst);
      if (s && d && s.kind !== Kind.Tower) this.units.lunge(s.serial, d.x - s.x, d.y - s.y, now);
    }
  }

  frame(state: ClientState, now: number, hoverId: number, showRange: boolean): void {
    const rig = this.rig;
    rig.apply();
    // shadow frustum follows the view; snapped to texels to avoid shimmering
    const step = (SHADOW_HALF * 2) / 2048;
    const fx = Math.round(rig.tx / step) * step;
    const fy = Math.round(rig.ty / step) * step;
    this.sun.target.position.set(fx, 0, -fy + 400);
    this.sun.position.copy(this.sun.target.position).addScaledVector(SUN_DIR, 5000);
    this.sun.target.updateMatrixWorld();

    if (state.snap) this.structures.update(state.snap.entities, now / 1000);
    this.units.update(state, now, hoverId);
    this.fx.update(state, now, showRange);
    this.ground.update(state, now);
    this.wards.update(state, now);
    this.pings.update(state, now);
    this.fog.update(state, now);
    this.terrain.update(now / 1000);
    this.renderer.render(this.scene, rig.camera);
  }

  /** Screen-space top anchor (CSS px) for health bars, or null if off-screen. */
  barAnchor(e: SnapEntity, x: number, y: number): { sx: number; sy: number } | null {
    const top = this.unitHeight(e);
    let wx = x;
    let wy = y;
    let wz = top;
    if (spriteKeyFor(e)) {
      // sprites lean back with the camera: the head sits along the tilted up vector
      wx = x;
      wy = y - this.up.z * top;
      wz = this.up.y * top;
    }
    const p = this.rig.project(wx, wy, wz + 18, this.w, this.h);
    if (p.behind || p.sx < -100 || p.sy < -100 || p.sx > this.w + 100 || p.sy > this.h + 100) return null;
    return p;
  }

  unitHeight(e: SnapEntity): number {
    const ch = this.units.spriteHeight(e);
    if (ch !== null) return ch;
    const key = spriteKeyFor(e);
    if (key) return SPRITE_SIZE[key] * 0.92;
    if (e.kind === Kind.Ward) return 90; // ward markers (render/wards.ts): bars + picking
    return this.structures.heightOf(e.kind);
  }

  /**
   * Screen-space pick against sprite rectangles / structure footprints. Returns the entity whose screen rect
   * contains the point and whose centre is closest, preferring champions.
   */
  pick(state: ClientState, sx: number, sy: number, accept: (e: SnapEntity) => boolean): SnapEntity | null {
    if (!state.snap) return null;
    let best: SnapEntity | null = null;
    let bestScore = Infinity;
    for (const e of state.snap.entities) {
      if (!e.alive || !accept(e)) continue;
      const x = state.x(e);
      const y = state.y(e);
      const foot = this.rig.project(x, y, 0, this.w, this.h);
      const head = this.barAnchor(e, x, y);
      if (!head) continue;
      const hgt = Math.max(20, foot.sy - head.sy);
      const halfW = Math.max(18, hgt * (e.kind >= Kind.Tower && e.kind <= Kind.Nexus ? 0.3 : 0.32));
      const cy = (foot.sy + head.sy) / 2;
      if (Math.abs(sx - foot.sx) > halfW || sy < head.sy || sy > foot.sy + 14) continue;
      let score = Math.hypot(sx - foot.sx, sy - cy);
      if (e.kind === Kind.Champion) score *= 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  dispose(): void {
    this.renderer.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
    });
  }
}
