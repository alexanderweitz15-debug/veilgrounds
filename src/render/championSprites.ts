// Animated sprites from a procedural paper-doll atlas (src/render/champions): one InstancedMesh whose per-instance
// UV rect (aUvRect) selects the frame. A second, colour-less upright quad facing the sun shares the geometry (so
// the same frame) and only casts the shadow. Used twice: champions (+ Hark) and minions (separate atlas).
import * as THREE from 'three';
import { gouacheSprite } from './materials';
import type { SnapEntity } from '../sim/snapshot';
import { Kind } from '../sim/types';
import { PITCH } from './camera';
import { dirFromAngle, ANIMS, type Anim, type ChampionAtlas, type Dir } from './champions';
import { champions } from '../data/champions';
import { turnToward } from './readability';
import { ANIM_OVERRIDES, animEvents, buildClipSet, newInput, UnitAnim, type AnimEventBus, type AnimEventName, type CastKind, type ClipSet } from './anim';

export type { CastKind } from './anim';
/** fallback wind-ups until one was measured (sim: 0.3 s of the attack period for minions) */
const WIND_MS: Partial<Record<number, number>> = { [Kind.MinionMelee]: 240, [Kind.MinionCaster]: 450, [Kind.MinionSiege]: 300, [Kind.MinionSuper]: 350 };

function windEstimate(e: SnapEntity): number {
  const d = e.kind === Kind.Champion && e.champ ? champions[e.champ] : undefined;
  if (d) return (1000 * d.base.windup) / (d.base.as * (1 + (d.base.asGrowth * Math.max(0, e.level - 1)) / 100));
  return WIND_MS[e.kind] ?? 330;
}

/** Ability type → cast playback. `champ` + `slot` (0..3) apply the per-slot override of the animation data table. */
export function castKindOf(type: string | undefined, champ?: string | null, slot?: number): CastKind {
  const o = champ && slot !== undefined && slot >= 0 && slot < 4 ? ANIM_OVERRIDES[champ]?.castKinds?.[slot as 0 | 1 | 2 | 3] : undefined;
  if (o) return o;
  if (type === 'self') return 'self';
  if (type === 'dash' || type === 'blink') return 'dash';
  return 'directed';
}
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
  /** size multiplier per entity (small camp members reuse their leader's frames), default 1 */
  scaleFor?: (e: SnapEntity) => number;
  /** raise `footstep` animation events (champions only; 60 minions would flood the audio) */
  footsteps?: boolean;
}

/** Champions by champion id; Hark (Ottilie's wolf) for the big pet. Corvin's keg (hp 1) stays on the placeholder. */
/** Visual size of champion sprites relative to their baked world size (sim radius unchanged). */
export const CHAMPION_SCALE = 1.3;

export const CHAMPION_BATCH: SpriteBatchOptions = {
  cap: 24,
  // champions ~11 % of the screen height like LoL (were ~8 % next to towers, trees and cliffs built at map scale)
  scaleFor: () => CHAMPION_SCALE,
  footsteps: true,
  ghosts: 12,
  corpseMs: 1800,
  idFor: (e, atlas) => {
    if (e.kind === Kind.Champion) return e.champ && atlas.frames[e.champ] ? e.champ : null;
    if (e.kind === Kind.Pet && e.look && atlas.frames[e.look]) return e.look; // decoy (Sev E) looks like its owner
    if (e.kind === Kind.Pet && e.maxHp > 1 && atlas.frames.hark) return 'hark';
    return null;
  },
};

interface AnimState {
  scale: number;
  serial: number;
  seen: number;
  id: string;
  /** the state machine (src/render/anim) */
  u: UnitAnim;
  /** clip set of `id`, cached per unit (saves a map lookup per frame) */
  cs: ClipSet | null;
  /** D2: displayed facing angle (radians, smoothed toward the sim facing) and its last update time; NaN = unset. */
  ang: number;
  angT: number;
}
interface PendingCast {
  t0: number;
  dur: number;
  kind: CastKind;
  slot: number;
}
interface Ghost {
  scale: number;
  on: boolean;
  id: string;
  eid: number;
  dir: Dir;
  x: number;
  y: number;
  t0: number;
  landed: boolean;
}

/** Selects the frame rect via the instanced `aUvRect` attribute (works for the colour and the depth material). */
function patchUv(mat: THREE.Material, footDepth = false): void {
  const prev = mat.onBeforeCompile.bind(mat);
  mat.onBeforeCompile = (s, r) => {
    prev(s, r);
    s.vertexShader = 'attribute vec4 aUvRect;\n' + s.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n\tvMapUv = mix(aUvRect.xy, aUvRect.zw, uv);\n#endif');
    // 2.5D sprites: the whole quad takes the depth of its feet, so a tilted billboard no longer cuts into walls,
    // cliffs and tower bases standing next to it (it is in front of or behind them as a whole, like LoL's units)
    if (footDepth)
      s.vertexShader = s.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvec4 footPos = vec4(0.0, 0.0, 0.0, 1.0);\n#ifdef USE_INSTANCING\nfootPos = instanceMatrix * footPos;\n#endif\nvec4 footClip = projectionMatrix * modelViewMatrix * footPos;\ngl_Position.z = (footClip.z / footClip.w - 0.0004) * gl_Position.w;',
      );
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey()}-${footDepth ? 'aUvRect-foot' : 'aUvRect'}`;
}

export class ChampionSprites {
  readonly group = new THREE.Group();
  private readonly vis: THREE.InstancedMesh;
  private readonly cast: THREE.InstancedMesh;
  private readonly uv: THREE.InstancedBufferAttribute;
  private readonly st = new Map<number, AnimState>(); // by serial
  private readonly byEid = new Map<number, AnimState>();
  private readonly pendingCast = new Map<number, PendingCast>(); // cast events that arrived before the first draw, by eid
  private readonly clipSets = new Map<string, ClipSet>();
  private readonly inp = newInput();
  private readonly bus: AnimEventBus;
  private recallEid = -1;
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
    bus: AnimEventBus = animEvents,
  ) {
    this.bus = bus;
    this.ghosts = Array.from({ length: opts.ghosts }, () => ({ scale: 1, on: false, id: '', eid: -1, dir: 'S' as Dir, x: 0, y: 0, t0: 0, landed: false }));
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
    // alphaToCoverage: soft, antialiased sprite edges under MSAA instead of hard alpha-test stair steps
    // lit like the gouache world (warm sun / violet shadow, tower and tree shadows), see materials.ts gouacheSprite
    const mat = gouacheSprite({ map: tex, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide });
    patchUv(mat, true);
    const castMat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
    patchUv(castMat);
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
    patchUv(depth);
    this.vis = new THREE.InstancedMesh(geo, mat, CAP);
    this.vis.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.vis.setColorAt(0, new THREE.Color(1, 1, 1));
    this.vis.frustumCulled = false;
    this.vis.receiveShadow = true;
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
  heightOf(id: string, e?: SnapEntity): number {
    return (this.atlas.foot[id]! - this.atlas.top[id]!) * this.atlas.worldSize[id]! * (e && this.opts.scaleFor ? this.opts.scaleFor(e) : 1);
  }

  /** Clip description of an id (frame counts and rates the atlas baked + the data table of src/render/anim/data.ts). */
  clipsOf(id: string): ClipSet {
    let cs = this.clipSets.get(id);
    if (!cs) {
      const f = this.atlas.frames[id]!;
      const frames = {} as Record<Anim, number>;
      for (const anim of ANIMS) frames[anim] = f[anim].S.length;
      const rate = this.atlas.rate[id] ?? ({} as Partial<Record<Anim, number>>);
      const fps = {} as Record<Anim, number>;
      for (const anim of ANIMS) fps[anim] = rate[anim] ?? this.atlas.fps[anim];
      cs = buildClipSet(id, { frames, fps, hit: this.atlas.hit[id] ?? 1, loop: this.atlas.loop });
      this.clipSets.set(id, cs);
    }
    return cs;
  }

  /** Animation event hand-off of one unit to the bus (only built when somebody listens). */
  private readonly sink = (name: AnimEventName, u: UnitAnim, slot: number, kind: CastKind, foot: number): void => {
    if (name === 'footstep' && !this.opts.footsteps) return;
    this.fire(name, u.eid, u.id, u.x, u.y, u.dir, this.lastNow, slot, kind, foot);
  };
  private lastNow = 0;
  private fire(name: AnimEventName, eid: number, id: string, x: number, y: number, dir: Dir, t: number, slot = -1, kind: CastKind = 'directed', foot = -1): void {
    const bus = this.bus;
    if (!bus.wants(name)) return;
    const ev = bus.scratch;
    ev.name = name;
    ev.eid = eid;
    ev.id = id;
    ev.t = t;
    ev.x = x;
    ev.y = y;
    ev.dir = dir;
    ev.slot = slot;
    ev.kind = kind;
    ev.foot = foot;
    bus.dispatch();
  }

  /** The viewer's own champion is channelling a recall (the snapshot only carries it for `me`). */
  setRecall(eid: number, on: boolean): void {
    this.recallEid = on ? eid : -1;
  }

  /** A cast started: `durMs` = wind-up until the release (sim cast time), `kind` from the ability type, `slot` 0..3. */
  onCast(eid: number, now: number, durMs = 0, kind: CastKind = 'directed', slot = -1): void {
    this.lastNow = now;
    const a = this.byEid.get(eid);
    if (a) a.u.onCast(now, durMs, kind, slot);
    else this.pendingCast.set(eid, { t0: now, dur: durMs, kind, slot });
  }

  /** Took a hit from (sx, sy): short knock-back flinch (rate-limited so damage over time does not jitter). */
  onHit(eid: number, now: number, sx: number, sy: number): void {
    this.lastNow = now;
    this.byEid.get(eid)?.u.onHit(now, sx, sy);
  }

  onDeath(eid: number, now: number): void {
    this.pendingCast.delete(eid);
    const a = this.byEid.get(eid);
    if (!a) return;
    this.lastNow = now;
    a.u.onDeath();
    const g = this.ghosts.find((x) => !x.on) ?? this.ghosts[0]!;
    g.on = true;
    g.scale = a.scale;
    g.id = a.id;
    g.eid = eid;
    g.dir = a.u.dir;
    g.x = a.u.x;
    g.y = a.u.y;
    g.t0 = now;
    g.landed = false;
    this.byEid.delete(eid);
    this.st.delete(a.serial);
  }

  begin(): void {
    this.n = 0;
  }

  /** Draws one living entity; `id` from idFor, (x, y) = interpolated feet incl. lunge, c = brightness. */
  push(e: SnapEntity, id: string, x: number, y: number, c: number, now: number, lift = 0): void {
    if (this.n >= this.opts.cap) return;
    this.lastNow = now;
    let a = this.st.get(e.serial);
    if (!a) {
      a = { scale: this.opts.scaleFor?.(e) ?? 1, serial: e.serial, seen: now, id, u: new UnitAnim(e.id, id, this.sink, now), cs: null, ang: NaN, angT: now };
      this.st.set(e.serial, a);
      const pc = this.pendingCast.get(e.id);
      if (pc) {
        this.pendingCast.delete(e.id);
        if (now - pc.t0 < 1500) a.u.onCast(pc.t0, pc.dur, pc.kind, pc.slot);
      }
    }
    a.seen = now;
    this.byEid.set(e.id, a);
    let dir = a.u.dir;
    if (e.fx || e.fy) {
      // D2: turn through the in-between directions (180 deg in ~80 ms) instead of flipping in one tick
      const target = Math.atan2(e.fy, e.fx);
      a.ang = Number.isNaN(a.ang) ? target : turnToward(a.ang, target, now - a.angT);
      dir = dirFromAngle(a.ang);
    }
    a.angT = now;
    const cs = a.cs?.id === id ? a.cs : (a.cs = this.clipsOf(id));
    const inp = this.inp;
    inp.atkPhase = e.atkPhase;
    inp.atkStart = e.atkStart;
    inp.atkEnd = e.atkEnd;
    inp.moving = e.moving;
    inp.cc = e.cc ?? 0;
    inp.recalling = e.id === this.recallEid;
    const mdx = e.x - e.px;
    const mdy = e.y - e.py;
    const sp = e.moving ? Math.sqrt(mdx * mdx + mdy * mdy) * 30 : 0; // (Math.hypot is slow in V8)
    inp.speed = sp === sp && sp < 1e5 ? sp : 0;
    inp.x = x;
    inp.y = y;
    inp.dir = dir;
    inp.windGuess = windEstimate(e);
    const u = a.u;
    u.update(inp, cs, now);
    this.draw(id, u.anim, u.dir, u.frame, x + u.ox, y + u.oy, c, a.scale, lift, cs.clips[u.anim].loop);
  }

  /** `lift` = height above the ground (knock-up hop, dash arc); the shadow quad stays on the ground. */
  private draw(id: string, anim: Anim, dir: Dir, k: number, x: number, y: number, c: number, scale = 1, lift = 0, loop = this.atlas.loop[anim]): void {
    const list = this.atlas.frames[id]?.[anim]?.[dir];
    if (!list?.length) return;
    // frame index from timers can be negative (clock offsets) or NaN (missing rate): clamp, never index out of range
    const kk = Number.isFinite(k) ? Math.max(0, Math.floor(k)) : 0;
    const r = list[loop ? kk % list.length : Math.min(kk, list.length - 1)];
    if (!r) return;
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.uv.setXYZW(i, r.u0, r.v0, r.u1, r.v1);
    const size = this.atlas.worldSize[id]! * scale;
    const below = (1 - this.atlas.foot[id]!) * size; // cell bottom below the feet
    this.p.set(x, lift, -y).addScaledVector(this.up, -below);
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
      else {
        const cs = this.clipsOf(g.id);
        const anim: Anim = cs.clips.death.frames ? 'death' : 'idle';
        const clip = cs.clips[anim];
        const k = Math.floor(((now - g.t0) / 1000) * clip.fps);
        if (!g.landed && anim === 'death' && clip.events.some((ev) => ev.name === 'land' && k >= ev.frame)) {
          g.landed = true;
          this.fire('land', g.eid, g.id, g.x, g.y, g.dir, now);
        }
        this.draw(g.id, anim, g.dir, k, g.x, g.y, 1, g.scale, 0, clip.loop);
      }
    }
    if (now - this.lastPrune > STALE_MS) {
      this.lastPrune = now;
      for (const [serial, a] of this.st) if (now - a.seen > STALE_MS) this.st.delete(serial);
      for (const [eid, a] of this.byEid) if (now - a.seen > STALE_MS) this.byEid.delete(eid);
      for (const [eid, t] of this.pendingCast) if (now - t.t0 > STALE_MS) this.pendingCast.delete(eid);
    }
    this.vis.count = this.cast.count = this.n;
    this.vis.instanceMatrix.needsUpdate = true;
    this.cast.instanceMatrix.needsUpdate = true;
    if (this.vis.instanceColor) this.vis.instanceColor.needsUpdate = true;
    this.uv.needsUpdate = true;
  }
}
