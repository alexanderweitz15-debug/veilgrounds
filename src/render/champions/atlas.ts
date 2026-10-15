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
import { Painter, Stage, TAU, project, type View } from './core';
import { FPS, FRAMES, LOOP, poseFor } from './anim';
import { bodyOf, drawHumanoid, solveRig } from './humanoid';
import { KITS } from './kits';
import { drawWolf, HARK } from './wolf';
import { MINION_DRAWERS, MINION_KITS } from './minions';
import { ANIMS, DIRS, type Anim, type Dir, type Kit } from './types';

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
  draw(st: Stage, p: Painter, anim: Anim, frame: number): void;
}
// minions are defined here (not registered from game code) so the bake workers know them too
const EXTRA_KITS: Record<string, Kit> = Object.fromEntries(MINION_KITS.map((k) => [k.id, k]));
const DRAWERS: Record<string, SpriteDrawer> = { ...MINION_DRAWERS };
export function registerSpriteKit(kit: Kit): void {
  EXTRA_KITS[kit.id] = kit;
}
export function registerSpriteDrawer(id: string, d: SpriteDrawer): void {
  DRAWERS[id] = d;
}
const kitOf = (id: string): Kit | undefined => KITS[id] ?? EXTRA_KITS[id];

export { ANIMS, DIRS, FRAMES, FPS, LOOP };
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
  fps: Record<Anim, number>;
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
}

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
let scratch: { fig: AnyCanvas; ink: AnyCanvas; out: AnyCanvas; size: number } | null = null;
function canvases(size: number) {
  if (!scratch || scratch.size !== size) scratch = { fig: newCanvas(size), ink: newCanvas(size), out: newCanvas(size), size };
  return scratch;
}

/**
 * Renders one frame at master resolution (canvas size `res`) and returns the scratch canvas (valid until
 * the next call). Feet stand at (res/2, res*0.92), figure faces per `yaw`.
 */
export function renderMaster(id: string, anim: Anim, yaw: number, frame: number, res = 256): AnyCanvas {
  const { fig, ink, out } = canvases(res);
  const s = res / 256;
  const fctx = ctx2d(fig);
  fctx.setTransform(1, 0, 0, 1, 0, 0);
  fctx.clearRect(0, 0, res, res);
  fctx.lineJoin = 'round';
  fctx.lineCap = 'round';
  const painter = new Painter(fctx, s);
  const drawer = DRAWERS[id];
  if (id === 'hark') {
    const view: View = { yaw, elev: 0.42, cx: res / 2, cy: res * 0.9, k: s, fall: 0, lift: 0 };
    drawWolf(new Stage(view), painter, anim, frame);
  } else if (drawer) {
    const view: View = { yaw, elev: 0.42, cx: res / 2, cy: res * drawer.foot, k: s, fall: 0, lift: 0 };
    drawer.draw(new Stage(view), painter, anim, frame);
  } else {
    const kit = kitOf(id);
    if (!kit) throw new Error(`unknown champion '${id}'`);
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
  }
  // value gradient head → feet (Dota rule: brightest at the top, calmer toward the feet)
  fctx.save();
  fctx.setTransform(1, 0, 0, 1, 0, 0);
  fctx.globalCompositeOperation = 'source-atop';
  const vg = fctx.createLinearGradient(0, res * 0.25, 0, res * 0.95);
  vg.addColorStop(0, 'rgba(255,220,170,0.06)');
  vg.addColorStop(0.5, 'rgba(30,20,50,0)');
  vg.addColorStop(1, 'rgba(30,20,50,0.3)');
  fctx.fillStyle = vg;
  fctx.fillRect(0, 0, res, res);
  fctx.restore();
  // outer contour: the figure's own colours darkened (dark local hue, not uniform black), dilated under it
  const ictx = ctx2d(ink);
  ictx.globalCompositeOperation = 'source-over';
  ictx.clearRect(0, 0, res, res);
  ictx.drawImage(fig, 0, 0);
  ictx.globalCompositeOperation = 'source-atop';
  ictx.fillStyle = 'rgba(24,16,34,0.8)';
  ictx.fillRect(0, 0, res, res);
  ictx.globalCompositeOperation = 'source-over';
  const octx = ctx2d(out);
  octx.clearRect(0, 0, res, res);
  const R = 2.3 * s * (drawer?.ink ?? kitOf(id)?.ink ?? 1);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    octx.drawImage(ink, Math.cos(a) * R, Math.sin(a) * R);
  }
  octx.drawImage(fig, 0, 0);
  return out;
}

/** Head centre and radius (master px) of a humanoid's idle frame 0 as rendered by renderMaster (portrait crops). */
export function headAnchor(id: string, yaw: number, res = 256): { x: number; y: number; r: number } | null {
  const kit = kitOf(id);
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
      for (const dir of uniqueDirs) for (let f = 0; f < framesOf(id, anim); f++) jobs.push({ id, anim, dir, frame: f, cell: jobs.length });
  const maxSize = opts.maxSize ?? 4096;
  let frame = opts.frame ?? 128;
  const fits = (fs: number) => Math.floor(maxSize / fs) ** 2 >= jobs.length;
  while (!fits(frame) && frame > 48) frame -= 16;
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
  for (const id of p.list) {
    worldSize[id] = worldSizeOf(id);
    foot[id] = footOf(id);
    top[id] ??= 0.2;
  }
  return { canvas, frameSize: p.frame, frames, worldSize, foot, top, fps: { ...FPS }, loop: { ...LOOP } };
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
): Promise<boolean> {
  const make = opts.worker;
  if (!make || typeof OffscreenCanvas === 'undefined' || typeof Worker === 'undefined') return false;
  const n = Math.max(1, Math.min(opts.workers ?? 6, (navigator.hardwareConcurrency || 4) - 1, Math.ceil(p.jobs.length / 30)));
  const total = p.jobs.length;
  let done = 0;
  const pool: Worker[] = [];
  try {
    await Promise.all(
      Array.from({ length: n }, (_, wi) => {
        const slice = p.jobs.filter((_, j) => j % n === wi);
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
  if (await bakeInWorkers(p, opts, master, ctx, frames, top)) return result(p, canvas, frames, top);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < p.jobs.length; i++) {
    place(ctx, p, p.jobs[i]!, master, frames, top);
    if (i % 40 === 39) {
      opts.onProgress?.(i + 1, p.jobs.length);
      await yieldToLoop();
    }
  }
  opts.onProgress?.(p.jobs.length, p.jobs.length);
  return result(p, canvas, frames, top);
}
