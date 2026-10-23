// Three.js scene root: renderer, morning sun with a camera-following shadow frustum, and all render layers.
import { GroundObjects } from './groundObjects';
import { PingMarkers } from './pings';
import * as THREE from 'three';
import type { MapData } from '../sim/map';
import type { SnapEntity } from '../sim/snapshot';
import { Kind, TICK_HZ, type SimEvent } from '../sim/types';
import { abilityForSlot } from '../data/champions';
import { castKindOf } from './championSprites';
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
import { settings } from '../settings';
import { QUALITY, setFastPcf } from './quality';
import { WORLD_LIGHT } from './materials';
import { disposeTree } from './dispose';
import { pickUnit, type PickView } from '../input/picking';

/** Direction toward the sun: low warm evening light from behind-right (style C), long shadows toward the camera. */
const SUN_DIR = WORLD_LIGHT.sunDir;
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
  private quality = settings.graphics;

  constructor(readonly canvas: HTMLCanvasElement, map: MapData) {
    const q = QUALITY[this.quality] ?? QUALITY.medium;
    setFastPcf(q.fastPcf); // compiled into this renderer's programs
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: q.antialias, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color(WORLD_LIGHT.haze);
    // violet distance haze: only the far (top) part of the view sinks into it
    this.scene.fog = new THREE.Fog(WORLD_LIGHT.haze, 3600, 8200);
    this.rig = new CameraRig(1);

    this.scene.add(new THREE.HemisphereLight(WORLD_LIGHT.sky, WORLD_LIGHT.ground, WORLD_LIGHT.hemiIntensity));
    this.sun = new THREE.DirectionalLight(WORLD_LIGHT.sun, WORLD_LIGHT.sunIntensity);
    this.sun.castShadow = q.shadows;
    this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -SHADOW_HALF;
    sc.right = sc.top = SHADOW_HALF;
    sc.near = 100;
    sc.far = 9000;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 6;
    this.scene.add(this.sun, this.sun.target);

    this.fog = new FogOfWar(map);
    this.terrain = buildTerrain(map, this.renderer.capabilities.getMaxAnisotropy(), this.quality);
    this.units = new Units(buildAtlas(), SUN_DIR);
    this.scene.add(this.terrain.group, this.structures.group, this.units.group, this.fx.group, this.ground.group, this.pings.group, this.wards.group, this.fx.particles.group);
    this.ground.particles = this.fx.particles;
  }

  /** Live part of the graphics quality setting: shadows on/off, shadow map size, render scale. */
  applyQuality(): void {
    if (settings.graphics === this.quality) return;
    this.quality = settings.graphics;
    const q = QUALITY[this.quality] ?? QUALITY.medium;
    this.sun.castShadow = q.shadows;
    if (this.sun.shadow.mapSize.x !== q.shadowMap) {
      this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
    this.renderer.setSize(this.w, this.h, false);
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

  /** Switch jungle monsters and plants to their painted sprite atlases ([big, camp]). */
  setMonsterAtlases(atlases: ChampionAtlas[]): void {
    this.units.setMonsterAtlases(atlases);
  }

  /** Switch minions to the animated sprite atlas. */
  setMinionAtlas(atlas: ChampionAtlas): void {
    this.units.setMinionAtlas(atlas);
  }

  /** G/A3: the player's own click toward (dx, dy): the champion sprite turns there before the sim answers. */
  intentFace(eid: number, dx: number, dy: number, now: number): void {
    this.units.champs?.intentFace(eid, dx, dy, now);
  }

  onEvent(ev: SimEvent, state: ClientState, now: number): void {
    this.fx.onEvent(ev, state, now);
    if (ev.e === 'cast') {
      // wind-up until the release: the sim's wind-up end tick (snapshot tick = event tick + 1)
      const src = state.byId.get(ev.src);
      const ab = src?.champ ? abilityForSlot(src.champ, ev.slot, src.ult ?? -1) : undefined;
      const dur = ev.at !== undefined && state.snap ? Math.max(0, ev.at - (state.snap.tick - 1)) * (1000 / TICK_HZ) : (ab?.castTime ?? 0) * 1000;
      this.units.champs?.onCast(ev.src, now, dur, castKindOf(ab?.type));
    } else if (ev.e === 'death') this.units.onDeath(ev.eid, now);
    if (ev.e === 'damage') {
      const d = state.byId.get(ev.dst);
      // B5: the sim marks which hits flash (champion hits always, the rest max 4/s per target)
      if (d && ev.flash) this.units.flash(d.serial, now, d.kind);
      const s = state.byId.get(ev.src);
      if (d && s && ev.amount > 0) this.units.hit(ev.dst, now, s.x, s.y);
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
    const step = (SHADOW_HALF * 2) / this.sun.shadow.mapSize.x;
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
    if (e.kind === Kind.Ward) return 165; // ward markers (render/wards.ts): bars + picking
    return this.structures.heightOf(e.kind);
  }

  /**
   * Unit under the screen point (agent C, src/input/picking.ts): HP bar, then the body (sim radius projected to the
   * screen + margin, from the ground point up the sprite) closest to the cursor; hostile units before allies.
   */
  pick(state: ClientState, sx: number, sy: number, accept: (e: SnapEntity) => boolean): SnapEntity | null {
    const view: PickView = {
      project: (x, y, z) => this.rig.project(x, y, z, this.w, this.h),
      barAnchor: (e, x, y) => this.barAnchor(e, x, y),
    };
    return pickUnit(state, view, sx, sy, accept);
  }

  /** Frees everything on the GPU (geometries, materials, textures, shadow map) and the WebGL context itself. */
  dispose(): void {
    disposeTree(this.scene);
    this.fog.dispose();
    this.sun.shadow.map?.dispose();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss(); // browsers cap live contexts; each menu backdrop and match builds a new one
  }
}
