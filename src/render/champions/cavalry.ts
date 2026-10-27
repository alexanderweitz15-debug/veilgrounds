// Vargrim Nebelhuf (cavalry juggernaut): a spectral centaur-like warlord. Horse body drawn with the quadruped rig of
// the wolf (jagged "fur" hulls, IK legs), an armored rider torso grows out of its chest, couched lance, chains and
// ghost-green flames. Baked as a SpriteDrawer (atlas.ts DRAWERS) plus a small humanoid Kit stub for icon colours.
import { at, frameYZ, ik, lerp3, m, madd, norm, project, ring, shapeFrom, smoothPath, sub, TAU, type Basis, type Painter, type Stage, type V3 } from './core';
import { furHull, gallopBody, gallopFoot } from './wolf';
import type { SpriteDrawer } from './atlas';
import type { Anim, Kit } from './types';

const FRAMES: Record<Anim, number> = { idle: 6, run: 8, attack: 5, cast: 4, death: 3 };

const HIDE = m('#46565c', 'fur');
const HIDE_LIGHT = m('#86aaa2', 'fur');
const HIDE_DARK = m('#252f36', 'fur');
const STEEL = m('#4d5862', 'metal');
const STEEL_DARK = m('#2b323a', 'metal');
const CLOTH = m('#1d2a30', 'cloth');
const CLOTH_LIT = m('#2f6862', 'cloth');
const BONE = m('#d8ceb4', 'wood');
const FLAME = m('#2fb8a4', 'glow');
const FLAME_CORE = m('#bfffee', 'glow');
const EYE = '#9bfff0';
const CHAIN = '#9aa6a8';

/** Humanoid stand-in for icon colours / lab lookups; the sprite itself comes from VARGRIM_DRAWER. */
export const VARGRIM_KIT: Kit = {
  id: 'vargrim',
  name: 'Vargrim Nebelhuf',
  world: 266,
  look: 'spectral centaur warlord: horned helm, dark steel plate with teal flames, couched lance, chains, ghostly horse body with burning hooves and tail',
  feature: 'lance-bearing ghost centaur with teal flames',
  body: { H: 180, shW: 24, hipW: 15, chestD: 12 },
  outfit: { skin: '#8fb4aa', top: STEEL, legs: CLOTH, boots: STEEL_DARK, coat: { mat: CLOTH_LIT, len: 1.2, flare: 0.3 }, pauldrons: { mat: STEEL, size: 1.2, spikes: true } },
  hold: 'port',
  attack: 'thrust',
  cast: 'raise',
  props: [],
};

/** Flame tongue: teardrop from `base` along `dir` (character space), flickering sideways with `ph`. */
function flame(st: Stage, pp: Painter, base: V3, dir: V3, len: number, w: number, ph: number, core = true): void {
  const b = st.p(base);
  const k = st.view.k;
  const sway = Math.sin(ph) * w * 0.9;
  const t = st.p(madd(madd(base, dir, len * (0.85 + 0.15 * Math.cos(ph * 1.7))), [1, 0, 0], sway));
  const dx = t.x - b.x;
  const dy = t.y - b.y;
  const l = Math.hypot(dx, dy) || 1;
  const px = (-dy / l) * w * k;
  const py = (dx / l) * w * k;
  const mid = { x: b.x + dx * 0.45 + (Math.sin(ph + 1) * w * k) / 2, y: b.y + dy * 0.45 };
  const pts = [
    { x: b.x + px, y: b.y + py },
    { x: mid.x + px * 1.1, y: mid.y + py * 1.1 },
    t,
    { x: mid.x - px * 1.1, y: mid.y - py * 1.1 },
    { x: b.x - px, y: b.y - py },
  ];
  pp.fill(shapeFrom(pts, smoothPath(pts)), FLAME, { lw: 0.8 });
  if (core) {
    const c = pts.map((q, i) => ({ x: b.x + (q.x - b.x) * 0.5 - (i === 2 ? 0 : 0), y: b.y + (q.y - b.y) * 0.55 }));
    pp.fill(shapeFrom(c, smoothPath(c)), FLAME_CORE, { lw: 0.5, rim: false });
  }
}

interface Pose {
  bob: number;
  pitch: number;
  lunge: number;
  low: number;
  rear: number;
  /** lance: forward push, vertical component of its direction (-0.15 couched .. 1 raised), rider lean (z) */
  lancePush: number;
  lanceUp: number;
  lean: number;
  flare: number;
  tailUp: number;
  feet: V3[];
}

function poseOf(anim: Anim, frame: number): Pose {
  const n = FRAMES[anim];
  const t = (frame % n) / n;
  const p: Pose = {
    bob: 0, pitch: 0, lunge: 0, low: 0, rear: 0, lancePush: 0, lanceUp: -0.12, lean: 0, flare: 0, tailUp: 0.35,
    feet: [[12, 0, 36], [-12, 0, 32], [12, 0, -40], [-12, 0, -36]],
  };
  if (anim === 'idle') {
    p.bob = Math.sin(t * TAU) * 1.2;
    p.lean = Math.sin(t * TAU) * 1.5;
    p.flare = 0.2 + 0.15 * Math.sin(t * TAU * 2);
    p.feet[1]![2] += Math.sin(t * TAU) * 3; // pawing
    p.feet[1]![1] = Math.max(0, Math.sin(t * TAU)) * 4;
    p.pitch = Math.sin(t * TAU) * 0.025; // breath: the barrel rocks, weight shifts back onto the haunches
    p.feet[2]![2] -= Math.max(0, Math.sin(t * TAU * 2)) * 1.5;
  } else if (anim === 'run') {
    p.feet.forEach((f, i) => {
      const [dz, dy] = gallopFoot(t, i, 19, 20);
      f[2] += dz;
      f[1] = dy;
    });
    const g = gallopBody(t, 3.4, 0.07);
    p.bob = g.bob + 0.6;
    p.pitch = g.pitch;
    p.lean = 6;
    p.lancePush = 6;
    p.flare = 0.7;
    p.tailUp = 0.05;
  } else if (anim === 'attack') {
    const k = [
      { lunge: 0, lp: -16, up: -0.1, lean: -8, low: 0.3 },
      { lunge: -8, lp: -30, up: 0.05, lean: -14, low: 0.5 },
      { lunge: 22, lp: 26, up: -0.2, lean: 14, low: 0 },
      { lunge: 14, lp: 18, up: -0.15, lean: 8, low: 0.1 },
      { lunge: 4, lp: 2, up: -0.12, lean: 0, low: 0.1 },
    ][frame % 5]!;
    p.lunge = k.lunge;
    p.lancePush = k.lp;
    p.lanceUp = k.up;
    p.lean = k.lean;
    p.low = k.low;
    p.flare = frame % 5 === 2 ? 1 : 0.4;
    p.feet[0]![2] += k.lunge * 0.9;
    p.feet[1]![2] += k.lunge * 0.7;
    if (frame % 5 === 2) p.feet[0]![1] = 6;
  } else if (anim === 'cast') {
    const k = [
      { rear: 0.35, up: 0.35, fl: 0.5, lean: -6 },
      { rear: 1, up: 1, fl: 1, lean: -12 },
      { rear: 0.5, up: 0.7, fl: 0.8, lean: -4 },
      { rear: 0, up: 0.1, fl: 0.9, lean: 0 },
    ][frame % 4]!;
    p.rear = k.rear;
    p.lanceUp = k.up;
    p.lean = k.lean;
    p.flare = k.fl;
    p.lancePush = 4;
    p.feet[0]![1] = k.rear * 44;
    p.feet[1]![1] = k.rear * 50;
    p.feet[0]![2] += k.rear * 14;
    p.feet[1]![2] += k.rear * 18;
  } else {
    const k = frame % 3;
    p.low = [0.5, 1.1, 1.6][k]!;
    p.lean = [8, 20, 34][k]!;
    p.lancePush = [0, -20, -40][k]!;
    p.lanceUp = [-0.3, -0.7, -0.9][k]!;
    p.tailUp = -0.3;
    p.flare = [0.5, 0.25, 0.1][k]!;
    if (k >= 1) {
      p.feet[0] = [14, 0, 44];
      p.feet[1] = [2, 0, 48];
      p.feet[2] = [14, 0, -46];
      p.feet[3] = [2, 0, -50];
    }
  }
  return p;
}

function drawVargrim(st: Stage, p: Painter, anim: Anim, frame: number): void {
  st.view.k *= 0.8;
  const k = st.view.k;
  const pose = poseOf(anim, frame);
  const n = FRAMES[anim];
  const ph = ((frame % n) / n) * TAU;
  const hip: V3 = [0, 70 + pose.bob - pose.low * 22 - pose.rear * 6, -48 + pose.lunge * 0.4];
  const sho: V3 = [0, 75 + pose.bob - pose.low * 24 + pose.rear * 46, 32 + pose.lunge - pose.rear * 12];
  const spine = norm(sub(sho, hip));
  const mid = lerp3(hip, sho, 0.5);
  const body: Basis = frameYZ(mid, [0, 1, -pose.pitch], spine);
  const B = (x: number, y: number, z: number): V3 => at(body, [x, y, z]);

  // ---------------------------------------------------------------- legs (far side drawn first by depth)
  const roots: V3[] = [B(9, -9, 34), B(-9, -9, 34), B(10, -8, -34), B(-10, -8, -34)];
  roots.forEach((root, i) => {
    const front = i < 2;
    const foot: V3 = [pose.feet[i]![0], pose.feet[i]![1] + 5, pose.feet[i]![2]];
    const [knee, end] = ik(root, foot, 42, 44, front ? [0, 0, 1] : [0, 0.1, -1]);
    st.add(lerp3(root, end, 0.5), -1.5, (pp) => {
      const hide = i % 2 ? HIDE_DARK : HIDE;
      pp.fill(st.capsule(root, knee, front ? 9 : 11, 6), hide);
      pp.fill(st.capsule(knee, end, 5.2, 4), hide);
      pp.fill(st.capsule(madd(end, [0, 1, 0], 6), end, 6.5, 6.5), STEEL, { lw: 1.2 });
      const hoof = frameYZ(end, [0, 1, 0], [0, 0, 1]);
      pp.fill(st.hull([...ring(hoof, -4, 6.5, 8, 7, 2), ...ring(hoof, 3, 5.5, 6, 6, 1)]), STEEL_DARK, { lw: 1.4 });
      flame(st, pp, madd(end, [0, 1, 0], 2), [0, 1, -0.2], 16 + pose.flare * 8, 3.4, ph * 2 + i * 1.3, false);
    });
  });

  // ---------------------------------------------------------------- tail of ghost flame
  const tailBase = B(0, 14, -46);
  st.add(tailBase, -0.5, (pp) => {
    for (let j = 0; j < 4; j++) {
      const dir = norm([Math.sin(ph + j) * 0.5, 0.15 + pose.tailUp * 0.9 + j * 0.05, -1]);
      flame(st, pp, madd(tailBase, [0, 1, 0], j * 3), dir, 54 - j * 6, 7 - j * 1.1, ph * (anim === 'run' ? 2 : 1) + j * 1.7, j > 1);
    }
  });

  // ---------------------------------------------------------------- horse body + barding
  st.add(body.o, 0, (pp) => {
    const pts = [
      ...ring(frameYZ(B(0, 0, -44), spine, [0, 1, 0]), 0, 19, 21, 12),
      ...ring(frameYZ(B(0, 1, -16), spine, [0, 1, 0]), 0, 22, 24, 12),
      ...ring(frameYZ(B(0, 1, 12), spine, [0, 1, 0]), 0, 23, 26, 12),
      ...ring(frameYZ(B(0, 3, 38), spine, [0, 1, 0]), 0, 20, 22, 12),
    ];
    pp.fill(furHull(st, pts, 3.2), HIDE, { folds: [st.pts2([B(8, 14, 6), B(4, -4, 10), B(10, -16, 4)]), st.pts2([B(-8, 14, -22), B(-6, -6, -26)])] });
    pp.fill(furHull(st, [B(6, -8, 40), B(-6, -8, 40), B(8, -20, 14), B(-8, -20, 14), B(0, -22, -14), B(0, -14, 44)], 2.4), HIDE_LIGHT, { lw: 1.2, rim: false });
    // barding plates on the side facing the camera
    for (const sd of [1, -1]) {
      if (st.faces([sd, 0, 0]) < -0.05) continue;
      for (const [z0, z1, y0] of [[-34, -16, 8], [-14, 6, 10], [8, 26, 8]] as const) {
        pp.fill(st.poly([B(sd * 22, y0 + 6, z0), B(sd * 24, y0 + 8, z1), B(sd * 24, y0 - 20, z1 - 2), B(sd * 22, y0 - 18, z0 + 1)], true), STEEL, { lw: 1.3 });
      }
    }
    // ghost flames along the back ridge
    for (let j = 0; j < 4; j++) flame(st, pp, B(0, 22, -30 + j * 18), [0.1, 1, -0.5], 18 + pose.flare * 14, 4.4, ph * 2 + j * 1.9);
  });

  // ---------------------------------------------------------------- rider torso
  const base = add3(sho, [0, 8, 4 - pose.rear * 6]);
  const lean = pose.lean;
  const up = norm([0, 1, lean * 0.02]);
  const tb: Basis = frameYZ(base, up, [0, 0, 1]);
  const T = (x: number, y: number, z: number): V3 => at(tb, [x, y, z]);
  const shoulderY = 44;
  const headC = T(0, shoulderY + 18, 3 + lean * 0.2);
  const sR = T(23, shoulderY - 3, 0);
  const sL = T(-23, shoulderY - 3, 0);
  const grip = madd(T(24, shoulderY - 20, 20), [0, 0, 1], pose.lancePush * 0.3);
  const lanceDir = norm([0.06, pose.lanceUp, 1 - Math.max(0, pose.lanceUp) * 0.6]);
  const butt = madd(grip, lanceDir, -34);
  const tip = madd(grip, lanceDir, 112 + pose.lancePush * 0.6);
  const [elR, wrR] = ik(sR, grip, 24, 26, [1, -0.4, -0.6]);
  const handL = T(-26, shoulderY - 28, 24);
  const [elL, wrL] = ik(sL, handL, 24, 26, [-1, -0.4, -0.6]);

  // cape, trailing back (behind the torso)
  st.add(T(0, shoulderY - 10, -14), -0.8, (pp) => {
    const sway = anim === 'run' ? 14 : 4 + Math.sin(ph) * 3;
    const cape = st.poly([T(-20, shoulderY, -6), T(20, shoulderY, -6), T(28, 4, -30 - sway), T(10, -10, -42 - sway), T(-6, 0, -36 - sway), T(-28, 2, -30 - sway)], true);
    pp.fill(cape, CLOTH, { lw: 1.6, folds: [st.pts2([T(-8, shoulderY - 4, -8), T(-10, 2, -34 - sway)]), st.pts2([T(10, shoulderY - 4, -8), T(14, 2, -34 - sway)])] });
    pp.fill(st.poly([T(-14, shoulderY - 6, -8), T(14, shoulderY - 6, -8), T(18, 0, -28 - sway), T(-18, 0, -28 - sway)], true), CLOTH_LIT, { lw: 1, rim: false });
  });

  // left arm (reins / chain)
  st.add(lerp3(sL, wrL, 0.5), 0.4, (pp) => {
    pp.fill(st.capsule(sL, elL, 7.5, 6), STEEL);
    pp.fill(st.capsule(elL, wrL, 6, 5), STEEL_DARK);
    pp.fill(st.sphere(wrL, 6.2), STEEL, { lw: 1.2 });
  });

  // torso, plate, chains
  st.add(base, 0.6, (pp) => {
    const tpts = [...ring(frameYZ(T(0, 0, 0), up, [0, 0, 1]), 0, 15, 11, 10), ...ring(frameYZ(T(0, 22, 1), up, [0, 0, 1]), 0, 19, 13, 10), ...ring(frameYZ(T(0, shoulderY - 6, 0), up, [0, 0, 1]), 0, 21, 13, 10)];
    pp.fill(st.hull(tpts), STEEL_DARK, { lw: 1.6 });
    pp.fill(st.hull([T(-15, shoulderY - 8, 10), T(15, shoulderY - 8, 10), T(12, 8, 11), T(-12, 8, 11), T(0, 2, 12)]), STEEL, { lw: 1.6, folds: [st.pts2([T(0, shoulderY - 8, 12), T(0, 10, 12)])] });
    // glowing seam on the chest
    pp.fill(st.poly([T(-3, shoulderY - 12, 12), T(3, shoulderY - 12, 12), T(2.5, 16, 12), T(-2.5, 16, 12)]), FLAME, { lw: 0.8 });
    // chains: diagonal across the chest, sagging loop at the hip
    const cr = (a: V3, b: V3, sag: number, nn: number): { x: number; y: number }[] =>
      Array.from({ length: nn + 1 }, (_, j) => {
        const u = j / nn;
        return st.p(add3(lerp3(a, b, u), [0, -sag * Math.sin(u * Math.PI), 0]));
      });
    pp.rope(cr(T(-19, shoulderY - 6, 9), T(15, 6, 12), 5, 9), CHAIN, 2.4);
    pp.rope(cr(T(19, shoulderY - 6, 9), T(-15, 6, 12), 5, 9), CHAIN, 2.4);
    for (const c of cr(T(-19, shoulderY - 6, 9), T(15, 6, 12), 5, 9)) pp.dot(c.x, c.y, 1.4 * k, 1.1 * k, '#cfd8d8');
    pp.rope(cr(T(-24, 6, 6), B(-24, 4, 24), 14, 6), CHAIN, 2.2);
    pp.rope(cr(T(24, 6, 6), B(24, 4, 24), 14, 6), CHAIN, 2.2);
  });

  // head with horned helm
  st.add(headC, 1.2, (pp) => {
    const H = frameYZ(headC, up, [0, 0, 1]);
    pp.fill(st.capsule(T(0, shoulderY - 8, 1), headC, 6.5, 6), STEEL_DARK);
    pp.fill(st.hull([...ring(H, -8, 8, 9, 8), ...ring(H, 2, 11, 11.5, 10), ...ring(H, 11, 8, 8, 8)]), STEEL, { lw: 1.6 });
    // face void + eyes
    const f = at(H, [0, -1, 11]);
    if (st.faces(norm(sub(f, headC))) > -0.1) {
      pp.fill(st.poly([at(H, [-6, 4, 10.5]), at(H, [6, 4, 10.5]), at(H, [5, -8, 10]), at(H, [-5, -8, 10])], true), HIDE_DARK, { lw: 1, rim: false });
      for (const sd of [1, -1]) {
        const e = st.p(at(H, [sd * 3.4, 1.5, 11.6]));
        p.dot(e.x, e.y, 2.3 * k, 1.5 * k, EYE);
      }
    }
    // horns
    for (const sd of [1, -1]) {
      const a = at(H, [sd * 10, 7, 0]);
      const b = at(H, [sd * 19, 17, -2]);
      const c = at(H, [sd * 17, 31, 3]);
      pp.fill(st.capsule(a, b, 3.4, 2.6), BONE, { lw: 1.2 });
      pp.fill(st.capsule(b, c, 2.6, 0.8), BONE, { lw: 1.2 });
    }
    flame(st, pp, at(H, [0, 12, -2]), [0, 1, -0.4], 20 + pose.flare * 10, 4, ph * 2 + 0.7);
  });

  // right shoulder + arm
  st.add(lerp3(sR, wrR, 0.5), 1.0, (pp) => {
    pp.fill(st.capsule(sR, elR, 7.5, 6), STEEL);
    pp.fill(st.capsule(elR, wrR, 6, 5), STEEL_DARK);
    pp.fill(st.sphere(wrR, 6.2), STEEL, { lw: 1.2 });
  });
  for (const [s0, sd] of [[sL, -1], [sR, 1]] as const)
    st.add(s0, 1.1, (pp) => {
      pp.fill(st.sphere(s0, 9.5), STEEL, { lw: 1.6 });
      pp.fill(st.hull([madd(s0, [sd, 0.6, 0], 4), madd(s0, [sd, 1.6, 0], 10), madd(s0, [sd * 0.5, 1, 0.6], 6)]), BONE, { lw: 1.1 });
    });

  // lance
  st.tip = { tip, grip };
  st.add(lerp3(butt, tip, 0.55), 1.4, (pp) => {
    pp.fill(st.capsule(butt, tip, 2.6, 2), m('#5a4636', 'wood'), { lw: 1.2 });
    const dir = norm(sub(tip, butt));
    const hd = frameYZ(tip, [0, 1, 0], dir);
    pp.fill(st.hull([madd(tip, dir, 20), at(hd, [0, 5, -7]), at(hd, [0, -5, -7]), at(hd, [5, 0, -7]), at(hd, [-5, 0, -7])]), m('#b7c6c8', 'metal'), { lw: 1.4 });
    // pennant
    pp.fill(st.poly([madd(tip, dir, -12), madd(tip, dir, -34), add3(madd(tip, dir, -26), [0, -14, 0])], true), CLOTH_LIT, { lw: 1.2 });
    flame(st, pp, madd(tip, dir, 10), dir, 18 + pose.flare * 16, 4.2, ph * 2 + 2.4);
    // clenched fist over the shaft
    pp.fill(st.sphere(grip, 5.4), STEEL, { lw: 1.2 });
  });

  // cast flare: ring of flames around the horse
  if (pose.flare > 0.85 && (anim === 'cast' || anim === 'attack'))
    st.add(body.o, 3, (pp) => {
      for (let j = 0; j < 8; j++) {
        const a = (j / 8) * TAU + 0.3;
        flame(st, pp, B(Math.cos(a) * 34, -2, Math.sin(a) * 48 - 2), [Math.cos(a) * 0.3, 1, 0], 24, 5, ph * 3 + j, true);
      }
    });

  st.render(p);
}

function add3(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/** Idle frame 0: head centre at [0, 145, 39] (see drawVargrim: shoulders 75 + rider 62), helm radius ~12. */
function head(yaw: number, res: number): { x: number; y: number; r: number } {
  const s = res / 256;
  const q = project({ yaw, elev: 0.42, cx: res / 2, cy: res * 0.9, k: s * 0.8, fall: 0, lift: 0 }, [0, 145, 39]);
  return { x: q.x, y: q.y, r: 12 * s * 0.8 };
}

export const VARGRIM_DRAWER: SpriteDrawer = {
  world: 340,
  frames: FRAMES,
  foot: 0.9,
  ink: 1,
  hit: 2,
  draw: drawVargrim,
  head,
};
