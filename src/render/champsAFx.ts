// Ground effects of the swarm champs-a champions (Gneis earth walls / crater rim, Kerrin chains, Henrike turret / spring).
// Same pooled flat meshes as fennaFx.ts; unknown tags return false (the generic shape is drawn).
import type * as THREE from 'three';
import type { SnapObject } from '../sim/snapshot';
import type { SevFxApi } from './sevFx';

const flick = (now: number, seed: number, speed = 120): number => 0.5 + 0.5 * Math.sin(now / speed + seed * 1.7);

export function drawChampsAObject(o: SnapObject, now: number, g: SevFxApi): boolean {
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
    case 'gneis_w_wall': {
      // earth wall: thick brown slab, lighter top edge, rock chunks along it; crumbles (flickers) in its last second
      const crumble = o.left !== undefined && o.left < 30 ? 0.55 + 0.45 * flick(now, 2, 60) : 1;
      line(o.x, o.y, g.end.x, g.end.y, o.r * 1.15, 6, '#3f3226', 0.9 * crumble);
      line(o.x, o.y, g.end.x, g.end.y, o.r * 0.8, 40, '#7a6650', 0.95 * crumble);
      line(o.x, o.y, g.end.x, g.end.y, o.r * 0.3, 44, '#a8987c', 0.9 * crumble);
      const dx = g.end.x - o.x;
      const dy = g.end.y - o.y;
      for (let i = 0; i < 6; i++) {
        const u = (i + 0.5) / 6;
        circle(g.disc, 22 + (i % 3) * 5, i % 2 ? '#8e7a62' : '#6a5844', 0.95 * crumble, 46 + (i % 2) * 6, o.x + dx * u, o.y + dy * u);
      }
      return true;
    }
    case 'gneis_r_rim': {
      // crater rim: ring of rock chunks around the impact with a gap toward Gneis (x2/y2 = opening point on the rim)
      const ox = g.end.x - o.x;
      const oy = g.end.y - o.y;
      const ol = Math.hypot(ox, oy) || 1;
      const fade = Math.min(1, life * 6);
      circle(g.disc, o.r, '#4a3a2a', 0.22 * fade);
      const n = 28;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const cx = Math.cos(a);
        const cy = Math.sin(a);
        if ((cx * ox + cy * oy) / ol > 0.7) continue;
        circle(g.disc, 30 + (i % 3) * 6, i % 2 ? '#8e7a62' : '#6a5844', 0.95 * fade, 44 + (i % 2) * 6, o.x + cx * o.r, o.y + cy * o.r);
      }
      circle(g.ring, o.r + 20, '#a8987c', 0.7 * fade, 5);
      return true;
    }
    case 'kerrin_q_chain': {
      // chain from Kerrin to the hook anchor while she is pulled: dark rope with bright links, shrinking with the pull
      const a = 0.4 + 0.6 * life;
      line(o.x, o.y, g.end.x, g.end.y, 9, 36, '#3a3f48', 0.9 * a);
      const dx = g.end.x - o.x;
      const dy = g.end.y - o.y;
      for (let i = 0; i < 9; i++) {
        const u = (i + 0.5) / 9;
        circle(g.disc, 9 + (i % 2) * 3, '#c9d2da', 0.95 * a, 40, o.x + dx * u, o.y + dy * u);
      }
      circle(g.ring, 40, '#b79cff', 0.8 * life, 6, g.end.x, g.end.y);
      return true;
    }
    case 'henrike_w_turret': {
      // clockwork turret: brass base disc, spinning ring of gear teeth, a raised barrel cap; orange halo while overwound
      const out = o.left !== undefined && o.left < 20 ? 0.5 + 0.5 * flick(now, 4, 70) : 1;
      circle(g.disc, 44, '#5a4a2a', 0.85 * out, 3);
      circle(g.disc, 34, '#d9a441', 0.95 * out, 6);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + now / 900;
        circle(g.disc, 8, i % 2 ? '#c06a3a' : '#8a6a2a', 0.95 * out, 9, o.x + Math.cos(a) * 36, o.y + Math.sin(a) * 36);
      }
      circle(g.disc, 16, '#2a2218', 0.95 * out, 30);
      circle(g.disc, 10, '#e8c870', 0.95 * out, 70);
      if (o.n) circle(g.ring, 62, '#ff9a3a', 0.6 + 0.3 * flick(now, 5, 90), 5);
      return true;
    }
    case 'henrike_w_shot':
      line(o.x, o.y, g.end.x, g.end.y, 14, 60, '#ffd98a', 0.9 * life);
      line(o.x, o.y, g.end.x, g.end.y, 5, 62, '#ffffff', 0.95 * life);
      return true;
    default:
      return false;
  }
}
