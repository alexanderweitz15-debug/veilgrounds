// placeholder art: procedurally drawn unit sprites in one shared atlas (one texture, one material).
// All figures face right, feet at the bottom centre of a 256x256 cell; flat fills, two-tone, thick ink outline.
import * as THREE from 'three';
import { INK, TEAM, type TeamPalette } from './palette';

export const SPRITE_KEYS = ['mira', 'champ', 'melee', 'caster', 'siege', 'super', 'dummy', 'monster'] as const;
export type SpriteKey = (typeof SPRITE_KEYS)[number];

/** World height (units) of each sprite cell. */
export const SPRITE_SIZE: Record<SpriteKey, number> = {
  mira: 250,
  champ: 260,
  melee: 165,
  caster: 165,
  siege: 210,
  super: 290,
  dummy: 230,
  monster: 230,
};

const CELL = 256;
const COLS = 8;

export interface Atlas {
  texture: THREE.CanvasTexture;
  /** UV rect [u0, v0, u1, v1] of a sprite for a team (0/1; neutral uses 1). */
  uv(key: SpriteKey, team: number): [number, number, number, number];
}

export function buildAtlas(): Atlas {
  const rows = Math.ceil((SPRITE_KEYS.length * 2) / COLS);
  const c = document.createElement('canvas');
  c.width = COLS * CELL;
  c.height = rows * CELL;
  const ctx = c.getContext('2d')!;
  SPRITE_KEYS.forEach((key, ki) => {
    for (const team of [0, 1]) {
      const idx = ki * 2 + team;
      ctx.save();
      ctx.translate((idx % COLS) * CELL, Math.floor(idx / COLS) * CELL);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      DRAW[key](ctx, TEAM[team]!);
      ctx.restore();
    }
  });
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return {
    texture,
    uv(key, team) {
      const idx = SPRITE_KEYS.indexOf(key) * 2 + Math.min(1, team);
      const u0 = (idx % COLS) / COLS;
      const row = Math.floor(idx / COLS);
      // canvas row 0 is the top; flipY puts it at v = 1
      const v1 = 1 - row / rows;
      return [u0 + 0.5 / c.width, v1 - 1 / rows + 0.5 / c.height, u0 + 1 / COLS - 0.5 / c.width, v1 - 0.5 / c.height];
    },
  };
}

type Ctx = CanvasRenderingContext2D;

/** Fill with a two-tone split (darker back/left side) and ink outline. */
function shape(ctx: Ctx, p: Path2D, base: string, shade = darken(base, 0.72), lw = 7): void {
  ctx.fillStyle = base;
  ctx.fill(p);
  ctx.save();
  ctx.clip(p);
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, 112, CELL);
  ctx.restore();
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  ctx.stroke(p);
}

function circle(x: number, y: number, r: number): Path2D {
  const p = new Path2D();
  p.arc(x, y, r, 0, Math.PI * 2);
  return p;
}

function poly(...pts: number[]): Path2D {
  const p = new Path2D();
  p.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i]!, pts[i + 1]!);
  p.closePath();
  return p;
}

function line(ctx: Ctx, color: string, w: number, ...pts: number[]): void {
  for (const [c, lw] of [[INK, w + 6], [color, w]] as const) {
    ctx.strokeStyle = c;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(pts[0]!, pts[1]!);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
    ctx.stroke();
  }
}

function darken(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}

const SKIN = '#e9c8a4';

const DRAW: Record<SpriteKey, (ctx: Ctx, p: TeamPalette) => void> = {
  // Mira Quell: slender hooded archer with a long bow and a quiver.
  mira(ctx, p) {
    line(ctx, '#3a3040', 9, 118, 190, 112, 244);
    line(ctx, '#3a3040', 9, 138, 190, 146, 244);
    shape(ctx, poly(96, 100, 92, 150, 104, 158), '#6b4a2c'); // quiver
    line(ctx, '#f0e6d0', 3, 98, 98, 90, 74);
    line(ctx, '#f0e6d0', 3, 104, 98, 100, 72);
    const cloak = new Path2D();
    cloak.moveTo(112, 92);
    cloak.lineTo(150, 92);
    cloak.quadraticCurveTo(170, 150, 166, 202);
    cloak.lineTo(92, 202);
    cloak.quadraticCurveTo(96, 140, 112, 92);
    cloak.closePath();
    shape(ctx, cloak, p.primary);
    shape(ctx, poly(108, 196, 150, 196, 150, 206, 108, 206), p.accent, undefined, 5);
    shape(ctx, circle(132, 72, 21), SKIN);
    const hood = new Path2D();
    hood.moveTo(108, 92);
    hood.quadraticCurveTo(104, 42, 136, 44);
    hood.quadraticCurveTo(160, 48, 156, 66);
    hood.quadraticCurveTo(140, 56, 122, 70);
    hood.quadraticCurveTo(118, 88, 126, 96);
    hood.closePath();
    shape(ctx, hood, p.secondary);
    ctx.fillStyle = INK;
    ctx.fillRect(142, 68, 5, 5); // eye
    line(ctx, SKIN, 7, 146, 112, 176, 122); // bow arm
    // bow
    ctx.strokeStyle = INK;
    ctx.lineWidth = 14;
    const bow = new Path2D();
    bow.moveTo(170, 46);
    bow.quadraticCurveTo(222, 124, 170, 202);
    ctx.stroke(bow);
    ctx.strokeStyle = '#8a5a2e';
    ctx.lineWidth = 8;
    ctx.stroke(bow);
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(190, 112);
    ctx.lineTo(196, 136);
    ctx.stroke();
    ctx.strokeStyle = '#f4f0e6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(170, 46);
    ctx.lineTo(170, 202);
    ctx.stroke();
  },
  // Generic champion: armoured figure with a raised blade.
  champ(ctx, p) {
    line(ctx, p.dark, 11, 116, 188, 108, 244);
    line(ctx, p.dark, 11, 140, 188, 148, 244);
    shape(ctx, poly(98, 96, 158, 96, 166, 196, 92, 196), p.primary);
    shape(ctx, poly(96, 96, 160, 96, 152, 120, 104, 120), p.accent, undefined, 5);
    shape(ctx, circle(128, 70, 24), SKIN);
    shape(ctx, poly(102, 66, 128, 38, 154, 66, 150, 56, 128, 50, 106, 56), p.secondary, undefined, 5);
    line(ctx, '#d8dde2', 9, 170, 140, 206, 40);
    line(ctx, p.accent, 7, 158, 150, 182, 134);
  },
  // Melee minion: stocky, round helmet, round shield.
  melee(ctx, p) {
    line(ctx, p.dark, 12, 114, 214, 110, 246);
    line(ctx, p.dark, 12, 142, 214, 146, 246);
    line(ctx, '#cfd4d8', 7, 92, 190, 74, 140);
    const body = new Path2D();
    body.ellipse(128, 182, 44, 42, 0, 0, Math.PI * 2);
    shape(ctx, body, p.primary);
    const helm = new Path2D();
    helm.arc(130, 134, 30, Math.PI, 0);
    helm.lineTo(160, 146);
    helm.lineTo(100, 146);
    helm.closePath();
    shape(ctx, helm, p.secondary);
    shape(ctx, poly(122, 100, 138, 100, 136, 112, 124, 112), p.accent, undefined, 4);
    ctx.fillStyle = INK;
    ctx.fillRect(140, 136, 14, 5);
    shape(ctx, circle(168, 186, 28), p.accent);
    shape(ctx, circle(168, 186, 9), p.secondary, undefined, 4);
  },
  // Caster minion: robed, pointed hat, staff with a glowing orb.
  caster(ctx, p) {
    line(ctx, '#6b4a2c', 6, 170, 96, 168, 246);
    shape(ctx, circle(172, 90, 15), p.glow, p.glow, 5);
    shape(ctx, poly(128, 120, 90, 244, 166, 244), p.primary);
    shape(ctx, poly(96, 226, 160, 226, 166, 244, 90, 244), p.accent, undefined, 5);
    shape(ctx, circle(128, 112, 20), SKIN);
    shape(ctx, poly(98, 104, 160, 104, 120, 40), p.secondary);
    ctx.fillStyle = INK;
    ctx.fillRect(136, 110, 5, 5);
    line(ctx, SKIN, 6, 140, 150, 166, 142);
  },
  // Siege minion: wheeled cannon cart with a small operator.
  siege(ctx, p) {
    shape(ctx, circle(108, 112, 18), SKIN);
    shape(ctx, poly(88, 108, 128, 108, 108, 80), p.secondary, undefined, 5);
    line(ctx, p.dark, 22, 130, 156, 226, 122);
    line(ctx, p.accent, 8, 206, 128, 214, 150);
    shape(ctx, poly(58, 140, 196, 140, 196, 210, 58, 210), p.primary);
    shape(ctx, poly(58, 140, 196, 140, 196, 156, 58, 156), p.accent, undefined, 5);
    shape(ctx, circle(86, 218, 28), '#5a4030');
    shape(ctx, circle(170, 218, 28), '#5a4030');
    shape(ctx, circle(86, 218, 8), p.accent, undefined, 4);
    shape(ctx, circle(170, 218, 8), p.accent, undefined, 4);
  },
  // Super minion: hulking brute with heavy fists.
  super(ctx, p) {
    line(ctx, p.dark, 18, 106, 200, 100, 246);
    line(ctx, p.dark, 18, 152, 200, 160, 246);
    const body = new Path2D();
    body.ellipse(128, 160, 70, 64, 0, 0, Math.PI * 2);
    shape(ctx, body, p.primary);
    shape(ctx, poly(70, 128, 186, 128, 176, 150, 80, 150), p.accent, undefined, 6);
    shape(ctx, circle(150, 92, 24), p.secondary);
    ctx.fillStyle = p.glow;
    ctx.fillRect(156, 88, 12, 6);
    if (p === TEAM[1]) {
      shape(ctx, poly(134, 74, 124, 44, 144, 70), '#d8cfc0', undefined, 4);
      shape(ctx, poly(162, 72, 176, 46, 170, 76), '#d8cfc0', undefined, 4);
    } else shape(ctx, poly(140, 70, 150, 50, 160, 70), p.accent, undefined, 4);
    line(ctx, p.primary, 22, 180, 140, 206, 186);
    shape(ctx, circle(208, 196, 22), p.accent);
  },
  // Practice dummy: scarecrow on a post with a strapped shield and a number plate.
  dummy(ctx) {
    line(ctx, '#7a5530', 12, 128, 100, 128, 248);
    line(ctx, '#7a5530', 10, 70, 132, 186, 132);
    for (const x of [64, 192]) {
      ctx.strokeStyle = '#d6b85e';
      ctx.lineWidth = 3;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(x, 132);
        ctx.lineTo(x + (x < 128 ? -10 : 10), 132 + i * 7);
        ctx.stroke();
      }
    }
    shape(ctx, circle(128, 86, 30), '#c9a96e');
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    for (const ex of [116, 140]) {
      ctx.beginPath();
      ctx.moveTo(ex - 5, 80);
      ctx.lineTo(ex + 5, 90);
      ctx.moveTo(ex + 5, 80);
      ctx.lineTo(ex - 5, 90);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(114, 102);
    for (let i = 0; i < 5; i++) ctx.lineTo(118 + i * 5, i % 2 ? 98 : 104);
    ctx.stroke();
    shape(ctx, circle(128, 160, 34), '#6c7a86');
    shape(ctx, circle(128, 160, 12), '#c8ccd0', undefined, 4);
    shape(ctx, poly(100, 196, 156, 196, 156, 226, 100, 226), '#efe6cf', undefined, 5);
    ctx.fillStyle = INK;
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('07', 128, 212);
  },
  // Neutral monster (later phases): mossy blob with horns.
  monster(ctx, p) {
    const body = new Path2D();
    body.ellipse(128, 190, 80, 56, 0, 0, Math.PI * 2);
    shape(ctx, body, '#5d6e4a');
    shape(ctx, poly(90, 150, 80, 110, 106, 142), p.secondary, undefined, 5);
    shape(ctx, poly(160, 146, 176, 106, 178, 150), p.secondary, undefined, 5);
    ctx.fillStyle = '#f2d65a';
    ctx.fillRect(150, 172, 12, 8);
    ctx.fillRect(176, 172, 12, 8);
  },
};
