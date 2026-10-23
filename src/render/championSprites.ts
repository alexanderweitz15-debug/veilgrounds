// Animated sprites from a procedural paper-doll atlas (src/render/champions): one InstancedMesh whose per-instance
// UV rect (aUvRect) selects the frame. A second, colour-less upright quad facing the sun shares the geometry (so
// the same frame) and only casts the shadow. Used twice: champions (+ Hark) and minions (separate atlas).
import * as THREE from 'three';
import { gouacheSprite } from './materials';
import type { SnapEntity } from '../sim/snapshot';
import { Kind } from '../sim/types';
import { PITCH } from './camera';
import { CAST_FLEX, CAST_RELEASE, dirFromAngle, type Anim, type ChampionAtlas, type Dir } from './champions';
import { champions } from '../data/champions';
import { AFTER_MS, afterFrame, castPoseActive, runRate, windupMsOf } from './spriteTiming';
import { turnToward } from './readability';

/** How a cast plays: directed spells release forward, self buffs flex, dashes lunge. */
export type CastKind = 'directed' | 'self' | 'dash';
/** hit flinch: knock-back distance (champions a bit more than minions, G/A7) and duration */
const FLINCH = 9;
const FLINCH_CHAMPION = 13;
const FLINCH_MS = 150;
/** G/A3: a click's intent facing is shown for at most this long, or until the sim facing changes. */
const INTENT_MS = 300;
/** fallback wind-ups until one was measured (sim: 0.3 s of the attack period for minions) */
const WIND_MS: Partial<Record<number, number>> = { [Kind.MinionMelee]: 240, [Kind.MinionCaster]: 450, [Kind.MinionSiege]: 300, [Kind.MinionSuper]: 350 };

function windEstimate(e: SnapEntity): number {
  const d = e.kind === Kind.Champion && e.champ ? champions[e.champ] : undefined;
  if (d) return (1000 * d.base.windup) / (d.base.as * (1 + (d.base.asGrowth * Math.max(0, e.level - 1)) / 100));
  return WIND_MS[e.kind] ?? 330;
}

/** Ability type → cast playback. */
export function castKindOf(type: string | undefined): CastKind {
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
}

/** Champions by champion id; Hark (Ottilie's wolf) for the big pet. Corvin's keg (hp 1) stays on the placeholder. */
/** Visual size of champion sprites relative to their baked world size (sim radius unchanged). */
export const CHAMPION_SCALE = 1.3;

export const CHAMPION_BATCH: SpriteBatchOptions = {
  cap: 24,
  // champions ~11 % of the screen height like LoL (were ~8 % next to towers, trees and cliffs built at map scale)
  scaleFor: () => CHAMPION_SCALE,
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
  anim: Anim;
  t0: number;
  dir: Dir;
  phase: number;
  x: number;
  y: number;
  /** attack: wind-up start, hit time (0 = not yet), measured wind-up length (ms) */
  atk0: number;
  atkHit: number;
  wind: number;
  /** last hit flinch: time + knock direction */
  hitT: number;
  hx: number;
  hy: number;
  /** D2: displayed facing angle (radians, smoothed toward the sim facing) and its last update time; NaN = unset. */
  ang: number;
  angT: number;
  /** G/A2: run-cycle phase in frames (advanced by the speed-dependent rate, so a rate change never jumps a frame). */
  runPh: number;
  /** G/A3: facing the player's own click asked for, shown until the sim facing moves or INTENT_MS pass. */
  intent: { ang: number; until: number; fx: number; fy: number } | null;
}
interface CastState {
  t0: number;
  /** wind-up until the release (ms) */
  dur: number;
  kind: CastKind;
}
interface Ghost {
  scale: number;
  on: boolean;
  id: string;
  dir: Dir;
  x: number;
  y: number;
  t0: number;
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
  private readonly castAt = new Map<number, CastState>(); // by eid
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
    this.ghosts = Array.from({ length: opts.ghosts }, () => ({ scale: 1, on: false, id: '', dir: 'S' as Dir, x: 0, y: 0, t0: 0 }));
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

  /** A cast started: `durMs` = wind-up until the release (sim cast time), `kind` from the ability type. */
  onCast(eid: number, now: number, durMs = 0, kind: CastKind = 'directed'): void {
    this.castAt.set(eid, { t0: now, dur: Math.max(0, Math.min(1500, durMs)), kind });
  }

  /**
   * G/A3: the player ordered a move/attack toward (dx, dy): turn the sprite there right away (render only). The
   * next snapshot that carries a new sim facing takes over; until then the old sim facing is ignored.
   */
  intentFace(eid: number, dx: number, dy: number, now: number): void {
    const a = this.byEid.get(eid);
    if (!a || (!dx && !dy)) return;
    a.intent = { ang: Math.atan2(dy, dx), until: now + INTENT_MS, fx: NaN, fy: NaN };
  }

  /** Took a hit from (sx, sy): short knock-back flinch (rate-limited so damage over time does not jitter). */
  onHit(eid: number, now: number, sx: number, sy: number): void {
    const a = this.byEid.get(eid);
    if (!a || now - a.hitT < 320) return;
    const dx = a.x - sx;
    const dy = a.y - sy;
    const d = Math.hypot(dx, dy) || 1;
    a.hitT = now;
    a.hx = dx / d;
    a.hy = dy / d;
  }

  /** Cast frame and whether the cast is still playing. */
  private castFrame(c: CastState, ms: number, n: number): number {
    // castTime 0 (instant): skip the gather
    const gather = c.dur;
    if (ms < gather) return 0;
    const k = ms - gather;
    if (c.kind === 'self') return n > CAST_FLEX ? CAST_FLEX : n - 1;
    if (c.kind === 'dash') return Math.min(n - 1, CAST_RELEASE);
    return Math.min(n - 1, k < AFTER_MS * 1.3 ? CAST_RELEASE : CAST_RELEASE + 1);
  }
  private castLen(c: CastState): number {
    return c.dur + (c.kind === 'self' ? 300 : c.kind === 'dash' ? 280 : AFTER_MS * 3.6);
  }

  onDeath(eid: number, now: number): void {
    const a = this.byEid.get(eid);
    if (!a) return;
    const g = this.ghosts.find((x) => !x.on) ?? this.ghosts[0]!;
    g.on = true;
    g.scale = a.scale;
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
  push(e: SnapEntity, id: string, x: number, y: number, c: number, now: number, lift = 0): void {
    if (this.n >= this.opts.cap) return;
    let a = this.st.get(e.serial);
    if (!a) {
      a = { scale: this.opts.scaleFor?.(e) ?? 1, serial: e.serial, seen: now, id, anim: 'idle', t0: now, dir: 'S', phase: 0, x, y, atk0: 0, atkHit: 0, wind: 0, hitT: -1e9, hx: 0, hy: 0, ang: NaN, angT: now, runPh: 0, intent: null };
      this.st.set(e.serial, a);
    }
    const dtMs = now - a.seen;
    a.seen = now;
    this.byEid.set(e.id, a);
    a.x = x;
    a.y = y;
    // G/A3: an intent facing (own click) overrides the sim facing until the sim facing itself changes
    const it = a.intent;
    if (it) {
      if (Number.isNaN(it.fx)) (it.fx = e.fx), (it.fy = e.fy); // sim facing at the time of the click
      else if (e.fx !== it.fx || e.fy !== it.fy || now > it.until) a.intent = null;
    }
    if (a.intent || e.fx || e.fy) {
      // D2: turn through the in-between directions (180 deg in ~80 ms) instead of flipping in one tick
      const target = a.intent ? a.intent.ang : Math.atan2(e.fy, e.fx);
      a.ang = Number.isNaN(a.ang) ? target : turnToward(a.ang, target, now - a.angT);
      a.dir = dirFromAngle(a.ang);
    }
    a.angT = now;
    const fr = this.atlas.frames[id]!;
    // attack state machine: the strike frame lands exactly on the sim's hit point (phase 1 -> 2)
    if (e.atkPhase === 1 && a.phase !== 1) {
      a.atk0 = now;
      a.atkHit = 0;
    } else if (e.atkPhase === 2 && a.phase !== 2) {
      if (a.phase === 1 && a.atk0) a.wind = Math.max(80, Math.min(1500, now - a.atk0));
      a.atkHit = now;
    } else if (e.atkPhase === 0 && a.phase === 1) a.atk0 = 0; // cancelled wind-up
    a.phase = e.atkPhase;
    const nA = fr.attack.S.length;
    const hit = Math.min(nA - 1, this.atlas.hit[id] ?? 1);
    const ca = this.castAt.get(e.id);
    let anim: Anim = e.moving ? 'run' : 'idle';
    let frame = -1;
    // G/A1: the cast pose ends early when the champion walks (castPoseActive), like the attack backswing below
    if (ca && fr.cast.S.length && castPoseActive(now - ca.t0, ca.dur, this.castLen(ca), e.moving)) {
      anim = 'cast';
      frame = this.castFrame(ca, now - ca.t0, fr.cast.S.length);
    } else if (e.atkPhase === 1 && nA && a.atk0) {
      // anticipation spread over the wind-up: from the snapshot (G/A6), else measured, else estimated
      anim = 'attack';
      const est = windupMsOf(e.atkStart, e.atkEnd) ?? (a.wind || windEstimate(e));
      frame = hit > 0 ? Math.min(hit - 1, Math.floor(((now - a.atk0) / est) * hit)) : 0;
    } else if (a.atkHit && nA && now - a.atkHit < (nA - hit) * AFTER_MS + 60 && (!e.moving || now - a.atkHit < AFTER_MS)) {
      // strike, follow-through, recover (moving during the backswing cancels it: orbwalking)
      anim = 'attack';
      frame = hit + afterFrame(now - a.atkHit, nA - hit);
    }
    if (anim !== a.anim) {
      a.anim = anim;
      a.t0 = now;
      if (anim === 'run') a.runPh = (e.id * 97) / 1000 * (this.atlas.rate[id]?.run ?? this.atlas.fps.run);
    }
    if (frame < 0 && anim === 'run') {
      // G/A2: run cycle paced by the distance walked in the last tick (boots faster, slows slower), phase-continuous
      const base = this.atlas.rate[id]?.run ?? this.atlas.fps.run;
      a.runPh += (Math.min(100, Math.max(0, dtMs)) / 1000) * runRate(base, Math.hypot(e.x - e.px, e.y - e.py));
      frame = Math.floor(a.runPh);
    }
    if (frame < 0) frame = Math.floor(((now - a.t0 + e.id * 97) / 1000) * (this.atlas.rate[id]?.[anim] ?? this.atlas.fps[anim]));
    // hit flinch: a quick knock away from the source
    const fk = (now - a.hitT) / FLINCH_MS;
    if (fk >= 0 && fk < 1) {
      const d = Math.sin(fk * Math.PI) * (e.kind === Kind.Champion ? FLINCH_CHAMPION : FLINCH) * (1 - fk * 0.5);
      x += a.hx * d;
      y += a.hy * d;
    }
    this.draw(id, anim, a.dir, frame, x, y, c, a.scale, lift);
  }

  /** `lift` = height above the ground (knock-up hop, dash arc); the shadow quad stays on the ground. */
  private draw(id: string, anim: Anim, dir: Dir, k: number, x: number, y: number, c: number, scale = 1, lift = 0): void {
    const list = this.atlas.frames[id]?.[anim]?.[dir];
    if (!list?.length) return;
    // frame index from timers can be negative (clock offsets) or NaN (missing rate): clamp, never index out of range
    const kk = Number.isFinite(k) ? Math.max(0, Math.floor(k)) : 0;
    const r = list[this.atlas.loop[anim] ? kk % list.length : Math.min(kk, list.length - 1)];
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
        const anim: Anim = this.atlas.frames[g.id]!.death.S.length ? 'death' : 'idle';
        this.draw(g.id, anim, g.dir, Math.floor(((now - g.t0) / 1000) * (this.atlas.rate[g.id]?.[anim] ?? this.atlas.fps[anim])), g.x, g.y, 1, g.scale);
      }
    }
    if (now - this.lastPrune > STALE_MS) {
      this.lastPrune = now;
      for (const [serial, a] of this.st) if (now - a.seen > STALE_MS) this.st.delete(serial);
      for (const [eid, a] of this.byEid) if (now - a.seen > STALE_MS) this.byEid.delete(eid);
      for (const [eid, t] of this.castAt) if (now - t.t0 > STALE_MS) this.castAt.delete(eid);
    }
    this.vis.count = this.cast.count = this.n;
    this.vis.instanceMatrix.needsUpdate = true;
    this.cast.instanceMatrix.needsUpdate = true;
    if (this.vis.instanceColor) this.vis.instanceColor.needsUpdate = true;
    this.uv.needsUpdate = true;
  }
}
