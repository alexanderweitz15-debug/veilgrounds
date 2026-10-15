// Minion sprites (style C "Gouache-Dämmerung"), baked with the champion pipeline into their own atlas.
// Four kinds per team, team baked into colour AND shape (docs/style-variants.md, variant C):
//   team 0 Lichtwerk (blue): dome helm + hammer + round brass shield; lantern-staff caster; copper cart with a
//          lens cannon; brass colossus with a boiler belly.
//   team 1 Aschehalle (red): wedge helm + tower shield + cleaver; stoker with a coal brazier on a staff; angular
//          mortar with a chimney and hex wheels; soot brute with a furnace hump and chimney horns.
// Melee/caster/super are humanoid kits (same rig, poses and painter as the champions); siege is a custom drawer.
import { at, frameYZ, frameZY, INK, lerp3, m, madd, mix, norm, ring, scl, sub, TAU, type Basis, type Mat, type Painter, type Stage, type V3 } from './core';
import { aimLW, aimW, backFrame, cyl, disc, glowOrb, heldBlade, ribbon, WOOD, WOOD_DARK } from './props';
import type { Anim, Kit, PropCtx } from './types';
import type { SpriteDrawer } from './atlas';

export const MINION_KINDS = ['melee', 'caster', 'siege', 'super'] as const;
export type MinionKind = (typeof MINION_KINDS)[number];
/** Atlas id of a minion sprite: kind + team (0 = Lichtwerk/blue, 1 = Aschehalle/red). */
export const minionId = (kind: MinionKind, team: number): string => `${kind}${Math.min(1, Math.max(0, team))}`;
export const MINION_IDS: string[] = MINION_KINDS.flatMap((k) => [minionId(k, 0), minionId(k, 1)]);

interface TeamLook {
  cloth: string;
  clothDark: string;
  trim: Mat;
  metal: Mat;
  metal2: Mat;
  glow: string;
  skin: string;
}
const cloth = (c: string): Mat => m(c, 'cloth');
const leather = (c = '#6a4630'): Mat => m(c, 'leather');
const metal = (c: string): Mat => m(c, 'metal');
const LOOK: [TeamLook, TeamLook] = [
  {
    cloth: '#3f66ad',
    clothDark: '#2b3f68',
    trim: cloth('#ddd0b2'),
    metal: metal('#c9973f'),
    metal2: metal('#b0683c'),
    glow: '#a8dcff',
    skin: '#ddb08a',
  },
  {
    cloth: '#a8382a',
    clothDark: '#5a221c',
    trim: cloth('#34313a'),
    metal: metal('#5d6470'),
    metal2: metal('#3e3c44'),
    glow: '#ff7a3a',
    skin: '#c08a62',
  },
];
const LEATHER_DARK = leather('#4a3224');
const NO_CAST: Partial<Record<Anim, number>> = { cast: 0 };

// ------------------------------------------------------------------------------------------------ props
/** Ring with a hole whose axis is the frame's z (wheels, lens rims, cages): hull of two discs ± depth. */
function hoop(st: Stage, p: Painter, f: Basis, rOut: number, rIn: number, mat: Mat, depth = 3): void {
  const outer = st.hull([...disc({ ...f, o: madd(f.o, f.z, -depth) }, rOut, 24), ...disc({ ...f, o: madd(f.o, f.z, depth) }, rOut, 24)]);
  const near = st.faces(f.z) >= 0 ? depth : -depth;
  const inner = st.pts2(disc({ ...f, o: madd(f.o, f.z, near) }, rIn, 20));
  const path = new Path2D();
  path.addPath(outer.path);
  inner.forEach((q, i) => (i ? path.lineTo(q.x, q.y) : path.moveTo(q.x, q.y)));
  path.closePath();
  p.fill({ ...outer, path }, mat, { rule: 'evenodd' });
}

/** Lichtwerk: round brass shield with a team-coloured face and a boss. */
function roundShield(c: PropCtx, t: TeamLook): void {
  const { st, rig } = c;
  const n = aimLW(c);
  const f = frameZY(madd(rig.handL.o, n, 5), n, rig.chest.y);
  const R = 18;
  st.add(madd(f.o, n, 6), 3.8, (p) => {
    const front = disc({ ...f, o: madd(f.o, f.z, 3) }, R, 24);
    const back = disc({ ...f, o: madd(f.o, f.z, -2) }, R * 0.95, 24);
    p.fill(st.hull([...front, ...back]), t.metal);
    if (st.faces(f.z) <= 0.02) return;
    p.fill(st.hull(disc({ ...f, o: madd(f.o, f.z, 3.6) }, R * 0.78, 22)), cloth(t.cloth), { lw: 1.3 });
    // sun rays painted on the face
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      p.line(st.pts2([at(f, [Math.cos(a) * R * 0.34, Math.sin(a) * R * 0.34, 3.8]), at(f, [Math.cos(a) * R * 0.7, Math.sin(a) * R * 0.7, 3.8])]), mix(t.cloth, '#f2dfbd', 0.55), 1.4);
    }
    p.fill(st.hull([...disc({ ...f, o: madd(f.o, f.z, 3.8) }, R * 0.3, 12), ...disc({ ...f, o: madd(f.o, f.z, 8) }, R * 0.12, 8)]), t.metal, { lw: 1.3 });
  });
}

/** Aschehalle: tall iron-banded tower shield with a red stripe and corner spikes. */
function towerShield(c: PropCtx, t: TeamLook): void {
  const { st, rig } = c;
  const n = aimLW(c);
  const f = frameZY(madd(rig.handL.o, n, 4), n, rig.chest.y);
  st.add(madd(f.o, n, 6), 3.8, (p) => {
    const w = 14;
    const h = 25;
    const face: V3[] = [at(f, [-w, h, 0]), at(f, [0, h + 4, 0]), at(f, [w, h, 0]), at(f, [w, -h + 4, 0]), at(f, [0, -h - 5, 0]), at(f, [-w, -h + 4, 0])];
    const backFace = face.map((q) => madd(q, f.z, -4));
    p.fill(st.hull([...face, ...backFace]), t.metal2, { lw: 1.6 });
    if (st.faces(f.z) <= 0.02) return;
    p.fill(st.poly(face), m('#4a4248', 'wood'), { grain: { x: 0, y: 1 } });
    p.fill(st.poly([at(f, [-4, h + 2.5, 0.4]), at(f, [4, h + 2.5, 0.4]), at(f, [4, -h - 2, 0.4]), at(f, [0, -h - 4, 0.4]), at(f, [-4, -h - 2, 0.4])]), cloth(t.cloth), { lw: 1.2 });
    for (const y of [h - 6, -h + 9]) p.fill(st.poly([at(f, [-w, y + 2.5, 0.6]), at(f, [w, y + 2.5, 0.6]), at(f, [w, y - 2.5, 0.6]), at(f, [-w, y - 2.5, 0.6])]), t.metal, { lw: 1.2 });
    for (const [x, y] of [
      [-w, h],
      [w, h],
    ] as const) {
      p.fill(st.poly([at(f, [x * 0.8, y - 2, 0.5]), at(f, [x * 1.25, y + 6, 1.5]), at(f, [x * 0.95, y - 7, 0.5])]), t.metal, { lw: 1.2 });
    }
  });
}

/** One-handed hammer: wooden haft, metal head. */
function hammer(c: PropCtx, head: Mat, len = 30): void {
  const { st, rig } = c;
  const dir = aimW(c);
  const a = madd(rig.handR.o, dir, -7);
  const b = madd(rig.handR.o, dir, len);
  st.add(lerp3(a, b, 0.5), 3.3, (p) => p.fill(st.capsule(a, b, 2.2, 2), WOOD, { grain: { x: b[0] - a[0], y: -(b[1] - a[1]) }, lw: 1.5 }));
  const hf = frameYZ(b, dir, rig.chest.z);
  st.add(b, 3.45, (p) => {
    p.fill(st.hull([...ring(frameZY(at(hf, [0, 0, -9]), hf.z, hf.y), 0, 5.5, 5.5, 8), ...ring(frameZY(at(hf, [0, 0, 10]), hf.z, hf.y), 0, 6.5, 6.5, 8)]), head);
    p.fill(st.hull([...ring(frameZY(at(hf, [0, 0, 9]), hf.z, hf.y), 0, 7, 7, 8), ...ring(frameZY(at(hf, [0, 0, 11.5]), hf.z, hf.y), 0, 7, 7, 8)]), metal('#8a5a34'), { lw: 1.2 });
  });
}

/** Aschehalle wedge helm: angular, ridged, with a nose guard and a red crest. */
function wedgeHelm(c: PropCtx, t: TeamLook): void {
  const { st, rig } = c;
  const H = rig.head;
  const r = rig.body.headR;
  st.add(H.o, 0.75, (p) => {
    const pts: V3[] = [
      at(H, [0, r * 1.62, r * 0.25]),
      at(H, [0, r * 1.25, -r * 1.2]),
      at(H, [r * 1.12, r * 0.42, r * 0.55]),
      at(H, [-r * 1.12, r * 0.42, r * 0.55]),
      at(H, [r * 1.2, r * 0.05, -r * 0.55]),
      at(H, [-r * 1.2, r * 0.05, -r * 0.55]),
      at(H, [r * 1.08, -r * 0.55, -r * 0.95]),
      at(H, [-r * 1.08, -r * 0.55, -r * 0.95]),
      at(H, [r * 0.9, r * 0.3, r * 1.08]),
      at(H, [-r * 0.9, r * 0.3, r * 1.08]),
      at(H, [0, r * 0.55, r * 1.32]),
    ];
    p.fill(st.hull(pts), t.metal);
    // ridge + crest
    const crest: V3[] = [at(H, [0, r * 1.6, r * 0.4]), at(H, [0, r * 2.05, -r * 0.2]), at(H, [0, r * 1.9, -r * 0.9]), at(H, [0, r * 1.3, -r * 1.25])];
    p.fill(ribbon(st, crest, r * 0.5, r * 0.3), cloth(t.cloth), { lw: 1.3 });
    if (st.faces(H.z) > -0.2) {
      p.fill(st.poly([at(H, [r * 0.22, r * 0.5, r * 1.3]), at(H, [-r * 0.22, r * 0.5, r * 1.3]), at(H, [0, -r * 0.45, r * 1.25])]), t.metal, { lw: 1.2 });
      // eye slit shadow under the brow
      p.line(st.pts2([at(H, [r * 0.85, r * 0.28, r * 1.02]), at(H, [0, r * 0.18, r * 1.2]), at(H, [-r * 0.85, r * 0.28, r * 1.02])]), INK, 1.6);
    }
  });
}

/** Caster staff: Lichtwerk lantern cage with a cool orb, Aschehalle coal brazier with embers. */
function casterStaff(c: PropCtx, t: TeamLook, light: boolean): void {
  const { st, rig, pose } = c;
  const dir = aimW(c);
  const a = madd(rig.handR.o, dir, -42);
  const b = madd(rig.handR.o, dir, 64);
  const shaft = light ? WOOD : m('#3a3436', 'wood');
  st.add(lerp3(a, b, 0.5), 3.25, (p) => p.fill(st.capsule(a, b, 2.2, 2), shaft, { grain: { x: b[0] - a[0], y: -(b[1] - a[1]) }, lw: 1.5 }));
  const f = frameYZ(b, dir, rig.chest.z);
  const power = 0.55 + pose.glow * 0.6;
  st.add(b, 3.4, (p) => {
    if (light) {
      p.fill(st.hull([...ring(f, -3, 3.5, 3.5, 8), ...ring(f, 2, 5.5, 5.5, 10)]), t.metal, { lw: 1.3 });
      const o = at(f, [0, 12, 0]);
      glowOrb(st, p, o, 5.5, t.glow, power);
      hoop(st, p, frameZY(o, f.x, f.y), 10, 8, t.metal, 1.2);
      hoop(st, p, frameZY(o, f.z, f.y), 10, 8, t.metal, 1.2);
      p.fill(st.hull([...ring(f, 21, 3, 3, 8), ...ring(f, 25, 1.2, 1.2, 6)]), t.metal, { lw: 1.2 });
    } else {
      // brazier bowl on three prongs
      for (const ang of [0, 2.1, 4.2]) p.line(st.pts2([at(f, [0, -2, 0]), at(f, [Math.sin(ang) * 8, 7, Math.cos(ang) * 8])]), mix(t.metal.c, '#000000', 0.3), 2);
      p.fill(st.hull([...ring(f, 6, 7, 7, 10), ...ring(f, 13, 10.5, 10.5, 12)]), t.metal);
      for (const [x, z] of [
        [-4, 2],
        [3, -3],
        [2, 4],
      ] as const)
        p.fill(st.sphere(at(f, [x, 14, z]), 3.4), m('#2a2628', 'stone'), { lw: 1 });
      // flame tongues (opaque glow, alphaTest friendly)
      const fl = (dx: number, hgt: number, w: number) =>
        p.fill(st.poly([at(f, [dx - w, 13, 0]), at(f, [dx - w * 0.3, 13 + hgt * 0.6, 0]), at(f, [dx + w * 0.2, 13 + hgt, 0]), at(f, [dx + w, 13, 0])], true), m(t.glow, 'glow'), { lw: 1 });
      const flick = (pose.frame % 2) * 2;
      fl(0, 13 + flick + pose.glow * 8, 5);
      fl(-4, 8 - flick * 0.5, 3);
      fl(4, 9 + flick * 0.5, 3);
      glowOrb(st, p, at(f, [0, 17, 0]), 3.5, '#ffd27a', power);
    }
  });
}

/** Oversized gauntlet fists (super minions). */
function bigFists(c: PropCtx, t: TeamLook, light: boolean): void {
  const { st, rig } = c;
  for (const [hand, el] of [
    [rig.handL, rig.elL],
    [rig.handR, rig.elR],
  ] as const) {
    st.add(madd(hand.o, hand.y, 2), 3.75, (p) => {
      const cuff = frameYZ(lerp3(el, hand.o, 0.5), sub(hand.o, el), rig.chest.z);
      p.fill(st.hull([...ring(cuff, -5, 8.5, 8.5, 10), ...ring(cuff, 12, 12.5, 12.5, 10)]), light ? t.metal2 : t.metal);
      const g = st.hull([...ring(hand, -2, 13, 11.5, 10), ...ring(hand, 8, 14.5, 12.5, 10), ...ring(hand, 16, 11.5, 10.5, 10)]);
      p.fill(g, t.metal);
      for (let i = -1; i <= 1; i++) {
        const q = at(hand, [i * 7, 16, 7]);
        if (light) p.fill(st.sphere(q, 3.6), t.metal2, { lw: 1.1 });
        else p.fill(st.poly([madd(q, hand.x, -3), madd(madd(q, hand.y, 7), hand.z, 2), madd(q, hand.x, 3)]), t.metal2, { lw: 1.1 });
      }
    });
  }
}

/** Lichtwerk colossus: glowing boiler porthole on the belly + copper tank on the back. */
function boilerBelly(c: PropCtx, t: TeamLook): void {
  const { st, rig, pose } = c;
  const ch = rig.chest;
  const nrm = ch.z;
  const o = at(ch, [0, -8, rig.body.chestD + rig.body.belly * 7 + 3]);
  st.add(madd(o, nrm, 2), 1.2, (p) => {
    if (st.faces(nrm) < 0.05) return;
    const f = frameZY(o, nrm, ch.y);
    hoop(st, p, f, 10, 7, t.metal2, 1.5);
    p.fill(st.hull(disc({ ...f, o: madd(f.o, f.z, 0.5) }, 7, 14)), m(t.glow, 'glass'), { lw: 1.2 });
    glowOrb(st, p, madd(f.o, f.z, 1), 2.6, t.glow, 0.5 + pose.glow * 0.5);
  });
  const bk = backFrame(rig, 2, 4);
  st.add(madd(bk.o, bk.z, 8), 0.1, (p) => {
    const tank = frameYZ(madd(bk.o, bk.z, 9), bk.y, bk.z);
    p.fill(cyl(st, tank, -20, 20, 13, 13), t.metal2);
    for (const y of [-12, 12]) p.fill(st.hull([...ring(tank, y - 1.6, 13.6, 13.6, 14), ...ring(tank, y + 1.6, 13.6, 13.6, 14)]), t.metal, { lw: 1.1 });
    for (const s of [1, -1]) {
      const p0 = at(tank, [s * 7, 18, 4]);
      const p1 = at(tank, [s * 9, 30, 2]);
      p.fill(st.capsule(p0, p1, 2.6, 2.4), t.metal, { lw: 1.2 });
      glowOrb(st, p, madd(p1, tank.y, 2), 2, t.glow, 0.45);
    }
  });
}

/** Aschehalle brute: furnace hump on the back with a glowing grate, two chimney horns. */
function furnaceHump(c: PropCtx, t: TeamLook): void {
  const { st, rig, pose } = c;
  const bk = backFrame(rig, 4, 3);
  st.add(madd(bk.o, bk.z, 10), 0.1, (p) => {
    const f = frameYZ(madd(bk.o, bk.z, 10), bk.y, bk.z);
    const hump: V3[] = [];
    for (const [x, y, z] of [
      [16, -14, -6],
      [-16, -14, -6],
      [18, 10, -6],
      [-18, 10, -6],
      [12, 22, -4],
      [-12, 22, -4],
      [14, -12, 10],
      [-14, -12, 10],
      [12, 14, 12],
      [-12, 14, 12],
    ] as const)
      hump.push(at(f, [x, y, z]));
    p.fill(st.hull(hump), t.metal2);
    if (st.faces(f.z) > 0.05) {
      const g = [at(f, [-8, 6, 12.5]), at(f, [8, 6, 12.5]), at(f, [8, -6, 11.5]), at(f, [-8, -6, 11.5])];
      p.fill(st.poly(g), m(t.glow, 'glow'), { lw: 1.4 });
      for (const x of [-4, 0, 4]) p.line(st.pts2([at(f, [x, 6, 12.7]), at(f, [x, -6, 11.7])]), INK, 1.4);
    }
    for (const s of [1, -1]) {
      const base = at(f, [s * 11, 18, 0]);
      const top = at(f, [s * 19, 46, -4]);
      p.fill(st.capsule(base, lerp3(base, top, 0.6), 4.2, 3.6), t.metal);
      p.fill(st.capsule(lerp3(base, top, 0.55), top, 3.8, 4.4), t.metal);
      const cap = frameYZ(top, norm(sub(top, base)), f.z);
      p.fill(st.hull([...ring(cap, -1, 5.2, 5.2, 8), ...ring(cap, 2, 5.2, 5.2, 8)]), t.metal2, { lw: 1.2 });
      glowOrb(st, p, at(cap, [0, 3, 0]), 2.2, t.glow, 0.5 + pose.glow * 0.4 + (pose.frame % 2) * 0.15);
    }
  });
}

// ------------------------------------------------------------------------------------------------ kits
function meleeKit(team: 0 | 1): Kit {
  const t = LOOK[team];
  const light = team === 0;
  return {
    id: minionId('melee', team),
    name: light ? 'Lichtwerk-Wache' : 'Aschehalle-Wache',
    world: 150,
    ink: 1.45,
    frames: NO_CAST,
    look: light ? 'dome helm, blue surcoat, brass round shield, hammer' : 'wedge helm, red surcoat over mail, tower shield, cleaver',
    feature: light ? 'round shield' : 'tower shield',
    body: { H: 164, headR: 14.8, shW: 21, hipW: 14.5, chestD: 11.5, girth: 1.14, stance: 9.5, legs: 0.46 },
    outfit: {
      skin: t.skin,
      top: cloth(t.cloth),
      sleeves: light ? t.trim : cloth('#3a3840'),
      forearms: leather(),
      hands: LEATHER_DARK,
      legs: cloth(t.clothDark),
      boots: LEATHER_DARK,
      bootH: 0.6,
      coat: light ? { mat: cloth(t.cloth), len: 0.55, flare: 0.35, collar: t.trim } : { mat: metal('#6a6e78'), len: 0.6, flare: 0.4 },
      tabard: light ? undefined : cloth(t.cloth),
      belt: { mat: leather(), buckle: t.metal },
      pauldrons: { mat: t.metal, size: light ? 0.75 : 0.85, spikes: !light },
      hat: light ? { kind: 'helm', mat: t.metal, band: t.metal2 } : undefined,
      hair: { style: 'none', mat: m('#2a2026', 'hair') },
      face: { brows: 1.3 },
    },
    hold: 'shield',
    attack: 'bash',
    cast: 'slam',
    props: light ? [(c) => roundShield(c, t), (c) => hammer(c, t.metal)] : [(c) => wedgeHelm(c, t), (c) => towerShield(c, t), (c) => heldBlade(c, { len: 28, w: 12, curve: 0.5, mat: metal('#8a909a') })],
  };
}

function casterKit(team: 0 | 1): Kit {
  const t = LOOK[team];
  const light = team === 0;
  return {
    id: minionId('caster', team),
    name: light ? 'Lichtwerk-Laternenträger' : 'Aschehalle-Heizer',
    world: 148,
    ink: 1.45,
    frames: NO_CAST,
    look: light ? 'lantern bearer in a blue robe and wide-brimmed hat, staff with a brass cage around a cold light orb' : 'soot-striped stoker in a head scarf and red-soot robe and leather apron, staff with a coal brazier',
    feature: light ? 'lantern-cage staff' : 'brazier staff',
    body: { H: 160, headR: 14.6, shW: 18.5, hipW: 14.5, chestD: 10.5, girth: 1.02, stance: 8.5, legs: 0.46 },
    outfit: {
      skin: t.skin,
      top: light ? t.trim : cloth('#3a3438'),
      sleeves: cloth(t.cloth),
      forearms: cloth(t.cloth),
      hands: light ? leather() : LEATHER_DARK,
      legs: cloth(t.clothDark),
      boots: LEATHER_DARK,
      coat: { mat: cloth(t.cloth), len: 1.35, flare: 0.6, open: light ? t.trim : cloth('#3a3438'), split: !light, tatter: !light },
      apron: light ? undefined : { mat: leather('#5a4232'), len: 0.9 },
      belt: { mat: light ? cloth('#ddd0b2') : leather(), buckle: t.metal },
      hat: light ? { kind: 'wide', mat: cloth(t.clothDark), band: t.metal } : { kind: 'kerchief', mat: cloth(t.clothDark) },
      hair: { style: light ? 'short' : 'crop', mat: m(light ? '#8a6a48' : '#2a2026', 'hair') },
      face: light ? { brows: 1.1 } : { brows: 1.4, paint: '#2a2224' },
    },
    hold: 'pole',
    attack: 'staff',
    cast: 'raise',
    props: [(c) => casterStaff(c, t, light)],
  };
}

function superKit(team: 0 | 1): Kit {
  const t = LOOK[team];
  const light = team === 0;
  return {
    id: minionId('super', team),
    name: light ? 'Messing-Koloss' : 'Rußbrut',
    world: 222,
    ink: 1.1,
    frames: NO_CAST,
    look: light ? 'huge brass-armoured colossus, boiler belly with a glowing porthole, copper tank on the back, giant brass fists' : 'hulking soot brute, iron plate, furnace hump with a glowing grate and two chimney horns, spiked iron fists',
    feature: light ? 'boiler belly' : 'furnace hump + chimney horns',
    body: { H: 182, headR: 14.5, shW: 29, hipW: 18, chestD: 15, girth: 1.4, belly: light ? 0.9 : 0.5, hunch: light ? 0.05 : 0.22, stance: 13, legs: 0.42 },
    outfit: {
      skin: light ? t.skin : '#9a7e6c',
      top: cloth(t.cloth),
      sleeves: cloth(t.clothDark),
      forearms: t.metal,
      hands: t.metal,
      legs: cloth(light ? '#3a3438' : '#2e2c33'),
      boots: light ? t.metal2 : t.metal,
      bootH: 0.7,
      plate: t.metal,
      coat: { mat: cloth(t.cloth), len: 0.55, flare: 0.5, tatter: !light },
      belt: { mat: LEATHER_DARK, buckle: t.metal },
      pauldrons: { mat: t.metal, size: 1.5, spikes: !light },
      hat: light ? { kind: 'helm', mat: t.metal, band: t.metal2 } : undefined,
      hair: { style: light ? 'none' : 'crop', mat: m('#1e1a1c', 'hair') },
      beard: light ? undefined : { style: 'full', mat: m('#1e1a1c', 'hair') },
      face: light ? { brows: 1.5 } : { brows: 1.8, scar: true, paint: '#2a2224' },
    },
    hold: 'fists',
    attack: 'swipe',
    cast: 'slam',
    gait: 'heavy',
    props: light ? [(c) => boilerBelly(c, t), (c) => bigFists(c, t, true)] : [(c) => furnaceHump(c, t), (c) => bigFists(c, t, false)],
  };
}

export const MINION_KITS: Kit[] = [meleeKit(0), meleeKit(1), casterKit(0), casterKit(1), superKit(0), superKit(1)];

// ------------------------------------------------------------------------------------------------ siege cart (custom drawer)
/** the cart is modelled at ~champion scale; drawn larger so it fills the cell like the humanoids */
const CART_SCALE = 1.45;
const SIEGE_FRAMES: Record<Anim, number> = { idle: 4, run: 6, attack: 4, cast: 0, death: 3 };

function siegeDrawer(team: 0 | 1): SpriteDrawer {
  const t = LOOK[team];
  const light = team === 0;
  return {
    world: 190,
    foot: 0.8,
    ink: 1.3,
    frames: SIEGE_FRAMES,
    draw: (st, p, anim, frame) => drawCart(st, p, anim, frame, t, light),
  };
}

function drawCart(st: Stage, p: Painter, anim: Anim, frame: number, t: TeamLook, light: boolean): void {
  st.view.k *= CART_SCALE;
  const n = Math.max(1, SIEGE_FRAMES[anim]);
  const u = (frame % n) / n;
  let bob = 0;
  let roll = 0;
  let sink = 0;
  let wheelA = 0;
  let recoil = 0;
  let flash = 0;
  let pitchUp = 0;
  let smoke = 0;
  let lostWheel = false;
  if (anim === 'idle') {
    bob = Math.sin(u * TAU) * 0.6;
    smoke = u;
  } else if (anim === 'run') {
    bob = Math.abs(Math.sin(u * TAU * 2)) * 1.6;
    wheelA = u * (TAU / 6) * (light ? 1 : 1);
    smoke = u;
  } else if (anim === 'attack') {
    pitchUp = [0.05, 0.1, 0.08, 0.02][frame % 4]!;
    recoil = [0, 9, 5, 1][frame % 4]!;
    flash = [0, 1, 0.35, 0][frame % 4]!;
    bob = [0, -1.5, -0.8, 0][frame % 4]!;
    smoke = 0.5;
  } else if (anim === 'death') {
    roll = [0.12, 0.32, 0.5][frame % 3]!;
    sink = [2, 7, 12][frame % 3]!;
    lostWheel = frame % 3 >= 1;
    smoke = 1;
  }
  // cart basis (x = left, y = up, z = forward), rolled about the forward axis when wrecked
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const C: Basis = { o: [0, bob - sink, 0], x: [cr, sr, 0], y: [-sr, cr, 0], z: [0, 0, 1] };
  const W = 30; // half track width
  const L = 40; // half wheelbase
  const wr = 17; // wheel radius
  const axleY = wr;
  // wheels
  const wheels: { x: number; z: number }[] = [
    { x: W, z: L },
    { x: -W, z: L },
    { x: W, z: -L },
    { x: -W, z: -L },
  ];
  wheels.forEach((w, i) => {
    if (lostWheel && i === 1) return;
    const c = at(C, [w.x + Math.sign(w.x) * 3, axleY, w.z]);
    const side = Math.sign(w.x);
    st.add(c, side * 0.5, (pp) => drawWheel(st, pp, frameZY(c, scl(C.x, side), C.y), wr, wheelA + i * 0.4, t, light));
  });
  // body
  const bodyC = at(C, [0, axleY + 16, 0]);
  st.add(bodyC, 0, (pp) => {
    if (light) {
      const B = frameYZ(bodyC, C.z, C.y); // y along the cart, z up
      const tub = [...ring(B, -52, 22, 14, 14, 2), ...ring(B, -44, 27, 20, 16, 2), ...ring(B, 40, 27, 20, 16, 2), ...ring(B, 52, 22, 13, 14, 2)];
      pp.fill(st.hull(tub), t.metal2);
      // brass bands
      for (const y of [-30, 0, 30]) pp.fill(st.hull([...ring(B, y - 2.2, 27.5, 20.5, 16, 2), ...ring(B, y + 2.2, 27.5, 20.5, 16, 2)]), t.metal, { lw: 1.2 });
    } else {
      const pts: V3[] = [];
      for (const [x, y, z] of [
        [26, -14, 50],
        [-26, -14, 50],
        [28, -14, -50],
        [-28, -14, -50],
        [22, 12, 44],
        [-22, 12, 44],
        [24, 16, -48],
        [-24, 16, -48],
        [16, 20, 30],
        [-16, 20, 30],
        [0, -16, 56],
      ] as const)
        pts.push(at(C, [x, axleY + 16 + y, z]));
      pp.fill(st.hull(pts), t.metal2);
      for (const z of [-28, 6, 34]) {
        const band = [at(C, [29, axleY + 2, z - 3]), at(C, [-29, axleY + 2, z - 3]), at(C, [24, axleY + 34, z - 3]), at(C, [-24, axleY + 34, z - 3])];
        pp.fill(st.hull([...band, ...band.map((q) => madd(q, C.z, 6))]), t.metal, { lw: 1.2 });
      }
    }
  });
  // team cloth draped over each side (only the side facing the camera)
  for (const side of [1, -1]) {
    const nrm = scl(C.x, side);
    if (st.faces(nrm) < 0.08) continue;
    const x = side * (light ? 27.5 : 29);
    const q = (z: number, y: number): V3 => at(C, [x, axleY + y, z]);
    st.add(at(C, [x, axleY + 14, 0]), 0.3, (pp) => {
      const pts = light ? [q(-26, 30), q(26, 30), q(24, 6), q(10, 2), q(0, 6), q(-10, 2), q(-24, 6)] : [q(-30, 30), q(30, 30), q(30, 4), q(16, -2), q(0, 4), q(-16, -2), q(-30, 4)];
      pp.fill(st.poly(pts), m(t.cloth, 'cloth'), { lw: 1.3, folds: [st.pts2([q(-8, 28), q(-10, 6)]), st.pts2([q(12, 28), q(14, 6)])] });
      // emblem: Lichtwerk sun disc, Aschehalle flame wedge
      const e = q(0, 18);
      if (light) {
        const f = frameZY(e, nrm, C.y);
        pp.fill(st.hull(disc({ ...f, o: madd(e, nrm, 0.5) }, 6.5, 14)), t.metal, { lw: 1.1 });
      } else pp.fill(st.poly([q(-6, 12), q(6, 12), q(0, 26)]), m('#2a2628', 'cloth'), { lw: 1.1 });
    });
  }
  // gun
  const gunBase = at(C, [0, axleY + 36, light ? 8 : -6]);
  const gunDir = norm(at({ ...C, o: [0, 0, 0] }, light ? [0, 0.22 + pitchUp, 1] : [0, 1.15 + pitchUp * 2, 1]));
  const g = frameYZ(madd(gunBase, gunDir, -recoil), gunDir, C.y);
  st.add(madd(g.o, gunDir, 18), 6, (pp) => {
    // mount
    pp.fill(st.hull([...ring(frameYZ(gunBase, C.y, C.z), -6, 11, 11, 10), ...ring(frameYZ(gunBase, C.y, C.z), 2, 9, 9, 10)]), t.metal, { lw: 1.3 });
    if (light) {
      pp.fill(cyl(st, g, -14, 40, 10, 8), t.metal);
      for (const y of [-6, 14, 34]) pp.fill(st.hull([...ring(g, y - 2, 10.6, 10.6, 12), ...ring(g, y + 2, 10.4, 10.4, 12)]), t.metal2, { lw: 1.1 });
      // lens at the muzzle
      const mz = at(g, [0, 41, 0]);
      const lf = frameZY(mz, gunDir, C.y);
      hoop(st, pp, lf, 10.5, 7.5, t.metal2, 1.6);
      if (st.faces(gunDir) > -0.1) pp.fill(st.hull(disc({ ...lf, o: madd(mz, gunDir, 1.2) }, 7.5, 14)), m(t.glow, 'glass'), { lw: 1.1 });
      glowOrb(st, pp, madd(mz, gunDir, 2 + flash * 6), 3.5 + flash * 4, t.glow, 0.35 + flash);
    } else {
      pp.fill(cyl(st, g, -8, 24, 14, 12.5), t.metal);
      pp.fill(st.hull([...ring(g, 22, 14.5, 14.5, 6), ...ring(g, 27, 14.5, 14.5, 6)]), t.metal2, { lw: 1.2 });
      const mz = at(g, [0, 27.5, 0]);
      if (st.faces(gunDir) > 0) {
        const hole = st.p(mz);
        pp.dot(hole.x, hole.y, 8.5 * st.view.k, 8.5 * st.view.k * Math.max(0.25, st.faces(gunDir)), '#1a1418');
      }
      glowOrb(st, pp, madd(mz, gunDir, 3 + flash * 6), 3 + flash * 5, t.glow, 0.25 + flash);
      // chimney behind the mortar
      const cb = at(C, [-10, axleY + 30, -36]);
      const ctop = at(C, [-12, axleY + 66, -42]);
      pp.fill(st.capsule(cb, ctop, 5, 4.4), t.metal);
      pp.fill(st.hull([...ring(frameYZ(ctop, C.y, C.z), -1, 6.5, 6.5, 6), ...ring(frameYZ(ctop, C.y, C.z), 3, 7.5, 7.5, 6)]), t.metal2, { lw: 1.2 });
      glowOrb(st, pp, madd(ctop, C.y, 4), 2.2, t.glow, 0.45 + (frame % 2) * 0.2);
    }
  });
  // smoke puffs (opaque grey dabs)
  if (smoke > 0 || flash > 0) {
    const src = light ? at(C, [0, axleY + 40, -44]) : at(C, [-12, axleY + 72, -42]);
    st.add(src, 7, (pp) => {
      for (let i = 0; i < 3; i++) {
        const k = (i + (anim === 'death' ? 0.5 : smoke)) / 3;
        const q = st.p(madd(madd(src, C.y, 6 + k * 26), C.z, -k * 10));
        const r = (3 + k * 6) * st.view.k;
        pp.dot(q.x, q.y, r, r * 0.85, mix(light ? '#d8d2c8' : '#5a5458', '#2a2236', k * 0.4));
      }
    });
  }
  // pennant on a pole at the back
  const pb = at(C, light ? [18, axleY + 30, -46] : [20, axleY + 32, -48]);
  const ptop = madd(pb, C.y, 44);
  st.add(lerp3(pb, ptop, 0.5), 1, (pp) => {
    pp.fill(st.capsule(pb, ptop, 1.6, 1.4), WOOD_DARK, { lw: 1.2 });
    const wave = Math.sin((u + 0.25) * TAU) * 3;
    const fl: V3[] = [madd(ptop, C.y, -1), madd(madd(ptop, C.z, -22), C.x, wave), madd(madd(madd(ptop, C.y, -7), C.z, -16), C.x, -wave * 0.5), madd(ptop, C.y, -14)];
    pp.fill(st.poly(fl, true), m(t.cloth, 'cloth'), { lw: 1.2 });
  });
  st.render(p);
}

function drawWheel(st: Stage, p: Painter, f: Basis, r: number, ang: number, t: TeamLook, light: boolean): void {
  if (light) {
    hoop(st, p, f, r, r * 0.74, WOOD_DARK, 3.2);
    hoop(st, p, { ...f, o: madd(f.o, f.z, 0.8) }, r * 0.8, r * 0.72, t.metal, 2.8);
  } else {
    // hex wheel: prism hull + hex hole
    const hex = (rr: number, dz: number): V3[] => {
      const out: V3[] = [];
      for (let i = 0; i < 6; i++) {
        const a = ang + (i / 6) * TAU;
        out.push(at(f, [Math.cos(a) * rr, Math.sin(a) * rr, dz]));
      }
      return out;
    };
    p.fill(st.hull([...hex(r, -3.5), ...hex(r, 3.5)]), t.metal);
    if (st.faces(f.z) > 0.05) p.fill(st.poly(hex(r * 0.72, 3.6)), t.metal2, { lw: 1.2 });
  }
  if (st.faces(f.z) <= 0.02) return;
  const spokes = light ? 6 : 3;
  for (let i = 0; i < spokes; i++) {
    const a = ang + (i / spokes) * (light ? TAU : Math.PI) + (light ? 0 : Math.PI / 6);
    const a0 = at(f, [Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78, 3.2]);
    const a1 = at(f, [-Math.cos(a) * r * 0.78, -Math.sin(a) * r * 0.78, 3.2]);
    p.rope(st.pts2([a0, a1]), light ? '#7b5530' : mix(t.metal.c, '#000000', 0.25), light ? 2.4 : 3.6);
  }
  p.fill(st.sphere(madd(f.o, f.z, 4), r * 0.22), light ? t.metal : t.metal2, { lw: 1.2 });
}

export const MINION_DRAWERS: Record<string, SpriteDrawer> = {
  [minionId('siege', 0)]: siegeDrawer(0),
  [minionId('siege', 1)]: siegeDrawer(1),
};
