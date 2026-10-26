// Jungle monster + plant sprites (style C "Gouache-Dämmerung"), baked with the champion pipeline into two atlases
// (render/sheets.ts: big = buffs + epics at a higher resolution, camp = small camps + plants). One drawer per
// monster type; small camp members reuse their leader's frames at a smaller scale (render/units.ts).
//   Dornenbock   slate-and-moss ram golem, blue rune glow, crystal thorns (blue buff)
//   Glutwächter  basalt ram golem, magma cracks, ember crown (red buff)
//   Sumpfunke    fat bog toad, glowing eyes, mushrooms on the back (gromp)
//   Mooswolf     moss-backed wolf (wolves; Hark's rig with a jungle look)
//   Hohlkäfer    horned chitin beetle with hollow glowing shell spots (raptor-like camp)
//   Schattenkrabbe  rock-shelled crab with violet shadow crystals (krug-like stone camp)
//   Nebelschleicher pale long-legged river strider with a lantern stalk (scuttle)
//   Flussleviathan  river serpent rising from its coils, glowing fins (dragon)
//   Schleierwächter armoured veil worm with a horned crown and many eyes (baron)
//   Kesselbrut   grub carrying a bubbling iron cauldron shell (voidgrubs)
//   plants: Sprungfrucht (amber pod), Honigfrucht (golden fruit cluster), Spähfrucht (blue eye bloom)
import { at, INK, lerp3, m, madd, mix, norm, ring, sub, TAU, type Basis, type Mat, type Painter, type Shape, type Stage, type V3 } from './core';
import { glowOrb } from './props';
import { drawWolf, furHull, HARK, type WolfLook } from './wolf';
import type { Anim } from './types';
import type { SpriteDrawer } from './atlas';

const MF: Record<Anim, number> = { idle: 3, run: 4, attack: 3, cast: 0, death: 3 };
/** epics (agent F): a breathing idle and an attack with anticipation, coil, STRIKE (hit frame 2), recover */
const EF: Record<Anim, number> = { idle: 4, run: 4, attack: 4, cast: 0, death: 3 };
const PF: Record<Anim, number> = { idle: 2, run: 0, attack: 0, cast: 0, death: 2 };

// ------------------------------------------------------------------------------------------------ helpers
/** Basis at o, pitched forward by `pitch` (y tilts toward +z) and rolled by `roll` (about the forward axis). */
function basis(o: V3, pitch = 0, roll = 0, yaw = 0): Basis {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  let x: V3 = [1, 0, 0];
  let y: V3 = [0, cp, sp];
  const z0: V3 = [0, -sp, cp];
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const x1: V3 = [x[0] * cr + y[0] * sr, x[1] * cr + y[1] * sr, x[2] * cr + y[2] * sr];
  y = [-x[0] * sr + y[0] * cr, -x[1] * sr + y[1] * cr, -x[2] * sr + y[2] * cr];
  x = x1;
  if (!yaw) return { o, x, y, z: z0 };
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const ry = (v: V3): V3 => [v[0] * cy + v[2] * sy, v[1], -v[0] * sy + v[2] * cy];
  return { o, x: ry(x), y: ry(y), z: ry(z0) };
}

/** Ellipsoid hull centred at local c of basis b. */
function ell(st: Stage, b: Basis, c: V3, rx: number, ry: number, rz: number, n = 12): Shape {
  return st.hull(ellPts(b, c, rx, ry, rz, n));
}
function ellPts(b: Basis, c: V3, rx: number, ry: number, rz: number, n = 12): V3[] {
  const bb: Basis = { ...b, o: at(b, c) };
  const pts: V3[] = [];
  for (const t of [-0.9, -0.55, 0, 0.55, 0.9]) {
    const k = Math.sqrt(1 - t * t);
    pts.push(...ring(bb, t * ry, rx * k, rz * k, n));
  }
  pts.push(at(bb, [0, ry, 0]), at(bb, [0, -ry, 0]));
  return pts;
}
/** Jagged (mossy / furry / rocky) ellipsoid outline. */
function jell(st: Stage, b: Basis, c: V3, rx: number, ry: number, rz: number, tooth: number): Shape {
  return furHull(st, ellPts(b, c, rx, ry, rz, 14), tooth);
}
/** Tapered tube through points (one capsule per segment), painted as one part. */
function tube(st: Stage, p: Painter, pts: V3[], r0: number, r1: number, mat: Mat, lw = 1.4): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = r0 + ((r1 - r0) * i) / (pts.length - 1);
    const b = r0 + ((r1 - r0) * (i + 1)) / (pts.length - 1);
    p.fill(st.capsule(pts[i]!, pts[i + 1]!, a, b), mat, { lw, ao: i === 0 });
  }
}
/** Cone spike from base (radius r) toward tip. */
function spike(st: Stage, base: V3, tip: V3, r: number): Shape {
  const d = norm(sub(tip, base));
  const side = norm(Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [d[2], 0, -d[0]]);
  const up: V3 = [d[1] * side[2] - d[2] * side[1], d[2] * side[0] - d[0] * side[2], d[0] * side[1] - d[1] * side[0]];
  const pts: V3[] = [tip];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    pts.push(madd(madd(base, side, Math.cos(a) * r), up, Math.sin(a) * r));
  }
  return st.hull(pts);
}
const loop = (anim: Anim, frame: number, frames: Record<Anim, number>): number => (frame % Math.max(1, frames[anim])) / Math.max(1, frames[anim]);
function eye(st: Stage, p: Painter, c: V3, r: number, color: string, facing: V3): void {
  if (st.faces(facing) < -0.05) return;
  const q = st.p(c);
  const k = st.view.k;
  p.dot(q.x, q.y, r * 1.5 * k, r * 1.5 * k, mix(color, INK, 0.55));
  p.dot(q.x, q.y, r * k, r * k, color);
  p.dot(q.x - r * 0.3 * k, q.y - r * 0.3 * k, r * 0.4 * k, r * 0.4 * k, '#ffffff');
}

// ------------------------------------------------------------------------------------------------ golems (buffs)
interface GolemLook {
  stone: Mat;
  dark: Mat;
  mantle: Mat;
  horn: Mat;
  thorn: Mat;
  glow: string;
  crack: string;
}
const DORNEN: GolemLook = {
  stone: m('#66727f', 'stone'),
  dark: m('#3f4954', 'stone'),
  mantle: m('#4f6b3a', 'fur'),
  horn: m('#cfc3a2', 'stone'),
  thorn: m('#7fc8f0', 'glass'),
  glow: '#8fdcff',
  crack: '#5fb8f0',
};
const GLUT: GolemLook = {
  stone: m('#584640', 'stone'),
  dark: m('#2e2426', 'stone'),
  mantle: m('#3a2c2a', 'stone'),
  horn: m('#2a2226', 'stone'),
  thorn: m('#ff9a3a', 'glow'),
  glow: '#ffb05a',
  crack: '#ff7a2a',
};

function drawGolem(st: Stage, p: Painter, anim: Anim, frame: number, L: GolemLook): void {
  st.view.k *= 0.98;
  const u = loop(anim, frame, MF);
  const f3 = frame % 3;
  let bob = 0;
  let hunch = 0.28;
  let fall = 0;
  let sink = 0;
  let glowP = 0.75;
  let fistL: V3 = [64, 16, 46];
  let fistR: V3 = [-64, 16, 46];
  const feet: [V3, V3] = [
    [36, 0, -26],
    [-36, 0, -26],
  ];
  if (anim === 'idle') {
    bob = Math.sin(u * TAU) * 2.2;
    glowP = 0.65 + 0.3 * Math.sin(u * TAU);
    fistL = [64, 16 + Math.sin(u * TAU) * 2, 46];
  } else if (anim === 'run') {
    const sw = Math.sin(u * TAU);
    bob = Math.abs(Math.sin(u * TAU * 2)) * 5;
    fistL = [64, 16 + Math.max(0, sw) * 16, 46 + sw * 24];
    fistR = [-64, 16 + Math.max(0, -sw) * 16, 46 - sw * 24];
    feet[0] = [36, Math.max(0, -sw) * 10, -26 - sw * 16];
    feet[1] = [-36, Math.max(0, sw) * 10, -26 + sw * 16];
    hunch = 0.38;
  } else if (anim === 'attack') {
    if (f3 === 0) {
      fistL = [38, 178, 22];
      fistR = [-38, 178, 22];
      hunch = 0.02;
      glowP = 1;
    } else if (f3 === 1) {
      fistL = [34, 10, 96];
      fistR = [-34, 10, 96];
      hunch = 0.62;
      bob = -6;
      glowP = 1.2;
    } else {
      fistL = [52, 24, 74];
      fistR = [-52, 24, 74];
      hunch = 0.45;
    }
  } else if (anim === 'death') {
    fall = [0.25, 0.75, 1.3][f3]!;
    sink = [6, 26, 46][f3]!;
    fistL = [80, 0, 40 + f3 * 14];
    fistR = [-80, 0, 40 + f3 * 14];
    glowP = [0.5, 0.25, 0][f3]!;
  }
  const B = basis([0, 60 + bob - sink, -14], hunch + fall);
  // legs (world)
  for (const [i, s] of [
    [0, 1],
    [1, -1],
  ] as const) {
    const hip = at(B, [s * 32, -4, 0]);
    const foot = feet[i]!;
    const knee = lerp3(hip, foot, 0.5);
    knee[2] += 10;
    st.add(lerp3(hip, foot, 0.5), -2, (pp) => {
      pp.fill(st.capsule(hip, knee, 24, 20), L.dark);
      pp.fill(st.capsule(knee, foot, 20, 22), L.stone);
      pp.fill(ell(st, basis(foot), [0, 6, 6], 22, 9, 26), L.dark, { lw: 1.4 });
    });
  }
  // torso + mantle + thorns
  st.add(at(B, [0, 40, 0]), 0, (pp) => {
    pp.fill(ell(st, B, [0, 8, 0], 46, 32, 38), L.dark);
    const chest = ell(st, B, [0, 58, 16], 66, 50, 50);
    pp.fill(chest, L.stone, { folds: [st.pts2([at(B, [-30, 80, 50]), at(B, [-8, 50, 64]), at(B, [-26, 22, 52])]), st.pts2([at(B, [34, 82, 46]), at(B, [12, 46, 64])])] });
    // glowing cracks
    for (const [a, b, c] of [
      [[-40, 70, 48], [-24, 52, 60], [-34, 30, 50]],
      [[44, 64, 44], [28, 44, 58], [40, 24, 48]],
    ] as [V3, V3, V3][]) {
      if (st.faces(B.z) > 0) pp.line(st.pts2([at(B, a), at(B, b), at(B, c)]), L.crack, 2.4);
    }
    pp.fill(jell(st, B, [0, 92, -6], 58, 22, 44, 5), L.mantle, { lw: 1.3 });
    for (let i = 0; i < 7; i++) {
      const a = (i / 6) * Math.PI - Math.PI / 2;
      const base = at(B, [Math.sin(a) * 40, 100, -18 + Math.cos(a) * 14]);
      const tip = at(B, [Math.sin(a) * 58, 140 + (i % 2) * 14, -42 + Math.cos(a) * 10]);
      pp.fill(spike(st, base, tip, 8), L.thorn, { lw: 1.2 });
    }
  });
  // chest rune
  st.add(at(B, [0, 60, 66]), 2, (pp) => {
    if (st.faces(B.z) < 0.05) return;
    const o = at(B, [0, 62, 66]);
    glowOrb(st, pp, o, 9, L.glow, glowP);
    const r = (x: number, y: number): V3 => at(B, [x, 62 + y, 66]);
    pp.line(st.pts2([r(-14, 16), r(0, 4), r(14, 16)]), L.crack, 2);
    pp.line(st.pts2([r(-12, -14), r(0, -4), r(12, -14)]), L.crack, 2);
  });
  // arms
  for (const [s, fist] of [
    [1, fistL],
    [-1, fistR],
  ] as const) {
    const sh = at(B, [s * 66, 76, 22]);
    const el: V3 = lerp3(sh, fist, 0.5);
    el[0] += s * 22;
    el[1] += 12;
    st.add(lerp3(sh, fist, 0.6), 1, (pp) => {
      pp.fill(ell(st, basis(sh), [0, 4, 0], 34, 30, 32), L.stone);
      pp.fill(st.capsule(sh, el, 22, 18), L.dark);
      pp.fill(st.capsule(el, fist, 20, 26), L.stone, { folds: [st.pts2([lerp3(el, fist, 0.3), lerp3(el, fist, 0.6)])] });
      pp.fill(jell(st, basis(fist), [0, 6, 0], 28, 22, 26, 3), L.dark);
      pp.fill(jell(st, basis(sh), [0, 30, -4], 26, 10, 22, 4), L.mantle, { lw: 1.2 });
    });
  }
  // head + horns
  const H = basis(at(B, [0, 70, 72]), hunch * 0.3);
  st.add(at(H, [0, 0, 6]), 3, (pp) => {
    pp.fill(ell(st, H, [0, 0, 0], 24, 22, 26), L.stone);
    pp.fill(ell(st, H, [0, -10, 16], 16, 10, 14), L.dark, { lw: 1.3 });
    eye(st, pp, at(H, [9, 4, 22]), 3.2, L.glow, H.z);
    eye(st, pp, at(H, [-9, 4, 22]), 3.2, L.glow, H.z);
    for (const s of [1, -1]) {
      const pts: V3[] = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const a = 0.5 + t * 4.6;
        const R = 26 * (1 - 0.5 * t);
        pts.push(at(H, [s * (18 + t * 18), 14 + Math.sin(a) * R, -6 + Math.cos(a) * R * 0.9 - 10 * t]));
      }
      tube(st, pp, pts, 11, 4, L.horn, 1.3);
      const tip = pts[pts.length - 1]!;
      pp.fill(spike(st, tip, madd(tip, [s, 0.3, 0.6], 16), 4), L.thorn, { lw: 1 });
    }
  });
  st.render(p);
}

// ------------------------------------------------------------------------------------------------ toad (gromp)
const TOAD = m('#5f7a3c', 'skin');
const TOAD_DARK = m('#3e5230', 'skin');
const TOAD_BELLY = m('#c9b77a', 'skin');
function drawToad(st: Stage, p: Painter, anim: Anim, frame: number): void {
  st.view.k *= 1.3;
  const u = loop(anim, frame, MF);
  const f3 = frame % 3;
  let lift = 0;
  let squash = 1;
  let sac = 0.6;
  let lean = 0;
  let tongue = 0;
  let roll = 0;
  if (anim === 'idle') {
    sac = 0.6 + 0.4 * Math.sin(u * TAU);
    squash = 1 + 0.03 * Math.sin(u * TAU);
  } else if (anim === 'run') {
    lift = [0, 18, 26, 6][frame % 4]!;
    squash = [0.86, 1.1, 1.06, 0.92][frame % 4]!;
  } else if (anim === 'attack') {
    lean = [-0.25, 0.35, 0.15][f3]!;
    sac = [1.3, 0.5, 0.7][f3]!;
    tongue = [0, 1, 0.3][f3]!;
  } else if (anim === 'death') {
    roll = [0.3, 0.9, 1.5][f3]!;
    squash = [0.9, 0.8, 0.7][f3]!;
    lift = -[2, 8, 14][f3]!;
  }
  const B = basis([0, 50 * squash + lift, 0], lean, roll);
  // hind legs
  for (const s of [1, -1]) {
    st.add(at(B, [s * 62, -14, -20]), -1, (pp) => {
      pp.fill(ell(st, B, [s * 60, -12, -18], 26, 30, 38), TOAD_DARK);
      const foot = at(B, [s * 74, -48 * squash, 16]);
      pp.fill(ell(st, basis(foot), [0, 0, 0], 18, 6, 24), TOAD_DARK, { lw: 1.2 });
    });
  }
  st.add(at(B, [0, 0, 0]), 0, (pp) => {
    pp.fill(ell(st, B, [0, 0, 0], 72, 48 * squash, 64), TOAD, {
      folds: [st.pts2([at(B, [-40, 30, 20]), at(B, [-10, 42, 6]), at(B, [26, 34, 18])])],
    });
    // warts
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      const q = st.p(at(B, [Math.cos(a) * 48, 30 + (i % 3) * 6, Math.sin(a) * 40]));
      pp.dot(q.x, q.y, 3.4 * st.view.k, 2.6 * st.view.k, mix('#3e5230', '#1a1420', 0.3));
    }
    // mushrooms on the back
    for (const [x, z, h] of [
      [-22, -20, 24],
      [10, -30, 32],
      [28, -6, 18],
    ] as const) {
      const base = at(B, [x, 40 * squash, z]);
      const top = madd(base, B.y, h);
      pp.fill(st.capsule(base, top, 3, 3), m('#e6dcc2', 'skin'), { lw: 1 });
      pp.fill(ell(st, basis(top), [0, 2, 0], 11, 6, 11), m('#c8a24a', 'glow'), { lw: 1.2 });
    }
  });
  // belly + face
  st.add(at(B, [0, -6, 50]), 1, (pp) => {
    pp.fill(ell(st, B, [0, -14, 40], 50, 28, 26), TOAD_BELLY, { lw: 1.3, rim: false });
    pp.fill(ell(st, B, [0, -22, 52], 28 * sac, 18 * sac, 16 * sac), m('#e2cf96', 'skin'), { lw: 1.2 });
    if (st.faces(B.z) > -0.2) pp.line(st.pts2([at(B, [-46, 0, 50]), at(B, [-20, -6, 62]), at(B, [20, -6, 62]), at(B, [46, 0, 50])]), INK, 2.6);
    if (tongue > 0) {
      const a = at(B, [0, -4, 62]);
      const b = madd(madd(a, B.z, 70 * tongue), B.y, -26 * tongue);
      pp.fill(st.capsule(a, b, 6, 9), m('#c85a6a', 'skin'), { lw: 1.4 });
    }
    for (const s of [1, -1]) {
      const c = at(B, [s * 30, 40 * squash, 34]);
      pp.fill(st.sphere(c, 15), TOAD, { lw: 1.4 });
      eye(st, pp, madd(c, B.z, 9), 7, '#f2d24a', B.z);
    }
  });
  st.render(p);
}

// ------------------------------------------------------------------------------------------------ beetle
const CHITIN = m('#2f4752', 'metal');
const CHITIN_DARK = m('#1f2a34', 'metal');
// F: glows one gouache step calmer (sprite-research rule 3: no channel at maximum on a body)
const BEETLE_GLOW = '#86d2c0';
function drawBeetle(st: Stage, p: Painter, anim: Anim, frame: number): void {
  st.view.k *= 1.15;
  const u = loop(anim, frame, MF);
  const f3 = frame % 3;
  let pitch = 0;
  let lunge = 0;
  let roll = 0;
  let sink = 0;
  let gait = 0;
  if (anim === 'idle') pitch = Math.sin(u * TAU) * 0.03;
  else if (anim === 'run') gait = u;
  else if (anim === 'attack') {
    pitch = [-0.2, 0.25, 0.1][f3]!;
    lunge = [-10, 30, 12][f3]!;
  } else if (anim === 'death') {
    roll = [0.6, 1.6, 2.6][f3]!;
    sink = [4, 14, 22][f3]!;
  }
  const B = basis([0, 46 - sink, lunge], pitch, roll);
  // legs
  for (let i = 0; i < 3; i++) {
    for (const s of [1, -1]) {
      const z = 40 - i * 34;
      const ph = gait * TAU + (i % 2 ? Math.PI : 0) + (s > 0 ? 0 : Math.PI);
      const root = at(B, [s * 30, -4, z]);
      const foot: V3 = roll > 0.5 ? at(B, [s * 70, 40, z + 10]) : [s * 80, Math.max(0, Math.sin(ph)) * 10, z + lunge + (gait ? Math.cos(ph) * 14 : 0)];
      const knee = lerp3(root, foot, 0.45);
      knee[1] += 26;
      knee[0] += s * 10;
      st.add(knee, -3, (pp) => {
        pp.fill(st.capsule(root, knee, 5, 4), CHITIN_DARK, { lw: 1.2 });
        pp.fill(st.capsule(knee, foot, 4, 2), CHITIN_DARK, { lw: 1.2 });
      });
    }
  }
  st.add(at(B, [0, 6, -10]), 0, (pp) => {
    const shell = ell(st, B, [0, 8, -18], 50, 36, 64);
    pp.fill(shell, CHITIN, {
      sheen: [st.pts2([at(B, [-26, 36, 10]), at(B, [-30, 30, -30]), at(B, [-22, 20, -60])])],
    });
    if (st.faces(B.y) > -0.3) pp.line(st.pts2([at(B, [0, 44, 22]), at(B, [0, 46, -20]), at(B, [0, 30, -74])]), INK, 2);
    // hollow glowing spots
    for (const [x, z] of [
      [-22, -2],
      [22, -2],
      [-18, -40],
      [18, -40],
    ] as const) {
      const q = st.p(at(B, [x, 38, z]));
      pp.dot(q.x, q.y, 6.5 * st.view.k, 4.5 * st.view.k, '#16202a');
      pp.dot(q.x, q.y, 4 * st.view.k, 2.6 * st.view.k, BEETLE_GLOW);
    }
  });
  st.add(at(B, [0, 0, 50]), 1, (pp) => {
    pp.fill(ell(st, B, [0, 2, 44], 36, 26, 22), CHITIN_DARK);
    pp.fill(ell(st, B, [0, -2, 70], 22, 18, 18), CHITIN);
    const horn = [at(B, [0, 8, 80]), at(B, [0, 30, 98]), at(B, [0, 56, 102]), at(B, [0, 70, 90])];
    tube(st, pp, horn, 8, 2.5, m('#b8ad8c', 'stone'), 1.3);
    for (const s of [1, -1]) {
      pp.fill(st.poly([at(B, [s * 10, -10, 82]), at(B, [s * 16, -12, 100]), at(B, [s * 4, -14, 96])]), m('#b8ad8c', 'stone'), { lw: 1.1 });
      eye(st, pp, at(B, [s * 13, 4, 82]), 3, BEETLE_GLOW, B.z);
    }
  });
  st.render(p);
}

// ------------------------------------------------------------------------------------------------ rock crab
const ROCK = m('#5a5562', 'stone');
const ROCK_DARK = m('#36323e', 'stone');
const SHADOW_CRYSTAL = m('#8e74c8', 'glass');
function drawCrab(st: Stage, p: Painter, anim: Anim, frame: number): void {
  st.view.k *= 1.12;
  const u = loop(anim, frame, MF);
  const f3 = frame % 3;
  let open = 0.3;
  let clawUp = 0;
  let bob = 0;
  let sink = 0;
  let gait = -1;
  if (anim === 'idle') open = 0.3 + 0.3 * Math.sin(u * TAU);
  else if (anim === 'run') {
    gait = u;
    bob = Math.abs(Math.sin(u * TAU * 2)) * 4;
  } else if (anim === 'attack') {
    clawUp = [1, -0.4, 0.2][f3]!;
    open = [1, 0, 0.4][f3]!;
  } else if (anim === 'death') {
    sink = [8, 20, 30][f3]!;
    open = 0;
  }
  const B = basis([0, 52 + bob - sink, 0]);
  for (let i = 0; i < 3; i++) {
    for (const s of [1, -1]) {
      const z = 10 - i * 26;
      const ph = gait >= 0 ? gait * TAU + i * 2 + (s > 0 ? 0 : Math.PI) : 0;
      const root = at(B, [s * 50, -10, z]);
      const foot: V3 = sink > 15 ? at(B, [s * 70, -40, z - 6]) : [s * (92 + Math.cos(ph) * 8), gait >= 0 ? Math.max(0, Math.sin(ph)) * 10 : 0, z];
      const knee = lerp3(root, foot, 0.5);
      knee[1] += 30;
      st.add(knee, -3, (pp) => {
        pp.fill(st.capsule(root, knee, 8, 6), ROCK_DARK, { lw: 1.2 });
        pp.fill(st.capsule(knee, foot, 6, 3), ROCK_DARK, { lw: 1.2 });
      });
    }
  }
  st.add(at(B, [0, 0, 0]), 0, (pp) => {
    pp.fill(jell(st, B, [0, 4, -6], 76, 34, 56, 5), ROCK, { folds: [st.pts2([at(B, [-40, 30, 10]), at(B, [0, 36, 20]), at(B, [36, 28, 6])])] });
    for (const [x, z, h, lean] of [
      [-20, -16, 46, -0.3],
      [6, -24, 60, 0.1],
      [26, -6, 38, 0.4],
      [-36, 6, 30, -0.6],
      [14, 14, 28, 0.2],
    ] as const) {
      const base = at(B, [x, 26, z]);
      pp.fill(spike(st, base, at(B, [x + lean * 30, 26 + h, z - 8]), 9), SHADOW_CRYSTAL, { lw: 1.2 });
    }
  });
  // claws + eyes
  for (const s of [1, -1]) {
    const sh = at(B, [s * 56, -2, 30]);
    const el = at(B, [s * 96, 6 + clawUp * 40, 54]);
    const hand = at(B, [s * 82, 4 + clawUp * 80, 92 - clawUp * 10]);
    st.add(hand, 1, (pp) => {
      pp.fill(st.capsule(sh, el, 11, 10), ROCK_DARK);
      pp.fill(st.capsule(el, hand, 10, 14), ROCK);
      const hb = basis(hand, -0.3 - clawUp * 0.6);
      pp.fill(ell(st, hb, [0, 0, 6], 20, 15, 24), ROCK, { lw: 1.4 });
      const tip = at(hb, [0, 4, 40]);
      pp.fill(st.poly([at(hb, [-10, 6, 20]), madd(tip, hb.y, 10 * open), at(hb, [10, 6, 20])]), ROCK_DARK, { lw: 1.2 });
      pp.fill(st.poly([at(hb, [-8, -6, 20]), madd(tip, hb.y, -12 * open), at(hb, [8, -6, 20])]), ROCK_DARK, { lw: 1.2 });
    });
  }
  st.add(at(B, [0, 20, 52]), 2, (pp) => {
    for (const s of [1, -1]) {
      const base = at(B, [s * 14, 18, 44]);
      const top = at(B, [s * 18, 42, 52]);
      pp.fill(st.capsule(base, top, 4, 3), ROCK_DARK, { lw: 1 });
      eye(st, pp, top, 5, '#c8a8ff', B.z);
    }
  });
  st.render(p);
}

// ------------------------------------------------------------------------------------------------ mist strider (scuttle)
const MIST_SHELL = m('#93a7b3', 'stone');
const MIST_DARK = m('#56677a', 'stone');
function drawStrider(st: Stage, p: Painter, anim: Anim, frame: number): void {
  st.view.k *= 1.15;
  const u = loop(anim, frame, MF);
  const f3 = frame % 3;
  let bob = 0;
  let sink = 0;
  let gait = -1;
  if (anim === 'idle') bob = Math.sin(u * TAU) * 3;
  else if (anim === 'run' || anim === 'attack') {
    gait = u;
    bob = Math.abs(Math.sin(u * TAU * 2)) * 6;
  } else if (anim === 'death') sink = [10, 30, 46][f3]!;
  const B = basis([0, 74 + bob - sink, 0]);
  for (let i = 0; i < 4; i++) {
    for (const s of [1, -1]) {
      const a = (i / 3 - 0.5) * 1.6;
      const ph = gait >= 0 ? gait * TAU + i * 1.6 + (s > 0 ? 0 : Math.PI) : 0;
      const root = at(B, [s * 30 * Math.cos(a), -6, 34 * Math.sin(a)]);
      const foot: V3 = [s * 100 * Math.cos(a) + (gait >= 0 ? Math.cos(ph) * 10 : 0), sink > 20 ? 0 : gait >= 0 ? Math.max(0, Math.sin(ph)) * 12 : 0, 96 * Math.sin(a)];
      const knee = lerp3(root, foot, 0.42);
      knee[1] += 44 - sink * 0.5;
      st.add(knee, -2, (pp) => {
        pp.fill(st.capsule(root, knee, 4.5, 3.5), MIST_DARK, { lw: 1.1 });
        pp.fill(st.capsule(knee, foot, 3.5, 1.6), MIST_DARK, { lw: 1.1 });
      });
    }
  }
  st.add(B.o, 0, (pp) => {
    pp.fill(ell(st, B, [0, 0, 0], 56, 22, 52), MIST_SHELL, { folds: [st.pts2([at(B, [-30, 16, -20]), at(B, [0, 22, 0]), at(B, [30, 16, -20])])] });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      const q = st.p(at(B, [Math.cos(a) * 30, 20, Math.sin(a) * 26]));
      pp.dot(q.x, q.y, 7 * st.view.k, 3.5 * st.view.k, '#c6d6df');
    }
    // mist wisps rising from the shell
    for (const [x, z, h] of [
      [-24, -10, 26],
      [16, -20, 34],
      [4, 14, 22],
    ] as const) {
      const q = st.p(at(B, [x, 24 + h, z]));
      pp.dot(q.x, q.y, 10 * st.view.k, 6 * st.view.k, '#dfe9f0');
    }
    const stalk = [at(B, [0, 16, 30]), at(B, [0, 46, 44]), at(B, [0, 62, 64])];
    tube(st, pp, stalk, 3.5, 2, MIST_DARK, 1);
    glowOrb(st, pp, stalk[2]!, 6, '#bfe8ff', 0.9 + 0.2 * Math.sin(u * TAU));
    eye(st, pp, at(B, [12, 8, 48]), 3.5, '#bfe8ff', B.z);
    eye(st, pp, at(B, [-12, 8, 48]), 3.5, '#bfe8ff', B.z);
  });
  st.render(p);
}

// ------------------------------------------------------------------------------------------------ leviathan (dragon)
const SCALE = m('#2f6474', 'skin');
const SCALE_DARK = m('#1f3f4e', 'skin');
const BELLY = m('#d6c69a', 'skin');
const FIN = m('#6fd6c8', 'glow');
function drawLeviathan(st: Stage, p: Painter, anim: Anim, frame: number): void {
  st.view.k *= 0.92;
  const u = loop(anim, frame, EF);
  const f3 = frame % 3;
  const f4 = frame % 4;
  let sway = 0;
  let strike = 0;
  let mouth = 0.15;
  let collapse = 0;
  let wave = 0;
  let rise = 0;
  if (anim === 'idle') {
    // slow sway of the raised neck, the chest swells on the in-breath, the jaw works
    sway = Math.sin(u * TAU) * 8;
    rise = Math.sin(u * TAU * 2 + 0.6) * 0.04;
    mouth = 0.12 + 0.12 * Math.max(0, Math.sin(u * TAU + 1));
  } else if (anim === 'run') wave = u * TAU;
  else if (anim === 'attack') {
    // rear up (anticipation), coil higher, STRIKE forward, recover
    strike = [-0.45, -0.75, 1, 0.3][f4]!;
    rise = [0.12, 0.22, -0.08, 0][f4]!;
    mouth = [0.35, 0.7, 1, 0.3][f4]!;
  } else if (anim === 'death') {
    collapse = [0.3, 0.7, 1][f3]!;
    mouth = 0.5;
  }
  // coils on the ground (behind), neck rising in front
  const coil: V3[] = [];
  for (let i = 0; i <= 9; i++) {
    const t = i / 9;
    const a = -0.6 + t * 4.2 + (wave ? Math.sin(wave + t * 4) * 0.12 : 0);
    coil.push([Math.cos(a) * 70 * (1 - 0.35 * t), 26 - t * 10, -40 + Math.sin(a) * 54 * (1 - 0.3 * t)]);
  }
  const neck: V3[] = [];
  const base: V3 = coil[0]!;
  for (let i = 0; i <= 7; i++) {
    const t = i / 7;
    const up = 150 * (1 - collapse * 0.85) * (1 + rise);
    const fwd = 40 + strike * 95 * t * t;
    // the strike drives the head forward more than down so it stays readable from the camera
    neck.push([base[0] * (1 - t) + sway * t, base[1] + up * Math.sin(t * 1.4) - Math.max(0, strike) * 28 * t * t + Math.max(0, -strike) * 20 * t, base[2] + 30 + fwd * t]);
  }
  st.add([0, 20, -50], -5, (pp) => {
    for (let i = coil.length - 1; i > 0; i--) {
      const r0 = 30 - (i / coil.length) * 18;
      pp.fill(st.capsule(coil[i]!, coil[i - 1]!, r0 - 2, r0), SCALE, { lw: 1.4 });
    }
    for (let i = 1; i < coil.length - 1; i += 2) {
      const c = coil[i]!;
      pp.fill(spike(st, madd(c, [0, 1, 0], 18), madd(c, [0, 1, -0.3], 44 - i * 2), 9), FIN, { lw: 1.1 });
    }
  });
  st.add(neck[3]!, 0, (pp) => {
    for (let i = 0; i < neck.length - 1; i++) {
      const r = 32 - i * 2.6;
      pp.fill(st.capsule(neck[i]!, neck[i + 1]!, r, r - 2.6), i % 2 ? SCALE : SCALE_DARK, { lw: 1.3, ao: false });
    }
    for (let i = 1; i < neck.length - 1; i++) {
      const c = neck[i]!;
      const d = norm(sub(neck[i + 1]!, neck[i - 1]!));
      if (st.faces([0, 0, 1]) > -0.2) {
        const front = madd(c, [0, -d[2] * 0.5, 1], 22 - i * 2);
        const q = st.p(front);
        pp.dot(q.x, q.y, (12 - i) * st.view.k, (7 - i * 0.5) * st.view.k, '#d6c69a');
      }
      pp.fill(spike(st, madd(c, [0, 0.4, -1], 20 - i), madd(c, [0, 0.9, -1.4], 46 - i * 3), 7), FIN, { lw: 1 });
    }
  });
  const hc = neck[neck.length - 1]!;
  const dir = norm(sub(hc, neck[neck.length - 3]!));
  const H = basis(hc, Math.atan2(dir[2], dir[1]) - 1.2 + strike * 0.4);
  st.add(at(H, [0, 0, 20]), 3, (pp) => {
    pp.fill(ell(st, H, [0, 4, 6], 26, 22, 30), SCALE);
    pp.fill(st.hull([...ellPts(H, [0, 6, 30], 16, 12, 22, 10), at(H, [0, 2, 62])]), SCALE, { lw: 1.4 });
    pp.fill(st.hull([...ellPts(H, [0, -12 - mouth * 14, 28], 13, 7, 20, 10), at(H, [0, -14 - mouth * 22, 56])]), BELLY, { lw: 1.4 });
    for (const s of [1, -1]) {
      pp.fill(st.poly([at(H, [s * 20, 14, -6]), at(H, [s * 52, 34, -26]), at(H, [s * 40, 6, -30]), at(H, [s * 54, -4, -16]), at(H, [s * 22, -6, 0])]), FIN, { lw: 1.2 });
      pp.fill(spike(st, at(H, [s * 10, 22, 0]), at(H, [s * 18, 54, -32]), 6), m('#d6c69a', 'stone'), { lw: 1 });
      eye(st, pp, at(H, [s * 14, 12, 32]), 4.5, '#f6f0a8', H.z);
    }
  });
  st.render(p);
}

// ------------------------------------------------------------------------------------------------ Schleierwächter (baron)
const VEIL = m('#3b2d52', 'skin');
const VEIL_PLATE = m('#5c4a7c', 'metal');
const VEIL_GLOW = '#c9a0ff';
function drawWarden(st: Stage, p: Painter, anim: Anim, frame: number): void {
  st.view.k *= 0.86;
  const u = loop(anim, frame, EF);
  const f3 = frame % 3;
  const f4 = frame % 4;
  let sway = 0;
  let strike = 0;
  let collapse = 0;
  let tendril = 0;
  let glowP = 0.8;
  if (anim === 'idle' || anim === 'run') {
    // the worm sways, breathes (segments swell) and its tendrils grope
    sway = Math.sin(u * TAU) * 10;
    tendril = Math.sin(u * TAU) * 0.3;
    glowP = 0.7 + 0.25 * Math.sin(u * TAU);
    strike = Math.sin(u * TAU * 2 + 1) * 0.05;
  } else if (anim === 'attack') {
    // draw back, rear up, STRIKE down, recover
    strike = [-0.35, -0.6, 1, 0.35][f4]!;
    tendril = [0.8, 1.0, -0.6, 0][f4]!;
    glowP = [1, 1.3, 1.4, 1][f4]!;
  } else if (anim === 'death') {
    collapse = [0.25, 0.6, 1][f3]!;
    glowP = [0.5, 0.25, 0][f3]!;
  }
  // mound of cracked rock the worm rises from
  st.add([0, 10, -30], -8, (pp) => {
    pp.fill(furHull(st, [...ring(basis([0, 0, -10]), 0, 118, 80, 18), ...ring(basis([0, 0, -10]), 26, 92, 64, 14)], 7), m('#2e2834', 'stone'), { lw: 1.6 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.3;
      const q0 = st.p([Math.cos(a) * 40, 22, -10 + Math.sin(a) * 28]);
      const q1 = st.p([Math.cos(a) * 100, 6, -10 + Math.sin(a) * 70]);
      pp.line([q0, q1], VEIL_GLOW, 2.2);
    }
  });
  // segmented body column
  const spine: V3[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const up = 165 * (1 - collapse * 0.8);
    spine.push([sway * t + collapse * 60 * t, 20 + up * t - strike * 40 * t * t, -10 + 30 * t + strike * 70 * t * t]);
  }
  st.add(spine[3]!, 0, (pp) => {
    for (let i = 0; i < spine.length - 1; i++) {
      const r = 58 - i * 3.5;
      pp.fill(st.capsule(spine[i]!, spine[i + 1]!, r, r - 3.5), VEIL, { lw: 1.4, ao: false });
      const c = lerp3(spine[i]!, spine[i + 1]!, 0.5);
      const plate = ellPts(basis(madd(c, [0, 0, -1], r * 0.35)), [0, 0, 0], r * 0.95, 9, r * 0.75, 12);
      pp.fill(st.hull(plate), VEIL_PLATE, { lw: 1.3, sheen: [st.pts2([madd(c, [-0.6, 0.3, -0.4], r), madd(c, [-0.2, 0.4, -0.7], r)])] });
    }
    // glowing belly seams facing the camera
    for (let i = 1; i < spine.length - 1; i++) {
      const c = spine[i]!;
      const q = st.p(madd(c, [0, 0, 1], 50 - i * 3));
      pp.dot(q.x, q.y, (16 - i) * st.view.k, 4 * st.view.k, mix(VEIL_GLOW, '#3b2d52', 0.2 + 0.4 * (1 - glowP)));
    }
  });
  // tendril arms
  for (const s of [1, -1]) {
    const root = lerp3(spine[3]!, spine[4]!, 0.5);
    const pts: V3[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      pts.push([root[0] + s * (40 + 70 * t), root[1] + 30 * Math.sin(t * 2.5) - 140 * t * (0.5 + tendril * s * 0.4) * t, root[2] + 30 * t + (strike > 0.5 ? 90 * t : 0)]);
    }
    st.add(pts[3]!, 1, (pp) => {
      tube(st, pp, pts, 16, 5, VEIL, 1.3);
      pp.fill(spike(st, pts[6]!, madd(pts[6]!, [s * 0.3, -1, 0.6], 34), 6), m('#d8c8e8', 'stone'), { lw: 1 });
    });
  }
  // head: hood, crown of horns, many eyes, tusks, veil streamers
  const hc = spine[spine.length - 1]!;
  const H = basis(madd(hc, [0, 1, 0.4], 20), 0.25 + strike * 0.5);
  st.add(at(H, [0, 0, 30]), 3, (pp) => {
    for (const s of [1, -1, 0]) {
      const a = at(H, [s * 26, -10, -10]);
      const pts = [a, madd(a, [s * 0.3, -1, -0.2], 40), madd(a, [s * 0.4, -1, -0.1], 80)];
      tube(st, pp, pts, 12, 4, m(VEIL_GLOW, 'glow'), 1.1);
    }
    pp.fill(ell(st, H, [0, 0, 0], 48, 40, 46), VEIL_PLATE);
    pp.fill(ell(st, H, [0, -8, 30], 34, 24, 30), VEIL);
    for (let i = 0; i < 7; i++) {
      const a = (i / 6 - 0.5) * 2.4;
      const base = at(H, [Math.sin(a) * 36, 26, -6 + Math.cos(a) * 6]);
      const tip = at(H, [Math.sin(a) * 66, 80 - Math.abs(Math.sin(a)) * 30, -26]);
      pp.fill(spike(st, base, tip, 9), m('#d8c8e8', 'stone'), { lw: 1.2 });
    }
    for (const [x, y] of [
      [13, 10],
      [-13, 10],
      [24, 0],
      [-24, 0],
      [8, -4],
      [-8, -4],
    ] as const) eye(st, pp, at(H, [x, y, 50]), 4 + (Math.abs(x) < 10 ? 1 : 0), VEIL_GLOW, H.z);
    for (const s of [1, -1]) pp.fill(spike(st, at(H, [s * 20, -22, 44]), at(H, [s * 12, -60, 70]), 7), m('#e8dcc8', 'stone'), { lw: 1.1 });
  });
  st.render(p);
}

// ------------------------------------------------------------------------------------------------ Kesselbrut (grubs)
const GRUB = m('#7a6a8c', 'skin');
const GRUB_DARK = m('#4e425e', 'skin');
const IRON_SHELL = m('#3a3640', 'metal');
const BREW = '#b884ff';
function drawGrub(st: Stage, p: Painter, anim: Anim, frame: number): void {
  st.view.k *= 1.35;
  const u = loop(anim, frame, MF);
  const f3 = frame % 3;
  let rear = 0;
  let wiggle = 0;
  let squash = 1;
  let roll = 0;
  if (anim === 'idle') wiggle = Math.sin(u * TAU) * 4;
  else if (anim === 'run') {
    squash = [0.9, 1.08, 1.1, 0.95][frame % 4]!;
    wiggle = Math.sin(u * TAU) * 6;
  } else if (anim === 'attack') rear = [0.6, -0.2, 0.1][f3]!;
  else if (anim === 'death') {
    roll = [0.4, 1.0, 1.4][f3]!;
    squash = [0.9, 0.75, 0.6][f3]!;
  }
  const B = basis([0, 30 * squash, 0], -rear * 0.6, roll);
  const seg: [V3, number][] = [
    [[wiggle, 0, -36], 20],
    [[-wiggle * 0.5, 4, -10], 26],
    [[wiggle * 0.3, 8, 16], 25],
    [[0, 10 + rear * 30, 40 + rear * 6], 19],
  ];
  st.add(at(B, [0, 0, 0]), 0, (pp) => {
    for (let i = 0; i < seg.length; i++) {
      const [c, r] = seg[i]!;
      pp.fill(ell(st, B, c, r, r * 0.85 * squash, r * 0.8), i === seg.length - 1 ? GRUB_DARK : GRUB, { lw: 1.4 });
    }
    // little legs
    for (let i = 0; i < 3; i++) {
      for (const s of [1, -1]) {
        const c = seg[i]![0];
        const a = at(B, [c[0] + s * 18, c[1] - 12, c[2]]);
        pp.fill(st.capsule(a, madd(a, [s, -1.4, 0.3], 14), 3.5, 2), GRUB_DARK, { lw: 1 });
      }
    }
  });
  // cauldron shell on the back
  const S = basis(at(B, [0, 22, -8]), -0.1);
  st.add(at(S, [0, 10, 0]), 1, (pp) => {
    pp.fill(st.hull([...ring(S, 0, 30, 28, 14), ...ring(S, 26, 24, 22, 14), ...ring(S, 34, 20, 18, 12)]), IRON_SHELL, {
      sheen: [st.pts2([at(S, [-22, 6, 14]), at(S, [-16, 26, 12])])],
    });
    pp.fill(st.hull([...ring(S, 32, 23, 21, 14), ...ring(S, 36, 23, 21, 14)]), m('#5a5460', 'metal'), { lw: 1.2 });
    const top = at(S, [0, 37, 0]);
    const q = st.p(top);
    pp.dot(q.x, q.y, 18 * st.view.k, 7 * st.view.k, mix(BREW, '#2a1a40', 0.25));
    for (let i = 0; i < 3; i++) {
      const b = st.p(madd(at(S, [(i - 1) * 9, 40, (i % 2) * 4]), S.y, ((u * 3 + i) % 1) * 12));
      pp.dot(b.x, b.y, 4 * st.view.k, 4 * st.view.k, mix(BREW, '#ffffff', 0.4));
    }
    glowOrb(st, pp, madd(top, S.y, 4), 5, BREW, 0.7);
  });
  st.add(at(B, [0, 10, 52]), 2, (pp) => {
    const hc = seg[3]![0];
    for (const s of [1, -1]) {
      pp.fill(st.poly([at(B, [hc[0] + s * 8, hc[1] - 6, hc[2] + 14]), at(B, [hc[0] + s * 4, hc[1] - 14, hc[2] + 30]), at(B, [hc[0] + s * 14, hc[1] - 10, hc[2] + 20])]), m('#e2d6c0', 'stone'), { lw: 1 });
      eye(st, pp, at(B, [hc[0] + s * 8, hc[1] + 6, hc[2] + 14]), 3.2, BREW, B.z);
    }
  });
  st.render(p);
}

// ------------------------------------------------------------------------------------------------ plants
const STEM = m('#4a6a3a', 'cloth');
const LEAF = m('#3f5e36', 'cloth');
function leaves(st: Stage, p: Painter, n: number, r: number, h: number, mat: Mat): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + 0.4;
    const tip: V3 = [Math.cos(a) * r, h * (0.4 + (i % 2) * 0.3), Math.sin(a) * r];
    const side: V3 = [-Math.sin(a) * r * 0.25, 0, Math.cos(a) * r * 0.25];
    p.fill(st.poly([[0, 4, 0], madd(madd(tip, side, 1), [0, 1, 0], -h * 0.2), tip, madd(madd(tip, side, -1), [0, 1, 0], -h * 0.2)], true), mat, { lw: 1.1 });
  }
}
function drawSprung(st: Stage, p: Painter, anim: Anim, frame: number): void {
  st.view.k *= 1.4;
  const burst = anim === 'death';
  const pulse = anim === 'idle' ? (frame % 2) * 0.25 : 0;
  st.add([0, 0, -10], -2, (pp) => leaves(st, pp, 6, 46, 30, LEAF));
  st.add([0, 40, 0], 0, (pp) => {
    const top: V3 = burst ? [0, 40, 0] : [0, 62, 4];
    pp.fill(st.capsule([0, 0, 0], top, 6, 5), STEM, { lw: 1.2 });
    if (!burst) {
      const c: V3 = [0, 92, 6];
      pp.fill(ell(st, basis(c), [0, 0, 0], 32 + pulse * 4, 36 + pulse * 4, 32 + pulse * 4), m('#d0843a', 'skin'), { folds: [st.pts2([[-16, 120, 30], [-22, 92, 34], [-14, 64, 28]]), st.pts2([[14, 122, 30], [20, 92, 34], [12, 64, 28]])] });
      glowOrb(st, pp, [0, 96, 38], 7, '#ffd27a', 0.7 + pulse);
      pp.fill(spike(st, [0, 122, 6], [0, 140, 4], 7), m('#8a5a2a', 'wood'), { lw: 1 });
    } else {
      // burst open: petals splayed, sparks
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + frame * 0.3;
        pp.fill(st.poly([[0, 42, 0], [Math.cos(a) * 30, 40 + frame * 4, Math.sin(a) * 30], [Math.cos(a + 0.4) * 46, 30, Math.sin(a + 0.4) * 46]], true), m('#d0843a', 'skin'), { lw: 1 });
      }
      if (frame % 2 === 0) for (let i = 0; i < 5; i++) glowOrb(st, pp, [Math.cos(i * 1.3) * 40, 70 + i * 10, Math.sin(i * 1.3) * 30], 4, '#ffd27a', 1);
    }
  });
  st.render(p);
}
function drawHonig(st: Stage, p: Painter, anim: Anim, frame: number): void {
  st.view.k *= 1.4;
  const eaten = anim === 'death';
  st.add([0, 0, -10], -2, (pp) => leaves(st, pp, 7, 52, 34, LEAF));
  st.add([0, 30, 0], 0, (pp) => {
    pp.fill(st.capsule([0, 0, 0], [0, 70, -4], 5, 3), STEM, { lw: 1.1 });
    pp.fill(st.poly([[0, 70, -4], [-40, 86, -8], [-10, 64, -2]], true), LEAF, { lw: 1 });
    pp.fill(st.poly([[0, 70, -4], [40, 82, -6], [10, 62, -2]], true), LEAF, { lw: 1 });
    const fruits: V3[] = [
      [-18, 52, 12],
      [14, 48, 14],
      [-4, 40, 22],
      [22, 30, 8],
      [-24, 30, 6],
    ];
    const n = eaten ? 2 - frame : fruits.length;
    for (let i = 0; i < Math.max(0, n); i++) {
      const c = fruits[i]!;
      pp.line(st.pts2([[0, 66, -4], madd(c, [0, 1, 0], 14)]), '#4a3a24', 1.4);
      pp.fill(st.hull([...ellPts(basis(c), [0, 0, 0], 11, 12, 11, 10), madd(c, [0, 1, 0], 18)]), m('#e6b046', 'glass'), { lw: 1.2 });
    }
    if (eaten) for (let i = 0; i < 4; i++) glowOrb(st, pp, [Math.cos(i * 1.6) * 30, 10 + frame * 8, Math.sin(i * 1.6) * 24], 4, '#ffe08a', 0.8);
  });
  st.render(p);
}
function drawSpaeh(st: Stage, p: Painter, anim: Anim, frame: number): void {
  st.view.k *= 1.35;
  const closed = anim === 'death';
  const sway = anim === 'idle' ? (frame % 2 ? 4 : -4) : 0;
  st.add([0, 0, -10], -2, (pp) => leaves(st, pp, 5, 40, 26, LEAF));
  const top: V3 = closed ? [24, 70, 10] : [sway, 120, 4];
  st.add([0, 60, 0], 0, (pp) => {
    tube(st, pp, [[0, 0, 0], [sway * 0.4, 50, 2], top], 5, 3, STEM, 1.1);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const len = closed ? 14 : 30;
      pp.fill(st.poly([top, madd(top, [Math.cos(a), 0.4 + (closed ? -1 : 0), Math.sin(a) * 0.6 + 0.6], len), madd(top, [Math.cos(a + 0.5), 0.2 + (closed ? -1 : 0), Math.sin(a + 0.5) * 0.6 + 0.6], len * 0.7)], true), m('#5a7ab8', 'cloth'), { lw: 1.1 });
    }
    if (!closed) {
      const c = madd(top, [0, 0, 1], 8);
      const q = st.p(c);
      pp.dot(q.x, q.y, 11 * st.view.k, 11 * st.view.k, '#cfe8ff');
      pp.dot(q.x, q.y, 6 * st.view.k, 7 * st.view.k, '#3a6ab8');
      pp.dot(q.x, q.y, 2.6 * st.view.k, 4.5 * st.view.k, INK);
      glowOrb(st, pp, madd(c, [0, 1, 0], 14), 4, '#9ad8ff', 0.6);
    }
  });
  st.render(p);
}

// ------------------------------------------------------------------------------------------------ registry
const MOSS_WOLF: WolfLook = { fur: m('#5d6452', 'fur'), light: m('#a8a88a', 'fur'), dark: m('#363c30', 'fur'), eye: '#f0d860', collar: false, moss: m('#5f7d3e', 'fur') };

/** Leader type each small camp member is drawn as (scaled). */
export const MONSTER_SPRITE: Record<string, { id: string; scale: number }> = {
  mooswelpe: { id: 'mooswolf', scale: 0.6 },
  kaeferling: { id: 'hohlkaefer', scale: 0.56 },
  krabbling: { id: 'schattenkrabbe', scale: 0.58 },
  // ponytail: new fruits reuse the three painted fruit sprites until own art is baked (swarm-plants.md open items)
  manafrucht: { id: 'spaehfrucht', scale: 0.9 },
  windfrucht: { id: 'sprungfrucht', scale: 0.9 },
  schildfrucht: { id: 'honigfrucht', scale: 0.9 },
  honigstueck: { id: 'honigfrucht', scale: 0.3 },
};
/** Sprites baked into the big atlas (higher resolution) and the camp atlas. */
export const BIG_MONSTER_IDS = ['dornenbock', 'glutwaechter', 'leviathan', 'schleierwaechter'];
export const CAMP_MONSTER_IDS = ['sumpfunke', 'mooswolf', 'hohlkaefer', 'schattenkrabbe', 'nebelschleicher', 'kesselbrut', 'sprungfrucht', 'honigfrucht', 'spaehfrucht'];

const d = (world: number, foot: number, frames: Record<Anim, number>, draw: SpriteDrawer['draw'], ink = 1.2): SpriteDrawer => ({ world, foot, frames, draw, ink });
// `world` = cell height in map units; figure height (idle top to feet) relative to a champion (~170) is the LoL
// yardstick (docs/DECISIONS.md "Maßstab"): buffs ~2.7x, Gromp ~1.7x, wolf/krug/raptor leaders 1.2-1.6x, scuttle
// ~1.2x, drake ~3.6x, baron ~4.9x; small camp members 0.6-0.9x (MONSTER_SPRITE scales).
export const MONSTER_DRAWERS: Record<string, SpriteDrawer> = {
  dornenbock: d(640, 0.9, MF, (st, p, a, f) => drawGolem(st, p, a, f, DORNEN), 1.0),
  glutwaechter: d(640, 0.9, MF, (st, p, a, f) => drawGolem(st, p, a, f, GLUT), 1.0),
  sumpfunke: d(430, 0.8, MF, drawToad),
  mooswolf: d(430, 0.9, HARK.frames, (st, p, a, f) => {
    st.view.k *= 1.55;
    drawWolf(st, p, a, f, MOSS_WOLF);
  }),
  hohlkaefer: d(440, 0.78, MF, drawBeetle),
  schattenkrabbe: d(480, 0.78, MF, drawCrab),
  nebelschleicher: d(340, 0.8, MF, drawStrider),
  leviathan: { ...d(860, 0.88, EF, drawLeviathan, 0.9), hit: 2 },
  schleierwaechter: { ...d(1040, 0.9, EF, drawWarden, 0.85), hit: 2 },
  kesselbrut: d(290, 0.8, MF, drawGrub),
  sprungfrucht: d(190, 0.86, PF, drawSprung),
  honigfrucht: d(190, 0.86, PF, drawHonig),
  spaehfrucht: d(200, 0.88, PF, drawSpaeh),
};
