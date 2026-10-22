// Unit picking under the cursor (agent C). One function serves the hover highlight, right-click attack, left-click
// select and pings, so what is highlighted is what a click hits. Pure screen-space maths: the projection comes in
// through PickView (render/world.ts adapts its camera), which keeps this testable without WebGL.
//
// Hostile units (other team, neutral monsters) rank before allies and the own champion: an ally minion standing in
// the enemy wave, or the own HP bar hanging over the minions' feet, must not swallow last hits. Within each class,
// hit areas best first:
//   1. the unit's HP bar (frame incl. champion level box; thin bars padded) - clicking a bar targets its unit;
//   2. the unit's body core: the sim radius projected to the screen, swept from the ground point up to the top of
//      the sprite (a capsule); where cores overlap the unit standing in front (lower on screen) wins, like the
//      drawn sprites;
//   3. the core plus PICK_MARGIN_PX: the unit whose body axis is closest to the cursor.
// No champion bonus: the "target champions only" key (controller.ts) filters through `accept` instead.
import type { SnapEntity } from '../sim/snapshot';
import { barHitRect, barLayout, type Rect } from '../ui/hpBarGeom';

/** Extra screen pixels around the projected sim radius (minions: 48 radius ~ 20 px at the default zoom -> 28). */
export const PICK_MARGIN_PX = 8;
/** Smallest core radius in px (tiny units, far zoom). */
export const MIN_CORE_PX = 16;

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
  /** Top of the body axis: the capsule's upper cap reaches the sprite top (bar anchor). */
  top: ScreenPt;
  /** Core radius in px (projected sim radius) and accept radius (core + margin). */
  core: number;
  reach: number;
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
  // axis from the feet up to one core radius below the bar anchor: the capsule's top cap ends at the anchor
  const topY = Math.min(foot.sy, head.sy + core);
  const lay = barLayout(e, head.sx, head.sy);
  return {
    e,
    foot,
    top: { sx: head.sx, sy: topY },
    core,
    reach: core + PICK_MARGIN_PX,
    squash: Math.max(1, rx / ry),
    bar: lay ? barHitRect(lay) : null,
    hostile: e.team !== state.myTeam,
  };
}

/** Distance from the cursor to the body axis (feet -> top), px below the feet stretched by the ground squash. */
export function bodyDistance(b: PickBody, sx: number, sy: number): number {
  if (sy >= b.foot.sy) return Math.hypot(sx - b.foot.sx, (sy - b.foot.sy) * b.squash);
  const span = b.foot.sy - b.top.sy;
  const k = span > 0 ? Math.min(1, (b.foot.sy - sy) / span) : 0;
  const ax = b.foot.sx + (b.top.sx - b.foot.sx) * k;
  const ay = b.foot.sy - span * k;
  return Math.hypot(sx - ax, sy - ay);
}

const inRect = (r: Rect, sx: number, sy: number): boolean => sx >= r.x0 && sx <= r.x1 && sy >= r.y0 && sy <= r.y1;

/** Rank of a candidate: lower wins. [hostile class, tier, metric]. */
function rank(b: PickBody, order: number, sx: number, sy: number): [number, number, number] | null {
  const cls = b.hostile ? 0 : 1;
  // bars are drawn over everything: the last drawn (top-most) bar wins
  if (b.bar && inRect(b.bar, sx, sy)) return [cls, 0, -order];
  const d = bodyDistance(b, sx, sy);
  if (d > b.reach) return null;
  // core: the unit drawn in front (feet lowest on screen) wins; margin: the closest body axis wins
  return d <= b.core ? [cls, 1, -b.foot.sy] : [cls, 2, d];
}

const better = (a: [number, number, number], b: [number, number, number]): boolean =>
  a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];

/** The unit under the cursor (CSS px in the canvas), or null. Only alive entities passing `accept` count. */
export function pickUnit(state: PickState, view: PickView, sx: number, sy: number, accept: (e: SnapEntity) => boolean): SnapEntity | null {
  const snap = state.snap;
  if (!snap) return null;
  let best: SnapEntity | null = null;
  let bestRank: [number, number, number] | null = null;
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
