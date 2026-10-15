// One shared figure set (silhouettes), three renderers (Painter driven by SpriteStyle).
// All figures face right, feet at the bottom centre of a 256x256 cell, light from the upper right.
// Shape language: Lichtwerk = round (domes, round shields, lenses); Aschehalle = angular (wedges, spikes, plates).
import type { TeamColors, Variant } from './styles';
import { luma } from './util';

export const KEYS = ['mira', 'renn', 'hagen', 'isolde', 'melee', 'caster', 'siege', 'super'] as const;
export type Key = (typeof KEYS)[number];
export const CHAMPS: Key[] = ['mira', 'renn', 'hagen', 'isolde'];
export const MINIONS: Key[] = ['melee', 'caster', 'siege', 'super'];
export const LABEL: Record<Key, string> = {
  mira: 'Mira Quell',
  renn: 'Renn Sieben',
  hagen: 'Mutter Hagen',
  isolde: 'Isolde',
  melee: 'Nahkampf',
  caster: 'Zauberer',
  siege: 'Belagerung',
  super: 'Super',
};
/** World height of a sprite cell (same scale as the game's SPRITE_SIZE). */
export const SIZE: Record<Key, number> = { mira: 255, renn: 255, hagen: 262, isolde: 255, melee: 165, caster: 165, siege: 210, super: 290 };

const CELL = 256;
type Ctx = CanvasRenderingContext2D;
interface FillOpts {
  metal?: boolean;
  glass?: boolean;
  glow?: boolean;
  rule?: CanvasFillRule;
  lw?: number;
}

const P = (d: string): Path2D => new Path2D(d);
function circle(x: number, y: number, r: number): Path2D {
  const p = new Path2D();
  p.arc(x, y, r, 0, Math.PI * 2);
  return p;
}
function ellipse(x: number, y: number, rx: number, ry: number): Path2D {
  const p = new Path2D();
  p.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  return p;
}
function ring(x: number, y: number, r: number, hole: number): Path2D {
  const p = circle(x, y, r);
  p.addPath(circle(x, y, hole));
  return p;
}
function ngon(x: number, y: number, r: number, n: number, rot = 0): Path2D {
  const p = new Path2D();
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    if (i) p.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else p.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  p.closePath();
  return p;
}

const BIG = (() => {
  const p = new Path2D();
  p.rect(-4000, -4000, 8256, 8256);
  return p;
})();
/** Everything except `p` shifted by (dx, dy) – use with clip(…, 'evenodd'). */
function outside(p: Path2D, dx: number, dy: number): Path2D {
  const r = new Path2D();
  r.addPath(BIG);
  r.addPath(p, new DOMMatrix().translate(dx, dy));
  return r;
}

const patterns = new Map<string, CanvasPattern>();
function hatch(ctx: Ctx, ink: string, cross: boolean): CanvasPattern {
  const key = ink + cross;
  let pat = patterns.get(key);
  if (!pat) {
    const c = document.createElement('canvas');
    c.width = c.height = 9;
    const g = c.getContext('2d')!;
    g.strokeStyle = ink;
    g.lineWidth = 2.2;
    g.lineCap = 'square';
    const diag = (flip: boolean) => {
      for (const o of [-9, 0, 9]) {
        g.beginPath();
        if (flip) {
          g.moveTo(o, 0);
          g.lineTo(o + 9, 9);
        } else {
          g.moveTo(o, 9);
          g.lineTo(o + 9, 0);
        }
        g.stroke();
      }
    };
    diag(false);
    if (cross) diag(true);
    pat = ctx.createPattern(c, 'repeat')!;
    patterns.set(key, pat);
  }
  return pat;
}

/** The style renderer: fill = lit base + form shadow + rim/specular + outline, all driven by the variant. */
class Painter {
  constructor(
    readonly ctx: Ctx,
    readonly v: Variant,
  ) {}

  get skin(): string {
    return this.v.sprite.skin;
  }

  fill(p: Path2D, base: string, o: FillOpts = {}): void {
    const { ctx } = this;
    const st = this.v.sprite;
    const rule = o.rule ?? 'nonzero';
    if (o.glow) {
      ctx.fillStyle = base;
      ctx.fill(p, rule);
    } else {
      ctx.fillStyle = st.lit(base);
      ctx.fill(p, rule);
      // form shadow = p minus p shifted toward the light (lower-left band, width ~ shadeShift)
      const s = st.shadeShift;
      ctx.save();
      ctx.clip(p, rule);
      ctx.clip(outside(p, s, -s), 'evenodd');
      if (st.shadeMode === 'hatch') {
        ctx.fillStyle = hatch(ctx, st.ink, luma(base) < 0.4);
      } else ctx.fillStyle = st.shade(base);
      ctx.fillRect(-50, -50, CELL + 100, CELL + 100);
      ctx.restore();
      // rim light (C: everything, warm) – band on the upper-right edge
      if (st.rim && (st.rim.all || o.metal || o.glass)) this.band(p, rule, st.rim.w, st.rim.color);
      // specular only on metal and glass
      if (o.metal || o.glass) this.band(p, rule, 3.5, st.spec);
      if (o.glass) {
        ctx.save();
        ctx.clip(p, rule);
        ctx.strokeStyle = st.spec;
        ctx.lineWidth = 3;
        const b = this.bounds(p);
        for (const t of [0.3, 0.55]) {
          ctx.beginPath();
          ctx.moveTo(b.x + b.w * t, b.y + b.h * 0.75);
          ctx.lineTo(b.x + b.w * (t + 0.25), b.y + b.h * 0.25);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    ctx.strokeStyle = st.ink;
    ctx.lineWidth = o.lw ?? st.lw;
    ctx.stroke(p);
  }

  private band(p: Path2D, rule: CanvasFillRule, w: number, color: string): void {
    const { ctx } = this;
    ctx.save();
    ctx.clip(p, rule);
    ctx.clip(outside(p, -w, w), 'evenodd');
    ctx.fillStyle = color;
    ctx.fillRect(-50, -50, CELL + 100, CELL + 100);
    ctx.restore();
  }

  /** Rough bounds of a path (sampled), for glass streaks. */
  private bounds(p: Path2D): { x: number; y: number; w: number; h: number } {
    const { ctx } = this;
    let x0 = CELL;
    let y0 = CELL;
    let x1 = 0;
    let y1 = 0;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let y = 0; y < CELL; y += 4)
      for (let x = 0; x < CELL; x += 4)
        if (ctx.isPointInPath(p, x, y)) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
    ctx.restore();
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  }

  /** Limb / pole: ink underlay + colour stroke. */
  limb(color: string, w: number, ...pts: number[]): void {
    const { ctx } = this;
    const lw = this.v.sprite.lw;
    for (const [c, width] of [[this.v.sprite.ink, w + lw * 1.2], [color, w]] as const) {
      ctx.strokeStyle = c;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(pts[0]!, pts[1]!);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
      ctx.stroke();
    }
  }

  curve(d: string, color: string, w: number): void {
    const { ctx } = this;
    const p = P(d);
    ctx.strokeStyle = this.v.sprite.ink;
    ctx.lineWidth = w + this.v.sprite.lw * 1.2;
    ctx.stroke(p);
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.stroke(p);
  }

  dot(x: number, y: number, w: number, h: number, color = this.v.sprite.ink): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }
}

const WOOD = '#7b5530';
const STEEL = '#c3cad2';

// --------------------------------------------------------------------------------------------- champions
// Champions keep their own colours on both teams; team is shown by ground ring / health bar (gameplay layer).
function mira(g: Painter): void {
  // tall-thin: bow longer than the whole figure
  g.fill(P('M 92 96 L 108 92 L 116 150 L 100 154 Z'), '#6b4a2c');
  g.limb('#efe6cf', 3, 98, 96, 90, 70);
  g.limb('#efe6cf', 3, 104, 94, 102, 68);
  g.limb('#3a3442', 10, 118, 196, 112, 244);
  g.limb('#3a3442', 10, 138, 196, 146, 244);
  g.fill(P('M 112 92 L 150 92 Q 170 150 166 204 L 92 204 Q 96 140 112 92 Z'), '#5d6e58');
  g.fill(P('M 104 150 L 157 150 L 158 160 L 103 160 Z'), '#c49a3e', { metal: true, lw: 5 });
  g.fill(circle(132, 72, 21), g.skin);
  g.fill(P('M 108 96 Q 100 40 136 42 Q 164 46 158 68 Q 140 56 122 70 Q 118 88 128 100 Z'), '#d8cdb0');
  g.dot(142, 68, 5, 5);
  g.limb(g.skin, 7, 146, 112, 182, 124);
  g.curve('M 178 12 Q 242 128 178 244', '#8a5a2e', 8);
  g.limb('#f4f0e6', 2, 178, 12, 178, 244);
  g.fill(P('M 200 116 L 210 116 L 212 140 L 202 140 Z'), '#c49a3e', { metal: true, lw: 4 });
}

function renn(g: Painter): void {
  // spiky star: seven blades fanned on the back
  const ox = 118;
  const oy = 106;
  for (let i = 0; i < 7; i++) {
    const a = ((-168 + i * 26) * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const nx = -dy;
    const ny = dx;
    const pt = (d: number, w: number) => `${(ox + dx * d + nx * w).toFixed(1)} ${(oy + dy * d + ny * w).toFixed(1)}`;
    g.fill(P(`M ${pt(32, 4)} L ${pt(62, 9)} L ${pt(112, 0)} L ${pt(62, -9)} L ${pt(32, -4)} Z`), STEEL, { metal: true, lw: 5 });
    g.fill(P(`M ${pt(28, 10)} L ${pt(34, 10)} L ${pt(34, -10)} L ${pt(28, -10)} Z`), '#b08a3c', { lw: 4 });
  }
  g.limb('#2d2b33', 10, 116, 190, 96, 244);
  g.limb('#2d2b33', 10, 136, 190, 160, 244);
  g.fill(P('M 104 98 L 146 98 L 162 196 L 150 188 L 140 202 L 128 190 L 116 204 L 104 190 L 92 198 Z'), '#3d3c48');
  g.fill(P('M 106 104 L 78 130 L 88 136 L 114 112 Z'), '#b08a3c', { lw: 5 });
  g.fill(P('M 102 94 L 152 94 L 150 112 L 106 112 Z'), '#b08a3c', { lw: 5 });
  g.fill(circle(128, 74, 20), g.skin);
  g.fill(P('M 106 72 Q 108 48 130 48 Q 152 50 152 66 L 142 60 L 134 68 L 124 58 L 114 74 Z'), '#2a2228');
  g.dot(140, 72, 5, 4);
  g.limb('#3d3c48', 9, 146, 112, 176, 138);
  g.fill(P('M 172 132 L 226 158 L 222 166 L 170 146 Z'), STEEL, { metal: true, lw: 5 });
}

function hagen(g: Painter): void {
  // wide-heavy: yoke across the shoulders, big bell forward, bucket behind
  g.limb('#b49a6a', 4, 52, 98, 52, 128);
  g.fill(P('M 34 128 L 70 128 L 64 162 L 40 162 Z'), WOOD);
  g.limb('#3a2e30', 12, 112, 220, 110, 246);
  g.limb('#3a2e30', 12, 144, 220, 148, 246);
  g.fill(P('M 96 112 L 160 112 L 186 238 L 70 238 Z'), '#5a4a5c');
  g.fill(P('M 112 140 L 152 140 L 160 226 L 106 226 Z'), '#e6dcc4');
  g.fill(P('M 90 100 L 166 100 L 172 142 L 84 142 Z'), '#7a5a42');
  g.fill(circle(128, 78, 22), g.skin);
  g.fill(P('M 103 82 Q 102 50 128 50 Q 156 50 154 82 L 146 74 Q 128 62 110 74 Z'), '#8f6a48');
  g.dot(140, 80, 5, 4);
  g.fill(P('M 30 90 L 226 90 Q 232 97 226 104 L 30 104 Q 24 97 30 90 Z'), WOOD, { lw: 6 });
  g.limb('#b49a6a', 4, 206, 104, 206, 118);
  g.fill(P('M 176 170 Q 178 118 206 116 Q 234 118 236 170 L 246 184 L 166 184 Z'), '#b5893a', { metal: true });
  g.fill(circle(206, 190, 8), '#6b5530', { metal: true, lw: 5 });
  g.limb('#7a5a42', 10, 160, 112, 184, 98);
}

function isolde(g: Painter): void {
  // angular-asymmetric: wire spool (hollow ring) on the back, big glass shard arm forward
  // spool sits clear of head/torso so its hole survives at 64 px
  g.limb('#a87a44', 4, 84, 92, 112, 104);
  g.fill(ring(80, 88, 31, 19), '#a87a44', { metal: true, rule: 'evenodd' });
  g.limb('#3b3530', 10, 118, 192, 110, 244);
  g.limb('#3b3530', 10, 138, 192, 154, 244);
  g.limb(g.skin, 7, 112, 110, 100, 152);
  g.fill(P('M 108 96 L 146 96 L 150 150 L 104 150 Z'), '#c3baa6');
  g.fill(P('M 102 130 L 152 130 L 162 206 L 96 206 Z'), '#7a5a3e');
  g.fill(circle(128, 72, 19), g.skin);
  g.fill(P('M 108 72 Q 108 50 130 50 Q 150 52 148 68 Q 136 58 122 64 Z'), '#d8c49a');
  g.fill(circle(110, 50, 10), '#d8c49a', { lw: 5 });
  g.fill(circle(140, 70, 6), '#c49a3e', { metal: true, lw: 4 });
  g.fill(P('M 138 98 L 170 104 L 198 136 L 186 148 L 148 124 Z'), '#cfe7ea', { glass: true });
  g.fill(P('M 182 132 L 248 64 L 238 114 L 200 152 Z'), '#cfe7ea', { glass: true });
  g.limb('#a87a44', 3, 160, 104, 152, 124);
  g.limb('#a87a44', 3, 176, 116, 166, 134);
  g.limb('#a87a44', 3, 196, 126, 210, 144);
}

// --------------------------------------------------------------------------------------------- minions
function melee(g: Painter, t: TeamColors, team: number): void {
  g.limb(t.dark, 12, 114, 214, 110, 246);
  g.limb(t.dark, 12, 142, 214, 146, 246);
  if (team === 0) {
    g.limb(WOOD, 7, 98, 190, 80, 140);
    g.fill(P('M 64 124 L 96 124 L 96 146 L 64 146 Z'), '#9aa0a6', { metal: true, lw: 6 });
    g.fill(ellipse(128, 182, 44, 42), t.primary);
    g.fill(P('M 96 150 A 34 34 0 0 1 164 150 Z'), t.secondary);
    g.fill(circle(130, 112, 8), t.accent, { metal: true, lw: 5 });
    g.dot(142, 140, 14, 5);
    g.fill(circle(170, 186, 28), t.accent, { metal: true });
    g.fill(circle(170, 186, 9), t.secondary, { lw: 4 });
  } else {
    g.limb(WOOD, 7, 98, 190, 82, 142);
    g.fill(P('M 64 110 L 94 120 L 90 152 L 68 146 Z'), STEEL, { metal: true, lw: 6 });
    g.fill(P('M 90 150 L 166 150 L 156 222 L 100 222 Z'), t.primary);
    g.fill(P('M 86 144 L 122 138 L 118 164 L 84 166 Z'), t.secondary, { lw: 6 });
    g.fill(P('M 98 152 L 102 116 L 132 102 L 170 134 L 156 152 Z'), t.secondary);
    g.fill(P('M 118 108 L 124 78 L 136 106 Z'), t.accent, { metal: true, lw: 5 });
    g.dot(144, 134, 14, 5, t.glow);
    g.fill(P('M 154 140 L 196 136 L 194 228 L 158 228 Z'), t.primary);
    g.fill(P('M 155 172 L 195 170 L 195 184 L 156 186 Z'), t.accent, { metal: true, lw: 5 });
  }
}

function caster(g: Painter, t: TeamColors, team: number): void {
  if (team === 0) {
    g.limb(WOOD, 6, 172, 96, 168, 246);
    g.fill(circle(172, 86, 15), t.glow, { glow: true });
    g.fill(P('M 158 66 L 186 66 L 180 58 L 164 58 Z'), t.accent, { metal: true, lw: 5 });
    g.fill(P('M 128 120 L 88 244 L 168 244 Z'), t.secondary);
    g.fill(P('M 95 224 L 161 224 L 168 244 L 88 244 Z'), t.primary, { lw: 5 });
    g.fill(circle(128, 112, 20), g.skin);
    g.fill(ellipse(128, 98, 36, 9), t.primary, { lw: 5 });
    g.fill(P('M 108 96 Q 110 64 128 64 Q 146 64 148 96 Z'), t.primary);
    g.dot(136, 110, 5, 5);
  } else {
    g.limb('#3a3436', 6, 172, 100, 168, 246);
    g.fill(P('M 150 88 L 194 88 L 184 108 L 160 108 Z'), t.accent, { metal: true, lw: 6 });
    g.fill(P('M 154 88 L 160 64 L 168 80 L 176 56 L 182 80 L 190 88 Z'), t.glow, { glow: true, lw: 5 });
    g.fill(P('M 128 118 L 82 244 L 174 244 L 152 168 Z'), t.accent);
    g.fill(P('M 90 222 L 166 222 L 174 244 L 82 244 Z'), t.secondary, { lw: 5 });
    g.fill(P('M 98 132 L 110 72 L 156 52 L 142 90 L 158 132 Z'), t.primary);
    g.fill(circle(138, 108, 12), g.skin, { lw: 5 });
    g.dot(142, 104, 5, 5);
  }
  g.limb(g.skin, 6, 140, 150, 166, 142);
}

function siege(g: Painter, t: TeamColors, team: number): void {
  if (team === 0) {
    g.fill(circle(100, 112, 18), g.skin);
    g.fill(P('M 82 110 Q 84 88 100 88 Q 116 88 118 110 Z'), t.secondary, { lw: 5 });
    g.fill(P('M 116 142 L 198 112 L 208 136 L 124 164 Z'), t.accent, { metal: true });
    g.fill(circle(210, 122, 20), t.glow, { glass: true });
    g.fill(P('M 58 146 Q 58 138 66 138 L 188 138 Q 196 138 196 146 L 196 202 Q 196 210 188 210 L 66 210 Q 58 210 58 202 Z'), t.primary);
    g.fill(P('M 58 150 L 196 150 L 196 162 L 58 162 Z'), t.accent, { metal: true, lw: 5 });
    for (const x of [86, 170]) {
      g.fill(circle(x, 216, 28), '#5a4030');
      g.fill(circle(x, 216, 9), t.accent, { metal: true, lw: 4 });
    }
  } else {
    g.fill(circle(100, 116, 16), g.skin);
    g.fill(P('M 80 120 L 92 82 L 120 92 L 116 120 Z'), t.primary, { lw: 5 });
    g.fill(P('M 66 96 L 88 96 L 92 146 L 62 146 Z'), t.accent);
    g.fill(P('M 126 104 L 178 84 L 192 146 L 138 156 Z'), t.primary);
    g.fill(P('M 130 120 L 184 104 L 186 116 L 132 132 Z'), t.secondary, { lw: 5 });
    g.fill(P('M 56 144 L 202 138 L 194 210 L 64 210 Z'), t.secondary);
    g.fill(P('M 58 150 L 200 146 L 200 160 L 58 164 Z'), t.accent, { lw: 5 });
    for (const x of [86, 172]) {
      g.fill(ngon(x, 216, 29, 6, Math.PI / 6), t.accent);
      g.fill(ngon(x, 216, 9, 4), t.secondary, { lw: 4 });
    }
  }
}

function superMinion(g: Painter, t: TeamColors, team: number): void {
  g.limb(t.dark, 18, 106, 200, 100, 246);
  g.limb(t.dark, 18, 152, 200, 160, 246);
  if (team === 0) {
    g.limb(t.primary, 14, 80, 140, 62, 186);
    g.fill(ellipse(128, 160, 66, 62), t.accent, { metal: true });
    g.fill(circle(128, 170, 20), t.glow, { glass: true });
    g.fill(P('M 76 122 L 180 122 L 176 136 L 80 136 Z'), t.primary, { lw: 5 });
    g.fill(circle(150, 84, 26), t.secondary);
    g.fill(P('M 154 78 L 176 78 L 176 90 L 154 90 Z'), t.glow, { glow: true, lw: 4 });
    g.limb(t.primary, 16, 182, 140, 206, 184);
    g.fill(circle(210, 196, 22), t.primary);
  } else {
    g.fill(P('M 84 98 L 76 50 L 96 56 L 100 96 Z'), t.accent, { metal: true, lw: 6 });
    g.fill(P('M 106 92 L 110 44 L 126 52 L 120 94 Z'), t.accent, { metal: true, lw: 6 });
    g.fill(P('M 62 196 L 70 126 L 118 94 L 184 110 L 198 186 L 172 216 L 84 216 Z'), t.primary);
    g.fill(P('M 58 122 L 96 90 L 114 118 L 80 152 Z'), t.accent);
    g.fill(P('M 74 120 L 94 104 L 100 118 L 82 134 Z'), t.glow, { glow: true, lw: 4 });
    g.fill(P('M 160 102 L 198 112 L 198 140 L 164 142 Z'), t.secondary);
    g.dot(180, 118, 12, 6, t.glow);
    g.limb(t.primary, 22, 180, 142, 212, 184);
    g.fill(P('M 194 176 L 232 180 L 228 216 L 190 212 Z'), t.accent, { metal: true });
  }
}

const DRAW: Record<Key, (g: Painter, t: TeamColors, team: number) => void> = {
  mira,
  renn,
  hagen,
  isolde,
  melee,
  caster,
  siege,
  super: superMinion,
};

const cache = new Map<string, HTMLCanvasElement>();
/** 256x256 sprite for a variant/key/team (cached). */
export function sprite(v: Variant, key: Key, team: number): HTMLCanvasElement {
  const id = `${v.id}:${key}:${team}`;
  let c = cache.get(id);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = CELL;
    const ctx = c.getContext('2d')!;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const [sx, sy] = v.sprite.chunk;
    ctx.translate(128, 248);
    ctx.scale(sx, sy);
    ctx.translate(-128, -248);
    DRAW[key](new Painter(ctx, v), v.team[team]!, team);
    cache.set(id, c);
  }
  return c;
}
