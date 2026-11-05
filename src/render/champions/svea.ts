// Svea Böenhall props (ADC, "the Gale Archer"): two long wind-streaming ribbons from the shoulders (they fly out
// behind her even when she stands), a tall three-feather crest on the brow, a feathered ribbon-tied bow and a small
// gust swirl round her boots. 64 px read: slim archer with two long streamers and a feather crest, no cloak, no wings.
import { at, lerp3, m, madd, TAU, type V3 } from './core';
import { aimLW, backFrame, bowProp, ribbon } from './props';
import type { PropCtx } from './types';

const STREAMER = m('#a6e8dc', 'cloth');
const STREAMER_DARK = m('#4f8f94', 'cloth');
const FEATHER = '#eaf6f0';
const FEATHER_TIP = '#5fb8b0';

/** Two long ribbons from the upper back: out behind and slightly up, rippling; swept flat when running, flared on cast. */
export function windStreamers(c: PropCtx): void {
  const { st, rig, pose } = c;
  const bk = backFrame(rig, 12, 0);
  const flat = 0.35 + pose.sway * 0.65;
  for (const s of [1, -1]) {
    const pts: V3[] = [];
    for (let i = 0; i <= 9; i++) {
      const u = i / 9;
      const wave = Math.sin(u * 7 - pose.t * TAU * 2 + (s > 0 ? 0 : 1.7)) * (3 + u * 9);
      pts.push(at(bk, [s * (6 + u * 38 + pose.glow * u * 26), 4 + u * 16 * (1 - flat) + wave * 0.7 + u * 6 * flat, u * (30 + 34 * flat)]));
    }
    st.add(pts[4]!, -0.3, (p) => {
      p.fill(ribbon(st, pts, 6, 1.6), s > 0 ? STREAMER : STREAMER_DARK, { lw: 1.2, folds: [st.pts2([pts[0]!, pts[3]!, pts[6]!])] });
    });
  }
}

/** Three tall feathers rising from a band on the brow, leaning back; they flutter with the run. */
export function featherCrest(c: PropCtx): void {
  const { st, rig, pose } = c;
  const H = rig.head;
  const r = rig.body.headR;
  const lean = 0.35 + pose.sway * 0.6;
  for (let i = 0; i < 3; i++) {
    const side = (i - 1) * 0.5;
    const base = at(H, [side * r * 0.5, r * 0.85, r * 0.4]);
    const mid = at(H, [side * r * 0.75, r * (1.55 + (i === 1 ? 0.3 : 0)), r * (0.1 - lean * 0.45)]);
    const tip = at(H, [side * r * 1.0 + Math.sin(pose.t * TAU + i) * r * 0.12, r * (2.3 + (i === 1 ? 0.5 : 0)), r * (-0.35 - lean * 0.9)]);
    st.add(mid, 0.8, (p) => {
      const k = st.view.k;
      const q = st.pts2([base, mid, tip]);
      p.line(q, FEATHER, 3 * k);
      p.line([q[1]!, q[2]!], FEATHER_TIP, 2.4 * k);
      p.line([q[0]!, q[1]!], '#c9e6dc', 0.9 * k);
    });
  }
}

/** Wind-wrapped bow: the shared recurve bow plus two short ribbon tails tied to the upper limb. */
export function gustBow(c: PropCtx): void {
  bowProp(c, { len: 168, mat: m('#d7c9a3', 'wood') });
  const { st, rig, pose } = c;
  const hb = rig.handL;
  const dir = aimLW(c);
  const top = madd(hb.o, dir, 84);
  for (const s of [1, -1]) {
    const pts: V3[] = [0, 1, 2, 3, 4].map((i) => madd(madd(top, rig.chest.x, s * (2 + i * 3)), rig.chest.z, -i * 8 + Math.sin(pose.t * TAU * 2 + i + s) * 2));
    st.add(lerp3(pts[0]!, pts[4]!, 0.5), 3.4, (p) => p.fill(ribbon(st, pts, 1.8, 0.6), STREAMER, { lw: 0.8, rim: false }));
  }
}

/** A small gust swirling round the boots: two thin arcs that turn with the animation phase. */
export function gustSwirl(c: PropCtx): void {
  const { st, rig, pose } = c;
  const foot = lerp3(rig.footL.o, rig.footR.o, 0.5);
  for (let j = 0; j < 2; j++) {
    const pts: V3[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * 1.5 * Math.PI + pose.t * TAU * (1 + j * 0.3) + j * Math.PI;
      pts.push(madd(madd(madd(foot, rig.chest.x, Math.cos(a) * (17 + j * 6 + pose.sway * 6)), rig.chest.z, Math.sin(a) * (11 + j * 4)), [0, 1, 0], 4 + j * 5 + i * 0.7));
    }
    st.add(foot, -0.9, (p) => {
      const q = st.pts2(pts);
      p.ctx.save();
      p.ctx.globalAlpha = 0.8;
      p.line(q, '#d6f2ec', 1.7 * st.view.k);
      p.ctx.restore();
    });
  }
}
