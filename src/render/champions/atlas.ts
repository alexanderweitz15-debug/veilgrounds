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
import { ANIMS, DIRS, type Anim, type Dir, type Kit } from './types';

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
let scratch: { fig: HTMLCanvasElement; ink: HTMLCanvasElement; out: HTMLCanvasElement; size: number } | null = null;
function canvases(size: number) {
  if (!scratch || scratch.size !== size) {
    const mk = () => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      return c;
    };
    scratch = { fig: mk(), ink: mk(), out: mk(), size };
  }
  return scratch;
}

/**
 * Renders one frame at master resolution (canvas size `res`) and returns the scratch canvas (valid until
 * the next call). Feet stand at (res/2, res*0.92), figure faces per `yaw`.
 */
export function renderMaster(id: string, anim: Anim, yaw: number, frame: number, res = 256): HTMLCanvasElement {
  const { fig, ink, out } = canvases(res);
  const s = res / 256;
  const fctx = fig.getContext('2d')!;
  fctx.setTransform(1, 0, 0, 1, 0, 0);
  fctx.clearRect(0, 0, res, res);
  fctx.lineJoin = 'round';
  fctx.lineCap = 'round';
  const painter = new Painter(fctx, s);
  if (id === 'hark') {
    const view: View = { yaw, elev: 0.42, cx: res / 2, cy: res * 0.9, k: s, fall: 0, lift: 0 };
    drawWolf(new Stage(view), painter, anim, frame);
  } else {
    const kit = KITS[id];
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
  const ictx = ink.getContext('2d')!;
  ictx.globalCompositeOperation = 'source-over';
  ictx.clearRect(0, 0, res, res);
  ictx.drawImage(fig, 0, 0);
  ictx.globalCompositeOperation = 'source-atop';
  ictx.fillStyle = 'rgba(24,16,34,0.8)';
  ictx.fillRect(0, 0, res, res);
  ictx.globalCompositeOperation = 'source-over';
  const octx = out.getContext('2d')!;
  octx.clearRect(0, 0, res, res);
  const R = 2.3 * s;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    octx.drawImage(ink, Math.cos(a) * R, Math.sin(a) * R);
  }
  octx.drawImage(fig, 0, 0);
  return out;
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
  return FRAMES[anim];
}
export function worldSizeOf(id: string): number {
  if (id === 'hark') return HARK.world;
  return KITS[id]?.world ?? 260;
}

// ------------------------------------------------------------------------------------------------ atlas
interface Job {
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
  const jobs: Job[] = [];
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

let down: HTMLCanvasElement | null = null;
function place(ctx: CanvasRenderingContext2D, p: ReturnType<typeof plan>, job: Job, master: number, frames: ChampionAtlas['frames']): void {
  const fs = p.frame;
  const x = (job.cell % p.perRow) * fs;
  const y = Math.floor(job.cell / p.perRow) * fs;
  const src = renderMaster(job.id, job.anim, DIR_YAW[job.dir], job.frame, master);
  // 2 px gutter: draw the figure into the cell inset by 1 px so mips/alphaTest never bleed into neighbours
  // downsample in a small scratch first (cheaper than a scaled draw into the big atlas canvas)
  if (!down || down.width !== fs - 2) {
    down = document.createElement('canvas');
    down.width = down.height = fs - 2;
  }
  const dctx = down.getContext('2d')!;
  dctx.imageSmoothingEnabled = true;
  dctx.imageSmoothingQuality = 'high';
  dctx.clearRect(0, 0, fs - 2, fs - 2);
  dctx.drawImage(src, 0, 0, fs - 2, fs - 2);
  ctx.drawImage(down, x + 1, y + 1);
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
}

function result(p: ReturnType<typeof plan>, canvas: HTMLCanvasElement, frames: ChampionAtlas['frames']): ChampionAtlas {
  const worldSize: Record<string, number> = {};
  for (const id of p.list) worldSize[id] = worldSizeOf(id);
  return { canvas, frameSize: p.frame, frames, worldSize, fps: { ...FPS }, loop: { ...LOOP } };
}

export function buildChampionAtlas(ids: string[], opts: AtlasOptions = {}): ChampionAtlas {
  const p = plan(ids, opts);
  const canvas = document.createElement('canvas');
  canvas.width = p.width;
  canvas.height = p.height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const frames = emptyFrames(p.list);
  const master = opts.master ?? 256;
  p.jobs.forEach((job, i) => {
    place(ctx, p, job, master, frames);
    opts.onProgress?.(i + 1, p.jobs.length);
  });
  return result(p, canvas, frames);
}

/** Yield to the event loop (MessageChannel: not clamped like setTimeout in background tabs). */
function yieldToLoop(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(0);
  });
}

/** Same as buildChampionAtlas but yields to the event loop after every ~40 frames. */
export async function buildChampionAtlasAsync(ids: string[], opts: AtlasOptions = {}): Promise<ChampionAtlas> {
  const p = plan(ids, opts);
  const canvas = document.createElement('canvas');
  canvas.width = p.width;
  canvas.height = p.height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const frames = emptyFrames(p.list);
  const master = opts.master ?? 256;
  for (let i = 0; i < p.jobs.length; i++) {
    place(ctx, p, p.jobs[i]!, master, frames);
    if (i % 40 === 39) {
      opts.onProgress?.(i + 1, p.jobs.length);
      await yieldToLoop();
    }
  }
  opts.onProgress?.(p.jobs.length, p.jobs.length);
  return result(p, canvas, frames);
}
