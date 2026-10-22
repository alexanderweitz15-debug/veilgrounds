// Sev Aschenblick ground effects (agent E): one distinct look per ability object tag (sev.ts visuals), drawn with the
// pooled flat meshes of groundObjects.ts. Fireball fire field, crow burst, eye-contact gaze, Amaterasu black flames
// (black body, crimson core: unlike normal fire), Susanoo spectral ribcage, sword thrust, Tsukuyomi red moon.
import type * as THREE from 'three';
import type { SnapObject } from '../sim/snapshot';

type Mesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
export interface SevFxApi {
  /** Next pooled mesh. */
  part(): Mesh;
  disc: THREE.BufferGeometry;
  ring: THREE.BufferGeometry;
  thin: THREE.BufferGeometry;
  /** Flat strip a -> b of width w at height h. */
  strip(m: Mesh, ax: number, ay: number, bx: number, by: number, w: number, h: number): void;
  /** End point of a line object (follows its unit). */
  end: { x: number; y: number };
}

const flick = (now: number, seed: number, speed = 90): number => 0.5 + 0.5 * Math.sin(now / speed + seed * 1.7);

/** Draws a Sev object; returns false for unknown tags (the generic shape is drawn instead). */
export function drawSevObject(o: SnapObject, now: number, g: SevFxApi): boolean {
  const circle = (geo: THREE.BufferGeometry, r: number, col: string, a: number, y = 3, x = o.x, z = o.y): void => {
    const m = g.part();
    m.geometry = geo;
    m.position.set(x, y, -z);
    m.scale.setScalar(Math.max(1, r));
    m.material.color.set(col);
    m.material.opacity = a;
  };
  const life = o.left !== undefined && o.total ? Math.max(0, Math.min(1, o.left / o.total)) : 1;
  switch (o.tag) {
    case 'sev_q_fire': {
      // fireball ground: orange field, hot yellow core, flickering red rim
      circle(g.disc, o.r, '#ff6a1a', 0.42 * (0.6 + 0.4 * life));
      circle(g.disc, o.r * (0.45 + 0.1 * flick(now, 1)), '#ffd04a', 0.5 * life, 4);
      circle(g.ring, o.r * (0.98 + 0.03 * flick(now, 2, 60)), '#c81e10', 0.8, 5);
      for (let i = 0; i < 5; i++) {
        const a = i * 1.26 + now / 400;
        const rr = o.r * (0.3 + 0.5 * flick(now, i, 130));
        circle(g.disc, 18 + 10 * flick(now, i + 3, 70), '#ffb030', 0.7 * life, 6, o.x + Math.cos(a) * rr, o.y + Math.sin(a) * rr);
      }
      // ring of flames on the edge (the readable AoE border)
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + now / 900;
        circle(g.disc, 20 + 14 * flick(now, i * 2, 55), i % 2 ? '#ff7a1a' : '#ffcf4a', 0.85 * (0.5 + 0.5 * life), 7, o.x + Math.cos(a) * o.r, o.y + Math.sin(a) * o.r);
      }
      // explosion flash in the first moments
      const age = 1 - life;
      if (age < 0.15) circle(g.disc, o.r * (0.6 + age * 3), '#fff0b0', 0.8 * (1 - age / 0.15), 8);
      return true;
    }
    case 'sev_w_crows': {
      // crow burst: dark shock ring expanding + crows flying outward
      const t = 1 - life;
      circle(g.thin, o.r * (0.4 + 0.8 * t), '#1a1420', 0.85 * life, 5);
      circle(g.disc, o.r * (0.3 + 0.5 * t), '#3a1a3a', 0.35 * life, 3);
      // crow storm: crows spiral outward to the edge and beyond
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2 + t * 2.2 + (i % 3) * 0.2;
        const rr = o.r * (0.15 + (0.75 + (i % 4) * 0.12) * t);
        circle(g.disc, 12 + (i % 3) * 4, '#0e0a12', 0.95 * Math.min(1, life * 2), 30 + (i % 5) * 6, o.x + Math.cos(a) * rr, o.y + Math.sin(a) * rr);
      }
      circle(g.ring, o.r, '#6a2a7a', 0.6 * life, 4);
      return true;
    }
    case 'sev_e_gaze': {
      // eye contact: red beam Sev -> target with a dark halo, pulsing (telegraph for the look-away counter)
      const pulse = 0.6 + 0.4 * flick(now, 0, 70);
      const core = g.part();
      g.strip(core, o.x, o.y, g.end.x, g.end.y, 10, 40);
      core.material.color.set('#ff2a2a');
      core.material.opacity = 0.9 * pulse;
      const halo = g.part();
      g.strip(halo, o.x, o.y, g.end.x, g.end.y, 46, 4);
      halo.material.color.set('#3a0408');
      halo.material.opacity = 0.45;
      circle(g.ring, 70 + 15 * pulse, '#ff3a3a', 0.8, 6, g.end.x, g.end.y);
      return true;
    }
    case 'sev_r1_flames': {
      // Amaterasu: black flame pool with a crimson core and black tongues licking outward
      circle(g.disc, o.r * 1.15, '#050306', 0.8);
      circle(g.disc, o.r * 0.45 * (0.85 + 0.25 * flick(now, 4, 80)), '#c0102a', 0.75, 4);
      for (let i = 0; i < 7; i++) {
        const a = i * 0.9 + now / 350;
        const len = o.r * (0.9 + 0.6 * flick(now, i, 75));
        const m = g.part();
        g.strip(m, o.x, o.y, o.x + Math.cos(a) * len, o.y + Math.sin(a) * len, 22, 5);
        m.material.color.set('#0a0508');
        m.material.opacity = 0.9;
      }
      circle(g.thin, o.r * 1.2, '#6a0a1a', 0.7, 6);
      return true;
    }
    case 'sev_r2_susanoo': {
      // Susanoo: large translucent orange-red guardian: aura, spine and ribs on the ground around Sev
      const p = 0.85 + 0.15 * flick(now, 2, 160);
      circle(g.disc, o.r * 1.15, '#ff4a1a', 0.16 * p);
      circle(g.ring, o.r * 1.15, '#ff7a3a', 0.75, 5);
      circle(g.thin, o.r * 0.7, '#ffb060', 0.5, 6);
      const spine = g.part();
      g.strip(spine, o.x, o.y - o.r * 0.9, o.x, o.y + o.r * 0.9, 18, 7);
      spine.material.color.set('#ff8a40');
      spine.material.opacity = 0.65;
      for (let i = 0; i < 4; i++) {
        const y = o.y + o.r * (0.55 - i * 0.32);
        for (const s of [1, -1]) {
          const m = g.part();
          g.strip(m, o.x, y, o.x + s * o.r * (0.95 - i * 0.12), y - o.r * 0.18, 14, 7);
          m.material.color.set('#ff6a2a');
          m.material.opacity = 0.6 * p;
        }
      }
      return true;
    }
    case 'sev_r2_thrust': {
      const m = g.part();
      g.strip(m, o.x, o.y, g.end.x, g.end.y, 120, 8);
      m.material.color.set('#ff6a2a');
      m.material.opacity = 0.75 * life;
      const c = g.part();
      g.strip(c, o.x, o.y, g.end.x, g.end.y, 36, 10);
      c.material.color.set('#ffd08a');
      c.material.opacity = 0.9 * life;
      return true;
    }
    case 'sev_r3_moon': {
      // Tsukuyomi: blood-red moon disc over a dark red-black world around the target
      circle(g.disc, o.r * 2.2, '#140206', 0.55);
      circle(g.disc, o.r, '#b80c18', 0.55, 4);
      circle(g.disc, o.r * 0.82, '#ff2a2a', 0.35 * (0.8 + 0.2 * flick(now, 5, 200)), 5);
      circle(g.thin, o.r * 1.05, '#ff6a6a', 0.8, 6);
      return true;
    }
    default:
      return false;
  }
}
