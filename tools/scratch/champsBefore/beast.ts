// Non-human body parts for the shared rig (beast-folk, spirits, constructs): digitigrade feet, a hovering wisp
// instead of legs, tails, muzzles/beaks, animal ears, horns and tusks. Called from humanoid.ts.
import { add, at, dirOf, frameYZ, hash, hull2, INK, lerp3, m, madd, mix, norm, polyPath, ring, rotY, shapeFrom, sub, TAU, type Basis, type Stage, type V3 } from './core';
import { ribbon } from './props';
import type { Kit, Pose, Rig } from './types';

/** Head-local points on a (squashed) sphere passing the predicate. */
function sphereSel(H: Basis, r: number, scale: number, pred: (u: V3) => boolean, squash: V3 = [1, 1, 1]): V3[] {
  const out: V3[] = [];
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const lat = -Math.PI / 2 + (i / n) * Math.PI;
    const cnt = Math.max(1, Math.round(Math.cos(lat) * n * 2));
    for (let j = 0; j < cnt; j++) {
      const lon = (j / cnt) * TAU;
      const u: V3 = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
      if (pred(u)) out.push(at(H, [u[0] * r * scale * squash[0], u[1] * r * scale * squash[1], u[2] * r * scale * squash[2]]));
    }
  }
  return out;
}

/** Digitigrade foot: raised heel (the rig's ankle) down to a paw / hoof / talons on the ground. */
export function digiFoot(st: Stage, rig: Rig, heel: V3, toe: V3, foot: Basis, kit: Kit): void {
  const o = kit.outfit;
  const g = rig.body.girth;
  const skin = m(o.skin, o.skinKind ?? 'skin');
  const fm = o.feet?.mat ?? o.boots;
  const kind = o.feet?.kind ?? 'paw';
  const flat: V3 = [toe[0] - heel[0], 0, toe[2] - heel[2]];
  const fwd = Math.hypot(flat[0], flat[2]) > 0.5 ? norm(flat) : norm([foot.z[0], 0, foot.z[2]]);
  st.add(lerp3(heel, toe, 0.6), -0.45, (p) => {
    p.fill(st.capsule(heel, toe, rig.limb.sh * 0.92, rig.limb.sh * 0.6), skin);
    const f = frameYZ(toe, [0, 1, 0], fwd);
    if (kind === 'hoof') {
      p.fill(st.hull([...ring(f, 4, 4.4 * g, 4.6 * g, 10, 1), ...ring(f, -2.5, 5.4 * g, 6.2 * g, 10, 2)]), fm);
      p.line(st.pts2([at(f, [0, 2.5, 6 * g]), at(f, [0, -2.5, 8 * g])]), INK, 1.4);
    } else if (kind === 'talon') {
      for (const a of [-0.55, 0, 0.55]) {
        const d = rotY(fwd, a);
        p.fill(st.capsule(add(toe, [0, -1, 0]), madd(add(toe, [0, -2.5, 0]), d, 12 * g), 2.3 * g, 0.8 * g), fm, { lw: 1.3, rim: false });
      }
      p.fill(st.capsule(toe, madd(add(toe, [0, -2, 0]), fwd, -8 * g), 2 * g, 0.8 * g), fm, { lw: 1.3, rim: false });
      p.fill(st.sphere(toe, 3.4 * g), skin, { lw: 1.3 });
    } else {
      p.fill(st.hull([...ring(f, 3, 4.8 * g, 5.4 * g, 10, 1), ...ring(f, -2.5, 5.6 * g, 7.6 * g, 10, 3)]), fm);
      for (const x of [-3, 0, 3]) {
        const q = st.p(at(f, [x * g, -1.5, 10 * g]));
        p.dot(q.x, q.y, 1.1 * st.view.k, 1.1 * st.view.k, '#e8e0d0');
      }
    }
  });
}

/** Hovering spirit: a tattered, tapering lower body instead of legs. */
export function drawWisp(st: Stage, rig: Rig, pose: Pose, kit: Kit): void {
  const o = kit.outfit;
  const b = rig.body;
  const mat = o.coat?.mat ?? o.legs;
  const P = rig.pelvis;
  const drop = P.o[1] - 8;
  const back = -(b.chestD + 4) - pose.sway * 26;
  const pts: V3[] = [
    ...ring(P, 8, b.hipW + 3 + b.belly * 6, b.chestD + 2 + b.belly * 6, 14),
    ...ring({ ...P, o: add(P.o, [0, -drop * 0.45, back * 0.35]) }, 0, b.hipW + 7, b.chestD + 6, 14),
    add(P.o, [6, -drop, back]),
    add(P.o, [-7, -drop * 0.88, back * 1.15]),
    add(P.o, [0, -drop * 0.8, back * 0.5 + 4]),
  ];
  st.add(add(P.o, [0, -drop * 0.4, back * 0.4]), -0.7, (p) => {
    const hull = hull2(st.pts2(pts));
    const cy = hull.reduce((s, q) => s + q.y, 0) / hull.length;
    const jag: { x: number; y: number }[] = [];
    hull.forEach((q, i) => {
      jag.push(q);
      const nx = hull[(i + 1) % hull.length]!;
      if (q.y > cy && nx.y > cy) jag.push({ x: (q.x + nx.x) / 2 + (hash(i + 3) - 0.5) * 4, y: (q.y + nx.y) / 2 - 6 - hash(i) * 10 });
    });
    const folds = [-0.6, 0, 0.6].map((x) => st.pts2([at(P, [x * b.hipW, 4, b.chestD + 2]), add(P.o, [x * 8, -drop * 0.8, back * 0.7])]));
    p.fill(shapeFrom(jag, polyPath(jag)), mat, { folds });
    // trailing smoke wisps
    for (let i = 0; i < 3; i++) {
      const a = add(P.o, [(i - 1) * 7, -drop * (0.55 + i * 0.1), back * 0.8]);
      const z = add(a, [(i - 1) * 4 + Math.sin(pose.t * TAU + i) * 3, -drop * 0.22, -10 - pose.sway * 14]);
      p.fill(st.capsule(a, z, 3.4, 0.6), { c: mix(mat.c, '#000000', 0.25), k: 'cloth' }, { lw: 1.2, rim: false });
    }
  });
}

/** Tail from the back of the pelvis; trails with the cloth sway and wags a little. */
export function drawTail(st: Stage, rig: Rig, pose: Pose, tail: NonNullable<Kit['outfit']['tail']>): void {
  const b = rig.body;
  const P = rig.pelvis;
  const z0 = -(b.chestD * 0.8 + b.belly * 6);
  const L = tail.len;
  const sw = pose.sway;
  const wag = Math.sin(pose.t * TAU * 2) * 0.3;
  const pts: V3[] = [];
  for (let i = 0; i <= 6; i++) {
    const u = i / 6;
    const back = -u * L * (0.7 + Math.max(0, sw) * 0.25);
    const down = -u * L * (0.6 - Math.max(0, sw) * 0.45) + u * u * L * (tail.kind === 'bushy' ? 0.35 : 0.1);
    pts.push(at(P, [Math.sin(u * 2 + wag) * u * L * 0.18, -1 + down, z0 + back]));
  }
  st.add(pts[1]!, -0.75, (p) => {
    if (tail.kind === 'stub') {
      p.fill(st.sphere(pts[1]!, L * 0.22), tail.mat);
      return;
    }
    if (tail.kind === 'feather') {
      for (let i = -2; i <= 2; i++) {
        const tip = add(pts[6]!, [i * L * 0.16, Math.abs(i) * 3, Math.abs(i) * 2]);
        const mid = lerp3(pts[0]!, tip, 0.55);
        const side: V3 = [L * 0.06, 0, 0];
        p.fill(st.poly([pts[0]!, add(mid, side), tip, sub(mid, side)]), i % 2 ? tail.mat : (tail.tip ?? tail.mat), { lw: 1.3, rim: i === 0 });
      }
      return;
    }
    // bushy: two hulls so the tail keeps its bend, tip in the lighter colour
    const rr = (u: number) => L * 0.1 * (0.55 + Math.sin(Math.min(1, u * 1.15) * Math.PI) * 0.9);
    const rings = (from: number, to: number) => {
      const out: V3[] = [];
      for (let i = from; i <= to; i++) out.push(...ring(frameYZ(pts[i]!, [0, 1, 0], P.z), 0, rr(i / 6), rr(i / 6), 8));
      return out;
    };
    p.fill(st.hull(rings(0, 3)), tail.mat, { folds: [st.pts2([pts[1]!, pts[3]!])] });
    p.fill(st.hull(rings(3, 6)), tail.mat);
    if (tail.tip) p.fill(st.hull([...ring(frameYZ(pts[6]!, [0, 1, 0], P.z), 0, rr(0.9), rr(0.9), 8), ...ring(frameYZ(lerp3(pts[5]!, pts[6]!, 0.4), [0, 1, 0], P.z), 0, rr(0.8), rr(0.8), 8)]), tail.tip, { lw: 1.4 });
  });
}

/** Muzzles, beaks, animal ears, horns and tusks on top of the shared head. */
export function drawBeastHead(st: Stage, rig: Rig, kit: Kit, front: number): void {
  const o = kit.outfit;
  const H = rig.head;
  const r = rig.body.headR;
  const skin = m(o.skin, o.skinKind ?? 'skin');
  const k = st.view.k;
  const lw = r / 14;
  if (o.ears) {
    const ears = o.ears;
    const em = ears.mat ?? skin;
    st.add(madd(H.o, H.z, -r * 0.2), 0.32, (p) => {
      for (const s of [1, -1]) {
        if (ears.kind === 'bear') {
          const c = at(H, [s * r * 0.8, r * 0.85, -r * 0.1]);
          p.fill(st.sphere(c, r * 0.42), em, { lw: 1.5 });
          const q = st.p(madd(c, H.z, r * 0.2));
          if (front > -0.2) p.dot(q.x, q.y, r * 0.2 * k, r * 0.2 * k, ears.inner ?? mix(em.c, '#000000', 0.4));
        } else if (ears.kind === 'yordle') {
          const e = [at(H, [s * r * 0.8, r * 0.3, -r * 0.05]), at(H, [s * r * 1.7, r * 0.85, -r * 0.3]), at(H, [s * r * 2.7, r * 1.15, -r * 0.4]), at(H, [s * r * 1.85, r * 0.3, -r * 0.3]), at(H, [s * r * 0.85, -r * 0.2, -r * 0.05])];
          p.fill(st.poly(e, true), em, { lw: 1.6 });
          p.line(st.pts2([at(H, [s * r * 1.0, r * 0.15, 0]), at(H, [s * r * 1.8, r * 0.6, -r * 0.25]), at(H, [s * r * 2.4, r * 0.95, -r * 0.35])]), ears.inner ?? '#d08a8a', 2.2 * lw);
        } else {
          const tall = ears.kind === 'wolf' ? 1.7 : 1.0;
          const out = ears.kind === 'wolf' ? 0.95 : 1.25;
          const tri = [at(H, [s * r * 0.38, r * 0.74, -r * 0.05]), at(H, [s * r * out, r * 0.42, -r * 0.2]), at(H, [s * r * (out - 0.1), r * tall, -r * 0.3])];
          p.fill(st.poly(tri), em, { lw: 1.6 });
          if (front > -0.1 && ears.inner) p.fill(st.poly([lerp3(tri[0]!, tri[2]!, 0.15), lerp3(tri[1]!, tri[2]!, 0.15), lerp3(tri[0]!, tri[2]!, 0.75)]), m(ears.inner, 'skin'), { lw: 0, rim: false, flat: true });
        }
      }
    });
  }
  if (o.snout) {
    const sn = o.snout;
    const mat = sn.mat ?? skin;
    const nose = sn.nose ?? '#2a2024';
    st.add(madd(H.o, H.z, r * 1.15), 0.22, (p) => {
      switch (sn.kind) {
        case 'wolf':
        case 'bear': {
          const bear = sn.kind === 'bear';
          const L = bear ? 1.38 : 1.65;
          p.fill(st.capsule(at(H, [0, -r * 0.45, r * 0.55]), at(H, [0, -r * 0.42, r * (L - 0.3)]), r * 0.32, r * 0.16), { c: mix(mat.c, '#000000', 0.18), k: mat.k }, { lw: 1.4 });
          p.fill(st.capsule(at(H, [0, -r * 0.02, r * 0.55]), at(H, [0, -r * 0.14, r * L]), r * (bear ? 0.56 : 0.46), r * (bear ? 0.42 : 0.22)), mat);
          const t = st.p(at(H, [0, -r * 0.04, r * (L + (bear ? 0.3 : 0.12))]));
          p.dot(t.x, t.y, r * (bear ? 0.24 : 0.15) * k, r * (bear ? 0.17 : 0.11) * k, nose);
          break;
        }
        case 'ram': {
          p.fill(st.capsule(at(H, [0, -r * 0.1, r * 0.55]), at(H, [0, -r * 0.62, r * 1.42]), r * 0.44, r * 0.34), mat);
          for (const s of [1, -1]) {
            const q = st.p(at(H, [s * r * 0.14, -r * 0.6, r * 1.72]));
            if (front > 0) p.dot(q.x, q.y, r * 0.06 * k, r * 0.05 * k, nose);
          }
          break;
        }
        case 'beak': {
          p.fill(st.hull([at(H, [r * 0.34, -r * 0.32, r * 0.72]), at(H, [-r * 0.34, -r * 0.32, r * 0.72]), at(H, [0, -r * 0.5, r * 1.9])]), { c: mix(mat.c, '#000000', 0.25), k: mat.k }, { lw: 1.4 });
          p.fill(st.hull([at(H, [r * 0.44, 0.08 * r, r * 0.7]), at(H, [-r * 0.44, 0.08 * r, r * 0.7]), at(H, [0, r * 0.3, r * 0.82]), at(H, [0, -r * 0.3, r * 2.35])]), mat, { lw: 1.6 });
          break;
        }
        case 'frog': {
          p.fill(st.hull(sphereSel(H, r, 1.08, (u) => u[1] < 0.1 && u[2] > -0.35, [1.3, 0.85, 1.08])), skin, { shadow: 0.8 });
          if (front > 0.05)
            p.line(st.pts2([at(H, [r * 1.1, -r * 0.3, r * 0.5]), at(H, [r * 0.5, -r * 0.48, r * 0.95]), at(H, [0, -r * 0.5, r * 1.05]), at(H, [-r * 0.5, -r * 0.48, r * 0.95]), at(H, [-r * 1.1, -r * 0.3, r * 0.5])]), mix(o.skin, INK, 0.7), 1.8 * lw);
          for (const s of [1, -1]) {
            const c = at(H, [s * r * 0.52, r * 0.6, r * 0.45]);
            p.fill(st.sphere(c, r * 0.36), skin, { lw: 1.5 });
            if (st.faces(dirOf(H, norm([s * 0.5, 0.6, 0.6]))) > -0.1) {
              const q = st.p(madd(c, H.z, r * 0.24));
              p.dot(q.x, q.y, r * 0.22 * k, r * 0.22 * k, '#e8d870');
              p.dot(q.x, q.y, r * 0.09 * k, r * 0.17 * k, INK);
              p.dot(q.x + r * 0.07 * k, q.y - r * 0.07 * k, r * 0.05 * k, r * 0.05 * k, '#ffffff');
            }
          }
          break;
        }
        case 'ogre': {
          const jaw = sphereSel(H, r, 1.12, (u) => u[1] < -0.2 && u[2] > -0.25, [1.25, 1, 1.08]);
          jaw.push(at(H, [0, -r * 1.3, r * 0.75]), at(H, [r * 0.7, -r * 1.15, r * 0.5]), at(H, [-r * 0.7, -r * 1.15, r * 0.5]));
          p.fill(st.hull(jaw), skin, { shadow: 0.9 });
          if (front > 0.15) p.line(st.pts2([at(H, [r * 0.55, -r * 0.7, r * 0.95]), at(H, [0, -r * 0.78, r * 1.12]), at(H, [-r * 0.55, -r * 0.7, r * 0.95])]), mix(o.skin, INK, 0.7), 1.8 * lw);
          break;
        }
      }
    });
  }
  if (o.tusks) {
    const tm = o.tusks;
    st.add(madd(H.o, H.z, r * 1.3), 0.3, (p) => {
      for (const s of [1, -1]) p.fill(st.capsule(at(H, [s * r * 0.45, -r * 0.9, r * 1.0]), at(H, [s * r * 0.66, r * 0.12, r * 1.25]), r * 0.2, r * 0.05), tm, { lw: 1.4 });
    });
  }
  if (o.horns) {
    const hn = o.horns;
    st.add(madd(H.o, H.y, r * 0.5), 0.78, (p) => {
      for (const s of [1, -1]) {
        if (hn.kind === 'ram') {
          const pts: V3[] = [];
          for (let i = 0; i <= 12; i++) {
            const u = i / 12;
            // spiral beside the head: up and back from the crown, down behind the ear, forward under it
            const th = 1.7 - u * 4.6;
            const R = r * 0.62 * (1 - 0.45 * u);
            pts.push(at(H, [s * (r * 0.78 + u * r * 0.42), r * 0.18 + Math.sin(th) * R, -r * 0.12 + Math.cos(th) * R]));
          }
          p.fill(ribbon(st, pts, r * 0.42, r * 0.12), hn.mat, { folds: [st.pts2(pts.slice(1, 11))] });
          // growth ridges
          for (let i = 2; i < 11; i += 2) p.line(st.pts2([madd(pts[i]!, H.x, s * r * 0.05), madd(pts[i]!, H.y, r * 0.08)]), mix(hn.mat.c, INK, 0.5), 1.1);
        } else {
          // branches: a forked bough per side with leaf clumps
          const root = at(H, [s * r * 0.45, r * 0.8, -r * 0.1]);
          const mid = at(H, [s * r * 1.05, r * 1.5, -r * 0.25]);
          const tip = at(H, [s * r * 1.2, r * 2.2, -r * 0.1]);
          const fork = at(H, [s * r * 1.85, r * 1.75, -r * 0.35]);
          p.fill(ribbon(st, [root, mid, tip], r * 0.34, r * 0.12), hn.mat, { lw: 1.4 });
          p.fill(ribbon(st, [mid, fork], r * 0.2, r * 0.1), hn.mat, { lw: 1.3 });
          if (hn.leaf) for (const q of [tip, fork]) p.fill(st.sphere(q, r * 0.3), m(hn.leaf, 'fur'), { lw: 1.3 });
        }
      }
    });
  }
}
