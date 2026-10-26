// Fenna Staubflügel ground effects: Lightbond thread (taut gold / slack lilac), Wingdust bounce and Chosen Flame arcs,
// Duskpool (violet pool with drifting dust and a slow turning rim) and Cocoon Light (silk dome with a woven net and an
// upright cocoon). Same pooled flat meshes as sevFx.ts; unknown tags return false (the generic shape is drawn).
import type * as THREE from 'three';
import type { SnapObject } from '../sim/snapshot';
import type { SevFxApi } from './sevFx';

const flick = (now: number, seed: number, speed = 120): number => 0.5 + 0.5 * Math.sin(now / speed + seed * 1.7);

export function drawFennaObject(o: SnapObject, now: number, g: SevFxApi): boolean {
  const circle = (geo: THREE.BufferGeometry, r: number, col: string, a: number, y = 3, x = o.x, z = o.y): void => {
    const m = g.part();
    m.geometry = geo;
    m.position.set(x, y, -z);
    m.scale.setScalar(Math.max(1, r));
    m.material.color.set(col);
    m.material.opacity = a;
  };
  const line = (ax: number, ay: number, bx: number, by: number, w: number, h: number, col: string, a: number): void => {
    const m = g.part();
    g.strip(m, ax, ay, bx, by, w, h);
    m.material.color.set(col);
    m.material.opacity = a;
  };
  const life = o.left !== undefined && o.total ? Math.max(0, Math.min(1, o.left / o.total)) : 1;
  switch (o.tag) {
    case 'fenna_p_bond': {
      // taut bond: soft gold glow, bright thread, beads of light running from Fenna to the bonded ally
      line(o.x, o.y, g.end.x, g.end.y, 44, 4, '#ffcf6a', 0.22);
      line(o.x, o.y, g.end.x, g.end.y, 9, 38, '#ffe9a8', 0.9);
      const dx = g.end.x - o.x;
      const dy = g.end.y - o.y;
      for (let i = 0; i < 5; i++) {
        const u = (((now / 1400 + i / 5) % 1) + 1) % 1;
        circle(g.disc, 14 + 5 * flick(now, i), '#fff6d0', 0.95, 42, o.x + dx * u, o.y + dy * u);
      }
      return true;
    }
    case 'fenna_p_slack': {
      line(o.x, o.y, g.end.x, g.end.y, 6, 30, '#b9a6e8', 0.55);
      return true;
    }
    case 'fenna_q_arc':
    case 'fenna_w_arc': {
      // dust bounce (lilac-gold sparkle) / shield hand-over (clear gold): a flash that fades with the arc's life
      const gold = o.tag === 'fenna_w_arc';
      line(o.x, o.y, g.end.x, g.end.y, gold ? 34 : 24, 40, gold ? '#ffe08a' : '#e8c8ff', 0.85 * life);
      line(o.x, o.y, g.end.x, g.end.y, gold ? 12 : 8, 44, '#ffffff', 0.9 * life);
      circle(g.ring, 60 + (1 - life) * 40, gold ? '#ffd45a' : '#d8a8ff', 0.8 * life, 6, g.end.x, g.end.y);
      return true;
    }
    case 'fenna_e_pool': {
      // Duskpool: dusk-violet pool, darker core, slow turning dashed rim, motes of dust rising
      const fade = Math.min(1, life * 4);
      circle(g.disc, o.r, '#3a2a68', 0.5 * fade);
      circle(g.disc, o.r * 0.6, '#1e1440', 0.4 * fade, 4);
      circle(g.ring, o.r * (0.99 + 0.01 * flick(now, 1)), '#b29aff', 0.85 * fade, 5);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + now / 2500;
        const a2 = a + 0.2;
        line(o.x + Math.cos(a) * o.r * 0.9, o.y + Math.sin(a) * o.r * 0.9, o.x + Math.cos(a2) * o.r * 0.9, o.y + Math.sin(a2) * o.r * 0.9, 12, 6, '#e8dcff', 0.8 * fade);
      }
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4 + now / 4000;
        const rr = o.r * (0.15 + 0.7 * (((i * 0.37) % 1) + 0.0));
        const rise = (((now / 1600 + i * 0.31) % 1) + 1) % 1;
        circle(g.disc, 8 + 4 * flick(now, i), '#f0e4ff', 0.8 * (1 - rise) * fade, 6 + rise * 60, o.x + Math.cos(a) * rr, o.y + Math.sin(a) * rr);
      }
      return true;
    }
    case 'fenna_r_cocoon': {
      // Cocoon Light: pale gold dome, woven silk net on the ground, an upright cocoon above the centre
      const p = 0.85 + 0.15 * flick(now, 3, 220);
      circle(g.disc, o.r, '#fff0c0', 0.14 * p);
      circle(g.ring, o.r, '#ffe08a', 0.85, 4);
      circle(g.thin, o.r * 0.66, '#fff6d8', 0.55, 5);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + now / 3000;
        const b = a + 2.4;
        line(o.x + Math.cos(a) * o.r, o.y + Math.sin(a) * o.r, o.x + Math.cos(b) * o.r, o.y + Math.sin(b) * o.r, 5, 6, '#fff2c8', 0.55);
      }
      const c = g.part();
      c.geometry = g.disc;
      c.rotation.set(Math.PI / 2, 0, 0); // upright ellipse facing the camera
      c.position.set(o.x, 120, -o.y);
      c.scale.set(o.r * 0.28, 1, o.r * 0.42);
      c.material.side = 2; // THREE.DoubleSide
      c.material.needsUpdate = true;
      c.material.color.set('#fff0c0');
      c.material.opacity = 0.42 * p;
      return true;
    }
    default:
      return false;
  }
}
