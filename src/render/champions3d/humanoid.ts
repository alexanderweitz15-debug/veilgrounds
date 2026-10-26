// Procedural low-poly humanoid: body (skinned lofts, smooth weights at the joints), head with sculpted features,
// hair / beards as faceted clumps and the layered outfit from the 2D kit (coat skirts, aprons, capes with folds,
// hoods, hats, pauldrons, belts, straps, pouches ...). Everything is authored in bind model space (H ~ 180 units,
// +x = figure's left, +z = forward) and written into the champion's MeshBuilder.
import { ConeGeometry as CONE } from 'three';
import type { Mat } from '../champions/core';
import type { Outfit } from '../champions/types';
import type { Ctx } from './ctx';
import { mixHex, shade, T, type Vec, type WeightFn, type Weights } from './mesh';

const TAU = Math.PI * 2;

/** Points of an (optionally partial) ellipse ring; u 0 = front (+z), 0.25 = left (+x), 0.5 = back. */
export function ell(cx: number, cy: number, cz: number, rx: number, rz: number, seg: number, u0 = 0, u1 = 1, dy?: (u: number) => number, dr?: (u: number) => number): Vec[] {
  const full = u0 === 0 && u1 === 1;
  const n = full ? seg : seg + 1;
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const u = u0 + ((u1 - u0) * i) / seg;
    const a = u * TAU;
    const r = dr ? dr(u) : 1;
    out.push([cx + Math.sin(a) * rx * r, cy + (dy ? dy(u) : 0), cz + Math.cos(a) * rz * r]);
  }
  return out;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

// ------------------------------------------------------------------------------------------------ weights
function torsoW(c: Ctx): WeightFn {
  const { waist, chestY, neckBase } = c.L;
  const H = c.bone.hips!;
  const S = c.bone.spine!;
  const C = c.bone.chest!;
  const N = c.bone.neck!;
  return (p): Weights => {
    const y = p.y;
    if (y < waist - 5) return [[H, 1]];
    if (y < waist + 3) {
      const t = (y - (waist - 5)) / 8;
      return [
        [H, 1 - t],
        [S, t],
      ];
    }
    if (y < chestY - 4) return [[S, 1]];
    if (y < chestY + 3) {
      const t = (y - (chestY - 4)) / 7;
      return [
        [S, 1 - t],
        [C, t],
      ];
    }
    if (y > neckBase + 1) return [[N, 1]];
    return [[C, 1]];
  };
}

function armW(c: Ctx, s: 1 | -1): WeightFn {
  const n = s > 0 ? 'L' : 'R';
  const U = c.bone[`uArm${n}`]!;
  const F = c.bone[`fArm${n}`]!;
  const elbow = c.bindP[F]!.y;
  return (p): Weights => {
    const t = clamp01((elbow + 3 - p.y) / 6);
    return [
      [U, 1 - t],
      [F, t],
    ];
  };
}

function legW(c: Ctx, s: 1 | -1): WeightFn {
  const n = s > 0 ? 'L' : 'R';
  const Th = c.bone[`thigh${n}`]!;
  const Sh = c.bone[`shin${n}`]!;
  const Hp = c.bone.hips!;
  const knee = c.bindP[Sh]!.y;
  const hip = c.L.hipY;
  return (p): Weights => {
    if (p.y > hip - 2) {
      const t = clamp01((p.y - (hip - 2)) / 8) * 0.6;
      return [
        [Th, 1 - t],
        [Hp, t],
      ];
    }
    const t = clamp01((knee + 3 - p.y) / 6);
    return [
      [Th, 1 - t],
      [Sh, t],
    ];
  };
}

/** Skirt cloth: top on the hips, lower part follows the front / back skirt bones. */
export function skirtW(c: Ctx, top: number, bottom: number): WeightFn {
  const H = c.bone.hips!;
  const F = c.bone.skirtF!;
  const Bk = c.bone.skirtB!;
  return (p): Weights => {
    const u = clamp01((top - p.y) / Math.max(1, top - bottom));
    const nz = p.z / (Math.abs(p.x) + Math.abs(p.z) + 1e-3);
    const f = Math.max(0, nz) * u * 0.95;
    const b = Math.max(0, -nz) * u * 0.95;
    return [
      [H, Math.max(0.001, 1 - f - b)],
      [F, f],
      [Bk, b],
    ];
  };
}

/** Cape / scarf tail: chest → cape0 → cape1 along the height. */
export function capeW(c: Ctx, top: number, bottom: number): WeightFn {
  const C = c.bone.chest!;
  const C0 = c.bone.cape0!;
  const C1 = c.bone.cape1!;
  return (p): Weights => {
    const u = clamp01((top - p.y) / Math.max(1, top - bottom));
    if (u < 0.45)
      return [
        [C, 1 - u / 0.45],
        [C0, u / 0.45],
      ];
    return [
      [C0, 1 - (u - 0.45) / 0.55],
      [C1, (u - 0.45) / 0.55],
    ];
  };
}

// ------------------------------------------------------------------------------------------------ body
export function buildHumanoid(c: Ctx): void {
  const o = c.kit.outfit;
  body(c, o);
  head(c, o);
  outfit(c, o);
}

function skinOr(o: Outfit, m: Mat | undefined): Mat {
  return m ?? { c: o.skin, k: 'skin' };
}

function body(c: Ctx, o: Outfit): void {
  const L = c.L;
  const b = c.b;
  const g = L.girth;
  const bel = L.belly;
  // ---- torso: pelvis → waist → chest → shoulders (smooth weights across hips / spine / chest)
  c.weights(torsoW(c));
  const legsMat = o.legs;
  const hipBot = L.hipY - 9;
  const pelvis: Vec[][] = [
    ell(0, hipBot, 0.5, L.hipW * 0.82, L.chestD * 0.78, 8),
    ell(0, L.hipY + 2, 0.5, L.hipW * 1.02, L.chestD * 0.88 + bel * 2, 8),
    ell(0, L.waist - 2, 0.6 + bel * 3, L.hipW * 0.98 + bel * 4, L.chestD * 0.86 + bel * 6, 8),
  ];
  c.paint(legsMat);
  b.rings(pelvis, true, true, false);
  const bust = L.bust;
  const torso: Vec[][] = [
    ell(0, L.waist - 2, 0.6 + bel * 3, L.hipW * 0.98 + bel * 4, L.chestD * 0.86 + bel * 6, 8),
    ell(0, lerp(L.waist, L.chestY, 0.5), 0.8 + bel * 2, lerp(L.hipW, L.shW * 0.84, 0.55) + bel * 3, L.chestD * 0.9 + bel * 4 + bust * 1.5, 8),
    ell(0, L.chestY, 1, L.shW * 0.86, L.chestD * (1 + bust * 0.12), 8),
    ell(0, L.shoulderY - 2, 0, L.shW * 0.95, L.chestD * 0.86, 8),
    ell(0, L.neckBase - 0.5, -0.5, L.shW * 0.52, L.chestD * 0.6, 8),
  ];
  c.paint(o.top);
  b.rings(torso, true, false, true);
  if (bust > 0.1) {
    c.on('chest');
    for (const s of [1, -1]) b.blob([s * L.shW * 0.36, L.chestY - 3, L.chestD * 0.78], [L.shW * 0.3, 4.6 * bust + 1.5, 4 * bust + 1.2], 0);
  }
  // neck
  c.on('neck').paint({ c: o.skin, k: 'skin' });
  b.limb([0, L.neckBase - 3, -0.5], [0, L.chin + 2, 0.8], L.headR * 0.42 * Math.max(0.9, g * 0.95), L.headR * 0.36 * g, 6);

  // ---- arms
  for (const s of [1, -1] as const) {
    const n = s > 0 ? 'L' : 'R';
    const sh = c.bindP[c.bone[`uArm${n}`]!]!;
    const el = c.bindP[c.bone[`fArm${n}`]!]!;
    const wr = c.bindP[c.bone[`hand${n}`]!]!;
    // deltoid
    c.on(`uArm${n}`).paint(o.sleeves ?? o.top);
    b.blob([sh.x + s * 0.5, sh.y - 1, sh.z], [5.6 * g, 6.2 * g, 5.4 * g], 0);
    c.weights(armW(c, s));
    const ru = 4.5 * g;
    const re = 3.5 * g;
    const rw = 2.6 * g;
    b.rings(
      [
        ell(el.x, el.y - 1, el.z + 0.4, re, re * 0.95, 6),
        ell(lerp(sh.x, el.x, 0.5), lerp(sh.y, el.y, 0.5), sh.z, ru * 0.98, ru * 0.92, 6),
        ell(sh.x, sh.y - 1, sh.z, ru, ru, 6),
      ],
      true,
      false,
      true,
    );
    c.paint(skinOr(o, o.forearms ?? o.sleeves));
    b.rings(
      [
        ell(wr.x, wr.y + 0.5, wr.z, rw, rw * 1.1, 6),
        ell(lerp(el.x, wr.x, 0.35), lerp(el.y, wr.y, 0.35), el.z + 0.3, re * 1.06, re, 6),
        ell(el.x, el.y + 2, el.z + 0.4, re * 0.98, re * 0.95, 6),
      ],
      true,
      true,
      true,
    );
    // hand: closed fist block + thumb, palm facing the body
    c.on(`hand${n}`).paint(skinOr(o, o.hands));
    const hl = L.hand;
    b.box(wr.x, wr.y - hl * 0.42, wr.z + 0.3, 2.9 * g, hl * 0.84, 4.6 * g, 0.92, 1.1);
    b.box(wr.x - s * 0.6, wr.y - hl * 0.3, wr.z + 2.6 * g, 1.6, hl * 0.42, 1.8);
  }

  // ---- legs
  for (const s of [1, -1] as const) {
    const n = s > 0 ? 'L' : 'R';
    const hp = c.bindP[c.bone[`thigh${n}`]!]!;
    const kn = c.bindP[c.bone[`shin${n}`]!]!;
    const an = c.bindP[c.bone[`foot${n}`]!]!;
    const rt = (L.hipW * 0.5 + 1) * g;
    const rk = 4.6 * g;
    const ra = 3.0 * g;
    c.weights(legW(c, s)).paint(legsMat);
    const bootH = o.bootH ?? 0.35;
    const bootTop = lerp(an.y, kn.y, Math.min(0.95, bootH));
    b.rings(
      [
        ell(kn.x, kn.y - 2, kn.z + 0.3, rk * 0.98, rk, 6),
        ell(kn.x, kn.y + 1.5, kn.z + 0.5, rk * 1.05, rk * 1.05, 6),
        ell(lerp(hp.x, kn.x, 0.45) + s * 0.4, lerp(hp.y, kn.y, 0.45), 0.6, rt * 0.92, rt * 0.95, 6),
        ell(hp.x + s * 0.6, hp.y + 3, 0.2, rt, rt * 1.05, 6),
      ],
      true,
      true,
      true,
    );
    c.on(`shin${n}`).paint(legsMat);
    // lower leg: trouser part above the boot
    const calfY = lerp(kn.y, an.y, 0.3);
    if (bootTop < kn.y - 3) {
      b.rings(
        [
          ell(lerp(kn.x, an.x, (kn.y - bootTop) / (kn.y - an.y)), bootTop - 1, 0.2, Math.max(ra, rk * 0.85), rk * 0.88, 6),
          ...(calfY < bootTop ? [] : [ell(lerp(kn.x, an.x, 0.3), calfY, -0.4, rk * 1.02, rk * 1.06, 6)]),
          ell(kn.x, kn.y - 2, kn.z + 0.3, rk * 0.95, rk * 0.95, 6),
        ],
        true,
        false,
        true,
      );
    }
    c.paint(o.boots);
    const bt = Math.min(bootTop, kn.y - 1);
    const bootR = (y: number) => lerp(ra, rk * 1.02, clamp01((y - an.y) / (kn.y - an.y) / 0.6)) + 0.6;
    b.rings(
      [ell(an.x, an.y - 2, 0.6, ra + 0.9, ra + 1.4, 6), ...(bt - an.y > 14 ? [ell(lerp(an.x, kn.x, 0.4), lerp(an.y, bt, 0.55), -0.3, bootR(lerp(an.y, bt, 0.55)), bootR(lerp(an.y, bt, 0.55)) * 1.05, 6)] : []), ell(lerp(an.x, kn.x, (bt - an.y) / (kn.y - an.y)), bt, 0, bootR(bt) + 0.4, bootR(bt) + 0.5, 6)],
      true,
      true,
      true,
    );
    // foot
    c.on(`foot${n}`).paint(o.boots);
    const fl = L.footLen;
    b.box(an.x, an.y * 0.55, fl * 0.32, 5.2 * g, an.y * 1.15 + 1, fl, 0.82, 0.8);
    b.box(an.x, 1.0, fl * 0.32, 5.6 * g, 2, fl * 1.04);
  }
}

// ------------------------------------------------------------------------------------------------ head
function head(c: Ctx, o: Outfit): void {
  const L = c.L;
  const b = c.b;
  const r = L.headR;
  const hc: Vec = [0, L.headC, 0.6];
  const f = o.face ?? {};
  const skin = o.skin;
  const hood = o.hood;
  const voidFace = !!hood?.dark;
  c.on('head');
  // skull + jaw as one loft (bottom → top)
  const rings: Vec[][] = [
    ell(hc[0], hc[1] - r * 0.98, hc[2] + r * 0.36, r * 0.3, r * 0.24, 8),
    ell(hc[0], hc[1] - r * 0.72, hc[2] + r * 0.12, r * 0.62, r * 0.62, 8),
    ell(hc[0], hc[1] - r * 0.3, hc[2] + 0.02, r * 0.8, r * 0.86, 8),
    ell(hc[0], hc[1] + r * 0.12, hc[2], r * 0.84, r * 0.93, 8),
    ell(hc[0], hc[1] + r * 0.56, hc[2] - r * 0.04, r * 0.76, r * 0.86, 8),
    ell(hc[0], hc[1] + r * 0.9, hc[2] - r * 0.08, r * 0.42, r * 0.52, 8),
  ];
  c.paint(voidFace ? '#141018' : { c: skin, k: 'skin' });
  b.rings(rings, true, true, true);
  if (voidFace) {
    // two pale eye glints in the void
    c.paint(f.eyes ?? '#d6caff', { glow: 1 });
    for (const s of [1, -1]) b.box(hc[0] + s * r * 0.3, hc[1] + r * 0.02, hc[2] + r * 0.86, r * 0.2, r * 0.09, 1);
    return;
  }
  const fz = hc[2] + r * 0.86; // face plane
  // brow ridge
  c.paint(shade(skin, 0.96));
  b.box(hc[0], hc[1] + r * 0.2, fz - r * 0.04, r * 1.18, r * 0.16, r * 0.26, 0.9);
  // nose wedge
  c.paint(skin);
  b.tri([hc[0], hc[1] + r * 0.1, fz + r * 0.05], [hc[0] - r * 0.12, hc[1] - r * 0.36, fz + r * 0.05], [hc[0], hc[1] - r * 0.34, fz + r * 0.3]);
  b.tri([hc[0], hc[1] + r * 0.1, fz + r * 0.05], [hc[0], hc[1] - r * 0.34, fz + r * 0.3], [hc[0] + r * 0.12, hc[1] - r * 0.36, fz + r * 0.05]);
  b.tri([hc[0] - r * 0.12, hc[1] - r * 0.36, fz + r * 0.05], [hc[0] + r * 0.12, hc[1] - r * 0.36, fz + r * 0.05], [hc[0], hc[1] - r * 0.34, fz + r * 0.3]);
  // cheekbones
  c.paint(shade(skin, 0.98));
  for (const s of [1, -1]) b.blob([hc[0] + s * r * 0.5, hc[1] - r * 0.22, fz - r * 0.22], [r * 0.24, r * 0.16, r * 0.2], 0);
  // ears
  for (const s of [1, -1]) b.box(hc[0] + s * r * 0.84, hc[1] - r * 0.08, hc[2] - r * 0.05, r * 0.14, r * 0.42, r * 0.26, 0.7);
  // eye sockets (cool shade) + eyes (dark)
  const sock = mixHex(shade(skin, 0.62), '#3a2d5a', 0.25);
  for (const s of [1, -1]) {
    c.paint(sock);
    b.box(hc[0] + s * r * 0.32, hc[1] + r * 0.02, fz - r * 0.05, r * 0.32, r * 0.17, r * 0.14);
    if (!f.blindfold) {
      c.paint(f.eyes ?? '#231a20');
      b.box(hc[0] + s * r * 0.3, hc[1] + r * 0.02, fz + r * 0.02, r * 0.14, r * 0.08, r * 0.06);
    }
  }
  // mouth line
  c.paint(mixHex(shade(skin, 0.55), '#5a2a2a', 0.3));
  b.box(hc[0], hc[1] - r * 0.56, fz - r * 0.1, r * 0.34, r * 0.05, r * 0.08);
  // brows
  const hairC = o.hair && o.hair.style !== 'none' ? o.hair.mat.c : o.beard?.mat.c ?? shade(skin, 0.5);
  const bw = f.brows ?? 1;
  c.paint(f.old ? mixHex(hairC, '#e8e2d8', 0.6) : shade(hairC, 0.9));
  for (const s of [1, -1]) b.box(hc[0] + s * r * 0.31, hc[1] + r * 0.28, fz + r * 0.05, r * 0.36, r * 0.07 * bw + 0.3, r * 0.1, 1, 1);
  if (f.old) {
    c.paint(shade(skin, 0.86));
    for (const s of [1, -1]) b.box(hc[0] + s * r * 0.36, hc[1] - r * 0.12, fz - r * 0.04, r * 0.28, r * 0.05, r * 0.1);
  }
  if (f.scar) {
    c.paint('#8a4a40');
    b.push(T(hc[0] - r * 0.3, hc[1] + r * 0.05, fz + r * 0.04, 0, 0, 0.5));
    b.box(0, 0, 0, r * 0.06, r * 0.55, r * 0.06);
    b.pop();
  }
  if (f.paint) {
    c.paint(f.paint);
    for (const s of [1, -1]) {
      b.push(T(hc[0] + s * r * 0.45, hc[1] - r * 0.24, fz - r * 0.1, 0, s * 0.4, s * 0.25));
      b.box(0, 0, 0, r * 0.4, r * 0.07, r * 0.08);
      b.box(0, -r * 0.14, 0, r * 0.34, r * 0.06, r * 0.08);
      b.pop();
    }
  }
  if (f.blindfold) {
    c.paint(f.blindfold);
    b.loft([{ c: [hc[0], hc[1] - r * 0.04, hc[2] + 0.2], rx: r * 0.92, rz: r * 1.0 }, { c: [hc[0], hc[1] + r * 0.2, hc[2] + 0.2], rx: r * 0.92, rz: r * 1.0 }], 8, false, false);
    b.box(hc[0] + r * 0.2, hc[1] - r * 0.15, hc[2] - r * 1.05, r * 0.16, r * 0.55, r * 0.1);
    b.box(hc[0] - r * 0.15, hc[1] - r * 0.25, hc[2] - r * 1.02, r * 0.16, r * 0.7, r * 0.1);
  }
  if (f.monocle) {
    c.paint({ c: '#c9973f', k: 'metal' });
    b.push(T(hc[0] - r * 0.3, hc[1] + r * 0.02, fz + r * 0.1));
    b.loft([{ c: [0, -0.4, 0], rx: r * 0.17, rz: r * 0.17 }, { c: [0, 0.4, 0], rx: r * 0.17, rz: r * 0.17 }], 6, false, false);
    b.pop();
    b.push(T(hc[0] - r * 0.3, hc[1] + r * 0.02, fz + r * 0.1, Math.PI / 2, 0, 0));
    b.loft([{ c: [0, -0.3, 0], rx: r * 0.18, rz: r * 0.18 }, { c: [0, 0.3, 0], rx: r * 0.18, rz: r * 0.18 }], 6);
    b.pop();
    c.paint('#d8e4e8', { metal: 0.8 });
    b.box(hc[0] - r * 0.3, hc[1] + r * 0.02, fz + r * 0.14, r * 0.24, r * 0.24, 0.3);
  }
  if (f.jaw) {
    c.paint(f.jaw);
    b.rings([ell(hc[0], hc[1] - r * 1.04, hc[2] + r * 0.36, r * 0.38, r * 0.32, 8, 0.7, 1.3), ell(hc[0], hc[1] - r * 0.5, hc[2] + r * 0.12, r * 0.86, r * 0.82, 8, 0.7, 1.3)], false, false, false);
    b.box(hc[0], hc[1] - r * 0.78, fz + r * 0.08, r * 0.7, r * 0.22, r * 0.12);
  }
  hairAndBeard(c, o, hc, r);
}

function hairAndBeard(c: Ctx, o: Outfit, hc: Vec, r: number): void {
  const b = c.b;
  const hair = o.hair;
  const hat = o.hat;
  const hood = o.hood;
  const covered = !!hood || (hat && (hat.kind === 'helm' || hat.kind === 'veil' || hat.kind === 'bearhood' || hat.kind === 'wolfhood'));
  c.on('head');
  if (hair && hair.style !== 'none') {
    c.paint(hair.mat);
    const st = hair.style;
    // cap: hairline higher at the front
    if (!covered || st === 'long' || st === 'braid') {
      const capR = st === 'crop' ? 1.03 : 1.08;
      const line = (u: number) => {
        const fr = Math.max(0, Math.cos(u * TAU));
        return fr * r * (st === 'crop' ? 0.62 : 0.5) - (1 - fr) * r * (st === 'bob' ? 0.55 : 0.12);
      };
      const cap: Vec[][] = [
        ell(hc[0], hc[1], hc[2] - r * 0.04, r * 0.86 * capR, r * 0.95 * capR, 10, 0, 1, line),
        ell(hc[0], hc[1] + r * 0.6, hc[2] - r * 0.06, r * 0.78 * capR, r * 0.88 * capR, 10),
        ell(hc[0], hc[1] + r * 0.98, hc[2] - r * 0.1, r * 0.44 * capR, r * 0.54 * capR, 10),
      ];
      if (!covered) b.rings(cap, true, false, true);
    }
    if (st === 'short' || st === 'wild') {
      const n = st === 'wild' ? 9 : 6;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + 0.3;
        const y = hc[1] + r * (0.55 + 0.25 * Math.sin(i * 2.1));
        const p: Vec = [hc[0] + Math.sin(a) * r * 0.72, y, hc[2] - r * 0.1 + Math.cos(a) * r * 0.78];
        if (Math.cos(a) > 0.75 && st === 'short') continue;
        if (st === 'wild') {
          b.push(T(p[0], p[1], p[2], Math.cos(a) * 0.9, 0, -Math.sin(a) * 0.9));
          b.geo(coneGeo(r * 0.24, r * 0.75, 4), T(0, r * 0.25, 0));
          b.pop();
        } else b.blob(p, [r * 0.34, r * 0.24, r * 0.32], 0, a);
      }
    }
    if (st === 'long') {
      b.rings(
        [
          ell(hc[0], hc[1] - r * 2.4, hc[2] - r * 0.55, r * 0.75, r * 0.32, 8, 0.25, 0.75),
          ell(hc[0], hc[1] - r * 1.0, hc[2] - r * 0.25, r * 0.98, r * 0.85, 8, 0.2, 0.8),
          ell(hc[0], hc[1] + r * 0.2, hc[2] - r * 0.05, r * 0.94, r * 1.0, 8, 0.16, 0.84),
        ],
        false,
      );
      b.rings(
        [
          ell(hc[0], hc[1] - r * 2.4, hc[2] - r * 0.6, r * 0.7, r * 0.28, 8, 0.27, 0.73),
          ell(hc[0], hc[1] - r * 1.0, hc[2] - r * 0.3, r * 0.92, r * 0.78, 8, 0.22, 0.78),
          ell(hc[0], hc[1] + r * 0.2, hc[2] - r * 0.1, r * 0.88, r * 0.94, 8, 0.18, 0.82),
        ].map((ring) => ring.slice().reverse()),
        false,
      );
    }
    if (st === 'bun') {
      b.blob([hc[0], hc[1] + r * 0.62, hc[2] - r * 0.78], [r * 0.42, r * 0.4, r * 0.38], 0);
      c.paint('#c9973f', { metal: 1 });
      b.box(hc[0] + r * 0.2, hc[1] + r * 0.82, hc[2] - r * 0.8, r * 0.05, r * 0.6, r * 0.05);
    }
    if (st === 'tied') {
      b.push(T(hc[0], hc[1] + r * 0.2, hc[2] - r * 0.95, -0.35, 0, 0));
      b.geo(coneGeo(r * 0.28, r * 1.5, 5), T(0, -r * 0.7, 0, Math.PI, 0, 0));
      b.pop();
    }
    if (st === 'braid') {
      for (let i = 0; i < 6; i++) b.blob([hc[0] - r * 0.15, hc[1] - r * (0.2 + i * 0.42), hc[2] - r * (0.95 + i * 0.06)], [r * 0.24 * (1 - i * 0.06), r * 0.26, r * 0.22], 0, i);
    }
    if (st === 'bob') {
      b.rings(
        [ell(hc[0], hc[1] - r * 0.62, hc[2] - r * 0.1, r * 0.98, r * 1.04, 10, 0.12, 0.88), ell(hc[0], hc[1] + r * 0.1, hc[2] - r * 0.08, r * 0.95, r * 1.02, 10, 0.12, 0.88)],
        false,
      );
    }
  }
  const beard = o.beard;
  if (beard) {
    c.paint(beard.mat);
    const fz = hc[2] + r * 0.86;
    if (beard.style === 'stubble') {
      c.paint(mixHex(o.skin, beard.mat.c, 0.45));
      b.rings([ell(hc[0], hc[1] - r * 1.0, hc[2] + r * 0.36, r * 0.33, r * 0.27, 8, 0.65, 1.35), ell(hc[0], hc[1] - r * 0.45, hc[2] + r * 0.06, r * 0.83, r * 0.88, 8, 0.65, 1.35)], false);
    } else if (beard.style === 'mustache') {
      for (const s of [1, -1]) {
        b.push(T(hc[0] + s * r * 0.17, hc[1] - r * 0.46, fz + r * 0.04, 0, 0, s * -0.35));
        b.box(0, 0, 0, r * 0.38, r * 0.12, r * 0.14, 0.7);
        b.pop();
      }
    } else {
      const big = beard.style === 'full' || beard.style === 'braided';
      const len = big ? r * 0.75 : r * 0.35;
      b.rings(
        [
          ell(hc[0], hc[1] - r * 1.02 - len, hc[2] + r * 0.52, r * 0.28, r * 0.18, 8, 0.7, 1.3),
          ell(hc[0], hc[1] - r * 0.92, hc[2] + r * 0.36, r * 0.62, r * 0.48, 8, 0.66, 1.34),
          ell(hc[0], hc[1] - r * 0.35, hc[2] + r * 0.05, r * 0.88, r * 0.94, 8, 0.64, 1.36),
        ],
        false,
      );
      b.rings(
        [
          ell(hc[0], hc[1] - r * 1.02 - len, hc[2] + r * 0.48, r * 0.26, r * 0.15, 8, 0.7, 1.3),
          ell(hc[0], hc[1] - r * 0.92, hc[2] + r * 0.3, r * 0.58, r * 0.42, 8, 0.66, 1.34),
          ell(hc[0], hc[1] - r * 0.35, hc[2] + r * 0.0, r * 0.84, r * 0.9, 8, 0.64, 1.36),
        ].map((x) => x.slice().reverse()),
        false,
      );
      for (const s of [1, -1]) {
        b.push(T(hc[0] + s * r * 0.2, hc[1] - r * 0.46, fz + r * 0.06, 0, 0, s * -0.3));
        b.box(0, 0, 0, r * 0.42, r * 0.14, r * 0.16, 0.7);
        b.pop();
      }
      if (big) for (let i = 0; i < 3; i++) b.blob([hc[0] + (i - 1) * r * 0.32, hc[1] - r * 1.0 - len * 0.5, hc[2] + r * 0.62], [r * 0.2, len * 0.45, r * 0.16], 0, i);
      if (beard.style === 'braided') for (let i = 0; i < 3; i++) b.blob([hc[0], hc[1] - r * 1.1 - len - i * r * 0.3, hc[2] + r * 0.55], [r * 0.14, r * 0.17, r * 0.14], 0, i);
    }
  }
}

function coneGeo(rad: number, h: number, seg: number) {
  // imported lazily to keep the top of the file readable
  return new CONE(rad, h, seg);
}

// ------------------------------------------------------------------------------------------------ outfit
function skirtBottom(c: Ctx, len: number): number {
  const L = c.L;
  return len <= 1 ? L.hipY - len * (L.hipY - L.kneeY) : L.kneeY - Math.min(1, (len - 1) / 0.5) * (L.kneeY - L.ankleY - 2);
}

function outfit(c: Ctx, o: Outfit): void {
  const L = c.L;
  const b = c.b;
  const bel = L.belly;
  // ---------------------------------------------------------------- coat: torso shell + skirt
  if (o.coat) {
    const co = o.coat;
    const open = !!co.open;
    c.weights(torsoW(c)).paint(co.mat);
    const u0 = open ? 0.085 : 0;
    const u1 = open ? 0.915 : 1;
    const shell: Vec[][] = [
      ell(0, L.waist - 3, 0.6 + bel * 3, L.hipW * 1.04 + bel * 4, L.chestD * 0.94 + bel * 6, 10, u0, u1),
      ell(0, L.chestY, 1, L.shW * 0.9, L.chestD * (1.08 + L.bust * 0.12), 10, u0, u1),
      ell(0, L.shoulderY - 1.5, 0, L.shW * 0.99, L.chestD * 0.93, 10, u0, u1),
      ell(0, L.neckBase + 0.5, -0.4, L.shW * 0.56, L.chestD * 0.66, 10, u0, u1),
    ];
    b.rings(shell, !open);
    if (open && co.open) {
      // lapels in the lining colour
      c.paint(co.open);
      for (const s of [1, -1]) {
        b.tri([s * L.shW * 0.5, L.neckBase, L.chestD * 0.7], [s * L.shW * 0.18, L.chestY - 6, L.chestD * 1.12], [s * L.shW * 0.42, L.chestY + 2, L.chestD * 1.06]);
        b.tri([s * L.shW * 0.5, L.neckBase, L.chestD * 0.7], [s * L.shW * 0.42, L.chestY + 2, L.chestD * 1.06], [s * L.shW * 0.18, L.chestY - 6, L.chestD * 1.12]);
      }
    }
    if (co.collar) {
      c.paint(co.collar);
      b.loft([{ c: [0, L.neckBase - 1, -1], rx: L.shW * 0.5, rz: L.chestD * 0.62 }, { c: [0, L.neckBase + 4, -1.5], rx: L.shW * 0.42, rz: L.chestD * 0.56 }], 8, false, false);
    }
    skirt(c, co.mat, L.waist - 3, skirtBottom(c, co.len), co.flare, open || !!co.split, !!co.tatter, open ? co.open : undefined);
    // sleeves of the coat: cuffs at the wrist
    for (const s of [1, -1] as const) {
      const n = s > 0 ? 'L' : 'R';
      const wr = c.bindP[c.bone[`hand${n}`]!]!;
      if (o.forearms && o.forearms.c === co.mat.c) {
        c.on(`fArm${n}`).paint(co.open ?? shade(co.mat.c, 0.85));
        b.loft([{ c: [wr.x, wr.y + 0.5, wr.z], rx: 3.4 * L.girth, rz: 3.6 * L.girth }, { c: [wr.x, wr.y + 4, wr.z], rx: 3.6 * L.girth, rz: 3.8 * L.girth }], 6, false, false);
      }
    }
  }
  // ---------------------------------------------------------------- tabard
  if (o.tabard) {
    c.paint(o.tabard);
    const top = L.shoulderY - 3;
    const bot = L.hipY - (L.hipY - L.kneeY) * 0.75;
    for (const side of [1, -1]) {
      const zf = (y: number) => side * (y > L.waist ? L.chestD * 1.06 + 0.6 : L.chestD * 0.98 + 1 + (L.waist - y) * 0.08) + (side > 0 ? L.belly * 6 : 0);
      c.weights(panelW(c, top, bot, side));
      const w0 = L.shW * 0.42;
      const w1 = L.hipW * 0.7;
      const ys = [top, L.chestY, L.waist, L.hipY, bot];
      for (let i = 0; i < ys.length - 1; i++) {
        const ya = ys[i]!;
        const yb = ys[i + 1]!;
        const wa = lerp(w0, w1, i / (ys.length - 1));
        const wb = lerp(w0, w1, (i + 1) / (ys.length - 1));
        const jag = o.coat?.tatter && i === ys.length - 2 ? 3 : 0;
        if (side > 0) b.quad([-wa, ya, zf(ya)], [-wb, yb + jag, zf(yb)], [wb, yb, zf(yb)], [wa, ya, zf(ya)]);
        else b.quad([wa, ya, zf(ya)], [wb, yb + jag, zf(yb)], [-wb, yb, zf(yb)], [-wa, ya, zf(ya)]);
      }
    }
  }
  // ---------------------------------------------------------------- apron (with bib)
  if (o.apron) {
    const ap = o.apron;
    c.paint(ap.mat);
    const top = L.chestY + 3;
    const bot = skirtBottom(c, ap.len) + 2;
    const coatR = o.coat ? 1.06 : 1;
    const zAt = (y: number) => {
      if (y > L.waist) return L.chestD * (1.04 + L.bust * 0.18) * coatR + 0.8;
      if (y > L.hipY) return (L.chestD * 0.92 + bel * 6) * coatR + 1;
      const below = L.hipY - y;
      return (L.chestD * 0.92 + bel * 4) * coatR + 1.4 + below * (o.coat ? 0.08 + o.coat.flare * 0.12 : 0.06);
    };
    const ys = [top, L.waist + 2, L.hipY, lerp(L.hipY, bot, 0.5), bot];
    const ws = [L.shW * 0.38, L.hipW * 0.85 + bel * 3, L.hipW * 1.0 + bel * 3, L.hipW * 1.06, L.hipW * 1.12];
    c.weights(panelW(c, top, bot, 1));
    for (let i = 0; i < ys.length - 1; i++) {
      const ya = ys[i]!;
      const yb = ys[i + 1]!;
      b.quad([-ws[i]!, ya, zAt(ya)], [-ws[i + 1]!, yb, zAt(yb)], [ws[i + 1]!, yb, zAt(yb)], [ws[i]!, ya, zAt(ya)]);
    }
    // neck strap
    c.on('chest').paint(shade(ap.mat.c, 0.8));
    b.box(0, L.neckBase - 2, L.chestD * 0.4, L.shW * 0.9, 1.4, L.chestD * 1.0, 1);
  }
  // ---------------------------------------------------------------- plate
  if (o.plate) {
    c.on('chest').paint(o.plate);
    b.rings(
      [
        ell(0, L.waist + 1, 1, L.hipW * 1.06 + bel * 4, L.chestD * 1.0 + bel * 6, 8, 0.78, 1.22),
        ell(0, L.chestY, 1.6, L.shW * 0.92, L.chestD * 1.16, 8, 0.75, 1.25),
        ell(0, L.shoulderY - 2, 0.6, L.shW * 0.9, L.chestD * 0.98, 8, 0.75, 1.25),
        ell(0, L.neckBase, 0, L.shW * 0.55, L.chestD * 0.72, 8, 0.78, 1.22),
      ],
      false,
    );
    b.box(0, L.chestY - 2, L.chestD * 1.18 + 1, 1.2, (L.shoulderY - L.waist) * 0.7, 1.2);
  }
  // ---------------------------------------------------------------- belt + buckle + pouches
  if (o.belt) {
    const y = L.hipY + 5 + (o.belt.y ?? 0) * (L.shoulderY - L.hipY) * 0.6;
    const coatR = o.coat ? 1.07 : 1.02;
    c.on('hips').paint(o.belt.mat);
    const rx = (L.hipW * 1.02 + bel * 3) * coatR + 0.6;
    const rz = (L.chestD * 0.88 + bel * 5) * coatR + 0.8;
    b.loft([{ c: [0, y - 1.8, 0.6 + bel * 2], rx, rz }, { c: [0, y + 1.8, 0.6 + bel * 2.2], rx: rx * 1.0, rz: rz * 1.0 }], 10, false, false);
    if (o.belt.buckle) {
      c.paint(o.belt.buckle);
      b.box(0, y, 0.6 + bel * 2 + rz + 0.4, 4, 4.2, 1.2);
    }
    if (o.pouches) {
      c.paint(o.pouches.mat);
      for (let i = 0; i < o.pouches.n; i++) {
        const a = (i % 2 ? -1 : 1) * (1.9 + i * 0.25);
        b.box(Math.sin(a) * rx * 1.05, y - 4, Math.cos(a) * rz * 1.05, 5, 6.5, 3.6, 0.9);
      }
    }
  }
  // ---------------------------------------------------------------- strap across the chest
  if (o.strap) {
    const sd = o.strap.flip ? -1 : 1;
    c.weights(torsoW(c)).paint(o.strap.mat);
    const p0: Vec = [sd * L.shW * 0.62, L.shoulderY + 0.5, 0];
    const p1: Vec = [-sd * L.hipW * 0.95, L.hipY + 4, 0];
    const zF = (y: number) => (y > L.waist ? L.chestD * (1.06 + L.bust * 0.12) : L.chestD * 0.95 + bel * 6) + 0.8;
    const zB = -L.chestD * 1.0 - 0.6;
    const N = 5;
    for (const back of [false, true]) {
      for (let i = 0; i < N; i++) {
        const t0 = i / N;
        const t1 = (i + 1) / N;
        const y0 = lerp(p0[1], p1[1], t0);
        const y1 = lerp(p0[1], p1[1], t1);
        const x0 = lerp(p0[0], p1[0], t0);
        const x1 = lerp(p0[0], p1[0], t1);
        const z0 = back ? zB : zF(y0) * Math.min(1, 0.55 + t0 * 2);
        const z1 = back ? zB : zF(y1) * Math.min(1, 0.55 + t1 * 2);
        const w = 1.9;
        if (!back) b.quad([x0 - w, y0 - w * 0.8, z0], [x1 - w, y1 - w * 0.8, z1], [x1 + w, y1 + w * 0.8, z1], [x0 + w, y0 + w * 0.8, z0]);
        else b.quad([x0 + w, y0 + w * 0.8, z0], [x1 + w, y1 + w * 0.8, z1], [x1 - w, y1 - w * 0.8, z1], [x0 - w, y0 - w * 0.8, z0]);
      }
    }
    if (o.strap.items) {
      c.paint(o.strap.itemMat ?? o.strap.mat);
      const it = o.strap.items;
      for (let i = 1; i < 5; i++) {
        const t = 0.18 + i * 0.13;
        const x = lerp(p0[0], p1[0], t);
        const y = lerp(p0[1], p1[1], t);
        const z = zF(y) + 1;
        if (it === 'shells' || it === 'vials') b.box(x, y, z, 1.6, 4.6, 1.8);
        else if (it === 'knives') {
          b.push(T(x, y, z, 0, 0, sd * 0.7));
          b.box(0, 0, 0, 1.2, 7, 0.8, 0.3);
          b.pop();
        } else b.box(x, y, z - 0.4, 1.8, 1.8, 1.4);
      }
    }
  }
  // ---------------------------------------------------------------- pauldrons
  if (o.pauldrons) {
    const pd = o.pauldrons;
    for (const s of [1, -1] as const) {
      const n = s > 0 ? 'L' : 'R';
      const sh = c.bindP[c.bone[`uArm${n}`]!]!;
      c.on(`uArm${n}`).paint(pd.mat);
      const R = 7.4 * pd.size * L.girth;
      b.push(T(sh.x + s * 1.2, sh.y + 1, sh.z, 0, 0, s * -0.35));
      b.rings([ell(0, -R * 0.55, 0, R * 1.0, R * 1.02, 8), ell(0, R * 0.05, 0, R * 0.92, R * 0.95, 8), ell(0, R * 0.5, 0, R * 0.5, R * 0.55, 8)], true, true, true);
      b.rings([ell(0, -R * 0.95, 0, R * 1.04, R * 1.04, 8), ell(0, -R * 0.55, 0, R * 1.02, R * 1.04, 8)], true, true, false);
      if (pd.spikes) b.geo(coneGeo(R * 0.25, R * 0.9, 4), T(0, R * 0.8, 0));
      b.pop();
    }
  }
  // ---------------------------------------------------------------- shawl
  if (o.shawl) {
    c.paint(o.shawl);
    const top = L.neckBase + 1;
    const bot = L.chestY - 7;
    c.weights(torsoW(c));
    b.rings(
      [
        ell(0, bot, 0.5, L.shW * 1.08, L.chestD * 1.25 + L.bust * 2, 12, 0, 1, (u) => (Math.abs(u - 0.5) < 0.12 ? -8 : 0) + Math.sin(u * TAU * 6) * 1.2, (u) => 1 + 0.05 * Math.sin(u * TAU * 6)),
        ell(0, L.shoulderY, 0, L.shW * 1.1, L.chestD * 1.1, 12),
        ell(0, top, -0.4, L.shW * 0.6, L.chestD * 0.72, 12),
      ],
      true,
    );
  }
  // ---------------------------------------------------------------- cape
  if (o.cape) cape(c, o.cape.mat, o.cape.len, !!o.cape.tatter, !!o.cape.short);
  // ---------------------------------------------------------------- scarf
  if (o.scarf) {
    c.on('chest').paint(o.scarf.mat);
    b.loft([{ c: [0, L.neckBase - 2.5, -0.5], rx: L.headR * 0.62, rz: L.chestD * 0.66 }, { c: [0, L.neckBase + 2.5, -0.2], rx: L.headR * 0.55, rz: L.chestD * 0.6 }], 8);
    const tail = o.scarf.tail;
    if (tail > 1) {
      // long tail streaming behind (cape chain)
      const top = L.neckBase;
      const bot = L.neckBase - tail * 34;
      c.weights(capeW(c, top + 6, bot)).paint(o.scarf.mat);
      const zb = -L.chestD * 0.9;
      const ys = [top, top - 14, top - 30, bot];
      for (let i = 0; i < ys.length - 1; i++) {
        const ya = ys[i]!;
        const yb = ys[i + 1]!;
        const xa = L.shW * 0.25 - i * 2;
        const za = zb - 1.2 - i * 2.5;
        const zb2 = zb - 1.2 - (i + 1) * 2.5;
        b.quad([xa - 3, ya, za], [xa - 2 - 3, yb, zb2], [xa - 2 + 3, yb, zb2], [xa + 3, ya, za]);
        b.quad([xa + 3, ya, za], [xa - 2 + 3, yb, zb2], [xa - 2 - 3, yb, zb2], [xa - 3, ya, za]);
      }
    } else {
      // short ends hanging in front
      c.on('chest');
      b.box(-L.shW * 0.2, L.chestY + 1, L.chestD * 1.02 + 1, 4.2, 14, 1.4, 0.9);
      b.box(-L.shW * 0.06, L.chestY - 2, L.chestD * 1.02 + 0.6, 3.6, 12, 1.2, 0.9);
    }
  }
  // ---------------------------------------------------------------- hood / hats
  if (o.hood) hood(c, o.hood.mat, !!o.hood.dark);
  if (o.hat) hat(c, o.hat.kind, o.hat.mat, o.hat.band);
  if (o.vents) {
    c.on('chest').paint(o.vents);
    for (const s of [1, -1]) b.loft([{ c: [s * L.shW * 0.5, L.shoulderY, -L.chestD * 0.8], rx: 1.8, rz: 1.8 }, { c: [s * L.shW * 0.55, L.shoulderY + 9, -L.chestD * 0.9], rx: 1.5, rz: 1.5 }], 6);
  }
}

/** Front (side +1) / back (side -1) cloth panel weights: hips/chest above, skirt bones below. */
function panelW(c: Ctx, top: number, bottom: number, side: number): WeightFn {
  const tw = torsoW(c);
  const sk = c.bone[side > 0 ? 'skirtF' : 'skirtB']!;
  const H = c.bone.hips!;
  const hip = c.L.hipY + 2;
  return (p): Weights => {
    if (p.y > hip) return tw(p);
    const u = clamp01((hip - p.y) / Math.max(1, hip - bottom)) * 0.95;
    void top;
    return [
      [H, 1 - u],
      [sk, u],
    ];
  };
}

function skirt(c: Ctx, m: Mat, top: number, bottom: number, flare: number, split: boolean, tatter: boolean, lining?: Mat): void {
  const L = c.L;
  const b = c.b;
  const bel = L.belly;
  const seg = 12;
  const u0 = split ? 0.06 : 0;
  const u1 = split ? 0.94 : 1;
  const h = top - bottom;
  const folds = (u: number) => 1 + 0.06 * Math.sin(u * TAU * 6);
  const jag = tatter ? (u: number) => (Math.round(u * seg) % 2 ? 4.5 : -1) : undefined;
  const rx0 = L.hipW * 1.07 + bel * 4;
  const rz0 = L.chestD * 0.95 + bel * 6;
  const rings: Vec[][] = [];
  const steps = h > 60 ? 3 : 2;
  for (let k = steps; k >= 0; k--) {
    const t = k / steps; // 0 = top, 1 = bottom
    const y = top - h * t;
    const rx = rx0 + (L.hipW * 0.2 + flare * h * 0.22) * t + (y < L.hipY ? 2.2 : 0);
    const rz = rz0 + (flare * h * 0.2) * t + (y < L.hipY ? 2 : 0) - bel * 3 * t;
    rings.push(ell(0, y, 0.6 + bel * 3 * (1 - t), rx, rz, seg, u0, u1, t === 1 ? jag : undefined, t > 0 ? folds : undefined));
  }
  c.weights(skirtW(c, top, bottom)).paint(m);
  b.rings(rings, !split);
  // lining: darker inside (same rings, reversed winding, shrunk a hair)
  c.paint(lining ?? { c: shade(m.c, 0.62), k: m.k });
  b.rings(
    rings.map((r) => r.map((p) => [p[0] * 0.985, p[1], (p[2] - 0.6) * 0.985 + 0.6] as Vec).reverse()),
    !split,
  );
}

function cape(c: Ctx, m: Mat, len: number, tatter: boolean, short: boolean): void {
  const L = c.L;
  const b = c.b;
  const top = L.shoulderY + 1.5;
  const bottom = short ? L.chestY - 10 : Math.max(L.ankleY + 10, L.shoulderY - len * (L.shoulderY - L.ankleY) * 0.95);
  const seg = 10;
  const u0 = short ? 0 : 0.22;
  const u1 = short ? 1 : 0.78;
  const jag = tatter ? (u: number) => (Math.round(u * seg) % 2 ? 6 : -1) : undefined;
  const folds = (u: number) => 1 + 0.07 * Math.sin(u * TAU * 7 + 0.5);
  const rings: Vec[][] = [];
  const steps = short ? 1 : 3;
  for (let k = steps; k >= 0; k--) {
    const t = k / steps;
    const y = lerp(top, bottom, t);
    const rx = L.shW * (1.02 + t * 0.32);
    const rz = L.chestD * (1.12 + t * 0.4) + L.belly * 4 * t;
    rings.push(ell(0, y, -t * 4 - 0.5, rx, rz, seg, u0, u1, t === 1 ? jag : undefined, t > 0 ? folds : undefined));
  }
  // collar ring at the neck so the cape reads as hung from the shoulders
  c.weights(short ? torsoW(c) : capeW(c, top, bottom)).paint(m);
  b.rings(rings, short);
  c.paint({ c: shade(m.c, 0.6), k: m.k });
  b.rings(
    rings.map((r) => r.map((p) => [p[0] * 0.97, p[1], p[2] * 0.97] as Vec).reverse()),
    short,
  );
  c.on('chest').paint(m);
  b.loft([{ c: [0, L.shoulderY - 0.5, -0.8], rx: L.shW * 0.62, rz: L.chestD * 0.82 }, { c: [0, L.neckBase + 1, -1], rx: L.shW * 0.5, rz: L.chestD * 0.7 }], 8, false, false);
}

function hood(c: Ctx, m: Mat, dark: boolean): void {
  const L = c.L;
  const b = c.b;
  const r = L.headR;
  const hc: Vec = [0, L.headC, 0.6];
  c.on('head').paint(m);
  const k = dark ? 1.3 : 1.17;
  const open = dark ? 0.16 : 0.13;
  const rings: Vec[][] = [
    ell(hc[0], hc[1] - r * 1.05, hc[2] - r * 0.15, r * 1.0 * k, r * 0.98 * k, 10, open, 1 - open),
    ell(hc[0], hc[1] - r * 0.2, hc[2] - r * 0.06, r * 0.98 * k, r * 1.06 * k, 10, open, 1 - open),
    ell(hc[0], hc[1] + r * 0.5, hc[2] - r * 0.06, r * 0.86 * k, r * 0.98 * k, 10, open * 0.6, 1 - open * 0.6),
  ];
  b.rings(rings, false);
  b.rings(
    rings.map((rr) => rr.map((p) => [p[0] * 0.96, p[1], p[2] * 0.96] as Vec).reverse()),
    false,
  );
  // crown + slight peak at the back
  b.rings([ell(hc[0], hc[1] + r * 0.5, hc[2] - r * 0.06, r * 0.86 * k, r * 0.98 * k, 10), ell(hc[0], hc[1] + r * 1.05 * k, hc[2] - r * 0.3, r * 0.45 * k, r * 0.55 * k, 10)], true, false, false);
  b.geo(coneGeo(r * 0.4 * k, r * 0.8, 5), T(hc[0], hc[1] + r * 1.05 * k, hc[2] - r * 0.6, -1.2, 0, 0));
  if (dark) {
    c.paint('#120e18');
    b.box(hc[0], hc[1] - r * 0.15, hc[2] + r * 0.5, r * 1.5, r * 1.9, r * 0.4);
    c.paint('#d6caff', { glow: 1 });
    for (const s of [1, -1]) b.box(hc[0] + s * r * 0.32, hc[1] + r * 0.02, hc[2] + r * 0.74, r * 0.2, r * 0.09, 0.6);
  }
  // mantle on the shoulders
  c.weights(torsoW(c)).paint(m);
  b.rings(
    [
      ell(0, L.chestY - 4, 0, L.shW * 1.1, L.chestD * 1.24 + L.bust * 2, 10, 0, 1, (u) => Math.sin(u * TAU * 5) * 1.2 + (Math.abs(u - 0.5) < 0.2 ? -4 : 0)),
      ell(0, L.shoulderY + 0.5, -0.3, L.shW * 1.08, L.chestD * 1.08, 10),
      ell(0, L.neckBase + 2, -0.6, L.shW * 0.62, L.chestD * 0.78, 10),
    ],
    true,
  );
}

function hat(c: Ctx, kind: string, m: Mat, band?: Mat): void {
  const L = c.L;
  const b = c.b;
  const r = L.headR;
  const hc: Vec = [0, L.headC, 0.6];
  c.on('head').paint(m);
  switch (kind) {
    case 'wide': {
      b.loft([{ c: [hc[0], hc[1] + r * 0.45, hc[2] - 0.5], rx: r * 2.1, rz: r * 2.15, jag: (u) => 1 + 0.03 * Math.sin(u * TAU * 3) }, { c: [hc[0], hc[1] + r * 0.62, hc[2] - 0.5], rx: r * 1.9, rz: r * 1.95 }], 12);
      b.loft([{ c: [hc[0], hc[1] + r * 0.5, hc[2] - 0.6], rx: r * 0.92, rz: r * 0.98 }, { c: [hc[0], hc[1] + r * 1.45, hc[2] - 0.9], rx: r * 0.76, rz: r * 0.84 }], 8);
      if (band) {
        c.paint(band);
        b.loft([{ c: [hc[0], hc[1] + r * 0.62, hc[2] - 0.6], rx: r * 0.95, rz: r * 1.0 }, { c: [hc[0], hc[1] + r * 0.82, hc[2] - 0.65], rx: r * 0.93, rz: r * 0.98 }], 8, false, false);
      }
      break;
    }
    case 'tricorn': {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU;
        b.push(T(hc[0] + Math.sin(a) * r * 0.86, hc[1] + r * 0.72, hc[2] + Math.cos(a) * r * 0.86, 0, a, 0));
        b.plate(
          [
            [-r * 1.05, -r * 0.18],
            [r * 1.05, -r * 0.18],
            [r * 0.7, r * 0.42],
            [-r * 0.7, r * 0.42],
          ],
          r * 0.12,
          T(0, 0, 0, -0.35, 0, 0),
        );
        b.pop();
      }
      b.loft([{ c: [hc[0], hc[1] + r * 0.45, hc[2] - 0.5], rx: r * 0.95, rz: r * 1.0 }, { c: [hc[0], hc[1] + r * 1.25, hc[2] - 0.7], rx: r * 0.72, rz: r * 0.8 }], 8);
      if (band) {
        c.paint(band);
        b.blob([hc[0] + r * 0.6, hc[1] + r * 0.9, hc[2] + r * 0.6], [r * 0.16, r * 0.16, r * 0.16], 0);
      }
      break;
    }
    case 'cap': {
      b.blob([hc[0], hc[1] + r * 0.62, hc[2] + r * 0.08], [r * 1.0, r * 0.48, r * 1.12], 1);
      b.box(hc[0], hc[1] + r * 0.36, hc[2] + r * 0.98, r * 1.2, r * 0.1, r * 0.55, 1, 1);
      break;
    }
    case 'helm': {
      c.paint(m);
      b.rings([ell(hc[0], hc[1] + r * 0.18, hc[2], r * 1.08, r * 1.12, 10), ell(hc[0], hc[1] + r * 0.75, hc[2], r * 0.95, r * 0.98, 10), ell(hc[0], hc[1] + r * 1.18, hc[2] - 0.5, r * 0.5, r * 0.52, 10)], true, false, true);
      // kettle brim, sloping down
      b.rings([ell(hc[0], hc[1] - r * 0.1, hc[2], r * 1.85, r * 1.9, 10), ell(hc[0], hc[1] + r * 0.22, hc[2], r * 1.08, r * 1.12, 10)], true, false, false);
      b.rings([ell(hc[0], hc[1] + r * 0.22, hc[2], r * 1.06, r * 1.1, 10), ell(hc[0], hc[1] - r * 0.06, hc[2], r * 1.82, r * 1.86, 10)], true, false, false);
      if (band) {
        c.paint(band);
        b.loft([{ c: [hc[0], hc[1] + r * 0.2, hc[2]], rx: r * 1.12, rz: r * 1.16 }, { c: [hc[0], hc[1] + r * 0.42, hc[2]], rx: r * 1.08, rz: r * 1.12 }], 10, false, false);
      }
      break;
    }
    case 'veil': {
      // wimple around the face + veil over the crown falling to the shoulders
      c.paint(m);
      b.rings(
        [
          ell(hc[0], hc[1] - r * 1.25, hc[2] - r * 0.1, r * 0.9, r * 1.0, 10, 0, 1),
          ell(hc[0], hc[1] - r * 0.4, hc[2] - r * 0.05, r * 0.98, r * 1.08, 10, 0.1, 0.9),
          ell(hc[0], hc[1] + r * 0.35, hc[2] - r * 0.04, r * 0.98, r * 1.08, 10, 0.1, 0.9),
        ].map((x, i) => (i === 0 ? x.slice(1, 10).concat([]) : x)).slice(1),
        false,
      );
      b.rings([ell(hc[0], hc[1] + r * 0.35, hc[2] - r * 0.05, r * 1.02, r * 1.1, 10), ell(hc[0], hc[1] + r * 1.12, hc[2] - r * 0.2, r * 0.6, r * 0.7, 10)], true, false, true);
      c.weights(capeW(c, L.headC + r, L.shoulderY - 18)).paint(m);
      b.rings(
        [
          ell(0, L.shoulderY - 16, -L.chestD * 0.6, L.shW * 0.85, L.chestD * 1.05, 10, 0.22, 0.78),
          ell(0, L.neckBase, -1, L.shW * 0.72, L.chestD * 1.0, 10, 0.2, 0.8),
          ell(hc[0], hc[1] + r * 0.4, hc[2] - r * 0.1, r * 1.04, r * 1.12, 10, 0.18, 0.82),
        ],
        false,
      );
      c.on('chest');
      b.rings([ell(0, L.shoulderY - 3, 0.3, L.shW * 0.72, L.chestD * 1.06, 10), ell(0, L.neckBase + 3, 0, L.shW * 0.45, L.chestD * 0.75, 10)], true);
      if (band) {
        c.on('head').paint(band);
        b.loft([{ c: [hc[0], hc[1] + r * 0.36, hc[2] - 0.2], rx: r * 1.02, rz: r * 1.1 }, { c: [hc[0], hc[1] + r * 0.58, hc[2] - 0.3], rx: r * 1.0, rz: r * 1.08 }], 10, false, false);
      }
      break;
    }
    case 'goggles': {
      c.paint(m);
      b.loft([{ c: [hc[0], hc[1] + r * 0.36, hc[2] - 0.3], rx: r * 0.9, rz: r * 0.99 }, { c: [hc[0], hc[1] + r * 0.6, hc[2] - 0.4], rx: r * 0.86, rz: r * 0.96 }], 8, false, false);
      for (const s of [1, -1]) {
        c.paint(band ?? { c: '#c9973f', k: 'metal' });
        b.push(T(hc[0] + s * r * 0.36, hc[1] + r * 0.56, hc[2] + r * 0.82, Math.PI / 2 - 0.5, 0, 0));
        b.loft([{ c: [0, -r * 0.05, 0], rx: r * 0.28, rz: r * 0.28 }, { c: [0, r * 0.25, 0], rx: r * 0.26, rz: r * 0.26 }], 6);
        b.pop();
        c.paint('#9fc4c8', { metal: 0.9 });
        b.push(T(hc[0] + s * r * 0.36, hc[1] + r * 0.6, hc[2] + r * 0.93, Math.PI / 2 - 0.5, 0, 0));
        b.loft([{ c: [0, 0.1, 0], rx: r * 0.2, rz: r * 0.2 }, { c: [0, r * 0.22, 0], rx: r * 0.19, rz: r * 0.19 }], 6);
        b.pop();
      }
      break;
    }
    case 'band': {
      b.loft([{ c: [hc[0], hc[1] + r * 0.36, hc[2] - 0.3], rx: r * 0.9, rz: r * 0.99 }, { c: [hc[0], hc[1] + r * 0.56, hc[2] - 0.4], rx: r * 0.87, rz: r * 0.96 }], 8, false, false);
      break;
    }
    case 'kerchief': {
      b.blob([hc[0], hc[1] + r * 0.45, hc[2] - r * 0.1], [r * 0.98, r * 0.62, r * 1.05], 1);
      b.blob([hc[0], hc[1] + r * 0.1, hc[2] - r * 1.0], [r * 0.25, r * 0.2, r * 0.2], 0);
      break;
    }
    case 'bearhood':
    case 'wolfhood': {
      const bear = kind === 'bearhood';
      const k = bear ? 1.25 : 1.12;
      c.paint(m);
      // animal skull over the head
      b.rings(
        [
          ell(hc[0], hc[1] + r * 0.1, hc[2] - r * 0.1, r * 1.05 * k, r * 1.08 * k, 10),
          ell(hc[0], hc[1] + r * 0.75, hc[2] - r * 0.05, r * 0.95 * k, r * 1.02 * k, 10),
          ell(hc[0], hc[1] + r * 1.25 * k, hc[2] - r * 0.15, r * 0.45 * k, r * 0.55 * k, 10),
        ],
        true,
        false,
        true,
      );
      // snout over the forehead
      const sn: Vec = [hc[0], hc[1] + r * 0.65, hc[2] + r * 1.05];
      b.push(T(sn[0], sn[1], sn[2], Math.PI / 2 + 0.25, 0, 0));
      b.loft([{ c: [0, -r * 0.4, 0], rx: r * 0.55 * k, rz: r * 0.42 * k }, { c: [0, r * (bear ? 0.55 : 0.85), 0], rx: r * 0.32 * k, rz: r * 0.26 * k }], 6);
      b.pop();
      c.paint('#1a1420');
      b.box(sn[0], sn[1] + r * 0.02 - (bear ? r * 0.12 : r * 0.22), sn[2] + r * (bear ? 0.65 : 0.92), r * 0.32, r * 0.2, r * 0.2);
      c.paint('#e8dcc0');
      for (const s of [1, -1]) b.geo(coneGeo(r * 0.07, r * 0.28, 4), T(sn[0] + s * r * 0.22, sn[1] - r * 0.35, sn[2] + r * 0.3, Math.PI, 0, 0));
      c.paint(m);
      for (const s of [1, -1]) {
        if (bear) b.blob([hc[0] + s * r * 0.85, hc[1] + r * 1.15, hc[2] - r * 0.15], [r * 0.3, r * 0.3, r * 0.18], 0);
        else b.geo(coneGeo(r * 0.3, r * 0.85, 4), T(hc[0] + s * r * 0.55, hc[1] + r * 1.35, hc[2] - r * 0.1, -0.1, 0, s * -0.25));
      }
      c.paint('#e8c060');
      for (const s of [1, -1]) b.box(hc[0] + s * r * 0.36, hc[1] + r * 0.82, hc[2] + r * 0.98, r * 0.14, r * 0.08, r * 0.1);
      // hide falling over the back + paws over the shoulders
      c.weights(capeW(c, L.headC, L.chestY - 10)).paint(m);
      b.rings(
        [
          ell(0, L.chestY - 12, -L.chestD * 0.4, L.shW * 1.05, L.chestD * 1.25, 10, 0.18, 0.82, (u) => (Math.round(u * 10) % 2 ? 3 : 0)),
          ell(0, L.shoulderY + 1, -0.5, L.shW * 1.05, L.chestD * 1.12, 10, 0.16, 0.84),
          ell(hc[0], hc[1] + r * 0.2, hc[2] - r * 0.1, r * 1.0 * k, r * 1.05 * k, 10, 0.15, 0.85),
        ],
        false,
      );
      c.on('chest').paint(m);
      for (const s of [1, -1]) b.blob([s * L.shW * 0.55, L.shoulderY - 6, L.chestD * 0.95], [4.5, 9, 3], 0);
      break;
    }
  }
}
