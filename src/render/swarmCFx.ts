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
    case 'truda_field': {
      // spore field: murky green pool, paler core, spotted rim; bubbles and spore motes rise; children (n = generation) are paler
      const fade = Math.min(1, life * 5) * (o.n ? 0.85 : 1);
      circle(g.disc, o.r, '#3f6a2a', 0.5 * fade);
      circle(g.disc, o.r * 0.62, '#7fb23c', 0.32 * fade, 4);
      circle(g.ring, o.r * (0.98 + 0.02 * flick(now, 2, 200)), '#c8f08a', 0.85 * fade, 5);
      for (let i = 0; i < 9; i++) {
        const a = i * 2.39 + o.id;
        const rr = o.r * (0.2 + 0.65 * (((i * 0.43) % 1) + 0));
        const rise = (((now / 1700 + i * 0.27) % 1) + 1) % 1;
        circle(g.disc, 7 + 5 * flick(now, i), i % 3 ? '#d6f59a' : '#f4ead2', 0.85 * (1 - rise) * fade, 6 + rise * 70, o.x + Math.cos(a) * rr, o.y + Math.sin(a) * rr);
      }
      return true;
    }
    case 'truda_burst': {
      // Spore Burst: a bright ring racing outward plus a pale-green flash that fades
      const k = 1 - life;
      circle(g.disc, o.r * (0.6 + 0.6 * k), '#e6ff9e', 0.55 * life, 5);
      circle(g.ring, o.r * (0.7 + 0.5 * k), '#ffffff', 0.9 * life, 7);
      return true;
    }
    default:
      return false;
  }
}
