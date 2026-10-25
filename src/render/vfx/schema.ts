// A4 VFX: format of one effect definition (src/render/vfx/effects/<id>.json, described in docs/VFX-FORMAT.md) and its
// validator. Pure: no THREE, no DOM. `validateEffect` never throws; it returns every problem it finds so that the
// runtime can skip a broken file (with a warning) and the test can demand an empty list.

export const VFX_CLASSES = ['projectile', 'hit', 'aura', 'telegraph', 'ultimate'] as const;
export type VfxClass = (typeof VFX_CLASSES)[number];
export const BLENDS = ['add', 'normal'] as const;
export type Blend = (typeof BLENDS)[number];
/** Glyph cells of the procedural atlas (src/render/vfx/glyphs.ts), index = position. */
export const GLYPHS = ['dot', 'spark', 'ring', 'shard', 'smoke', 'streak', 'cross', 'wisp'] as const;
export type Glyph = (typeof GLYPHS)[number];
export const SHAPES = ['point', 'disc', 'ring', 'line', 'cone'] as const;
export type Shape = (typeof SHAPES)[number];
export const DIRS = ['radial', 'outward', 'forward', 'inward'] as const;
export type Dir = (typeof DIRS)[number];
export const TINT_MODES = ['none', 'hue', 'team'] as const;
export type TintMode = (typeof TINT_MODES)[number];

/** Hard caps per effect class: ring size of the class pool (per blend mode) and spawns accepted per frame. */
export const CLASS_CAP: Readonly<Record<VfxClass, number>> = { projectile: 1024, hit: 1024, aura: 1024, telegraph: 512, ultimate: 1024 };
export const CLASS_FRAME_BUDGET: Readonly<Record<VfxClass, number>> = { projectile: 160, hit: 300, aura: 160, telegraph: 120, ultimate: 400 };
/** Samples of the over-life curves in the GPU table. */
export const CURVE_SAMPLES = 16;

export type Range = [number, number];
export type Stop<T> = [number, T];

export interface EffectDef {
  id: string;
  /** Default pool; an emit call may name another one (e.g. a trail kind that also bursts). */
  class: VfxClass;
  blend: Blend;
  glyph: Glyph;
  /** none: colour from colorOverLife only | hue: HSL from the emit hue | team: own/enemy relation colour. */
  tint: { mode: TintMode; saturation: number; lightness: number; hueJitter: number; lightnessJitter: number };
  /** ms, per particle random in [min, max]. */
  life: Range;
  /** Default burst count of one emit call. */
  count: number;
  emitter: {
    shape: Shape;
    /** disc/ring/cone radius (world units) */
    radius: number;
    thickness: number;
    /** cone: full angle in degrees */
    angle: number;
    /** square half-extent of the position jitter */
    jitter: number;
    jitterH: number;
    height: Range;
  };
  velocity: { dir: Dir; speed: Range; rise: Range; back: number };
  /** Downward acceleration (world units/s^2) and linear drag (1/s). */
  gravity: number;
  drag: number;
  /** World units at distance-attenuation scale 1 (like THREE.PointsMaterial.size). */
  size: Range;
  sizeOverLife: Stop<number>[];
  colorOverLife: Stop<string>[];
  alphaOverLife: Stop<number>[];
  /** 0..1 depth of the brightness shimmer. */
  flicker: number;
  /** rad/s, random in [min, max]. */
  spin: Range;
  /** Hard cap on simultaneously living particles of this effect. */
  maxLive: number;
}

const ID_RE = /^[a-z][a-z0-9_]{1,40}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRange = (v: unknown): v is Range => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]) && v[0] <= v[1];

export interface Validated {
  def: EffectDef | null;
  errors: string[];
}

/** Keys allowed per object level (typos are errors, not silently ignored). */
const TOP_KEYS = ['_doc', 'id', 'class', 'blend', 'glyph', 'tint', 'life', 'count', 'emitter', 'velocity', 'gravity', 'drag', 'size', 'sizeOverLife', 'colorOverLife', 'alphaOverLife', 'flicker', 'spin', 'maxLive'];
const TINT_KEYS = ['mode', 'saturation', 'lightness', 'hueJitter', 'lightnessJitter'];
const EMITTER_KEYS = ['shape', 'radius', 'thickness', 'angle', 'jitter', 'jitterH', 'height'];
const VEL_KEYS = ['dir', 'speed', 'rise', 'back'];

/** Validate one raw JSON object and fill defaults. `where` names the file in the messages. */
export function validateEffect(raw: unknown, where: string): Validated {
  const errors: string[] = [];
  const err = (m: string): void => void errors.push(`${where}: ${m}`);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { def: null, errors: [`${where}: not an object`] };
  const o = raw as Record<string, unknown>;
  const checkKeys = (obj: Record<string, unknown>, allowed: string[], path: string): void => {
    for (const k of Object.keys(obj)) if (!allowed.includes(k)) err(`unknown key ${path}${k}`);
  };
  const sub = (k: string, allowed: string[]): Record<string, unknown> => {
    const v = o[k];
    if (v === undefined) return {};
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      err(`${k} must be an object`);
      return {};
    }
    checkKeys(v as Record<string, unknown>, allowed, `${k}.`);
    return v as Record<string, unknown>;
  };
  const num = (src: Record<string, unknown>, k: string, dflt: number, min: number, max: number, path = ''): number => {
    const v = src[k] ?? dflt;
    if (!isNum(v) || v < min || v > max) {
      err(`${path}${k} must be a number in [${min}, ${max}]`);
      return dflt;
    }
    return v;
  };
  const range = (src: Record<string, unknown>, k: string, dflt: Range, min: number, max: number, path = ''): Range => {
    const v = src[k] ?? dflt;
    if (!isRange(v) || v[0] < min || v[1] > max) {
      err(`${path}${k} must be [min, max] with min <= max inside [${min}, ${max}]`);
      return dflt;
    }
    return [v[0], v[1]];
  };
  const oneOf = <T extends string>(src: Record<string, unknown>, k: string, list: readonly T[], dflt: T | null, path = ''): T => {
    const v = src[k] ?? dflt;
    if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) {
      err(`${path}${k} must be one of ${list.join('|')}`);
      return dflt ?? list[0]!;
    }
    return v as T;
  };
  const stops = <T>(k: string, dflt: Stop<T>[], ok: (v: unknown) => boolean, what: string): Stop<T>[] => {
    const v = o[k] ?? dflt;
    if (!Array.isArray(v) || v.length < 2 || v.length > CURVE_SAMPLES) {
      err(`${k} must be a list of 2..${CURVE_SAMPLES} [t, ${what}] stops`);
      return dflt;
    }
    let last = -1;
    for (const s of v) {
      if (!Array.isArray(s) || s.length !== 2 || !isNum(s[0]) || s[0] < 0 || s[0] > 1 || s[0] < last || !ok(s[1])) {
        err(`${k}: every stop is [t in 0..1 ascending, ${what}]`);
        return dflt;
      }
      last = s[0];
    }
    if (v[0][0] !== 0 || v[v.length - 1][0] !== 1) {
      err(`${k}: first stop must be at t=0 and the last at t=1`);
      return dflt;
    }
    return v as Stop<T>[];
  };

  checkKeys(o, TOP_KEYS, '');
  const id = typeof o.id === 'string' && ID_RE.test(o.id) ? o.id : (err('id must match ' + String(ID_RE)), 'invalid');
  const cls = oneOf(o, 'class', VFX_CLASSES, null);
  const tintO = sub('tint', TINT_KEYS);
  const emO = sub('emitter', EMITTER_KEYS);
  const velO = sub('velocity', VEL_KEYS);
  const def: EffectDef = {
    id,
    class: cls,
    blend: oneOf(o, 'blend', BLENDS, 'add'),
    glyph: oneOf(o, 'glyph', GLYPHS, 'dot'),
    tint: {
      mode: oneOf(tintO, 'mode', TINT_MODES, 'none', 'tint.'),
      saturation: num(tintO, 'saturation', 0.95, 0, 1, 'tint.'),
      lightness: num(tintO, 'lightness', 0.6, 0, 1, 'tint.'),
      hueJitter: num(tintO, 'hueJitter', 0, 0, 180, 'tint.'),
      lightnessJitter: num(tintO, 'lightnessJitter', 0, 0, 0.5, 'tint.'),
    },
    life: range(o, 'life', [400, 600], 16, 10000),
    count: num(o, 'count', 8, 0, 400),
    emitter: {
      shape: oneOf(emO, 'shape', SHAPES, 'point', 'emitter.'),
      radius: num(emO, 'radius', 0, 0, 3000, 'emitter.'),
      thickness: num(emO, 'thickness', 0, 0, 500, 'emitter.'),
      angle: num(emO, 'angle', 60, 1, 360, 'emitter.'),
      jitter: num(emO, 'jitter', 0, 0, 500, 'emitter.'),
      jitterH: num(emO, 'jitterH', 0, 0, 500, 'emitter.'),
      height: range(emO, 'height', [0, 0], -200, 1000, 'emitter.'),
    },
    velocity: {
      dir: oneOf(velO, 'dir', DIRS, 'radial', 'velocity.'),
      speed: range(velO, 'speed', [0, 0], 0, 3000, 'velocity.'),
      rise: range(velO, 'rise', [0, 0], -2000, 2000, 'velocity.'),
      back: num(velO, 'back', 0, -2000, 2000, 'velocity.'),
    },
    gravity: num(o, 'gravity', 0, -3000, 3000),
    drag: num(o, 'drag', 0, 0, 30),
    size: range(o, 'size', [100, 100], 1, 1000),
    sizeOverLife: stops<number>('sizeOverLife', [[0, 1], [1, 1]], (v) => isNum(v) && v >= 0 && v <= 10, 'size factor 0..10'),
    colorOverLife: stops<string>('colorOverLife', [[0, '#ffffff'], [1, '#ffffff']], (v) => typeof v === 'string' && HEX_RE.test(v), '#rrggbb'),
    alphaOverLife: stops<number>('alphaOverLife', [[0, 1], [1, 0]], (v) => isNum(v) && v >= 0 && v <= 1, 'alpha 0..1'),
    flicker: num(o, 'flicker', 0, 0, 1),
    spin: range(o, 'spin', [0, 0], -40, 40),
    maxLive: num(o, 'maxLive', 256, 1, 4096),
  };
  if (def.maxLive > CLASS_CAP[cls]) err(`maxLive ${def.maxLive} exceeds the class cap ${CLASS_CAP[cls]} of "${cls}"`);
  if (def.count > CLASS_FRAME_BUDGET[cls]) err(`count ${def.count} exceeds the per-frame budget ${CLASS_FRAME_BUDGET[cls]} of "${cls}"`);
  if (def.emitter.shape === 'ring' && def.emitter.radius <= 0) err('emitter.shape "ring" needs radius > 0 (an emit call may override it)');
  return { def: errors.length ? null : def, errors };
}
