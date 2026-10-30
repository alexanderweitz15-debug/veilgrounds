// Agent F: a look of its own for every hook ground object that used to fall through to the generic ring / disc /
// line shapes of groundObjects.ts (Sev keeps sevFx.ts). Drawn with the pooled flat meshes: stone walls stand up as
// slabs, the kettle wall glows at its seam, the glass dome is a cage of panes, ropes have knots, threads sag,
// smoke drifts, firestorms rain fire columns, spark rain falls, bell peals ripple, the shadow veil has wisps.
import type { SnapObject } from '../sim/snapshot';
import type { SevFxApi } from './sevFx';

const flick = (now: number, seed: number, speed = 90): number => 0.5 + 0.5 * Math.sin(now / speed + seed * 1.7);

/** Tags drawn here (tests). */
export const ABILITY_FX_TAGS: readonly string[] = [
  'oleth_r_wall',
  'dagny_e_wall',
  'isolde_dome',
  'isolde_wire',
  'tobin_q_tether',
  'wren_e_smoke',
  'wren_r_storm',
  'lio_r_rain',
  'hagen_r_peal',
  'grimald_r_aura',
  'nyx_r_veil',
  'nyx_seed',
  'corvin_w_keg',
  'kiran_p_thread',
  'kiran_e_link',
  'aurel_e_rewind',
  'ottilie_w_scout',
  'oda_p_spring',
  'seraphyne_r_strike',
  'renn_w_drop',
  'isolde_anchor',
  'tobin_q_range',
  'ottilie_q_leap',
  'vargrim_w_mist',
];

/** Draws a hook object by tag; false = not ours (the generic shape is drawn instead). */
export function drawAbilityObject(o: SnapObject, now: number, g: SevFxApi): boolean {
  const circle = (geo: THREE_Geo, r: number, col: string, a: number, y = 3, x = o.x, z = o.y): void => {
    const m = g.part();
    m.geometry = geo;
    m.position.set(x, y, -z);
    m.scale.setScalar(Math.max(1, r));
    m.material.color.set(col);
    m.material.opacity = a;
  };
  /** upright pane of width w and height h at (x, y), facing yaw */
  const pane = (x: number, y: number, w: number, h: number, yaw: number, col: string, a: number): void => {
    const m = g.part();
    m.geometry = g.plane;
    m.rotation.order = 'YXZ';
    m.rotation.set(Math.PI / 2, yaw, 0);
    m.position.set(x, h / 2, -y);
    m.scale.set(w, 1, h);
    m.material.side = 2; // THREE.DoubleSide
    m.material.needsUpdate = true;
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
  const ex = g.end.x;
  const ey = g.end.y;
  switch (o.tag) {
    case 'oleth_r_wall': {
      // stone wall of the order: dark footing, five standing slabs along the line, a pale top edge
      const len = Math.hypot(ex - o.x, ey - o.y);
      line(o.x, o.y, ex, ey, Math.max(30, o.r), 4, '#2a2630', 0.9);
      const yaw = Math.atan2(ey - o.y, ex - o.x);
      const n = Math.max(2, Math.round(len / 90));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const px = o.x + (ex - o.x) * t;
        const py = o.y + (ey - o.y) * t;
        pane(px, py, len / n - 6, 150 + (i % 2) * 24, yaw + Math.PI / 2, i % 2 ? '#6e7482' : '#7e8592', 0.92 * (0.4 + 0.6 * life));
      }
      line(o.x, o.y, ex, ey, 8, 6, '#c8c0a8', 0.6 * life);
      return true;
    }
    case 'dagny_e_wall': {
      // kettle shield wall: a short iron pane with a glowing hot seam and steam puffs
      const yaw = Math.atan2(ey - o.y, ex - o.x);
      line(o.x, o.y, ex, ey, Math.max(20, o.r), 4, '#3a3a40', 0.9);
      pane((o.x + ex) / 2, (o.y + ey) / 2, Math.hypot(ex - o.x, ey - o.y), 70, yaw + Math.PI / 2, '#6a6e78', 0.95);
      line(o.x, o.y, ex, ey, 6, 7, '#ffb060', 0.6 + 0.3 * flick(now, 1, 70));
      for (let i = 0; i < 4; i++) {
        const t = (i + 0.5) / 4;
        circle(g.disc, 14 + 8 * flick(now, i, 160), '#e8e4dc', 0.25 * flick(now, i + 2, 220), 60 + 30 * flick(now, i, 300), o.x + (ex - o.x) * t, o.y + (ey - o.y) * t);
      }
      return true;
    }
    case 'isolde_dome': {
      // glass dome: faint cyan floor, a bright rim and eight tall translucent panes like a cage of glass
      circle(g.disc, o.r, '#9fe8f0', 0.08);
      circle(g.thin, o.r, '#d8fbff', 0.9 * (0.5 + 0.5 * life), 5);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.2;
        pane(o.x + Math.cos(a) * o.r * 0.96, o.y + Math.sin(a) * o.r * 0.96, o.r * 0.7, 170, -a + Math.PI / 2, i % 2 ? '#b8f4f8' : '#d8fbff', 0.22 + 0.08 * flick(now, i, 400));
      }
      return true;
    }
    case 'isolde_wire': {
      // copper wire under tension: thin bright core, darker sheath, sparks running along it
      line(o.x, o.y, ex, ey, 14, 4, '#5a3a20', 0.5);
      line(o.x, o.y, ex, ey, 5, 6, '#f0b070', 0.95);
      const t = (now / 300) % 1;
      circle(g.disc, 9, '#fff4d0', 0.9, 8, o.x + (ex - o.x) * t, o.y + (ey - o.y) * t);
      return true;
    }
    case 'tobin_q_tether': {
      // harpoon rope: hemp strip with knots, a dark shadow under it
      line(o.x, o.y, ex, ey, 10, 4, '#2a2420', 0.5);
      line(o.x, o.y, ex, ey, 7, 6, '#c8a468', 0.95);
      const len = Math.hypot(ex - o.x, ey - o.y);
      const n = Math.floor(len / 70);
      for (let i = 1; i <= n; i++) {
        const t = (i * 70) / len;
        circle(g.disc, 7, '#8a6a3a', 0.95, 7, o.x + (ex - o.x) * t, o.y + (ey - o.y) * t);
      }
      return true;
    }
    case 'wren_e_smoke': {
      // ash smoke: slow dark puffs drifting inside the cloud, no hard rim
      circle(g.disc, o.r, '#3a3438', 0.35 * life);
      for (let i = 0; i < 9; i++) {
        const a = i * 0.7 + now / (1800 + i * 90);
        const rr = o.r * (0.2 + 0.6 * flick(now, i, 900));
        circle(g.disc, o.r * (0.22 + 0.1 * flick(now, i + 4, 500)), i % 3 ? '#4e484c' : '#6a6268', 0.45 * life, 5 + i, o.x + Math.cos(a) * rr, o.y + Math.sin(a) * rr);
      }
      circle(g.thin, o.r, '#8a8088', 0.35 * life, 6);
      return true;
    }
    case 'wren_r_storm': {
      // firestorm: ring of flames on the edge, embers on the ground, fire columns raining in
      circle(g.disc, o.r, '#7a3a14', 0.28);
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + now / 1100;
        circle(g.disc, 16 + 12 * flick(now, i * 2, 55), i % 2 ? '#ff7a1a' : '#ffcf4a', 0.85, 7, o.x + Math.cos(a) * o.r, o.y + Math.sin(a) * o.r);
      }
      for (let i = 0; i < 4; i++) {
        const a = i * 1.9 + Math.floor(now / 450) * 0.8;
        const rr = o.r * (0.25 + 0.55 * flick(now, i + 7, 700));
        const px = o.x + Math.cos(a) * rr;
        const py = o.y + Math.sin(a) * rr;
        const k = (now / 450 + i * 0.25) % 1;
        pane(px, py, 26, 220 * (1 - k * 0.6), 0.6 + i, '#ff9a3a', 0.7 * (1 - k));
        circle(g.disc, 30 * k + 10, '#ffd870', 0.8 * (1 - k), 8, px, py);
      }
      return true;
    }
    case 'lio_r_rain': {
      // spark rain: warm ground, thin bright sparks falling all over the area
      circle(g.disc, o.r, '#ffb040', 0.18 + 0.08 * flick(now, 0, 120));
      circle(g.thin, o.r, '#ffe08a', 0.7, 5);
      for (let i = 0; i < 12; i++) {
        const k = (now / 380 + i * 0.083) % 1;
        const a = i * 2.4 + Math.floor(now / 380 + i * 0.083) * 1.3;
        const rr = o.r * 0.9 * Math.sqrt(0.2 + 0.8 * flick(0, i + Math.floor(now / 380), 1));
        const px = o.x + Math.cos(a) * rr;
        const py = o.y + Math.sin(a) * rr;
        pane(px, py, 6, 90, a, '#fff0a0', 0.9 * (1 - k));
        if (k > 0.8) circle(g.disc, 18 * (k - 0.8) * 5 + 4, '#fff6c0', 0.9 * (1 - k) * 5, 8, px, py);
      }
      return true;
    }
    case 'hagen_r_peal': {
      // bell peal: brass sound waves rippling outward from the bell
      circle(g.disc, o.r, '#e8c060', 0.08);
      for (let i = 0; i < 3; i++) {
        const k = (now / 900 + i / 3) % 1;
        circle(g.thin, o.r * (0.15 + 0.85 * k), '#f4d888', 0.9 * (1 - k), 5 + i);
      }
      circle(g.ring, o.r, '#c8a040', 0.6 * life, 4);
      return true;
    }
    case 'grimald_r_aura': {
      // bear roar: pulsing amber ring with claw rakes radiating from the bear
      const p = 0.9 + 0.1 * flick(now, 0, 110);
      circle(g.disc, o.r * p, '#d08a40', 0.12);
      circle(g.ring, o.r * p, '#e8a050', 0.75 * life, 4);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + now / 2600;
        line(o.x + Math.cos(a) * o.r * 0.45, o.y + Math.sin(a) * o.r * 0.45, o.x + Math.cos(a + 0.12) * o.r * 0.9, o.y + Math.sin(a + 0.12) * o.r * 0.9, 9, 5, '#f0c080', 0.5 * life);
      }
      return true;
    }
    case 'nyx_r_veil': {
      // shadow veil: a dark pool with a violet edge and wisps circling inside
      circle(g.disc, o.r, '#140c20', 0.4 * (0.5 + 0.5 * life));
      circle(g.thin, o.r, '#9a7ae0', 0.6 * life, 5);
      for (let i = 0; i < 10; i++) {
        const a = i * 0.63 + now / (1400 + i * 60);
        const rr = o.r * (0.3 + 0.6 * flick(now, i, 1300));
        circle(g.disc, 22 + 10 * flick(now, i + 3, 300), '#2a1a40', 0.7 * life, 6, o.x + Math.cos(a) * rr, o.y + Math.sin(a) * rr);
      }
      return true;
    }
    case 'nyx_seed': {
      // shadow seed: a dark bud with a violet glint and one wisp rising
      circle(g.disc, o.r * 0.35, '#1a1226', 0.9);
      circle(g.thin, o.r * 0.5, '#9a7ae0', 0.5 + 0.3 * flick(now, o.id, 400), 4);
      circle(g.disc, 8, '#c8b0ff', 0.6 * flick(now, o.id + 1, 300), 10 + 18 * flick(now, o.id, 600));
      return true;
    }
    case 'corvin_w_keg': {
      // powder keg: rust ring of the blast area, a standing barrel with a burning fuse
      circle(g.disc, o.r, '#8a4a2a', 0.1);
      circle(g.ring, o.r, '#c86a3a', 0.75, 4);
      pane(o.x, o.y, 44, 56, 0, '#6a4a30', 0.95);
      pane(o.x, o.y, 44, 56, Math.PI / 2, '#5a3c26', 0.95);
      line(o.x - 22, o.y, o.x + 22, o.y, 6, 30, '#b89040', 0.9);
      circle(g.disc, 7 + 4 * flick(now, 2, 60), '#ffd040', 0.95, 62, o.x + 6, o.y + 6);
      return true;
    }
    case 'kiran_p_thread':
    case 'kiran_e_link': {
      // red yarn: a thin thread with a slow wobble beside it and a spindle at the far end
      line(o.x, o.y, ex, ey, 4, 6, '#d04040', 0.95);
      const nx = -(ey - o.y);
      const ny = ex - o.x;
      const l = Math.hypot(nx, ny) || 1;
      const w = 6 * Math.sin(now / 350);
      line(o.x + (nx / l) * w * 0.3, o.y + (ny / l) * w * 0.3, ex + (nx / l) * w, ey + (ny / l) * w, 2.5, 5, '#ff8a80', 0.6);
      circle(g.disc, 9, '#c0443a', 0.9, 7, ex, ey);
      return true;
    }
    case 'aurel_e_rewind': {
      // rewind pin: a brass clock face whose hand runs backwards
      circle(g.disc, o.r, '#3a3020', 0.6);
      circle(g.ring, o.r, '#e0c070', 0.9, 4);
      const a = -now / 600;
      line(o.x, o.y, o.x + Math.cos(a) * o.r * 0.8, o.y + Math.sin(a) * o.r * 0.8, 5, 6, '#fff0c0', 0.95);
      for (let i = 0; i < 12; i++) {
        const t = (i / 12) * Math.PI * 2;
        circle(g.disc, i % 3 ? 2.5 : 4, '#f0d890', 0.9, 5, o.x + Math.cos(t) * o.r * 0.85, o.y + Math.sin(t) * o.r * 0.85);
      }
      return true;
    }
    case 'ottilie_w_scout': {
      // scout destination: a wolf paw print
      circle(g.disc, o.r * 0.4, '#d8d0c0', 0.8, 4, o.x, o.y + o.r * 0.1);
      for (let i = 0; i < 4; i++) {
        const a = Math.PI * 0.75 + (i / 3) * Math.PI * 0.5;
        circle(g.disc, o.r * 0.17, '#d8d0c0', 0.8, 4, o.x + Math.cos(a) * o.r * 0.6, o.y - Math.sin(a) * o.r * 0.6 + o.r * 0.1);
      }
      circle(g.thin, o.r, '#8fe8ff', 0.5 + 0.3 * flick(now, 0, 200), 5);
      return true;
    }
    case 'oda_p_spring': {
      // spring: slow water ripples spreading from Oda's feet
      circle(g.disc, o.r, '#3f8a86', 0.1);
      for (let i = 0; i < 3; i++) {
        const k = (now / 1500 + i / 3) % 1;
        circle(g.thin, o.r * (0.2 + 0.8 * k), '#9fe0e0', 0.6 * (1 - k), 4 + i);
      }
      return true;
    }
    case 'seraphyne_r_strike': {
      // pending storm strike(s): faint outer ring, a bright ring closing in on the next strike, a lightning column
      // building up; the last strike (n 1) also stuns: white inner ring
      const k = o.total ? Math.max(0, Math.min(1, (o.left ?? 0) / o.total)) : 0;
      const more = o.n ?? 1;
      circle(g.disc, o.r, '#7ab8ff', 0.1 + 0.12 * (1 - k));
      circle(g.thin, o.r, '#9fd0ff', 0.45, 4);
      circle(g.thin, o.r * (0.25 + 0.75 * k), '#e8f6ff', 0.95, 6);
      pane(o.x, o.y, 22, 60 + 240 * (1 - k), now / 90, '#d8f0ff', 0.25 + 0.5 * (1 - k) * flick(now, 3, 45));
      if (more <= 1) circle(g.ring, o.r * 0.3, '#ffffff', 0.5 + 0.4 * flick(now, 1, 80), 7);
      else for (let i = 0; i < more; i++) circle(g.disc, 7, '#e8f6ff', 0.95, 8, o.x + (i - (more - 1) / 2) * 24, o.y);
      return true;
    }
    case 'renn_w_drop': {
      // blade about to land: a landing mark that tightens, filling up, and a blade standing over it
      const k = o.total ? Math.max(0, Math.min(1, (o.left ?? 0) / o.total)) : 0;
      circle(g.thin, o.r * (0.5 + 0.9 * k), '#8fb4ff', 0.85, 5);
      circle(g.disc, o.r * 0.35, '#8fb4ff', 0.3 + 0.4 * (1 - k), 4);
      pane(o.x, o.y, 14, 30 + 200 * k, now / 400, '#dfe8ff', 0.9);
      return true;
    }
    case 'isolde_anchor': {
      // wire anchor: a copper rivet with a ring that pulses while the recast window is open
      circle(g.disc, 16, '#f0b070', 0.95, 6);
      circle(g.disc, 7, '#fff4d0', 0.95, 7);
      circle(g.thin, o.r * (0.8 + 0.2 * flick(now, 0, 140)), '#f0b070', 0.8 * (0.4 + 0.6 * life), 5);
      return true;
    }
    case 'tobin_q_range': {
      // root distance: a ring of hemp-coloured beads that burns down clockwise with the tether timer
      const n = 40;
      const lit = Math.ceil(life * n);
      for (let i = 0; i < lit; i++) {
        const a = Math.PI / 2 - (i / n) * Math.PI * 2;
        circle(g.disc, 9, '#e8d49a', 0.9, 6, o.x + Math.cos(a) * o.r, o.y + Math.sin(a) * o.r);
      }
      circle(g.thin, o.r, '#8a6a3a', 0.25, 4);
      return true;
    }
    case 'ottilie_q_leap': {
      // hunt line: paw prints walking from Hark to the marked prey
      const len = Math.hypot(ex - o.x, ey - o.y) || 1;
      const n = Math.max(1, Math.floor(len / 90));
      const ph = (now / 500) % 1;
      for (let i = 0; i < n; i++) {
        const t = Math.min(1, (i + ph) / n);
        const side = i % 2 ? 1 : -1;
        circle(g.disc, 9, '#d8d0c0', 0.8 * (1 - 0.5 * t), 5, o.x + (ex - o.x) * t - ((ey - o.y) / len) * 14 * side, o.y + (ey - o.y) * t + ((ex - o.x) / len) * 14 * side);
      }
      circle(g.thin, 70, '#ff8a6a', 0.55 + 0.3 * flick(now, 0, 120), 6, ex, ey);
      return true;
    }
    case 'vargrim_w_mist': {
      // gallop mist: pale teal cloud with slow puffs and a thin rim that fades with the timer
      circle(g.disc, o.r, '#6fd0b8', 0.1 * (0.5 + 0.5 * life));
      for (let i = 0; i < 8; i++) {
        const a = i * 0.8 + now / (2200 + i * 110);
        const rr = o.r * (0.25 + 0.6 * flick(now, i, 1100));
        circle(g.disc, o.r * (0.16 + 0.07 * flick(now, i + 5, 600)), '#bfeee0', 0.22 * life, 5 + i, o.x + Math.cos(a) * rr, o.y + Math.sin(a) * rr);
      }
      circle(g.thin, o.r, '#8fe0c8', 0.55 * life, 5);
      return true;
    }
    default:
      return false;
  }
}

type THREE_Geo = SevFxApi['disc'];
