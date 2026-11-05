// Gneis Mauerherz props (stone golem tank, "the Walking Cliff"): a wide boulder body with a tiny head. Props: a huge rock
// hump on the back, two boulder fists with knuckle chunks, glowing rune cracks across the chest and moss tufts on the
// shoulders and crown. 64 px read: a very wide, low, rectangular block with a pinhead and two giant fists.
import { at, lerp3, m, madd, mix, type V3 } from './core';
import { backFrame, glowOrb } from './props';
import type { PropCtx } from './types';

export const GNEIS_STONE = '#8a8478';
const STONE = m(GNEIS_STONE, 'stone');
const STONE_DARK = m('#5c574e', 'stone');
const STONE_LIGHT = m('#a69f90', 'stone');
const MOSS = m('#5f8a3c', 'fur');
const RUNE = '#ffae42';

/** Rock hump behind the shoulders (stacked boulders): gives the tall back silhouette a wide block shape. */
export function rockHump(c: PropCtx): void {
  const { st, rig } = c;
  const bk = backFrame(rig, 4, 0);
  for (const [x, y, z, r, mat] of [[0, 8, 14, 26, STONE_DARK], [-18, 22, 12, 15, STONE], [17, 24, 11, 14, STONE_DARK]] as const) {
    const o = at(bk, [x, y, z]);
    st.add(o, -0.5, (p) => p.fill(st.sphere(o, r), mat, { lw: 1.7 }));
  }
}

/** Two boulder fists: one big sphere plus knuckle chunks; the right one carries a rune that flares on cast. */
export function boulderFists(c: PropCtx): void {
  const { st, rig, pose } = c;
  for (const [h, s] of [[rig.handL, -1], [rig.handR, 1]] as const) {
    const o = madd(h.o, h.y, 9);
    st.add(o, 3.2, (p) => {
      p.fill(st.sphere(o, 19), STONE, { lw: 1.8 });
      for (const [dx, dy, dz, r] of [[-9, 6, 9, 8], [8, 8, 9, 7], [0, -9, 11, 8]] as const) {
        const k = madd(madd(madd(o, rig.chest.x, dx * s), h.y, dy), rig.chest.z, dz);
        p.fill(st.sphere(k, r), STONE_LIGHT, { lw: 1.4 });
      }
      const q = st.p(madd(o, rig.chest.z, 14));
      const k = st.view.k;
      p.line([{ x: q.x - 5 * k, y: q.y - 4 * k }, { x: q.x, y: q.y }, { x: q.x + 4 * k, y: q.y - 6 * k }], mix(RUNE, '#7a2a00', 0.3 - pose.glow * 0.3), 1.8 * k);
    });
  }
}

/** Glowing rune cracks down the chest and belly; they brighten while casting and while hitting. */
export function runeCracks(c: PropCtx): void {
  const { st, rig, pose } = c;
  const glow = 0.45 + Math.max(pose.glow, Math.abs(pose.act)) * 0.55;
  const front = (u: number, side: number, zz: number): V3 =>
    madd(madd(lerp3(rig.neck, rig.pelvis.o, u), rig.chest.x, side), rig.chest.z, rig.body.chestD * 1.05 + zz);
  const bolts: V3[][] = [
    [front(0.12, 0, 0), front(0.3, 7, 0), front(0.42, -3, 0), front(0.6, 9, 0), front(0.8, 2, 0)],
    [front(0.25, -12, 0), front(0.4, -17, 0), front(0.55, -13, 0)],
    [front(0.3, 14, 0), front(0.45, 19, 0), front(0.58, 15, 0)],
  ];
  const mid = bolts[0]![2]!;
  st.add(mid, 1.4, (p) => {
    if (st.faces(rig.chest.z) < -0.1) return;
    const k = st.view.k;
    for (const b of bolts) {
      const q = st.pts2(b);
      p.line(q, mix(RUNE, '#7a2a00', 1 - glow), 3.2 * k);
      p.line(q, mix(RUNE, '#fff2b0', glow * 0.7), 1.4 * k);
    }
    glowOrb(st, p, front(0.42, 0, 2), 3 + glow * 2, RUNE, glow);
  });
}

/** Moss tufts on both shoulders and the crown. */
export function mossTufts(c: PropCtx): void {
  const { st, rig } = c;
  const spots: [V3, number][] = [
    [madd(rig.shL, [0, 1, 0], 17), 7],
    [madd(rig.shR, [0, 1, 0], 17), 8],
    [madd(madd(rig.head.o, rig.head.y, rig.body.headR * 0.9), rig.head.z, -2), 5],
  ];
  for (const [o, r] of spots)
    st.add(o, 1.5, (p) => {
      p.fill(st.sphere(o, r), MOSS, { lw: 1.3 });
      p.fill(st.sphere(madd(o, [2, 3, 1], 1), r * 0.55), m('#86b04c', 'fur'), { lw: 0.9, rim: false });
    });
}
