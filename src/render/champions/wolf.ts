// Hark, Ottilie's wolf: a small quadruped rig drawn with the same painter (fur = jagged hull outlines).
import { at, frameYZ, ik, INK, lerp3, m, madd, norm, ring, sub, TAU, hull2, shapeFrom, type Basis, type Painter, type Stage, type V3 } from './core';
import type { Anim } from './types';

export const HARK = { world: 300, frames: { idle: 4, run: 6, attack: 4, cast: 0, death: 3 } as Record<Anim, number> };


export function jag(pts: { x: number; y: number }[], tooth: number): { x: number; y: number }[] {
  let cx = 0;
  let cy = 0;
  for (const q of pts) {
    cx += q.x;
    cy += q.y;
  }
  cx /= pts.length;
  cy /= pts.length;
  const out: { x: number; y: number }[] = [];
  pts.forEach((q, i) => {
    out.push(q);
    const n = pts[(i + 1) % pts.length]!;
    const mx = (q.x + n.x) / 2;
    const my = (q.y + n.y) / 2;
    const dx = mx - cx;
    const dy = my - cy;
    const d = Math.hypot(dx, dy) || 1;
    if (Math.hypot(n.x - q.x, n.y - q.y) > tooth * 0.8) out.push({ x: mx + (dx / d) * tooth, y: my + (dy / d) * tooth });
  });
  return out;
}

export function furHull(st: Stage, pts: V3[], tooth: number) {
  const h = hull2(st.pts2(pts));
  const j = jag(h, tooth * st.view.k);
  const path = new Path2D();
  j.forEach((q, i) => (i ? path.lineTo(q.x, q.y) : path.moveTo(q.x, q.y)));
  path.closePath();
  return shapeFrom(j, path);
}

/** Fur colours of a wolf drawing: Hark (default) or the jungle's Mooswolf (moss tufts, glowing eyes, no collar). */
export interface WolfLook {
  fur: ReturnType<typeof m>;
  light: ReturnType<typeof m>;
  dark: ReturnType<typeof m>;
  eye: string;
  collar: boolean;
  moss?: ReturnType<typeof m>;
}
const HARK_LOOK: WolfLook = { fur: m('#8d8a86', 'fur'), light: m('#c9c2b4', 'fur'), dark: m('#55524f', 'fur'), eye: '#e8c050', collar: true };

export function drawWolf(st: Stage, p: Painter, anim: Anim, frame: number, look: WolfLook = HARK_LOOK): void {
  const FUR = look.fur;
  const FUR_LIGHT = look.light;
  const FUR_DARK = look.dark;
  const n = Math.max(1, HARK.frames[anim]);
  const t = (frame % n) / n;
  let bob = 0;
  let pitch = 0;
  let headDrop = 0;
  let lunge = 0;
  let low = 0;
  let mouth = 0;
  let tailUp = 0.3;
  const feet: V3[] = [
    [9, 0, 30],
    [-9, 0, 26],
    [9, 0, -36],
    [-9, 0, -32],
  ];
  if (anim === 'idle') {
    bob = Math.sin(t * TAU) * 1;
    tailUp = 0.25 + Math.sin(t * TAU * 2) * 0.15;
  } else if (anim === 'run') {
    const ph = t * TAU;
    const pairs = [0, Math.PI, Math.PI, 0];
    feet.forEach((f, i) => {
      const a = ph + pairs[i]!;
      f[2] += Math.cos(a) * 16;
      f[1] = Math.max(0, -Math.sin(a)) * 9;
    });
    bob = Math.abs(Math.sin(ph)) * 3 - 1;
    pitch = Math.sin(ph) * 0.05;
    headDrop = 4;
    tailUp = 0.05;
  } else if (anim === 'attack') {
    const k = [
      [0, 0.3, 0, 0],
      [-6, 0.5, 0, 0.2],
      [22, 0, 1, 1],
      [8, 0.1, 0.4, 0.3],
    ][frame % 4]!;
    lunge = k[0]!;
    low = k[1]!;
    mouth = k[2]!;
    headDrop = 6 - k[3]! * 10;
    tailUp = 0.6;
    feet[0]![2] += lunge * 0.9;
    feet[1]![2] += lunge * 0.7;
    if (frame % 4 === 2) {
      feet[0]![1] = 8;
      feet[1]![1] = 6;
    }
  } else if (anim === 'death') {
    low = [0.4, 0.8, 1.2][frame % 3]!;
    headDrop = [4, 14, 26][frame % 3]!;
    tailUp = -0.4;
    if (frame % 3 === 2) {
      feet[0] = [16, 0, 34];
      feet[1] = [4, 0, 38];
      feet[2] = [16, 0, -40];
      feet[3] = [4, 0, -44];
    }
  }
  const sh: V3 = [0, 62 + bob - low * 18, 24 + lunge];
  const hp: V3 = [0, 60 + bob - low * 14, -34 + lunge * 0.4];
  const spine = norm(sub(sh, hp));
  const body: Basis = frameYZ(lerp3(hp, sh, 0.5), [0, 1, -pitch], spine);
  const bodyZ = (z: number, y: number): V3 => at({ ...body, o: lerp3(hp, sh, 0.5) }, [0, y, z]);
  const fur = FUR;

  // legs (far ones first by depth sort)
  const legRoots: V3[] = [
    at(body, [7, -6, 24]),
    at(body, [-7, -6, 24]),
    at(body, [8, -4, -30]),
    at(body, [-8, -4, -30]),
  ];
  legRoots.forEach((root, i) => {
    const front = i < 2;
    const foot: V3 = [feet[i]![0], feet[i]![1] + 4, feet[i]![2]];
    const [mid, end] = ik(root, foot, front ? 28 : 30, front ? 30 : 30, front ? [0, 0, -1] : [0, 0.2, 1]);
    st.add(lerp3(root, end, 0.5), -1, (pp) => {
      pp.fill(st.capsule(root, mid, front ? 7.5 : 9, 5), i % 2 ? FUR_DARK : fur);
      pp.fill(st.capsule(mid, end, 4.6, 3.6), i % 2 ? FUR_DARK : fur);
      pp.fill(st.hull([...ring(frameYZ(end, [0, 1, 0], [0, 0, 1]), -3, 5, 6, 8, 2), ...ring(frameYZ(end, [0, 1, 0], [0, 0, 1]), 1, 4, 4, 6)]), FUR_DARK, { lw: 1.5 });
    });
  });
  // tail
  const tailPts: V3[] = [];
  for (let i = 0; i <= 5; i++) {
    const u = i / 5;
    const wag = anim === 'idle' ? Math.sin(t * TAU * 2) * 8 * u : anim === 'run' ? Math.sin(t * TAU) * 4 * u : 0;
    tailPts.push(add3(bodyZ(-40 - u * 34, 4 + tailUp * 30 * u - u * u * 16), [wag, 0, 0]));
  }
  st.add(tailPts[3]!, 0, (pp) => {
    const pts: V3[] = [];
    tailPts.forEach((q, i) => pts.push(...ring(frameYZ(q, [0, 1, 0], [0, 0, 1]), 0, 7 - i * 0.6, 7 - i * 0.6, 6)));
    pp.fill(furHull(st, pts, 3.5), fur, { folds: [st.pts2(tailPts)] });
  });
  // body
  st.add(body.o, 0, (pp) => {
    const pts = [
      ...ring(frameYZ(bodyZ(-38, 0), spine, [0, 1, 0]), 0, 14, 15, 12),
      ...ring(frameYZ(bodyZ(-12, -1), spine, [0, 1, 0]), 0, 14, 16, 12),
      ...ring(frameYZ(bodyZ(16, 1), spine, [0, 1, 0]), 0, 16, 19, 12),
      bodyZ(22, -22),
      bodyZ(-8, -16),
    ];
    const s = furHull(st, pts, 3.2);
    pp.fill(s, fur, {
      folds: [
        st.pts2([bodyZ(10, 14), bodyZ(4, -6), bodyZ(12, -16)]),
        st.pts2([bodyZ(-18, 13), bodyZ(-22, -4)]),
      ],
    });
    // pale belly / chest
    const belly = furHull(st, [bodyZ(22, -6), bodyZ(26, -20), bodyZ(10, -18), bodyZ(-6, -14), bodyZ(16, -4)], 2.2);
    pp.fill(belly, FUR_LIGHT, { lw: 1.2, rim: false });
    if (look.moss) {
      // moss mantle along the spine (jungle wolves)
      const mantle = furHull(st, [bodyZ(-30, 14), bodyZ(-10, 17), bodyZ(12, 19), bodyZ(20, 13), bodyZ(-34, 9), bodyZ(-4, 22), bodyZ(8, 23)], 4.5);
      pp.fill(mantle, look.moss, { lw: 1.3 });
    }
  });
  // neck ruff + head
  const neckBase = bodyZ(24, 8);
  const headC: V3 = add3(sh, [0, 14 - headDrop, 22 + lunge * 0.3]);
  st.add(headC, 1, (pp) => {
    const ruff = furHull(st, [...ring(frameYZ(neckBase, [0, 1, 0.3], [0, 0, 1]), 0, 15, 14, 10), ...ring(frameYZ(lerp3(neckBase, headC, 0.6), [0, 1, 0.6], [0, 0, 1]), 0, 11, 11, 10)], 4);
    pp.fill(ruff, FUR_LIGHT);
    const H = frameYZ(headC, [0, 1, 0], [0, -0.15 - headDrop * 0.01, 1]);
    const skull = furHull(st, [...ring(H, 2, 11, 11, 10), ...ring(H, 8, 8, 8, 8), ...ring(H, -6, 9, 9, 8)], 1.6);
    pp.fill(skull, fur);
    // snout: upper + lower jaw (mouth opens on bite)
    const up = st.hull([at(H, [5, 2, 4]), at(H, [-5, 2, 4]), at(H, [3.5, 1, 22]), at(H, [-3.5, 1, 22]), at(H, [4.5, -4, 6]), at(H, [-4.5, -4, 6]), at(H, [3, -3, 21]), at(H, [-3, -3, 21])]);
    const jawDrop = mouth * 7;
    const low2 = st.hull([at(H, [4, -5, 4]), at(H, [-4, -5, 4]), at(H, [2.5, -6 - jawDrop, 19]), at(H, [-2.5, -6 - jawDrop, 19]), at(H, [3, -9, 5]), at(H, [-3, -9, 5])]);
    pp.fill(low2, FUR_LIGHT, { lw: 1.6 });
    if (mouth > 0.2) pp.line(st.pts2([at(H, [0, -4, 18]), at(H, [0, -4 - jawDrop * 0.5, 12])]), '#f4ead8', 2.4);
    pp.fill(up, FUR_LIGHT, { lw: 1.6 });
    const nose = st.p(at(H, [0, 0.5, 23]));
    pp.dot(nose.x, nose.y, 2.6 * st.view.k, 2 * st.view.k, INK);
    for (const s of [1, -1]) {
      const ear = st.poly([at(H, [s * 4, 8, -2]), at(H, [s * 10, 8, -3]), at(H, [s * 8, 20, -5])]);
      pp.fill(ear, FUR_DARK, { lw: 1.6 });
      const e = at(H, [s * 5.5, 3.5, 9.5]);
      if (st.faces(norm(sub(e, headC))) > 0.05) {
        const q = st.p(e);
        pp.dot(q.x, q.y, 2 * st.view.k, 1.4 * st.view.k, look.eye);
        pp.dot(q.x, q.y, 0.9 * st.view.k, 1.2 * st.view.k, INK);
      }
    }
    if (!look.collar) return;
    // leather collar with a brass tag (Ottilie's)
    const col = st.hull([...ring(frameYZ(lerp3(neckBase, headC, 0.35), [0, 1, 0.5], [0, 0, 1]), 0, 12.5, 12, 12), ...ring(frameYZ(lerp3(neckBase, headC, 0.42), [0, 1, 0.5], [0, 0, 1]), 0, 12, 11.5, 12)]);
    pp.fill(col, m('#7a3a2a', 'leather'), { lw: 1.4 });
    const tag = st.p(madd(lerp3(neckBase, headC, 0.35), [0, -1, 0.4], 12));
    pp.dot(tag.x, tag.y, 2.2 * st.view.k, 2.2 * st.view.k, '#d9a441');
  });
  st.render(p);
}

function add3(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
