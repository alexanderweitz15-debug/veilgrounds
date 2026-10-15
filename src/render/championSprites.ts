// Animated sprites from a procedural paper-doll atlas (src/render/champions): one InstancedMesh whose per-instance
// UV rect (aUvRect) selects the frame. A second, colour-less upright quad facing the sun shares the geometry (so
// the same frame) and only casts the shadow. Used twice: champions (+ Hark) and minions (separate atlas).
import * as THREE from 'three';
import type { SnapEntity } from '../sim/snapshot';
import { Kind } from '../sim/types';
import { PITCH } from './camera';
import { dirFromAngle, type Anim, type ChampionAtlas, type Dir } from './champions';

const CAST_MS = 320;
/** forget animation state of entities not drawn for this long (fog, recall, despawn without a death event) */
const STALE_MS = 6000;

export interface SpriteBatchOptions {
  /** max live sprites per frame */
  cap: number;
  /** max simultaneous corpses (death animation + lying still) */
  ghosts: number;
  /** death anim + lying still, then the corpse disappears */
  corpseMs: number;
  /** atlas id for an entity, or null if this batch does not draw it */
  idFor: (e: SnapEntity, atlas: ChampionAtlas) => string | null;
}

/** Champions by champion id; Hark (Ottilie's wolf) for the big pet. Corvin's keg (hp 1) stays on the placeholder. */
export const CHAMPION_BATCH: SpriteBatchOptions = {
  cap: 24,
  ghosts: 12,
  corpseMs: 1800,
  idFor: (e, atlas) => {
    if (e.kind === Kind.Champion) return e.champ && atlas.frames[e.champ] ? e.champ : null;
    if (e.kind === Kind.Pet && e.maxHp > 1 && atlas.frames.hark) return 'hark';
    return null;
  },
};

interface AnimState {
  serial: number;
  seen: number;
  id: string;
  anim: Anim;
  t0: number;
  dir: Dir;
  phase: number;
  x: number;
  y: number;
}
interface Ghost {
  on: boolean;
  id: string;
  dir: Dir;
  x: number;
  y: number;
  t0: number;
}

/** Selects the frame rect via the instanced `aUvRect` attribute (works for the colour and the depth material). */
function patchUv(mat: THREE.Material): void {
  mat.onBeforeCompile = (s) => {
    s.vertexShader = 'attribute vec4 aUvRect;\n' + s.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n\tvMapUv = mix(aUvRect.xy, aUvRect.zw, uv);\n#endif');
  };
  mat.customProgramCacheKey = () => 'aUvRect';
}

export class ChampionSprites {
  readonly group = new THREE.Group();
  private readonly vis: THREE.InstancedMesh;
  private readonly cast: THREE.InstancedMesh;
  private readonly uv: THREE.InstancedBufferAttribute;
  private readonly st = new Map<number, AnimState>(); // by serial
  private readonly byEid = new Map<number, AnimState>();
  private readonly castAt = new Map<number, number>(); // by eid
  private readonly ghosts: Ghost[];
  private readonly cap: number;
  private lastPrune = 0;
  private readonly up = new THREE.Vector3(0, Math.cos(PITCH), -Math.sin(PITCH));
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly tmp = new THREE.Color();
  private n = 0;

  constructor(
    readonly atlas: ChampionAtlas,
    private readonly qVis: THREE.Quaternion,
    private readonly qCast: THREE.Quaternion,
    private readonly opts: SpriteBatchOptions = CHAMPION_BATCH,
  ) {
    this.ghosts = Array.from({ length: opts.ghosts }, () => ({ on: false, id: '', dir: 'S' as Dir, x: 0, y: 0, t0: 0 }));
    const CAP = (this.cap = opts.cap + opts.ghosts);
    const tex = new THREE.CanvasTexture(atlas.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = 4;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0);
    this.uv = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
    this.uv.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aUvRect', this.uv);
    const mat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
    patchUv(mat);
    const castMat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
    patchUv(castMat);
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
    patchUv(depth);
    this.vis = new THREE.InstancedMesh(geo, mat, CAP);
    this.vis.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.vis.setColorAt(0, new THREE.Color(1, 1, 1));
    this.vis.frustumCulled = false;
    this.vis.count = 0;
    this.cast = new THREE.InstancedMesh(geo, castMat, CAP);
    this.cast.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cast.customDepthMaterial = depth;
    this.cast.castShadow = true;
    this.cast.frustumCulled = false;
    this.cast.count = 0;
    this.group.add(this.vis, this.cast);
  }

  /** Atlas id for an entity, or null if it is not drawn by this renderer. */
  idFor(e: SnapEntity): string | null {
    return this.opts.idFor(e, this.atlas);
  }

  /** Height of the figure's top above the feet (health bars, picking). */
  heightOf(id: string): number {
    return (this.atlas.foot[id]! - this.atlas.top[id]!) * this.atlas.worldSize[id]!;
  }

  onCast(eid: number, now: number): void {
    this.castAt.set(eid, now);
  }

  onDeath(eid: number, now: number): void {
    const a = this.byEid.get(eid);
    if (!a) return;
    const g = this.ghosts.find((x) => !x.on) ?? this.ghosts[0]!;
    g.on = true;
    g.id = a.id;
    g.dir = a.dir;
    g.x = a.x;
    g.y = a.y;
    g.t0 = now;
    this.byEid.delete(eid);
    this.st.delete(a.serial);
  }

  begin(): void {
    this.n = 0;
  }

  /** Draws one living entity; `id` from idFor, (x, y) = interpolated feet incl. lunge, c = brightness. */
  push(e: SnapEntity, id: string, x: number, y: number, c: number, now: number): void {
    if (this.n >= this.opts.cap) return;
    let a = this.st.get(e.serial);
    if (!a) {
      a = { serial: e.serial, seen: now, id, anim: 'idle', t0: now, dir: 'S', phase: 0, x, y };
      this.st.set(e.serial, a);
    }
    a.seen = now;
    this.byEid.set(e.id, a);
    a.x = x;
    a.y = y;
    if (e.fx || e.fy) a.dir = dirFromAngle(Math.atan2(e.fy, e.fx));
    const fr = this.atlas.frames[id]!;
    const ca = this.castAt.get(e.id);
    let anim: Anim = 'idle';
    if (ca !== undefined && now - ca < CAST_MS && fr.cast.S.length) anim = 'cast';
    else if (e.atkPhase > 0) anim = 'attack';
    else if (e.moving) anim = 'run';
    if (anim !== a.anim || (anim === 'attack' && e.atkPhase === 1 && a.phase !== 1)) {
      a.anim = anim;
      a.t0 = anim === 'cast' && ca !== undefined ? ca : now;
    }
    a.phase = e.atkPhase;
    this.draw(id, anim, a.dir, now - a.t0 + (this.atlas.loop[anim] ? e.id * 97 : 0), x, y, c);
  }

  private draw(id: string, anim: Anim, dir: Dir, ms: number, x: number, y: number, c: number): void {
    const list = this.atlas.frames[id]![anim][dir];
    if (!list.length) return;
    const k = Math.floor((ms / 1000) * this.atlas.fps[anim]);
    const r = list[this.atlas.loop[anim] ? k % list.length : Math.min(k, list.length - 1)]!;
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.uv.setXYZW(i, r.u0, r.v0, r.u1, r.v1);
    const size = this.atlas.worldSize[id]!;
    const below = (1 - this.atlas.foot[id]!) * size; // cell bottom below the feet
    this.p.set(x, 0, -y).addScaledVector(this.up, -below);
    this.s.set(size, size, 1);
    this.m.compose(this.p, this.qVis, this.s);
    this.vis.setMatrixAt(i, this.m);
    this.p.set(x, -below, -y);
    this.s.set(size * 0.8, size, 1);
    this.m.compose(this.p, this.qCast, this.s);
    this.cast.setMatrixAt(i, this.m);
    this.vis.setColorAt(i, this.tmp.setRGB(c, c, c));
  }

  end(now: number): void {
    for (const g of this.ghosts) {
      if (!g.on) continue;
      if (now - g.t0 > this.opts.corpseMs) g.on = false;
      else this.draw(g.id, this.atlas.frames[g.id]!.death.S.length ? 'death' : 'idle', g.dir, now - g.t0, g.x, g.y, 1);
    }
    if (now - this.lastPrune > STALE_MS) {
      this.lastPrune = now;
      for (const [serial, a] of this.st) if (now - a.seen > STALE_MS) this.st.delete(serial);
      for (const [eid, a] of this.byEid) if (now - a.seen > STALE_MS) this.byEid.delete(eid);
      for (const [eid, t] of this.castAt) if (now - t > STALE_MS) this.castAt.delete(eid);
    }
    this.vis.count = this.cast.count = this.n;
    this.vis.instanceMatrix.needsUpdate = true;
    this.cast.instanceMatrix.needsUpdate = true;
    if (this.vis.instanceColor) this.vis.instanceColor.needsUpdate = true;
    this.uv.needsUpdate = true;
  }
}
