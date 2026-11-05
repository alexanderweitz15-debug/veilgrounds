// Ground effects of the swarm-C champions (Svea, the mushroom hexer, the crab): one look per object tag, drawn with the
// pooled flat meshes of groundObjects.ts (same API as sevFx.ts / fennaFx.ts). Unknown tags return false.
import type * as THREE from 'three';
import type { SnapObject } from '../sim/snapshot';
import type { SevFxApi } from './sevFx';

const flick = (now: number, seed: number, speed = 120): number => 0.5 + 0.5 * Math.sin(now / speed + seed * 1.7);

export function drawSwarmCObject(o: SnapObject, now: number, g: SevFxApi): boolean {
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
    case 'svea_w_zone': {
      // Wind Wall: pale teal gust field, bright rim, streaks sweeping across the circle
      const fade = Math.min(1, life * 4);
      circle(g.disc, o.r, '#9fe6dc', 0.18 * fade);
      circle(g.ring, o.r * (0.99 + 0.01 * flick(now, 1)), '#d8fff6', 0.9 * fade, 5);
      circle(g.thin, o.r * 0.62, '#b8f2e8', 0.5 * fade, 4);
      for (let i = 0; i < 7; i++) {
        const u = (((now / 900 + i / 7) % 1) + 1) % 1;
        const off = ((i * 0.37) % 1) * 2 - 1;
        const half = Math.sqrt(Math.max(0, 1 - off * off)) * o.r;
        const y = o.y + off * o.r * 0.9;
        line(o.x - half + u * half * 1.2, y, o.x - half + u * half * 1.2 + 70, y + 12, 10, 30 + i, '#f2fffb', 0.85 * fade * (1 - Math.abs(u - 0.5)));
      }
      return true;
    }
    default:
      return false;
  }
}
