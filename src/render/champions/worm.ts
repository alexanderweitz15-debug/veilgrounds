// Dorrak Sandschlund (jungle): a giant sand worm. A chain of fat hide segments along a sagging, rearing curve, dark bony
// back plates and spikes, a ring-of-teeth maw. Baked as a SpriteDrawer (atlas.ts DRAWERS) plus a humanoid Kit stub
// for icon colours.
import { at, frameYZ, hash, m, madd, norm, project, ring, rotX, sub, TAU, type Painter, type Stage, type V3 } from './core';
import type { SpriteDrawer } from './atlas';
import type { Anim, Kit } from './types';

const FRAMES: Record<Anim, number> = { idle: 6, run: 8, attack: 5, cast: 4, death: 3 };
const HIDE = m('#c99a52', 'leather');
const HIDE_ALT = m('#ad7d3c', 'leather');
const BELLY = m('#e0c08a', 'skin');
const PLATE = m('#3d2b20', 'stone');
const LIP = m('#7d4228', 'skin');
const THROAT = m('#2a0a0e', 'skin');
const TOOTH = m('#f0e6c4', 'wood');
const SAND = m('#d9b97a', 'stone');
const EYE = '#ffb52e';
const K = 1.05;
const N = 16;

/** Humanoid stand-in for icon colours / lab lookups; the sprite itself comes from DORRAK_DRAWER. */
export const DORRAK_KIT: Kit = {
  id: 'dorrak',
  name: 'Dorrak Sandschlund',
  world: 300,
  look: 'giant sand worm: rearing segmented ochre body, dark bony back plates and spikes, a round maw of three tooth rings',
  feature: 'fat curved worm with a round toothed mouth',
  body: { H: 180, shW: 24, hipW: 15, chestD: 12 },
  outfit: { skin: '#c99a52', top: HIDE, legs: HIDE_ALT, boots: PLATE },
  hold: 'relaxed',
  attack: 'thrust',
  cast: 'raise',
  props: [],
};

interface Pose {
  /** 0 = low, 1 = reared high */
  rear: number;
  /** head forward push (z) */
  lean: number;
  /** head pitch, + tilts forward/down */
  bite: number;
  /** collapse into the sand */
  sink: number;
  ampX: number;
  ampY: number;
  spray: number;
  puffs: number;
  ph: number;
}

function poseOf(anim: Anim, frame: number): Pose {
  const n = FRAMES[anim];
  const f = frame % n;
  const ph = (f / n) * TAU;
  const p: Pose = { rear: 0.55, lean: 0, bite: 0.5, sink: 0, ampX: 0, ampY: 0, spray: 0, puffs: 3, ph };
  if (anim === 'idle') {
    p.rear = 0.6 + 0.05 * Math.sin(ph);
    p.ampX = 5;
    p.bite = 0.5 + 0.08 * Math.sin(ph + 1);
  } else if (anim === 'run') {
    p.rear = 0.3;
    p.bite = 0.75;
    p.lean = 10;
    p.ampX = 12;
    p.ampY = 7;
    p.puffs = 6;
  } else if (anim === 'attack') {
    const k = [
      { rear: 0.85, lean: -8, bite: 0.25 },
      { rear: 1.15, lean: -24, bite: -0.25 },
      { rear: 0.4, lean: 44, bite: 1.1 },
      { rear: 0.4, lean: 30, bite: 0.9 },
      { rear: 0.6, lean: 8, bite: 0.5 },
    ][f]!;
    Object.assign(p, k, { spray: f === 2 ? 0.7 : f === 3 ? 0.4 : 0, puffs: f >= 2 ? 5 : 3 });
  } else if (anim === 'cast') {
    const k = [
      { rear: 1.1, lean: -10, bite: 0.1, spray: 0.2 },
      { rear: 1.45, lean: -16, bite: -0.3, spray: 0.5, ampX: 4 },
      { rear: 0.3, lean: 26, bite: 1.15, spray: 1 },
      { rear: 0.55, lean: 8, bite: 0.5, spray: 0.6 },
    ][f]!;
    Object.assign(p, k, { puffs: 6 });
  } else {
    Object.assign(p, [{ rear: 0.45, bite: 0.9, sink: 8 }, { rear: 0.2, lean: 8, bite: 1.2, sink: 34 }, { rear: 0, lean: 14, bite: 1.35, sink: 60 }][f]!, { puffs: 5 });
  }
  return p;
}

const bez = (a: number, b: number, c: number, d: number, t: number): number => {
  const s = 1 - t;
  return s * s * s * a + 3 * s * s * t * b + 3 * s * t * t * c + t * t * t * d;
};

/** Point on the spine, u = 0 tail .. 1 head (character space: y up, z forward). */
function spine(p: Pose, u: number): V3 {
  const x = Math.sin(u * TAU * 1.25 - p.ph) * p.ampX * (0.3 + 0.7 * u);
  const wob = Math.sin(u * TAU * 2 - p.ph) * p.ampY * (1 - u * 0.3);
  const y = bez(8, 4, 8 + p.rear * 62, 66 + p.rear * 72, u) + wob - p.sink * (0.4 + 0.6 * u);
  return [x, y, bez(-78, -34, -6 + p.lean * 0.3, 16 + p.lean, u)];
}
const radius = (u: number, breath: number): number => (13 + 20 * Math.sin(Math.min(1, u / 0.45) * (Math.PI / 2)) - 4 * Math.max(0, (u - 0.7) / 0.3)) * breath;
/** Head direction and centre. */
function headOf(p: Pose): { d: V3; c: V3; R: number } {
  const e = spine(p, 1);
  const d = norm(rotX(norm(sub(e, spine(p, 0.93))), p.bite - 0.2));
  const R = 34;
  return { d, c: madd(e, d, R * 0.3), R };
}

function drawDorrak(st: Stage, p: Painter, anim: Anim, frame: number): void {
  st.view.k *= K;
  const pose = poseOf(anim, frame);
  const breath = 1 + 0.035 * Math.sin(pose.ph - 1);
  const ground = frameYZ([0, 0, -14], [0, 1, 0], [0, 0, 1]);

  // sand mound under the body
  st.add([0, 0, -14], -100, (pp) => pp.fill(st.hull(ring(ground, 0, 56, 74, 16)), SAND, { lw: 1, rim: false, ao: false }));

  // body segments (tail -> head), belly band, back plate, spike
  for (let i = 0; i < N; i++) {
    const u0 = i / N;
    const u1 = (i + 1) / N;
    const a = spine(pose, u0);
    const b = spine(pose, u1);
    const ra = radius(u0, breath);
    const rb = radius(u1, breath);
    const mid = madd(a, sub(b, a), 0.5);
    const tg = norm(sub(b, a));
    const belly: V3 = [0, -tg[2], tg[1]];
    st.add(mid, 0, (pp) => {
      pp.fill(st.capsule(a, b, ra * 1.05, rb * 1.05), i % 2 ? HIDE_ALT : HIDE, { lw: 1.4 });
      pp.fill(st.capsule(madd(a, belly, ra * 0.55), madd(b, belly, rb * 0.55), ra * 0.5, rb * 0.5), BELLY, { lw: 0.8, rim: false });
    });
    const r = (ra + rb) / 2;
    const back = madd(mid, belly, -r * 0.82);
    st.add(back, 0.5, (pp) => {
      pp.fill(st.capsule(madd(a, belly, -ra * 0.8), madd(b, belly, -rb * 0.8), ra * 0.32, rb * 0.32), PLATE, { lw: 1 });
      if (i % 2 && i > 2) pp.fill(st.poly([madd(a, belly, -ra * 0.95), madd(b, belly, -rb * 0.95), madd(mid, belly, -r - 13)], false), PLATE, { lw: 1, rim: false });
    });
  }

  // head: shell, lip, throat, three tooth rings
  const { d, c, R } = headOf(pose);
  const H = frameYZ(c, d, [1, 0, 0]);
  st.add(c, 1.2, (pp) => {
    pp.fill(st.hull([...ring(H, -R * 0.9, R * 0.8, R * 0.8, 12), ...ring(H, 0, R, R, 12), ...ring(H, R * 0.5, R * 0.95, R * 0.95, 12)]), HIDE, { lw: 1.6 });
    for (const sd of [1, -1]) {
      const e = st.p(at(H, [sd * R * 0.5, -R * 0.2, -R * 0.78]));
      pp.dot(e.x, e.y, 2.2 * st.view.k, 1.6 * st.view.k, EYE);
    }
    if (st.faces(d) < -0.05) return;
    const cy = R * 0.52;
    pp.fill(st.hull(ring(H, cy, R * 0.98, R * 0.98, 16)), LIP, { lw: 1.4 });
    pp.fill(st.hull(ring(H, cy + 1, R * 0.62, R * 0.62, 16)), THROAT, { lw: 1, rim: false });
    for (const [r, nT, h, off] of [[0.92, 14, 0.3, 0], [0.68, 11, 0.32, 0.4], [0.42, 8, 0.3, 0.2]] as const)
      for (let j = 0; j < nT; j++) {
        const a0 = ((j + off) / nT) * TAU;
        const w = (TAU / nT) * 0.4;
        const P = (aa: number, rr: number, y: number): V3 => at(H, [Math.sin(aa) * R * rr, cy + y, Math.cos(aa) * R * rr]);
        pp.fill(st.poly([P(a0 - w, r, 0), P(a0 + w, r, 0), P(a0, r - 0.3 * Math.min(r, 0.5) - 0.12, R * h)]), TOOTH, { lw: 0.8, rim: false, ao: false });
      }
  });

  // dust at the base, sand spray on slams
  st.add([0, 0, -50], 60, (pp) => {
    for (let j = 0; j < pose.puffs; j++) {
      const t = (pose.ph / TAU + j / pose.puffs) % 1;
      const o = madd(spine(pose, 0.05 + 0.2 * hash(j)), [hash(j + 7) - 0.5, 0, 0], 70);
      pp.fill(st.sphere([o[0], 6 + t * 26, o[2] + 6], 7 + t * 8), SAND, { flat: true, alpha: 0.75 * (1 - t), lw: 0, rim: false, ao: false });
    }
    if (pose.spray > 0)
      for (let j = 0; j < 12; j++) {
        const a = hash(j) * TAU;
        const s = pose.spray * (0.4 + hash(j + 3));
        pp.fill(st.sphere([c[0] + Math.cos(a) * 34 * s, 6 + 40 * s * hash(j + 5), c[2] + 14 + Math.sin(a) * 34 * s], 3 + 2 * hash(j + 9)), SAND, { flat: true, lw: 0, rim: false, ao: false, alpha: 0.9 });
      }
  });

  // death: sand heaps over the sunken body
  if (pose.sink > 0)
    st.add([0, 0, 40], 80, (pp) => pp.fill(st.hull(ring(frameYZ([0, 0, 20], [0, 1, 0], [0, 0, 1]), 0, 64, 52, 14).concat(ring(frameYZ([0, 0, 20], [0, 1, 0], [0, 0, 1]), pose.sink * 0.35, 40, 30, 10))), SAND, { lw: 1.2, rim: false }));

  st.render(p);
}

/** Idle frame 0 head centre and radius (portrait crops). */
function head(yaw: number, res: number): { x: number; y: number; r: number } {
  const s = res / 256;
  const q = project({ yaw, elev: 0.42, cx: res / 2, cy: res * 0.9, k: s * K, fall: 0, lift: 0 }, headOf(poseOf('idle', 0)).c);
  return { x: q.x, y: q.y, r: 34 * s * K };
}

export const DORRAK_DRAWER: SpriteDrawer = {
  world: 300,
  frames: FRAMES,
  foot: 0.9,
  ink: 1,
  hit: 2,
  draw: drawDorrak,
  head,
};
