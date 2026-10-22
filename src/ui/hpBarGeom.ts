// Health-bar layout shared by the overlay (drawing) and the picker (clicking a bar targets its unit). Pure: no DOM.
import type { SnapEntity } from '../sim/snapshot';
import { Kind } from '../sim/types';

export interface BarLayout {
  /** Left / top of the coloured bar (CSS px). */
  x: number;
  y: number;
  bw: number;
  bh: number;
  champ: boolean;
  structure: boolean;
  dummy: boolean;
  monster: boolean;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Bar geometry for a unit whose bar anchor (world.barAnchor) is at (ax, ay); null for units without a bar. */
export function barLayout(e: SnapEntity, ax: number, ay: number): BarLayout | null {
  if (e.maxHp <= 0 || e.kind === Kind.Plant) return null;
  const champ = e.kind === Kind.Champion || !!e.look; // decoys (Sev E) get the fake champion bar
  const structure = e.kind >= Kind.Tower && e.kind <= Kind.Nexus;
  const dummy = e.kind === Kind.Dummy;
  const monster = e.kind === Kind.Monster;
  const bw = champ ? 104 : structure ? 130 : dummy ? 104 : monster && e.radius >= 130 ? 150 : monster && e.radius >= 100 ? 116 : monster && e.radius >= 80 ? 86 : monster && e.radius >= 70 ? 72 : 54;
  const bh = champ ? 11 : structure ? 9 : dummy ? 10 : 5;
  return { x: ax - bw / 2 + (champ ? 10 : 0), y: ay - bh, bw, bh, champ, structure, dummy, monster };
}

/** Thin bars get this much extra clickable height above and below (a 5 px minion bar is hard to hit). */
const BAR_PAD_Y = 3;

/** Clickable area of a bar: its dark frame (incl. the champion mana strip and level box), thin bars padded. */
export function barHitRect(l: BarLayout): Rect {
  const pad = l.bh < 9 ? BAR_PAD_Y : 0;
  return {
    x0: l.x - (l.champ ? 24 : 2),
    y0: l.y - (l.champ ? 4 : 2) - pad,
    x1: l.x + l.bw + 2,
    y1: l.y + l.bh + 2 + (l.champ ? 5 : 0) + pad,
  };
}
