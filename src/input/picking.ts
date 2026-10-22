// Unit picking under the cursor (agent C, C8). One function serves the hover highlight, right-click attack,
// left-click select, casts and pings, so what is highlighted is what a click hits. Pure screen-space maths: the
// projection comes in through PickView (render/world.ts adapts its camera), which keeps this testable without WebGL.
//
// Hostile units (other team, neutral monsters) rank before allies and the own champion: an ally minion standing in
// the enemy wave, or the own HP bar hanging over the minions' feet, must not swallow last hits. Within each class,
// hit areas best first:
//   1. the unit's HP bar (dark frame incl. the champion level box) - clicking a bar targets its unit; the bar drawn
//      last (on top) wins;
//   2. the drawn sprite body (an ellipse over the sprite, SPRITE_HALF_W x its height): where sprites overlap, the
//      unit standing in front (feet lower on screen) wins, because that is the one drawn on top;
//   3. the click area: the sim radius projected to the screen plus PICK_MARGIN_PX, swept from the ground point up
//      the body axis (a capsule); the unit whose drawn body is closest to the cursor wins.
// No champion bonus: the "target champions only" key (controller.ts) filters through `accept` instead.
import type { SnapEntity } from '../sim/snapshot';
import { barHitRect, barLayout, barLift, type Rect } from '../ui/hpBarGeom';

/** Extra screen pixels around the projected sim radius (minions: 48 radius ~ 20 px at the default zoom -> 28). */
export const PICK_MARGIN_PX = 8;
/** Smallest core radius in px (tiny units, far zoom). */
export const MIN_CORE_PX = 16;
/** Drawn sprite body: half-width as a share of the on-screen height (feet to bar anchor), at least 6 px. */
export const SPRITE_HALF_W = 0.22;

export interface ScreenPt {
  sx: number;
  sy: number;
}

/** Camera adapter: CSS-pixel projection of sim points. */
export interface PickView {
  /** Sim point (x, y) at height z -> CSS px in the canvas. */
  project(x: number, y: number, z: number): ScreenPt & { behind: boolean };
  /** Top anchor of the unit (where its HP bar sits) in CSS px, or null when off-screen. */
  barAnchor(e: SnapEntity, x: number, y: number): ScreenPt | null;
}

/** What the picker needs from the client state (ClientState satisfies it). */
export interface PickState {
  snap: { entities: SnapEntity[] } | null;
  myTeam: number;
  x(e: SnapEntity): number;
  y(e: SnapEntity): number;
}

/** Screen-space body of one unit. */
export interface PickBody {
  e: SnapEntity;
  /** Ground point (feet). */
  foot: ScreenPt;
  /** Bar anchor (just above the sprite top). */
  head: ScreenPt;
  /** Top of the click-area axis: the capsule's upper cap reaches 40 % of a core radius above the bar anchor. */
  top: ScreenPt;
  /** Projected sim radius (px) and the click-area radius (core + margin). */
  core: number;
  reach: number;
  /** Half-width of the drawn sprite body (px). */
  half: number;
  /** Ground ellipse squash: px below the feet count `squash` times (pitched camera: ry ~ 0.83 rx). */
  squash: number;
  bar: Rect | null;
  hostile: boolean;
}

export function pickBody(state: PickState, view: PickView, e: SnapEntity): PickBody | null {
  const x = state.x(e);
  const y = state.y(e);
  const foot = view.project(x, y, 0);
  if (foot.behind) return null;
  const head = view.barAnchor(e, x, y);
  if (!head) return null;
  const r = Math.max(e.radius, 1);
  const east = view.project(x + r, y, 0);
  const south = view.project(x, y - r, 0); // south = toward the camera = down on screen
  const rx = Math.abs(east.sx - foot.sx);
  const ry = Math.max(1, Math.abs(south.sy - foot.sy));
  const core = Math.max(MIN_CORE_PX, rx);
  const lay = barLayout(e, head.sx, head.sy + (barLift.get(e.id) ?? 0)); // stacked bars are clicked where drawn
  return {
    e,
    foot,
    head,
    top: { sx: head.sx, sy: Math.min(foot.sy, head.sy + core * 0.6) },
    core,
    reach: core + PICK_MARGIN_PX,
    half: Math.max(6, (foot.sy - head.sy) * SPRITE_HALF_W),
    squash: Math.max(1, rx / ry),
    bar: lay ? barHitRect(lay) : null,
    hostile: e.team !== state.myTeam,
  };
}

/** Distance from the cursor to the click-area axis (feet -> top), px below the feet stretched by the ground squash. */
export function bodyDistance(b: PickBody, sx: number, sy: number): number {
  if (sy >= b.foot.sy) return Math.hypot(sx - b.foot.sx, (sy - b.foot.sy) * b.squash);
  const span = b.foot.sy - b.top.sy;
  const k = span > 0 ? Math.min(1, (b.foot.sy - sy) / span) : 0;
  const ax = b.foot.sx + (b.top.sx - b.foot.sx) * k;
  const ay = b.foot.sy - span * k;
  return Math.hypot(sx - ax, sy - ay);
}

/**
 * Drawn sprite body: an ellipse from the feet to the bar anchor, `half` wide. Returns the approximate px distance
 * outside its outline (<= 0 inside).
 */
export function spriteGap(b: PickBody, sx: number, sy: number): number {
  const hh = Math.max(1, (b.foot.sy - b.head.sy) / 2);
  const cx = (b.foot.sx + b.head.sx) / 2;
  const cy = b.foot.sy - hh;
  return (Math.hypot((sx - cx) / b.half, (sy - cy) / hh) - 1) * b.half;
}

const inRect = (r: Rect, sx: number, sy: number): boolean => sx >= r.x0 && sx <= r.x1 && sy >= r.y0 && sy <= r.y1;

type Rank = [number, number, number];

/** Rank of a candidate: lower wins. [hostile class, tier, metric]. */
function rank(b: PickBody, order: number, sx: number, sy: number): Rank | null {
  const cls = b.hostile ? 0 : 1;
  if (b.bar && inRect(b.bar, sx, sy)) return [cls, 0, -order];
  const gap = spriteGap(b, sx, sy);
  if (gap <= 0) return [cls, 1, -b.foot.sy];
  return bodyDistance(b, sx, sy) <= b.reach ? [cls, 2, gap] : null;
}

const better = (a: Rank, b: Rank): boolean => (a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2]);

/** The unit under the cursor (CSS px in the canvas), or null. Only alive entities passing `accept` count. */
export function pickUnit(state: PickState, view: PickView, sx: number, sy: number, accept: (e: SnapEntity) => boolean): SnapEntity | null {
  const snap = state.snap;
  if (!snap) return null;
  let best: SnapEntity | null = null;
  let bestRank: Rank | null = null;
  const ents = snap.entities;
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i]!;
    if (!e.alive || !accept(e)) continue;
    const b = pickBody(state, view, e);
    if (!b) continue;
    const r = rank(b, i, sx, sy);
    if (r && (!bestRank || better(r, bestRank))) {
      bestRank = r;
      best = e;
    }
  }
  return best;
}
