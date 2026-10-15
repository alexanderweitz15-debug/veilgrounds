// Transient effects: projectiles (instanced), ability telegraphs, click markers, range circle, cast rings and death
// puffs. All ground shapes lie flat with polygon offset against z-fighting.
// Telegraphs ("Hitbox = sichtbare Fläche", geometry from src/render/telegraph.ts): the outer border of every drawn
// shape is the exact hitbox (edges are drawn inside it). Cast previews run from the `cast` event over the wind-up;
// line skillshots then continue as an in-flight strip (projectile -> end of range), ground AoEs as the `zone` event
// (rim + fill over time, persistent zones until `until`). Own team cold blue, enemies warm red.
import * as THREE from 'three';
import type { ClientState } from '../game/state';
import type { SimEvent } from '../sim/types';
import type { AbilityData } from '../sim/champions/schema';
import { champions } from '../data/champions';
import { REL } from './palette';
import { castDir, castTelegraph, hitboxAbility, lineZone, windupTicks, zoneProgress, type CastTelegraph, type CircleShape, type LineShape, type Shape } from './telegraph';

const MAX_PROJ = 160;
/** Border thickness (world units), drawn inside the hitbox. */
const EDGE = 10;
/** Ticks the resolve flash lasts. */
const FLASH = 6;

interface Pulse {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t0: number;
  dur: number;
  r0: number;
  r1: number;
  a0: number;
  active: boolean;
}

type ZoneEvent = Extract<SimEvent, { e: 'zone' }>;

const flatRing = new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2);
const flatDisc = new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2);
/** Unit square centred on the origin, x = length, z = thickness. */
const flatPlane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

const ringCache = new Map<string, THREE.BufferGeometry>();
/** Unit-radius ring (inner = 1 - edge/r) or arc of half angle `half` (radians, centred on +x). */
function ringGeom(inner: number, half: number | null): THREE.BufferGeometry {
  const key = `${inner.toFixed(4)}|${half === null ? '' : half.toFixed(4)}`;
  let g = ringCache.get(key);
  if (!g) {
    g = (half === null ? new THREE.RingGeometry(inner, 1, 96) : new THREE.RingGeometry(inner, 1, 48, 1, -half, 2 * half)).rotateX(-Math.PI / 2);
    ringCache.set(key, g);
  }
  return g;
}
const sectorCache = new Map<string, THREE.BufferGeometry>();
function sectorGeom(half: number): THREE.BufferGeometry {
  const key = half.toFixed(4);
  let g = sectorCache.get(key);
  if (!g) sectorCache.set(key, (g = new THREE.CircleGeometry(1, 48, -half, 2 * half).rotateX(-Math.PI / 2)));
  return g;
}

function groundMat(color: string, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
}

/** Flat strip from (ax, ay) to (bx, by) in sim coordinates, thickness w, at height h. */
function placeStrip(m: THREE.Mesh, ax: number, ay: number, bx: number, by: number, w: number, h: number): void {
  const dx = bx - ax;
  const dy = by - ay;
  m.position.set((ax + bx) / 2, h, -(ay + by) / 2);
  m.scale.set(Math.max(0.01, Math.sqrt(dx * dx + dy * dy)), 1, Math.max(0.01, w));
  m.rotation.set(0, Math.atan2(dy, dx), 0);
}

/** One pooled ground shape: fill + border (ring/arc for circles and cones, edge strips for lines and cone sides). */
class ShapeView {
  readonly fillMat = groundMat('#fff', 0.2);
  readonly rimMat = groundMat('#fff', 0.9);
  readonly fill = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>(flatDisc, this.fillMat);
  readonly rim = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>(flatRing, this.rimMat);
  readonly edges = [0, 1, 2, 3].map(() => new THREE.Mesh(flatPlane, this.rimMat));

  constructor(group: THREE.Group) {
    this.fill.renderOrder = 2;
    this.rim.renderOrder = 3;
    for (const e of this.edges) e.renderOrder = 3;
    group.add(this.fill, this.rim, ...this.edges);
    this.hide();
  }

  hide(): void {
    this.fill.visible = this.rim.visible = false;
    for (const e of this.edges) e.visible = false;
  }

  /**
   * Draw `s` with fill progress k (0..1): circles/cones fill outward, lines along their length (from A, or from the
   * middle when `centre`). Border always at the full hitbox.
   */
  show(s: Shape, color: string, k: number, fillOpacity: number, rimOpacity: number, centre = false): void {
    this.fillMat.color.set(color);
    this.rimMat.color.set(color);
    this.fillMat.opacity = fillOpacity;
    this.rimMat.opacity = rimOpacity;
    this.hide();
    this.fill.visible = k > 0 && fillOpacity > 0;
    if (s.k === 'line') {
      const { ax, ay, bx, by, width: w } = s;
      const len = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
      if (len <= 0 || w <= 0) return this.hide();
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      // fill
      this.fill.geometry = flatPlane;
      if (centre) {
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        const h = (len * k) / 2;
        placeStrip(this.fill, mx - ux * h, my - uy * h, mx + ux * h, my + uy * h, w, 3);
      } else placeStrip(this.fill, ax, ay, ax + ux * len * k, ay + uy * len * k, w, 3);
      // border: two long sides inset by EDGE/2, two caps
      const e = Math.min(EDGE, w / 2, len / 2);
      const nx = -uy * (w / 2 - e / 2);
      const ny = ux * (w / 2 - e / 2);
      placeStrip(this.edges[0]!, ax + nx, ay + ny, bx + nx, by + ny, e, 4);
      placeStrip(this.edges[1]!, ax - nx, ay - ny, bx - nx, by - ny, e, 4);
      const cx = ux * (e / 2);
      const cy = uy * (e / 2);
      const px = -uy * (w / 2);
      const py = ux * (w / 2);
      placeStrip(this.edges[2]!, ax + cx + px, ay + cy + py, ax + cx - px, ay + cy - py, e, 4);
      placeStrip(this.edges[3]!, bx - cx + px, by - cy + py, bx - cx - px, by - cy - py, e, 4);
      for (const m of this.edges) m.visible = true;
      return;
    }
    if (s.k === 'circle') {
      if (s.r <= 0) return this.hide();
      this.fill.geometry = flatDisc;
      this.fill.position.set(s.x, 3, -s.y);
      this.fill.rotation.set(0, 0, 0);
      this.fill.scale.setScalar(Math.max(1, s.r * k));
      this.rim.geometry = ringGeom(Math.max(0, 1 - Math.min(EDGE, s.r) / s.r), null);
      this.rim.position.set(s.x, 4, -s.y);
      this.rim.rotation.set(0, 0, 0);
      this.rim.scale.setScalar(s.r);
      this.rim.visible = true;
      return;
    }
    // cone
    if (s.range <= 0) return this.hide();
    const half = (s.halfAngleDeg * Math.PI) / 180;
    const rot = Math.atan2(s.dy, s.dx);
    this.fill.geometry = sectorGeom(half);
    this.fill.position.set(s.x, 3, -s.y);
    this.fill.rotation.set(0, rot, 0);
    this.fill.scale.setScalar(Math.max(1, s.range * k));
    this.rim.geometry = ringGeom(Math.max(0, 1 - Math.min(EDGE, s.range) / s.range), half);
    this.rim.position.set(s.x, 4, -s.y);
    this.rim.rotation.set(0, rot, 0);
    this.rim.scale.setScalar(s.range);
    this.rim.visible = true;
    // radial sides, inset so their outer border lies on the cone edge
    const e = Math.min(EDGE, s.range / 2);
    for (const [i, sign] of [
      [0, 1],
      [1, -1],
    ] as const) {
      const a = rot + sign * half;
      const ex = Math.cos(a);
      const ey = Math.sin(a);
      const ix = sign * Math.sin(a) * (e / 2); // inward normal (toward the cone axis)
      const iy = -sign * Math.cos(a) * (e / 2);
      placeStrip(this.edges[i]!, s.x + ix, s.y + iy, s.x + ex * s.range + ix, s.y + ey * s.range + iy, e, 4);
      this.edges[i]!.visible = true;
    }
  }
}

/** Cast preview: wind-up telegraph from the `cast` event. Ticks are sim ticks. */
interface Preview {
  view: ShapeView;
  views: ShapeView[];
  tel: CastTelegraph | null;
  src: number;
  team: number;
  start: number;
  end: number;
  /** A projectile strip or zone event takes over at `end` (no resolve flash). */
  handover: boolean;
}

interface Zone {
  view: ShapeView;
  ev: ZoneEvent | null;
  shape: Shape | null;
  /** Self AoE with a delay: centre follows the caster. */
  follow: boolean;
  /** Line fill grows from the middle (perpendicular walls/wires) instead of from the caster (forward strips). */
  centre: boolean;
}

export class Fx {
  readonly group = new THREE.Group();
  private readonly proj: THREE.InstancedMesh;
  private readonly halo: THREE.InstancedMesh;
  private readonly pulses: Pulse[] = [];
  private readonly zones: Zone[] = [];
  private readonly previews: Preview[] = [];
  private readonly strips: ShapeView[] = [];
  private readonly stripShape: LineShape = { k: 'line', ax: 0, ay: 0, bx: 0, by: 0, width: 0 };
  /** Latest cast per caster: ability, origin and direction (hook-defined line zones are rebuilt from it). */
  private readonly lastCast = new Map<number, { ab: AbilityData; ox: number; oy: number; dx: number; dy: number }>();
  private readonly range: THREE.Mesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private readonly axis = new THREE.Vector3(1, 0, 0);
  private readonly dir = new THREE.Vector3();

  constructor() {
    const g = new THREE.IcosahedronGeometry(1, 1);
    this.proj = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial(), MAX_PROJ);
    this.halo = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }), MAX_PROJ);
    for (const m of [this.proj, this.halo]) {
      m.setColorAt(0, this.c.set(1, 1, 1));
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
    }
    this.proj.castShadow = true;
    this.group.add(this.proj, this.halo);
    this.range = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 96).rotateX(-Math.PI / 2), groundMat('#f2e7b6', 0.7));
    this.range.visible = false;
    this.group.add(this.range);
  }

  private pulse(x: number, y: number, color: string, r0: number, r1: number, dur: number, now: number, disc = false, a0 = 0.9): void {
    let p = this.pulses.find((q) => !q.active && (q.mesh.geometry === flatDisc) === disc);
    if (!p) {
      const mat = groundMat(color, a0);
      const mesh = new THREE.Mesh(disc ? flatDisc : flatRing, mat);
      mesh.renderOrder = 3;
      this.group.add(mesh);
      p = { mesh, mat, t0: 0, dur: 0, r0: 0, r1: 0, a0, active: false };
      this.pulses.push(p);
    }
    p.mat.color.set(color);
    p.mesh.position.set(x, 3, -y);
    Object.assign(p, { t0: now, dur, r0, r1, a0, active: true });
    p.mesh.visible = true;
  }

  /** Click feedback for move / attack commands. */
  clickMarker(x: number, y: number, attack: boolean, now: number): void {
    this.pulse(x, y, attack ? '#ff5a3c' : '#7dff8a', 90, 20, 380, now);
  }

  onEvent(ev: SimEvent, state: ClientState, now: number): void {
    switch (ev.e) {
      case 'zone':
        this.addZone(ev);
        break;
      case 'cast': {
        const src = state.byId.get(ev.src);
        if (!src) break;
        this.pulse(src.x, src.y, src.team === state.myTeam ? REL.ownShot : REL.enemyShot, 40, 160, 300, now);
        if (!ev.recast) this.addPreview(ev, state);
        break;
      }
      case 'death':
        this.pulse(ev.x, ev.y, '#c8c4bc', 30, 140, 600, now, true, 0.5);
        break;
    }
  }

  private addPreview(ev: Extract<SimEvent, { e: 'cast' }>, state: ClientState): void {
    const src = state.byId.get(ev.src);
    const ab = src?.champ ? champions[src.champ]?.abilities[ev.slot] : undefined;
    if (!src || !ab || !state.snap) return;
    const [dx, dy] = castDir(src.x, src.y, ev.x, ev.y, src.fx, src.fy);
    this.lastCast.set(ev.src, { ab, ox: src.x, oy: src.y, dx, dy });
    // caster stands still during the wind-up: its tick-end position is the cast origin
    const tel = castTelegraph(ab, ev.rank ?? 1, src.x, src.y, ev.x, ev.y, src.fx, src.fy);
    if (!tel) return;
    // one wind-up per caster: a new cast replaces a lingering preview (e.g. shortened by a cast-speed passive)
    let pv = this.previews.find((q) => q.tel && q.src === ev.src) ?? this.previews.find((q) => !q.tel);
    if (!pv) {
      const view = new ShapeView(this.group);
      pv = { view, views: [view], tel: null, src: 0, team: 0, start: 0, end: 0, handover: false };
      this.previews.push(pv);
    }
    while (pv.views.length < tel.shapes.length) pv.views.push(new ShapeView(this.group));
    // snapshot tick = sim tick of the event + 1 (step() increments after the systems ran). The sim's wind-up end
    // (`at`, incl. cast-speed hooks) wins over the data formula; dashes keep their travel time on top.
    const start = state.snap.tick - 1;
    const end = ev.at !== undefined ? ev.at + tel.ticks - windupTicks(ab) : start + tel.ticks;
    Object.assign(pv, { tel, src: ev.src, team: src.team, start, end, handover: tel.next !== undefined });
  }

  private addZone(ev: ZoneEvent): void {
    let shape: Shape | null = null;
    const last = this.lastCast.get(ev.src);
    const hitAb = last ? hitboxAbility(last.ab) : null;
    if (ev.line) shape = { k: 'line', ...ev.line };
    else if (last && hitAb?.line) shape = lineZone(hitAb, last.ox, last.oy, ev.x, ev.y, last.dx, last.dy); // hook-owned line (Wren W, Lysa E)
    else if (ev.r > 0) shape = { k: 'circle', x: ev.x, y: ev.y, r: ev.r };
    // the zone takes over from the caster's wind-up preview
    for (const pv of this.previews) if (pv.tel?.next === 'zone' && pv.src === ev.src) pv.tel = null;
    if (!shape) return; // radius-less summons (pets) have no ground area
    let z = this.zones.find((q) => !q.ev);
    if (!z) {
      z = { view: new ShapeView(this.group), ev: null, shape: null, follow: false, centre: false };
      this.zones.push(z);
    }
    z.ev = ev;
    z.shape = shape;
    z.follow = ev.follow === true;
    z.centre = shape.k === 'line' && hitAb?.line !== 'forward';
  }

  update(state: ClientState, now: number, showRange: boolean): void {
    const snap = state.snap;
    // fractional sim tick of the displayed state (snapshot tick = sim tick + 1)
    const tick = snap ? snap.tick - 1 + state.alpha : 0;
    const ownCol = (team: number): string => (team === state.myTeam ? REL.ownShot : REL.enemyShot);

    // projectiles + in-flight strips of line skillshots (exact width, to the end of range)
    let n = 0;
    let ns = 0;
    if (snap) {
      const a = state.alpha;
      for (const pr of snap.projectiles) {
        const own = pr.team === state.myTeam;
        const homing = pr.kind !== 1;
        const x = pr.px + (pr.x - pr.px) * a;
        const y = pr.py + (pr.y - pr.py) * a;
        if (!homing && pr.left !== undefined && pr.width > 0) {
          if (ns >= this.strips.length) this.strips.push(new ShapeView(this.group));
          // far end is fixed in the world (end of range); near end = interpolated projectile position
          const st = this.stripShape;
          st.ax = x;
          st.ay = y;
          st.bx = pr.x + pr.dx * pr.left;
          st.by = pr.y + pr.dy * pr.left;
          st.width = pr.width;
          if ((st.bx - x) * pr.dx + (st.by - y) * pr.dy > 0) this.strips[ns++]!.show(st, ownCol(pr.team), 1, 0.16, 0.75);
        }
        if (n >= MAX_PROJ) continue;
        // blob: visual only, capped so wide waves stay readable (the strip is the hitbox)
        const w = Math.max(14, Math.min(pr.width, 140) * (homing ? 0.6 : 0.55));
        this.p.set(x, homing ? 110 : 70, -y);
        this.dir.set(pr.dx || 1, 0, -(pr.dy || 0)).normalize();
        this.q.setFromUnitVectors(this.axis, this.dir);
        this.s.set(homing ? w * 1.8 : w * 2.6, w * 0.7, w * 0.7);
        this.m.compose(this.p, this.q, this.s);
        this.proj.setMatrixAt(n, this.m);
        this.c.set(homing ? (own ? '#bfe4ff' : '#ffc29a') : own ? REL.ownShot : REL.enemyShot);
        this.proj.setColorAt(n, this.c);
        this.s.multiplyScalar(1.9);
        this.m.compose(this.p, this.q, this.s);
        this.halo.setMatrixAt(n, this.m);
        this.halo.setColorAt(n, this.c);
        n++;
      }
    }
    for (let i = ns; i < this.strips.length; i++) this.strips[i]!.hide();
    for (const m of [this.proj, this.halo]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }

    // cast previews: full hitbox during the wind-up, fill = wind-up progress; resolve flash (not for line skillshots)
    for (const pv of this.previews) {
      const tel = pv.tel;
      const caster = state.byId.get(pv.src);
      const stop = !tel || !snap || (caster && !caster.alive) || tick >= pv.end + (pv.handover ? 0 : FLASH);
      if (stop) {
        pv.tel = null;
        for (const v of pv.views) v.hide();
        continue;
      }
      const col = ownCol(pv.team);
      const k = zoneProgress(pv.start, pv.end, tick);
      const flash = tick >= pv.end ? 1 - (tick - pv.end) / FLASH : -1;
      for (let i = 0; i < pv.views.length; i++) {
        const s = tel.shapes[i];
        if (!s) {
          pv.views[i]!.hide();
          continue;
        }
        if (tel.follow && caster && s.k === 'circle') {
          (s as CircleShape).x = state.x(caster);
          (s as CircleShape).y = state.y(caster);
        }
        if (flash >= 0) pv.views[i]!.show(s, col, 1, 0.55 * flash, 0.9 * flash);
        else pv.views[i]!.show(s, col, k, 0.14 + 0.2 * k, tel.approx ? 0.6 : 0.9);
      }
    }

    // zones: rim at the full hitbox, fill grows from start to the resolve tick; persistent zones hold until `until`
    for (const z of this.zones) {
      const ev = z.ev;
      const shape = z.shape;
      if (!ev || !shape) {
        z.view.hide();
        continue;
      }
      const end = ev.until ?? ev.at;
      if (tick > end + FLASH) {
        z.ev = null;
        z.view.hide();
        continue;
      }
      if (z.follow && shape.k === 'circle') {
        const c = state.byId.get(ev.src);
        if (c) (shape.x = state.x(c)), (shape.y = state.y(c));
      }
      const col = ownCol(ev.team);
      const k = zoneProgress(ev.start, ev.at, tick);
      let fillA: number;
      if (tick <= ev.at) fillA = 0.18 + 0.2 * k;
      else if (tick <= end) fillA = tick - ev.at < FLASH ? 0.6 - ((0.6 - 0.32) * (tick - ev.at)) / FLASH : 0.32;
      else fillA = (ev.until !== undefined ? 0.32 : 0.6) * (1 - (tick - end) / FLASH);
      const rimA = tick <= end ? 0.95 : 0.95 * (1 - (tick - end) / FLASH);
      z.view.show(shape, col, k, fillA, rimA, z.centre);
    }

    // pulses
    for (const p of this.pulses) {
      if (!p.active) continue;
      const k = (now - p.t0) / p.dur;
      if (k >= 1) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      p.mesh.scale.setScalar(p.r0 + (p.r1 - p.r0) * k);
      p.mat.opacity = p.a0 * (1 - k);
    }

    // attack range circle (hold C)
    const me = state.me();
    const stats = snap?.me?.stats;
    this.range.visible = showRange && !!me && !!stats;
    if (me && stats) {
      this.range.position.set(state.x(me), 4, -state.y(me));
      this.range.scale.setScalar(stats.range + me.radius);
    }
  }
}
