// Knarr Zangenfels (top tank, "the Tidal Bulwark"): a giant armored crab. Not a humanoid: painted by a SpriteDrawer
// (atlas.ts DRAWERS) with the shell hull, six IK legs, one huge crusher claw (right) and a smaller pincer (left), eye
// stalks and barnacles. A small humanoid Kit stub (kits.ts) only carries the icon colours. 64 px read: a very wide low
// rust-red dome with one oversized claw, no head, no cloth: unlike any other champion.
import { at, frameYZ, ik, lerp3, m, norm, project, ring, TAU, type Basis, type Painter, type Stage, type V3 } from './core';
import type { SpriteDrawer } from './atlas';
import type { Anim, Kit } from './types';

const FRAMES: Record<Anim, number> = { idle: 6, run: 8, attack: 5, cast: 4, death: 3 };

const SHELL = m('#a8432e', 'stone');
const SHELL_LIGHT = m('#d9784b', 'stone');
const SHELL_DARK = m('#5c241f', 'stone');
const UNDER = m('#e2cba0', 'stone');
const BARNACLE = '#cfc8b2';
const EYE = '#f2d25a';
const TIDE = '#8fd6e4';

/** Humanoid stand-in for icon colours / lab lookups; the sprite itself comes from KNARR_DRAWER. */
export const KNARR_KIT: Kit = {
  id: 'knarr',
  name: 'Knarr Zangenfels',
  world: 300,
  look: 'giant armored crab walking on six legs: rust-red barnacle-crusted shell, one huge crusher claw and a smaller pincer, eye stalks',
  feature: 'wide red crab shell with one huge claw',
  body: { H: 180, shW: 26, hipW: 18, chestD: 14 },
  outfit: { skin: '#d9784b', top: SHELL, legs: SHELL_DARK, boots: SHELL_DARK },
  hold: 'fists',
  attack: 'bash',
  cast: 'stomp',
  gait: 'heavy',
  props: [],
};

interface Pose {
  bob: number;
  /** claw lift 0..1 (right = crusher, left = pincer) and jaw opening 0..1 */
  liftR: number;
  openR: number;
  liftL: number;
  openL: number;
  lunge: number;
  sink: number;
  tilt: number;
  /** run phase (-1 = standing) and splay of the legs when casting / dying */
  gait: number;
  splay: number;
  glow: number;
}

function poseOf(anim: Anim, frame: number): Pose {
  const n = FRAMES[anim];
  const t = (frame % n) / n;
  const p: Pose = { bob: 0, liftR: 0.1, openR: 0.25, liftL: 0.1, openL: 0.2, lunge: 0, sink: 0, tilt: 0, gait: -1, splay: 0, glow: 0 };
  if (anim === 'idle') {
    p.bob = Math.sin(t * TAU) * 1.6;
    p.openR = 0.25 + 0.2 * Math.sin(t * TAU);
    p.openL = 0.2 + 0.25 * Math.sin(t * TAU + 1.3);
    p.liftR = 0.12 + 0.05 * Math.sin(t * TAU);
  } else if (anim === 'run') {
    p.gait = t;
    p.bob = Math.abs(Math.sin(t * TAU * 2)) * 4;
    p.liftR = 0.25;
    p.liftL = 0.2;
    p.openR = 0.35;
  } else if (anim === 'attack') {
    const k = [
      { lift: 0.3, open: 0.9, lunge: -6 },
      { lift: 0.85, open: 1, lunge: -12 },
      { lift: 0.25, open: 0, lunge: 22 }, // hit frame: the crusher snaps shut
      { lift: 0.2, open: 0.15, lunge: 12 },
      { lift: 0.12, open: 0.3, lunge: 2 },
    ][frame % 5]!;
    p.liftR = k.lift;
    p.openR = k.open;
    p.lunge = k.lunge;
    p.liftL = 0.3;
    p.openL = frame % 5 === 2 ? 0 : 0.6;
  } else if (anim === 'cast') {
    const k = [
      { lift: 0.5, open: 0.6, glow: 0.4 },
      { lift: 1, open: 1, glow: 1 },
      { lift: 0.7, open: 0.5, glow: 0.7 },
      { lift: 0.15, open: 0.2, glow: 0.3 },
    ][frame % 4]!;
    p.liftR = k.lift;
    p.liftL = k.lift;
    p.openR = k.open;
    p.openL = k.open;
    p.glow = k.glow;
    p.splay = k.lift * 0.5;
    p.bob = k.lift * 3;
  } else {
    const k = frame % 3;
    p.sink = [8, 20, 30][k]!;
    p.tilt = [0.08, 0.22, 0.32][k]!;
    p.liftR = [0.1, -0.2, -0.4][k]!;
    p.liftL = [0.1, -0.2, -0.4][k]!;
    p.openR = 0.1;
    p.openL = 0.1;
    p.splay = [0.2, 0.6, 1][k]!;
  }
  return p;
}

/** One claw: arm from the shoulder, palm along the arm, two fingers that open vertically. */
function claw(st: Stage, B: Basis, side: number, big: boolean, lift: number, open: number, lunge: number): void {
  const s = big ? 1 : 0.68;
  const sh = at(B, [side * 60, 10, 38]);
  const el = at(B, [side * (big ? 104 : 92), 12 + lift * 26, 60 + lunge * 0.4]);
  const wr = at(B, [side * (big ? 92 : 80), 10 + lift * 52, 100 + lunge]);
  const dir = norm([wr[0] - el[0] + side * -6, wr[1] - el[1] + 8, wr[2] - el[2] + 40]);
  const cb = frameYZ(wr, dir, [0, 1, 0]);
  st.add(lerp3(sh, wr, 0.5), side * 0.4 + 2, (pp) => {
    pp.fill(st.capsule(sh, el, 11 * s + 2, 9 * s + 2), SHELL_DARK, { lw: 1.4 });
    pp.fill(st.capsule(el, wr, 9 * s + 2, 12 * s), SHELL, { lw: 1.4 });
    // palm
    pp.fill(st.hull([...ring(cb, 0, 15 * s, 12 * s, 10), ...ring(cb, 30 * s, 20 * s, 15 * s, 10)]), SHELL_LIGHT, { lw: 1.8, folds: [st.pts2([at(cb, [0, 4, 12 * s]), at(cb, [0, 30 * s, 14 * s])])] });
    // fixed lower finger and the moving upper finger (opens up to ~40 degrees)
    const gap = open * 17 * s;
    const lowTip = at(cb, [-2 * s, 66 * s, -3 * s]);
    const upTip = at(cb, [0, 62 * s, 6 * s + gap]);
    pp.fill(st.poly([at(cb, [-10 * s, 26 * s, -9 * s]), lowTip, at(cb, [8 * s, 30 * s, -3 * s])], true), SHELL, { lw: 1.6 });
    pp.fill(st.poly([at(cb, [-10 * s, 26 * s, 9 * s]), upTip, at(cb, [8 * s, 30 * s, 5 * s + gap * 0.3])], true), SHELL_LIGHT, { lw: 1.6 });
    // teeth of the crusher
    if (big) for (const u of [0.45, 0.65, 0.85]) pp.line([st.p(at(cb, [0, 66 * u + 10, 1])), st.p(at(cb, [0, 66 * u + 10, 7 + gap * u]))], '#f4ead2', 1.4);
  });
}

function drawKnarr(st: Stage, p: Painter, anim: Anim, frame: number): void {
  st.view.k *= 0.8;
  const k = st.view.k;
  const pose = poseOf(anim, frame);
  const n = FRAMES[anim];
  const ph = ((frame % n) / n) * TAU;
  const B = frameYZ([0, 54 + pose.bob - pose.sink, 0 + pose.lunge * 0.3], [0, 1, -pose.tilt], [0, 0, 1]);
  const T = (x: number, y: number, z: number): V3 => at(B, [x, y, z]);

  // ---------------------------------------------------------------- legs (three per side), far side first by depth
  for (let i = 0; i < 3; i++) {
    for (const s of [1, -1]) {
      const z = 26 - i * 30;
      const stepPh = pose.gait >= 0 ? pose.gait * TAU + i * 2.1 + (s > 0 ? 0 : Math.PI) : 0;
      const lift = pose.gait >= 0 ? Math.max(0, Math.sin(stepPh)) * 12 : 0;
      const dz = pose.gait >= 0 ? Math.cos(stepPh) * 12 : 0;
      const out = 104 + i * 4 + pose.splay * 16;
      const root = T(s * 48, -6, z);
      const foot: V3 = pose.sink > 12 ? T(s * (out - 28), -20, z - 6) : [s * out, lift - pose.sink * 0.2, z + dz - pose.lunge * 0.0];
      const [knee, end] = ik(root, foot, 46, 52, [s * 0.3, 1, 0]);
      st.add(lerp3(root, end, 0.5), -2 + i * 0.1, (pp) => {
        pp.fill(st.capsule(root, knee, 7.5, 6), SHELL_DARK, { lw: 1.2 });
        pp.fill(st.capsule(knee, end, 6, 2.6), SHELL, { lw: 1.2 });
      });
    }
  }

  // ---------------------------------------------------------------- shell
  st.add(B.o, 0, (pp) => {
    const pts = [...ring(B, -10, 64, 50, 14), ...ring(B, 12, 82, 60, 14), ...ring(B, 34, 58, 46, 14), ...ring(B, 48, 26, 22, 10)];
    pp.fill(st.hull(pts), SHELL, { folds: [st.pts2([T(-60, 30, 6), T(0, 48, 12), T(58, 30, 4)]), st.pts2([T(-48, 22, -26), T(0, 38, -22), T(46, 22, -28)]), st.pts2([T(-30, 40, 30), T(0, 52, 34), T(30, 40, 30)])] });
    // paler underside rim and a battle-worn central ridge
    pp.fill(st.hull([...ring(B, -12, 62, 48, 14), ...ring(B, -2, 70, 54, 14)]), UNDER, { lw: 1.4, rim: false });
    pp.fill(st.hull([T(-8, 48, -30), T(8, 48, -30), T(5, 52, 28), T(-5, 52, 28)]), SHELL_LIGHT, { lw: 1.2, rim: false });
    // a deep crack across the right side (he has been through some fights) and barnacles
    pp.line(st.pts2([T(26, 44, 10), T(40, 30, 20), T(34, 18, 34), T(46, 8, 40)]), '#2a1210', 1.6);
    for (const [x, y, z, r] of [[-40, 36, -8, 3.4], [-30, 42, 10, 2.6], [-52, 28, 6, 3], [34, 40, -20, 3.2], [14, 46, -30, 2.4], [-14, 46, -26, 2.8], [50, 30, -10, 2.8]] as const) {
      const q = st.p(T(x, y, z));
      pp.dot(q.x, q.y, r * k * 1.3, r * k, BARNACLE);
      pp.dot(q.x, q.y, r * k * 0.5, r * k * 0.4, '#6a6454');
    }
    // cast / stance glow: tide-blue shimmer on the shell
    if (pose.glow > 0.05) {
      p.ctx.save();
      p.ctx.globalAlpha = 0.5 * pose.glow;
      const q = st.p(T(0, 40, 0));
      p.dot(q.x, q.y, 70 * k * 0.9, 38 * k * 0.9, TIDE);
      p.ctx.restore();
    }
  });

  // ---------------------------------------------------------------- eye stalks
  st.add(T(0, 52, 44), 1.4, (pp) => {
    for (const s of [1, -1]) {
      const base = T(s * 14, 38, 42);
      const top = T(s * 20, 66 + Math.sin(ph + s) * 1.5 + pose.liftR * 4, 52);
      pp.fill(st.capsule(base, top, 4.4, 3.4), SHELL_DARK, { lw: 1.1 });
      const q = st.p(top);
      pp.dot(q.x, q.y, 6.4 * k, 6.4 * k, '#fff4d0');
      pp.dot(q.x, q.y, 3.8 * k, 3.8 * k, EYE);
      pp.dot(q.x, q.y + 0.4 * k, 1.8 * k, 2.8 * k, '#1a1420');
    }
  });

  // ---------------------------------------------------------------- claws (crusher on the right, pincer on the left)
  claw(st, B, -1, false, pose.liftL, pose.openL, pose.lunge * 0.5);
  claw(st, B, 1, true, pose.liftR, pose.openR, pose.lunge);

  // strike smear anchor for the attack frame
  if (anim === 'attack' && frame % 5 === 2) st.tip = { grip: T(88, 24, 90), tip: T(80, 20, 170) };
  st.render(p);
}

/** Idle frame 0: the eyes (stalk tops) at about [14, 120, 52], radius ~7. */
function head(yaw: number, res: number): { x: number; y: number; r: number } {
  const s = res / 256;
  const q = project({ yaw, elev: 0.42, cx: res / 2, cy: res * 0.88, k: s * 0.8, fall: 0, lift: 0 }, [0, 118, 50]);
  return { x: q.x, y: q.y, r: 24 * s * 0.8 };
}

export const KNARR_DRAWER: SpriteDrawer = {
  world: 330,
  frames: FRAMES,
  foot: 0.86,
  ink: 1,
  hit: 2,
  draw: drawKnarr,
  head,
};
