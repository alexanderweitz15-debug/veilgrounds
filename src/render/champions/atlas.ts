// Public API for the game: renders champion frames (procedural paper-doll, gouache style C) and packs them
// into one power-of-two texture atlas.
//
//   const atlas = buildChampionAtlas(['mira', 'renn', ...]);          // sync
//   const atlas = await buildChampionAtlasAsync(ids, { onProgress });  // yields between champions
//   atlas.frames.mira.run.SE[2]  -> { x, y, w, h, u0, v0, u1, v1, flip }
//   drawChampionFrame(ctx, 'mira', 'attack', 'E', 1, x, y, 128)        // previews / UI portraits
//
// UVs follow three.js CanvasTexture defaults (flipY = true: v = 1 at the canvas top). Mirrored directions
// (W, SW, NW when opts.mirror) reuse the E/SE/NE cells with u0/u1 swapped and flip = true.
import { Painter, Stage, TAU, dirOf, len, lerp3, madd, norm, project, sub, type V3, type View } from './core';
import { ATTACK_HIT, CAST_FLEX, CAST_RELEASE, CHAMP_FPS, FPS, FRAMES, LOOP, poseFor } from './anim';
import { bodyOf, drawHumanoid, solveRig } from './humanoid';
import { KITS } from './kits';
import { drawWolf, HARK } from './wolf';
import { VARGRIM_DRAWER } from './cavalry';
import { MINION_DRAWERS, MINION_KITS } from './minions';
import { MONSTER_DRAWERS } from './monsters';
import { ANIMS, DIRS, type Anim, type Dir, type Kit } from './types';
import { STRIP_COLS, stripKey, stripPos } from '../atlasStrip';

/** Canvas in the page or (in a Worker) an OffscreenCanvas. */
export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export function newCanvas(w: number, h = w): AnyCanvas {
  if (typeof document === 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
/** CPU-backed 2D context: ~2.5x faster than a GPU canvas for many small paths that are read back right away. */
export function ctx2d(c: AnyCanvas): CanvasRenderingContext2D {
  return c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
}

/** Non-champion sprite sources baked with the same pipeline (minions, carts): humanoid kits or custom painters. */
export interface SpriteDrawer {
  world: number;
  frames: Record<Anim, number>;
  /** feet position as a fraction of the cell height */
  foot: number;
  /** outer contour width multiplier (default 1) */
  ink?: number;
  /** attack frame of the impact (default: middle frame, rounded down) */
  hit?: number;
  draw(st: Stage, p: Painter, anim: Anim, frame: number): void;
  /** Head centre and radius (master px) of idle frame 0, for portrait crops of champions drawn by a custom painter. */
  head?(yaw: number, res: number): { x: number; y: number; r: number };
}
// minions are defined here (not registered from game code) so the bake workers know them too
const EXTRA_KITS: Record<string, Kit> = Object.fromEntries(MINION_KITS.map((k) => [k.id, k]));
// vargrim: champion with a custom painter (quadruped rider, cavalry.ts); its Kit stub lives in kits.ts
const DRAWERS: Record<string, SpriteDrawer> = { ...MINION_DRAWERS, ...MONSTER_DRAWERS, vargrim: VARGRIM_DRAWER };
export function registerSpriteKit(kit: Kit): void {
  EXTRA_KITS[kit.id] = kit;
}
export function registerSpriteDrawer(id: string, d: SpriteDrawer): void {
  DRAWERS[id] = d;
}
const kitOf = (id: string): Kit | undefined => KITS[id] ?? EXTRA_KITS[id];

export { ANIMS, DIRS, FRAMES, FPS, LOOP, CAST_RELEASE, CAST_FLEX };
export type { Anim, Dir };

export interface FrameRect {
  /** pixel rect in the atlas canvas */
  x: number;
  y: number;
  w: number;
  h: number;
  /** UV rect (u0 < u1 unless flip) */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** horizontally mirrored reuse of another direction */
  flip: boolean;
}

export interface ChampionAtlas {
  canvas: HTMLCanvasElement;
  frameSize: number;
  /** feet position per id as a fraction of the cell height (from the top) */
  foot: Record<string, number>;
  /** topmost opaque row of the idle S frame per id, as a fraction of the cell height (from the top) */
  top: Record<string, number>;
  frames: Record<string, Record<Anim, Record<Dir, FrameRect[]>>>;
  /** suggested world height of a frame cell (same scale as SPRITE_SIZE) */
  worldSize: Record<string, number>;
  /** default playback rates (legacy layout); `rate[id]` overrides per sprite */
  fps: Record<Anim, number>;
  /** playback rate per id and anim (frames per second) */
  rate: Record<string, Record<Anim, number>>;
  /** attack frame of the impact per id (synced to the sim's hit point) */
  hit: Record<string, number>;
  loop: Record<Anim, boolean>;
}

export interface AtlasOptions {
  /** cell size in the atlas (default 128; reduced automatically if the atlas would exceed maxSize²) */
  frame?: number;
  /** max texture edge (default 4096) */
  maxSize?: number;
  /** reuse E/SE/NE for W/SW/NW (default true; false renders all 8 with consistent light) */
  mirror?: boolean;
  /** master render resolution before downsampling (default 256) */
  master?: number;
  /** add the wolf 'hark' automatically when 'ottilie' is present (default true) */
  autoHark?: boolean;
  onProgress?: (done: number, total: number) => void;
  /** bake worker factory (module worker running src/render/spriteWorker.ts); omitted = main thread */
  worker?: () => Worker;
  /** max pool size (default 6, capped at cores - 1) */
  workers?: number;
  /** B7: persistent per-id cell cache (src/render/sheets.ts, Cache Storage); hits skip baking that id. */
  cache?: AtlasCellCache;
  /** S3 stand-in: one still frame per animation and direction (a fraction of the jobs); never combine with `cache`. */
  still?: boolean;
}

/**
 * Persistent cache of baked cells per sprite id. A strip holds the id's atlas cells (incl. 1 px gutter) in job order,
 * STRIP_COLS per row; `top` = head-height fraction (AtlasJob isTopJob). Keys come from `stripKey`.
 */
export interface AtlasCellCache {
  get(key: string): Promise<{ bmp: ImageBitmap; top: number } | null>;
  put(key: string, strip: AnyCanvas, top: number): void;
}
export { STRIP_COLS, stripKey, stripPos } from '../atlasStrip';

export const DIR_YAW: Record<Dir, number> = {
  S: 0,
  SE: Math.PI / 4,
  E: Math.PI / 2,
  NE: (3 * Math.PI) / 4,
  N: Math.PI,
  NW: -(3 * Math.PI) / 4,
  W: -Math.PI / 2,
  SW: -Math.PI / 4,
};
const MIRROR_OF: Partial<Record<Dir, Dir>> = { W: 'E', SW: 'SE', NW: 'NE' };

/** Sim facing angle (rad; 0 = east/screen-right, +PI/2 = north/away from the camera) → sprite direction. */
export function dirFromAngle(rad: number): Dir {
  const a = ((rad % TAU) + TAU) % TAU;
  const i = Math.round(a / (Math.PI / 4)) % 8;
  return (['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'] as const)[i]!;
}

/** All renderable ids: the 26 champions plus 'hark' (Ottilie's wolf). */
export const CHAMPION_IDS: string[] = Object.keys(KITS);
export function championKit(id: string): Kit | undefined {
  return KITS[id];
}

// ------------------------------------------------------------------------------------------------ frame render
let scratch: { fig: AnyCanvas; ink: AnyCanvas; out: AnyCanvas; tmp: AnyCanvas; rim: AnyCanvas; size: number } | null = null;
function canvases(size: number) {
  if (!scratch || scratch.size !== size) scratch = { fig: newCanvas(size), ink: newCanvas(size), out: newCanvas(size), tmp: newCanvas(size), rim: newCanvas(size), size };
  return scratch;
}

// ------------------------------------------------------------------------------------------------ figure finish
// Sprite revision (docs/style/sprite-research.md, "Was wir übernehmen"): figure-level passes after the parts are
// painted. Everything stays inside the silhouette or is opaque: the game draws sprites with alphaTest 0.5.
/**
 * Screen direction toward the low evening sun for the silhouette rim. Straight up on purpose: W/SW/NW reuse the
 * E/SE/NE cells mirrored, so a sideways rim would flip sides; a top rim (head, shoulders, raised weapons) reads the
 * same in all 8 directions. The violet sky fill lives in the per-part shadow tones (core.ts SHADOW_VIOLET).
 */
const SUN_RIM = { x: 0, y: -1 };
const RIM_WARM = '#ffcf8c';
/** attack styles whose strike frame gets a smear (fast melee swings/stabs) */
const SMEAR: Partial<Record<string, 'arc' | 'stab'>> = { chop: 'arc', slash: 'arc', swipe: 'arc', bash: 'arc', thrust: 'stab' };
/** outer contour: dilation taps on a ring (8 keep the line round at <= 2.5 px radius) */
const INK_TAPS = 8;

interface Focal {
  x: number;
  y: number;
  r: number;
  a: number;
}
type Pt = { x: number; y: number };
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** bounding box of the painted figure (alpha > 60, sampled every 2 px) */
function figureBox(c: AnyCanvas, res: number): Box {
  const d = ctx2d(c).getImageData(0, 0, res, res).data;
  let x0 = res;
  let y0 = res;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < res; y += 2) {
    const row = y * res;
    for (let x = 0; x < res; x += 2) {
      if (d[(row + x) * 4 + 3]! > 60) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  if (x1 < 0) return { x0: 0, y0: res * 0.2, x1: res, y1: res * 0.9 };
  return { x0, y0, x1, y1: Math.max(y1, y0 + 8) };
}

/** Thin band of the figure along its edge facing `dir`, tinted; composited onto `dst` (inside the silhouette). */
function edgeLight(dst: CanvasRenderingContext2D, src: AnyCanvas, rim: AnyCanvas, b: Box, dir: Pt, w: number, color: string, alpha: number, top: number, bot: number, fade: number): void {
  const r = ctx2d(rim);
  const bw = b.x1 - b.x0;
  const bh = b.y1 - b.y0;
  r.globalCompositeOperation = 'source-over';
  r.globalAlpha = 1;
  r.clearRect(b.x0, b.y0, bw, bh);
  r.drawImage(src, b.x0, b.y0, bw, bh, b.x0, b.y0, bw, bh);
  r.globalCompositeOperation = 'source-in';
  r.fillStyle = color;
  r.fillRect(b.x0, b.y0, bw, bh);
  // keep only pixels whose neighbour toward the light is outside the figure
  r.globalCompositeOperation = 'destination-out';
  r.drawImage(src, b.x0, b.y0, bw, bh, b.x0 - dir.x * w, b.y0 - dir.y * w, bw, bh);
  // brightest at the head, calmer toward the feet
  r.globalCompositeOperation = 'destination-in';
  const g = r.createLinearGradient(0, top, 0, bot);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.85)');
  g.addColorStop(1, `rgba(0,0,0,${fade})`);
  r.fillStyle = g;
  r.fillRect(b.x0, b.y0, bw, bh);
  r.globalCompositeOperation = 'source-over';
  dst.save();
  dst.globalCompositeOperation = 'source-atop';
  dst.globalAlpha = alpha;
  dst.drawImage(rim, b.x0, b.y0, bw, bh, b.x0, b.y0, bw, bh);
  dst.restore();
}

/**
 * Value/saturation hierarchy, focal light, top rim and the ground-weighted outer contour; returns `out`.
 * Dota 2 art guide: brightest and most saturated at head/hands/weapon, darker and greyer toward the feet.
 * All passes work on the figure's bounding box only (bake time).
 */
function finishFigure(res: number, s: number, inkMul: number, focal: Focal[], smear: Band[] | null): AnyCanvas {
  const { fig, ink, out, tmp, rim } = canvases(res);
  const R = 2.5 * s * inkMul;
  const f = figureBox(fig, res);
  const top = f.y0;
  const bot = f.y1;
  // work box: figure + contour + rim margin (+ sampling step), clamped to the canvas
  const pad = Math.ceil(R * 1.5 + 3 * s + 3);
  const b: Box = { x0: Math.max(0, f.x0 - pad), y0: Math.max(0, f.y0 - pad), x1: Math.min(res, f.x1 + pad), y1: Math.min(res, f.y1 + pad) };
  const bw = b.x1 - b.x0;
  const bh = b.y1 - b.y0;
  const t = ctx2d(tmp);
  t.setTransform(1, 0, 0, 1, 0, 0);
  t.globalAlpha = 1;
  t.globalCompositeOperation = 'source-over';
  t.clearRect(0, 0, res, res);
  t.drawImage(fig, b.x0, b.y0, bw, bh, b.x0, b.y0, bw, bh);
  t.globalCompositeOperation = 'source-atop';
  // value + saturation in one pass: warm light on the upper body; legs mix toward a grey violet (less saturated),
  // then darker toward the feet; contact darkening at the soles
  const vg = t.createLinearGradient(0, top, 0, bot);
  vg.addColorStop(0, 'rgba(255,226,180,0.12)');
  vg.addColorStop(0.32, 'rgba(255,226,180,0)');
  vg.addColorStop(0.55, 'rgba(84,76,96,0)');
  vg.addColorStop(0.8, 'rgba(70,62,84,0.26)');
  vg.addColorStop(0.95, 'rgba(30,22,44,0.42)');
  vg.addColorStop(1, 'rgba(18,12,30,0.6)');
  t.fillStyle = vg;
  t.fillRect(b.x0, b.y0, bw, bh);
  // focal light on the head and weapon hand
  for (const q of focal) {
    const rg = t.createRadialGradient(q.x, q.y, 0, q.x, q.y, q.r);
    rg.addColorStop(0, `rgba(255,232,196,${q.a})`);
    rg.addColorStop(1, 'rgba(255,232,196,0)');
    t.fillStyle = rg;
    t.fillRect(q.x - q.r, q.y - q.r, q.r * 2, q.r * 2);
  }
  t.globalCompositeOperation = 'source-over';
  // silhouette rim from the low sun (top edges, mirror-safe)
  edgeLight(t, fig, rim, b, SUN_RIM, 2.6 * s, RIM_WARM, 0.78, top, bot, 0.3);

  // outer contour: the figure's own colours darkened, dilated under it, heavier toward the ground (mirror-safe)
  const ictx = ctx2d(ink);
  ictx.globalCompositeOperation = 'source-over';
  ictx.clearRect(0, 0, res, res);
  ictx.drawImage(tmp, b.x0, b.y0, bw, bh, b.x0, b.y0, bw, bh);
  ictx.globalCompositeOperation = 'source-atop';
  ictx.fillStyle = 'rgba(24,16,34,0.82)';
  ictx.fillRect(b.x0, b.y0, bw, bh);
  ictx.globalCompositeOperation = 'source-over';
  const octx = ctx2d(out);
  octx.clearRect(0, 0, res, res);
  const oy = R * 0.4;
  for (let i = 0; i < INK_TAPS; i++) {
    const a = (i / INK_TAPS) * TAU + Math.PI / INK_TAPS;
    octx.drawImage(ink, b.x0, b.y0, bw, bh, b.x0 + Math.cos(a) * R, b.y0 + oy + Math.sin(a) * R, bw, bh);
  }
  octx.drawImage(tmp, b.x0, b.y0, bw, bh, b.x0, b.y0, bw, bh);
  if (smear) paintSmear(octx, smear, s);
  return out;
}

/** one smear band: outer edge, inner edge, bright core edge (polygons close outer -> reversed inner/core) */
type Band = [Pt[], Pt[], Pt[]];

/** Opaque smear (alphaTest-safe): pale warm bands with a brighter core and a thin ink lip. */
function paintSmear(c: CanvasRenderingContext2D, bands: Band[], s: number): void {
  const poly = (a: Pt[], b: Pt[]) => {
    const p = new Path2D();
    a.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)));
    for (let i = b.length - 1; i >= 0; i--) p.lineTo(b[i]!.x, b[i]!.y);
    p.closePath();
    return p;
  };
  c.save();
  c.lineJoin = 'round';
  for (const [outer, inner, core] of bands) {
    const band = poly(outer, inner);
    c.strokeStyle = 'rgba(40,24,40,0.75)';
    c.lineWidth = 1.6 * s;
    c.stroke(band);
    c.fillStyle = 'rgba(255,214,150,0.86)';
    c.fill(band);
    c.fillStyle = 'rgba(255,250,236,0.95)';
    c.fill(poly(outer, core));
  }
  c.restore();
}

/**
 * Smear between the coil and the strike weapon positions. Swings ('arc'): a crescent trailing the weapon tip
 * (short weapons such as claws use the whole hand path and a band reaching down to the hand). Stabs ('stab'): two
 * speed lines flanking the weapon behind its tip, so a thrust toward the camera still reads.
 */
function smearShape(view: View, from: { tip: V3; grip: V3 }, to: { tip: V3; grip: V3 }, kind: 'arc' | 'stab', s: number, res: number): Band[] | null {
  const P = (v: V3) => project(view, v);
  if (kind === 'stab') {
    const g = P(to.grip);
    const t = P(to.tip);
    const inCell = (q: Pt) => q.x > 6 * s && q.x < res - 6 * s && q.y > 6 * s && q.y < res - 6 * s;
    let dx = t.x - g.x;
    let dy = t.y - g.y;
    let L = Math.hypot(dx, dy);
    if (L < 10 * s) {
      // weapon points at the camera: use the screen motion of the tip instead
      const t0 = P(from.tip);
      dx = t.x - t0.x;
      dy = t.y - t0.y;
      L = Math.max(Math.hypot(dx, dy), 18 * s);
    }
    const l = Math.hypot(dx, dy) || 1;
    const ux = dx / l;
    const uy = dy / l;
    // long lances leave the cell: pull the streak head back along the weapon until it is visible
    for (let i = 0; i < 60 && !inCell(t); i++) {
      t.x -= ux * 2 * s;
      t.y -= uy * 2 * s;
    }
    const streak = Math.min(L * 0.8, 60 * s);
    const bands: Band[] = [];
    for (const side of [-1, 1]) {
      const off = side * 6 * s;
      const outer: Pt[] = [];
      const inner: Pt[] = [];
      const core: Pt[] = [];
      const N = 6;
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const along = -streak + (streak - 3 * s) * u;
        const w = 3.4 * s * Math.pow(u, 0.8);
        const cx = t.x + ux * along - uy * off;
        const cy = t.y + uy * along + ux * off;
        outer.push({ x: cx - uy * w * side, y: cy + ux * w * side });
        inner.push({ x: cx + uy * w * side * 0.3, y: cy - ux * w * side * 0.3 });
        core.push({ x: cx - uy * w * side * 0.45, y: cy + ux * w * side * 0.45 });
      }
      bands.push([outer, inner, core]);
    }
    return bands;
  }
  const N = 12;
  const T: Pt[] = [];
  const G: Pt[] = [];
  const d0 = sub(from.tip, from.grip);
  const d1 = sub(to.tip, to.grip);
  const l0 = len(d0);
  const l1 = len(d1);
  const short = Math.max(l0, l1) < 30;
  // long weapons: only the last part of the path, so the trail hugs the weapon instead of spanning the whole swing
  const u0 = short ? 0.1 : 0.45;
  for (let i = 0; i <= N; i++) {
    const u = u0 + (1 - u0) * (i / N);
    const grip = lerp3(from.grip, to.grip, u);
    let d = norm(lerp3(norm(d0), norm(d1), u));
    if (!Number.isFinite(d[0])) d = norm(d1);
    T.push(P(madd(grip, d, l0 + (l1 - l0) * u)));
    G.push(P(grip));
  }
  const span = Math.hypot(T[N]!.x - T[0]!.x, T[N]!.y - T[0]!.y);
  if (span < 5 * s) return null;
  const outer: Pt[] = [];
  const inner: Pt[] = [];
  const core: Pt[] = [];
  const reach = short ? 0.95 : 0.55;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const a = T[Math.max(0, i - 1)]!;
    const b = T[Math.min(N, i + 1)]!;
    let nx = -(b.y - a.y);
    let ny = b.x - a.x;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl;
    ny /= nl;
    const q = T[i]!;
    // normal pointing away from the grip (outside of the swing)
    if (nx * (q.x - G[i]!.x) + ny * (q.y - G[i]!.y) < 0) {
      nx = -nx;
      ny = -ny;
    }
    const w = Math.pow(u, 1.3);
    // short weapons: at least ~6 px of band so the trail survives the 112 px cell
    const gx = G[i]!.x - q.x;
    const gy = G[i]!.y - q.y;
    const gl = Math.hypot(gx, gy) || 1;
    const depth = Math.max(gl * reach, short ? 13 * s : 0) * w;
    outer.push({ x: q.x + nx * 1.4 * s * w, y: q.y + ny * 1.4 * s * w });
    inner.push({ x: q.x + (gx / gl) * depth, y: q.y + (gy / gl) * depth });
    core.push({ x: q.x + (gx / gl) * depth * 0.35, y: q.y + (gy / gl) * depth * 0.35 });
  }
  return [[outer, inner, core]];
}

/** Weapon tip/grip of a rig (props report it through Stage.tip; fallback: along the main-hand aim). */
function weaponOf(st: Stage, rig: ReturnType<typeof solveRig>, pose: ReturnType<typeof poseFor>): { tip: V3; grip: V3 } {
  if (st.tip) return st.tip;
  const grip = rig.handR.o;
  return { grip, tip: madd(grip, norm(dirOf(rig.chest, pose.aim)), rig.body.H * 0.3) };
}

/**
 * Renders one frame at master resolution (canvas size `res`) and returns the scratch canvas (valid until
 * the next call). Feet stand at (res/2, res*0.92), figure faces per `yaw`.
 */
export function renderMaster(id: string, anim: Anim, yaw: number, frame: number, res = 256): AnyCanvas {
  const { fig } = canvases(res);
  const s = res / 256;
  const fctx = ctx2d(fig);
  fctx.setTransform(1, 0, 0, 1, 0, 0);
  fctx.clearRect(0, 0, res, res);
  fctx.lineJoin = 'round';
  fctx.lineCap = 'round';
  const painter = new Painter(fctx, s);
  const drawer = DRAWERS[id];
  const focal: Focal[] = [];
  let smear: Band[] | null = null;
  if (id === 'hark') {
    const view: View = { yaw, elev: 0.42, cx: res / 2, cy: res * 0.9, k: s, fall: 0, lift: 0 };
    drawWolf(new Stage(view), painter, anim, frame);
  } else if (drawer) {
    const view: View = { yaw, elev: 0.42, cx: res / 2, cy: res * drawer.foot, k: s, fall: 0, lift: 0 };
    drawer.draw(new Stage(view), painter, anim, frame);
  } else {
    // ponytail: a champion without a sprite kit (e.g. a new champion merged before its art) is drawn with a stand-in
    // kit instead of throwing - one missing kit used to abort the whole match atlas (no sprites at all).
    const kit = kitOf(id) ?? KITS.mira!;
    if (!kitOf(id)) console.warn(`sprite kit missing for '${id}', drawing a stand-in`);
    const pose = poseFor(kit, anim, frame);
    const b = bodyOf(kit);
    const view: View = { yaw, elev: 0.42, cx: res / 2, cy: res * 0.935, k: s * 1.1, fall: pose.fall, lift: Math.sin(pose.fall) * (b.chestD + 3) };
    if (pose.fall > 0.01) {
      // keep a falling/lying body inside the cell: shift so the hips stay near the centre
      const head = project(view, [0, b.H, 0]);
      const feet = project(view, [0, 0, 0]);
      const k2 = Math.min(1, pose.fall / 1.48);
      view.cx += (res / 2 - (head.x + feet.x) / 2) * k2;
      const low = Math.max(head.y, feet.y) + 6 * s;
      if (low > res * 0.95) view.cy -= low - res * 0.95;
    }
    const st = new Stage(view);
    const rig = solveRig(kit, pose);
    drawHumanoid(st, rig, pose, kit);
    for (const prop of kit.props) prop({ st, rig, pose, kit });
    st.render(painter);
    if (pose.fall < 0.01) {
      const hq = project(view, rig.head.o);
      focal.push({ x: hq.x, y: hq.y, r: rig.body.headR * view.k * 2.6, a: 0.16 });
      const w = weaponOf(st, rig, pose);
      const wq = project(view, lerp3(w.grip, w.tip, 0.5));
      focal.push({ x: wq.x, y: wq.y, r: rig.body.H * 0.16 * view.k, a: 0.1 });
    }
    // smear arc on the strike frame of fast melee attacks: coil -> strike path of the weapon tip
    const style = kit.attack ? SMEAR[kit.attack] : undefined;
    if (style && anim === 'attack' && frame > 0 && frame === hitOf(id)) {
      const pose0 = poseFor(kit, anim, frame - 1);
      const rig0 = solveRig(kit, pose0);
      const st0 = new Stage(view);
      for (const prop of kit.props) prop({ st: st0, rig: rig0, pose: pose0, kit });
      smear = smearShape(view, weaponOf(st0, rig0, pose0), weaponOf(st, rig, pose), style, s, res);
    }
  }
  return finishFigure(res, s, drawer?.ink ?? kitOf(id)?.ink ?? 1, focal, smear);
}

/** Head centre and radius (master px) of a humanoid's idle frame 0 as rendered by renderMaster (portrait crops). */
export function headAnchor(id: string, yaw: number, res = 256): { x: number; y: number; r: number } | null {
  const kit = kitOf(id);
  if (DRAWERS[id]?.head) return DRAWERS[id]!.head!(yaw, res);
  if (!kit || DRAWERS[id] || id === 'hark') return null;
  const s = res / 256;
  const rig = solveRig(kit, poseFor(kit, 'idle', 0));
  const view: View = { yaw, elev: 0.42, cx: res / 2, cy: res * 0.935, k: s * 1.1, fall: 0, lift: 0 };
  const q = project(view, rig.head.o);
  return { x: q.x, y: q.y, r: rig.body.headR * view.k };
}

/**
 * Draws one frame into any 2D context: (x, y) = top-left of a size×size cell, feet near the bottom centre.
 * `frame` is an index (wrapped). `master` = internal resolution (default: max(256, size)).
 */
export function drawChampionFrame(ctx: CanvasRenderingContext2D, id: string, anim: Anim, dir: Dir, frame: number, x: number, y: number, size: number, master?: number): void {
  const res = master ?? Math.max(256, Math.ceil(size / 64) * 64);
  const src = renderMaster(id, anim, DIR_YAW[dir], frame, res);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, x, y, size, size);
  ctx.restore();
}

/** Frame counts for an id (Hark has no cast). */
export function framesOf(id: string, anim: Anim): number {
  if (id === 'hark') return HARK.frames[anim];
  const d = DRAWERS[id];
  if (d) return d.frames[anim];
  return kitOf(id)?.frames?.[anim] ?? FRAMES[anim];
}
/** Attack frame of the impact (the sim's hit point) for an id. */
export function hitOf(id: string): number {
  const n = framesOf(id, 'attack');
  if (id === 'hark') return 2;
  const d = DRAWERS[id];
  if (d) return d.hit ?? Math.floor((n - 1) / 2);
  return n >= 5 ? ATTACK_HIT : 1;
}
/** Playback rates for an id: champions use the longer layout's rates, everything else the legacy ones. */
export function rateOf(id: string): Record<Anim, number> {
  return { ...(KITS[id] ? CHAMP_FPS : FPS) };
}
export function worldSizeOf(id: string): number {
  if (id === 'hark') return HARK.world;
  return DRAWERS[id]?.world ?? kitOf(id)?.world ?? 260;
}
/** Feet position of an id's frames as a fraction of the cell height. */
export function footOf(id: string): number {
  if (id === 'hark') return 0.9;
  return DRAWERS[id]?.foot ?? 0.935;
}

// ------------------------------------------------------------------------------------------------ atlas
export interface AtlasJob {
  id: string;
  anim: Anim;
  dir: Dir;
  frame: number;
  cell: number;
}

function plan(ids: string[], opts: AtlasOptions) {
  const list = [...ids];
  if ((opts.autoHark ?? true) && list.includes('ottilie') && !list.includes('hark')) list.push('hark');
  const mirror = opts.mirror ?? true;
  const uniqueDirs = DIRS.filter((d) => !(mirror && MIRROR_OF[d]));
  const jobs: AtlasJob[] = [];
  for (const id of list)
    for (const anim of ANIMS)
      for (const dir of uniqueDirs) for (let f = 0; f < (opts.still ? 1 : framesOf(id, anim)); f++) jobs.push({ id, anim, dir, frame: f, cell: jobs.length });
  const maxSize = opts.maxSize ?? 4096;
  let frame = opts.frame ?? 128;
  const fits = (fs: number) => Math.floor(maxSize / fs) ** 2 >= jobs.length;
  while (!fits(frame) && frame > 48) frame -= 8;
  const cols = Math.floor(maxSize / frame);
  const width = Math.min(maxSize, pot(Math.min(cols, jobs.length) * frame));
  const perRow = Math.floor(width / frame);
  const height = pot(Math.ceil(jobs.length / perRow) * frame);
  return { list, mirror, jobs, frame, width, height, perRow };
}
type Plan = ReturnType<typeof plan>;
const pot = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

function emptyFrames(list: string[]): ChampionAtlas['frames'] {
  const frames: ChampionAtlas['frames'] = {};
  for (const id of list) {
    const a = {} as Record<Anim, Record<Dir, FrameRect[]>>;
    for (const anim of ANIMS) {
      const d = {} as Record<Dir, FrameRect[]>;
      for (const dir of DIRS) d[dir] = [];
      a[anim] = d;
    }
    frames[id] = a;
  }
  return frames;
}

let down: AnyCanvas | null = null;
/**
 * Renders one atlas job, downsampled to (cell - 2)² (1 px gutter on each side so mips/alphaTest never bleed into
 * neighbours). Returns a scratch canvas valid until the next call. Used on the main thread and in bake workers.
 */
export function renderCell(job: AtlasJob, master: number, cell: number): AnyCanvas {
  const src = renderMaster(job.id, job.anim, DIR_YAW[job.dir], job.frame, master);
  // downsample in a small scratch first (cheaper than a scaled draw into the big atlas canvas)
  if (!down || down.width !== cell - 2) down = newCanvas(cell - 2);
  const dctx = ctx2d(down);
  dctx.imageSmoothingEnabled = true;
  dctx.imageSmoothingQuality = 'high';
  dctx.clearRect(0, 0, cell - 2, cell - 2);
  dctx.drawImage(src, 0, 0, cell - 2, cell - 2);
  return down;
}
/** The job whose topmost opaque row defines `top` (head height for health bars / picking). */
export const isTopJob = (j: AtlasJob): boolean => j.anim === 'idle' && j.dir === 'S' && j.frame === 0;
/** Topmost row with alpha > 50% of a renderCell result, as a fraction of the full cell. */
export function topRow(c: AnyCanvas, cell: number): number {
  const n = c.width;
  const data = ctx2d(c).getImageData(0, 0, n, n).data;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (data[(y * n + x) * 4 + 3]! > 128) return (y + 1) / cell;
  return 0.2;
}

function record(p: Plan, job: AtlasJob, frames: ChampionAtlas['frames']): { x: number; y: number } {
  const fs = p.frame;
  const x = (job.cell % p.perRow) * fs;
  const y = Math.floor(job.cell / p.perRow) * fs;
  const W = p.width;
  const H = p.height;
  const rect: FrameRect = {
    x,
    y,
    w: fs,
    h: fs,
    u0: (x + 0.5) / W,
    u1: (x + fs - 0.5) / W,
    v1: 1 - (y + 0.5) / H,
    v0: 1 - (y + fs - 0.5) / H,
    flip: false,
  };
  frames[job.id]![job.anim][job.dir][job.frame] = rect;
  if (p.mirror) {
    for (const [m, srcDir] of Object.entries(MIRROR_OF) as [Dir, Dir][]) {
      if (srcDir === job.dir) frames[job.id]![job.anim][m][job.frame] = { ...rect, u0: rect.u1, u1: rect.u0, flip: true };
    }
  }
  return { x, y };
}

function place(ctx: CanvasRenderingContext2D, p: Plan, job: AtlasJob, master: number, frames: ChampionAtlas['frames'], top: Record<string, number>): void {
  const c = renderCell(job, master, p.frame);
  const { x, y } = record(p, job, frames);
  ctx.drawImage(c, x + 1, y + 1);
  if (isTopJob(job)) top[job.id] = topRow(c, p.frame);
}

function result(p: Plan, canvas: HTMLCanvasElement, frames: ChampionAtlas['frames'], top: Record<string, number>): ChampionAtlas {
  const worldSize: Record<string, number> = {};
  const foot: Record<string, number> = {};
  const rate: Record<string, Record<Anim, number>> = {};
  const hit: Record<string, number> = {};
  for (const id of p.list) {
    worldSize[id] = worldSizeOf(id);
    foot[id] = footOf(id);
    rate[id] = rateOf(id);
    hit[id] = hitOf(id);
    top[id] ??= 0.2;
  }
  return { canvas, frameSize: p.frame, frames, worldSize, foot, top, fps: { ...FPS }, rate, hit, loop: { ...LOOP } };
}

function atlasCanvas(p: Plan): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = p.width;
  canvas.height = p.height;
  const ctx = ctx2d(canvas);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

export function buildChampionAtlas(ids: string[], opts: AtlasOptions = {}): ChampionAtlas {
  const p = plan(ids, opts);
  const { canvas, ctx } = atlasCanvas(p);
  const frames = emptyFrames(p.list);
  const top: Record<string, number> = {};
  const master = opts.master ?? 256;
  p.jobs.forEach((job, i) => {
    place(ctx, p, job, master, frames, top);
    opts.onProgress?.(i + 1, p.jobs.length);
  });
  return result(p, canvas, frames, top);
}

/** Yield to the event loop (MessageChannel: not clamped like setTimeout in background tabs). */
function yieldToLoop(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(0);
  });
}

/** Message protocol of a bake worker (see src/render/spriteWorker.ts). */
export interface BakeRequest {
  master: number;
  cell: number;
  jobs: AtlasJob[];
}
export interface BakeResult {
  cell: number;
  bmp: ImageBitmap;
  top?: number;
}

/** Renders the jobs in a worker pool; false if a worker failed (the caller then bakes on the main thread). */
async function bakeInWorkers(
  p: Plan,
  opts: AtlasOptions,
  master: number,
  ctx: CanvasRenderingContext2D,
  frames: ChampionAtlas['frames'],
  top: Record<string, number>,
  jobs: readonly AtlasJob[],
  done0: number,
): Promise<boolean> {
  const make = opts.worker;
  if (!make || typeof OffscreenCanvas === 'undefined' || typeof Worker === 'undefined') return false;
  const n = Math.max(1, Math.min(opts.workers ?? 6, (navigator.hardwareConcurrency || 4) - 1, Math.ceil(jobs.length / 30)));
  const total = p.jobs.length;
  let done = done0;
  const pool: Worker[] = [];
  try {
    await Promise.all(
      Array.from({ length: n }, (_, wi) => {
        const slice = jobs.filter((_, j) => j % n === wi);
        if (!slice.length) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
          const w = make();
          pool.push(w);
          let left = slice.length;
          w.onmessage = (ev: MessageEvent<BakeResult>) => {
            const r = ev.data;
            const job = p.jobs[r.cell]!;
            const { x, y } = record(p, job, frames);
            ctx.drawImage(r.bmp, x + 1, y + 1);
            r.bmp.close();
            if (r.top !== undefined) top[job.id] = r.top;
            opts.onProgress?.(++done, total);
            if (--left === 0) resolve();
          };
          w.onerror = (e) => reject(e);
          const req: BakeRequest = { master, cell: p.frame, jobs: slice };
          w.postMessage(req);
        });
      }),
    );
    return true;
  } catch (e) {
    console.warn('sprite bake workers failed, baking on the main thread', e);
    return false;
  } finally {
    for (const w of pool) w.terminate();
  }
}

/**
 * Same as buildChampionAtlas but asynchronous: in a worker pool when `opts.worker` is given (about cores-times
 * faster), otherwise on the main thread, yielding to the event loop after every ~40 frames.
 */
export async function buildChampionAtlasAsync(ids: string[], opts: AtlasOptions = {}): Promise<ChampionAtlas> {
  const p = plan(ids, opts);
  const { canvas, ctx } = atlasCanvas(p);
  const frames = emptyFrames(p.list);
  const top: Record<string, number> = {};
  const master = opts.master ?? 256;
  const mirror = opts.mirror ?? true;
  // B7: ids found in the persistent cache are blitted from their strip, only the rest is baked
  const cached = new Set<string>();
  // the key uses the requested cell size: a crowded atlas (smaller p.frame) scales the cached cells down
  const want = opts.frame ?? 128;
  if (opts.cache) {
    const hits = await Promise.all(p.list.map((id) => opts.cache!.get(stripKey(id, master, want, mirror)).catch(() => null)));
    p.list.forEach((id, i) => {
      const h = hits[i];
      if (!h) return;
      const jobs = p.jobs.filter((j) => j.id === id);
      const src = Math.round(h.bmp.width / Math.min(jobs.length, STRIP_COLS));
      const need = stripPos(jobs.length - 1, src);
      if (src < p.frame || h.bmp.height < need.y + src) return h.bmp.close(); // stale layout
      jobs.forEach((job, k) => {
        const s = stripPos(k, src);
        const { x, y } = record(p, job, frames);
        // content only (1 px gutter on both sides stays transparent)
        ctx.drawImage(h.bmp, s.x + 1, s.y + 1, src - 2, src - 2, x + 1, y + 1, p.frame - 2, p.frame - 2);
      });
      h.bmp.close();
      top[id] = h.top;
      cached.add(id);
    });
  }
  const todo = p.jobs.filter((j) => !cached.has(j.id));
  const done0 = p.jobs.length - todo.length;
  opts.onProgress?.(done0, p.jobs.length);
  if (todo.length && !(await bakeInWorkers(p, opts, master, ctx, frames, top, todo, done0))) {
    for (const job of todo) ctx.clearRect(...cellRect(p, job));
    for (let i = 0; i < todo.length; i++) {
      place(ctx, p, todo[i]!, master, frames, top);
      if (i % 40 === 39) {
        opts.onProgress?.(done0 + i + 1, p.jobs.length);
        await yieldToLoop();
      }
    }
  }
  opts.onProgress?.(p.jobs.length, p.jobs.length);
  if (opts.cache && todo.length) storeStrips(p, canvas, top, todo, opts.cache, master, want, mirror);
  return result(p, canvas, frames, top);
}

/** Atlas rectangle of a job's cell. */
function cellRect(p: Plan, job: AtlasJob): [number, number, number, number] {
  return [(job.cell % p.perRow) * p.frame, Math.floor(job.cell / p.perRow) * p.frame, p.frame, p.frame];
}

/** Copies every freshly baked id's cells into a strip and hands it to the cache (after the atlas is returned). */
function storeStrips(p: Plan, canvas: AnyCanvas, top: Record<string, number>, baked: readonly AtlasJob[], cache: AtlasCellCache, master: number, want: number, mirror: boolean): void {
  const ids = [...new Set(baked.map((j) => j.id))];
  setTimeout(() => {
    for (const id of ids) {
      const jobs = p.jobs.filter((j) => j.id === id);
      const rows = Math.ceil(jobs.length / STRIP_COLS);
      const strip = newCanvas(Math.min(jobs.length, STRIP_COLS) * p.frame, rows * p.frame);
      const sctx = ctx2d(strip);
      jobs.forEach((job, k) => {
        const s = stripPos(k, p.frame);
        const [x, y, w, h] = cellRect(p, job);
        sctx.drawImage(canvas, x, y, w, h, s.x, s.y, w, h);
      });
      cache.put(stripKey(id, master, want, mirror), strip, top[id] ?? 0.2);
    }
  }, 0);
}
