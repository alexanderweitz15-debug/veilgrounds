// Lumi Sternenwiege props (support guardian enchanter, "the Wishkeeper"): a big silver crescent moon floating behind
// the head like a cradle, a wishing staff topped with a golden five-point star and little twinkling stars drifting
// round the cloak. 64 px read: robed figure with a bright crescent behind the head (no other champion has a halo).
import { at, m, madd, TAU, type V3 } from './core';
import { aimW } from './props';
import type { PropCtx } from './types';

const MOON = '#e8ecf6';
const MOON_RIM = '#8a96c0';
const STAR = '#ffd978';
const STAR_RIM = '#c88a2a';
const STAFF = m('#4a3f66', 'wood');

/** Crescent moon behind the head: opening up, slowly bobbing; glows brighter with the cast pulse. */
export function moonCrescent(c: PropCtx): void {
  const { st, rig, pose } = c;
  const r = rig.body.headR;
  const o = at(rig.head, [0, r * 0.9 + Math.sin(pose.t * TAU) * 1.2, -r * 1.7]);
  st.add(o, -1.5, (p) => {
    const q = st.p(o);
    const k = st.view.k;
    const R = (r * 1.9 + pose.glow * 2) * k;
    const ctx = p.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(q.x, q.y, R, Math.PI * 0.12, Math.PI * 0.88, false);
    ctx.arc(q.x, q.y - R * 0.34, R * 0.84, Math.PI * 0.88, Math.PI * 0.12, true);
    ctx.closePath();
    ctx.fillStyle = MOON;
    ctx.strokeStyle = MOON_RIM;
    ctx.lineWidth = 1.3 * k;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  });
}

/** Staff in the right hand with a golden five-point star on top. */
export function wishStaff(c: PropCtx): void {
  const { st, rig, pose } = c;
  const dir = aimW(c);
  const base = madd(rig.handR.o, dir, -46);
  const top = madd(rig.handR.o, dir, 96);
  st.add(rig.handR.o, 3.0, (p) => {
    p.fill(st.capsule(base, top, 2.6, 1.9), STAFF, { lw: 1.2 });
    const q = st.p(madd(top, dir, 7));
    const k = st.view.k;
    const R = (7.5 + pose.glow * 2) * k;
    const ctx = p.ctx;
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? R * 0.45 : R;
      const x = q.x + Math.cos(a) * rr;
      const y = q.y + Math.sin(a) * rr;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = STAR;
    ctx.strokeStyle = STAR_RIM;
    ctx.lineWidth = 1.2 * k;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  });
}

/** Small four-point sparkles drifting round the cloak, each twinkling at its own phase. */
export function twinkleStars(c: PropCtx): void {
  const { st, rig, pose } = c;
  for (let i = 0; i < 6; i++) {
    const u = (pose.t * 0.6 + i / 6) % 1;
    const a = i * 1.9 + pose.t * TAU * 0.4;
    const o: V3 = at(rig.pelvis, [Math.sin(a) * (24 + (i % 3) * 6), 10 + u * 90, Math.cos(a) * (16 + (i % 2) * 6)]);
    st.add(o, 3.6, (p) => {
      const q = st.p(o);
      const k = st.view.k;
      const tw = 0.5 + 0.5 * Math.sin(pose.t * TAU * 2 + i * 1.7);
      const R = (2.2 + tw * 2.2) * k;
      p.ctx.save();
      p.ctx.globalAlpha = 0.95 * (1 - u * 0.6);
      p.line([{ x: q.x - R, y: q.y }, { x: q.x + R, y: q.y }], i % 2 ? STAR : MOON, 1.5 * k);
      p.line([{ x: q.x, y: q.y - R }, { x: q.x, y: q.y + R }], i % 2 ? STAR : MOON, 1.5 * k);
      p.ctx.restore();
    });
  }
}
