// Tilda Saitenwind props (support musician, "the Note Gatherer"): a long red plume on the wide-brim hat, a big lute slung on
// her back (neck up over the shoulder) and three floating music notes in the song colours (green heal, blue speed, red stun)
// circling her. 64 px read: hat + plume on top, a lute neck behind, notes around a slim figure.
import { at, mix, TAU, add, type V3 } from './core';
import { backFrame } from './props';
import type { PropCtx } from './types';

const WOOD = '#9a6a38';
const WOOD_DARK = '#4f3420';
const PLUME = '#d24a3a';
const NOTE = ['#58d46a', '#58a8e8', '#e8586a'];

/** A long feather curving up and back from the hat band. */
export function hatPlume(c: PropCtx): void {
  const { st, rig, pose } = c;
  const H = rig.head;
  const r = rig.body.headR;
  const wave = Math.sin(pose.t * TAU) * 0.12 - pose.sway * 0.4;
  const pts: V3[] = [];
  for (let i = 0; i <= 6; i++) {
    const u = i / 6;
    pts.push(at(H, [(0.75 + u * 0.5) * r, (1.05 + u * 1.2 - u * u * 0.5) * r, (-0.1 - u * (0.9 + wave)) * r]));
  }
  st.add(pts[3]!, 0.8, (p) => {
    const k = st.view.k;
    const q = st.pts2(pts);
    p.line(q, mix(PLUME, '#3a1010', 0.45), 4.2 * k);
    p.line(q, PLUME, 3 * k);
    p.line(q, '#f4b8a8', 1 * k);
  });
}

/** Lute on the back: round soundboard with a dark sound hole, long neck reaching up past the shoulder, pegbox, strings. */
export function luteBack(c: PropCtx): void {
  const { st, rig, pose } = c;
  const bk = backFrame(rig, 1, 0);
  const sw = pose.sway * 6;
  const body = at(bk, [-10, -14, -9 + sw]);
  const top = at(bk, [10, 34, -8 + sw]);
  st.add(body, -0.6, (p) => {
    const k = st.view.k;
    const a = st.p(body);
    const b = st.p(top);
    p.line([a, b], WOOD_DARK, 5.2 * k);
    p.line([a, b], WOOD, 3.4 * k);
    p.dot(b.x, b.y, 3.4 * k, 2.4 * k, WOOD_DARK);
    p.dot(a.x, a.y, 12.5 * k, 14 * k, WOOD_DARK);
    p.dot(a.x, a.y, 11 * k, 12.5 * k, WOOD);
    p.dot(a.x, a.y + 1.5 * k, 3.6 * k, 3.6 * k, '#2a1a10');
    p.line([{ x: a.x - 3 * k, y: a.y + 8 * k }, { x: b.x - 1 * k, y: b.y }], '#efe2c4', 0.8 * k);
    p.line([{ x: a.x + 3 * k, y: a.y + 8 * k }, { x: b.x + 1 * k, y: b.y }], '#efe2c4', 0.8 * k);
  });
}

/** Three eighth notes circling at head-to-chest height; they bob and spread wider while casting. */
export function floatNotes(c: PropCtx): void {
  const { st, rig, pose } = c;
  const pulse = Math.max(pose.glow, Math.abs(pose.act) * 0.5);
  for (let i = 0; i < 3; i++) {
    const a = pose.t * TAU * 0.5 + (i * TAU) / 3;
    const R = 34 + pulse * 20;
    const h = 22 + i * 14 + Math.sin(pose.t * TAU * 2 + i * 2) * 3;
    const o: V3 = add(rig.chest.o, [Math.cos(a) * R, h, Math.sin(a) * R]);
    st.add(o, Math.sin(a) > 0 ? 4.2 : -1.2, (p) => {
      const q = st.p(o);
      const k = st.view.k * (1 + pulse * 0.35);
      const col = NOTE[i]!;
      // note head (tilted oval), stem and flag
      p.dot(q.x, q.y, 3.4 * k, 2.6 * k, mix(col, '#102010', 0.5));
      p.dot(q.x, q.y, 2.6 * k, 1.9 * k, col);
      p.line([{ x: q.x + 2.8 * k, y: q.y }, { x: q.x + 2.8 * k, y: q.y - 11 * k }], col, 1.3 * k);
      p.line([{ x: q.x + 2.8 * k, y: q.y - 11 * k }, { x: q.x + 7 * k, y: q.y - 8 * k }, { x: q.x + 5.5 * k, y: q.y - 5 * k }], col, 1.3 * k);
      p.ctx.save();
      p.ctx.globalAlpha = 0.5;
      p.dot(q.x, q.y - 5 * k, 6 * k, 8 * k, mix(col, '#ffffff', 0.5));
      p.ctx.restore();
    });
  }
}
