// Test scene for src/input/picking.ts: the real camera rig (default zoom, 1280x720) and world.barAnchor's maths with
// the in-game sprite heights (World itself needs WebGL). Also the pre-C8 picker (render/world.ts pick() before
// 2026-10-22) for before/after measurements.
import { CameraRig, PITCH } from '../src/render/camera';
import { Kind } from '../src/sim/types';
import type { SnapEntity } from '../src/sim/snapshot';
import type { PickState, PickView } from '../src/input/picking';

export const W = 1280;
export const H = 720;

const UP_Y = Math.cos(PITCH);
const UP_Z = -Math.sin(PITCH);

/**
 * Sprite height (world units) as world.unitHeight returns it in the built game with the painted atlases (probed
 * 2026-10-22, classic game: minions 100-101, champions 141-216; the SPRITE_SIZE fallback is 1.5x taller).
 */
export function heightOf(e: SnapEntity): number {
  const k = e.kind;
  if (k === Kind.Champion) return 170;
  if (k === Kind.MinionSiege || k === Kind.MinionSuper) return 135;
  if (k === Kind.MinionMelee || k === Kind.MinionCaster) return 100;
  return 120;
}

export function makeView(rig: CameraRig): PickView {
  return {
    project: (x, y, z) => rig.project(x, y, z, W, H),
    // world.barAnchor: sprites lean back with the camera, the head sits along the tilted up vector, +18 above it
    barAnchor: (e, x, y) => {
      const top = heightOf(e);
      const p = rig.project(x, y - UP_Z * top, UP_Y * top + 18, W, H);
      if (p.behind || p.sx < -100 || p.sy < -100 || p.sx > W + 100 || p.sy > H + 100) return null;
      return p;
    },
  };
}

export function rigAt(x: number, y: number): CameraRig {
  const rig = new CameraRig(W / H);
  rig.focus(x, y);
  rig.apply();
  return rig;
}

let nextId = 1;
export function unit(kind: number, team: number, x: number, y: number, extra: Partial<SnapEntity> = {}): SnapEntity {
  const id = nextId++;
  const radius = kind === Kind.Champion ? 65 : kind === Kind.MinionSiege || kind === Kind.MinionSuper ? 65 : 48;
  const maxHp = kind === Kind.Champion ? 1200 : 460;
  return {
    id, serial: id, kind, team, x, y, px: x, py: y, fx: 1, fy: 0, hp: maxHp, maxHp, shield: 0, mana: 0, maxMana: 0,
    radius, level: 1, champ: kind === Kind.Champion ? 'mira' : null, slot: -1, atkPhase: 0, atkTarget: -1, moving: false,
    alive: true, ...extra,
  } as SnapEntity;
}

export function stateOf(entities: SnapEntity[], myTeam = 0): PickState {
  return { snap: { entities }, myTeam, x: (e) => e.x, y: (e) => e.y };
}

/** The picker before C8, verbatim apart from the view adapter: sprite rect, champions score x0.5. */
export function legacyPick(state: PickState, view: PickView, sx: number, sy: number, accept: (e: SnapEntity) => boolean): SnapEntity | null {
  if (!state.snap) return null;
  let best: SnapEntity | null = null;
  let bestScore = Infinity;
  for (const e of state.snap.entities) {
    if (!e.alive || !accept(e)) continue;
    const x = state.x(e);
    const y = state.y(e);
    const foot = view.project(x, y, 0);
    const head = view.barAnchor(e, x, y);
    if (!head) continue;
    const hgt = Math.max(20, foot.sy - head.sy);
    const halfW = Math.max(18, hgt * (e.kind >= Kind.Tower && e.kind <= Kind.Nexus ? 0.3 : 0.32));
    const cy = (foot.sy + head.sy) / 2;
    if (Math.abs(sx - foot.sx) > halfW || sy < head.sy || sy > foot.sy + 14) continue;
    let score = Math.hypot(sx - foot.sx, sy - cy);
    if (e.kind === Kind.Champion) score *= 0.5;
    if (score < bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}
