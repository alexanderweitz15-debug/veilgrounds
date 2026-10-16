// Procedural UI icons (placeholder art, Phase 6): items by stat category + a glyph from the item's name, abilities
// from the champion's outfit palette + a glyph for the ability type, summoner spells by id. Canvas-drawn once per id,
// cached as PNG data URLs and used as CSS backgrounds (shop, inventory, ability bar).
import { itemById } from '../sim/items/inventory';
import type { ItemData } from '../sim/items/schema';
import { championData } from '../sim/champions';
import { championKit } from '../render/champions/atlas';
import { MOTIF_RULES, abilityTheme } from '../render/abilityTheme';

const S = 64;
const cache = new Map<string, string>();

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  return [c, c.getContext('2d')!];
}

function cached(key: string, draw: (g: CanvasRenderingContext2D) => void): string {
  let url = cache.get(key);
  if (!url) {
    const [c, g] = canvas();
    draw(g);
    url = c.toDataURL('image/png');
    cache.set(key, url);
  }
  return url;
}

/** Show an icon as the element's background (no-op when unchanged); the text stays for screen readers via title. */
export function setIcon(el: HTMLElement, url: string | null): void {
  const v = url ? `url("${url}")` : '';
  if (el.dataset.iconUrl === (url ?? '')) return;
  el.dataset.iconUrl = url ?? '';
  el.style.backgroundImage = v;
  el.style.backgroundSize = v ? 'cover' : '';
  el.classList.toggle('has-icon', !!url);
}

// ------------------------------------------------------------------------------------------------ drawing helpers
function hsl(h: number, s: number, l: number): string {
  return `hsl(${h.toFixed(0)} ${s.toFixed(0)}% ${l.toFixed(0)}%)`;
}

function backdrop(g: CanvasRenderingContext2D, c0: string, c1: string): void {
  const gr = g.createRadialGradient(S * 0.35, S * 0.3, 4, S * 0.5, S * 0.5, S * 0.75);
  gr.addColorStop(0, c0);
  gr.addColorStop(1, c1);
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
}

function frame(g: CanvasRenderingContext2D, color: string, w = 3): void {
  g.strokeStyle = color;
  g.lineWidth = w;
  g.strokeRect(w / 2, w / 2, S - w, S - w);
}

/** Ink + fill a path built by `path`. */
function shape(g: CanvasRenderingContext2D, fill: string, path: () => void, ink = 'rgba(12,9,6,0.9)', lw = 3): void {
  g.beginPath();
  path();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.lineWidth = lw;
  g.strokeStyle = ink;
  g.stroke();
  g.fillStyle = fill;
  g.fill();
}

function line(g: CanvasRenderingContext2D, color: string, w: number, pts: number[]): void {
  g.beginPath();
  g.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i]!, pts[i + 1]!);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(12,9,6,0.9)';
  g.lineWidth = w + 3;
  g.stroke();
  g.strokeStyle = color;
  g.lineWidth = w;
  g.stroke();
}

const METAL = '#d9dde2';
const GOLD = '#e8c45a';
const WOOD = '#9a6a3a';

type Glyph = (g: CanvasRenderingContext2D, c: string) => void;

const GLYPHS: Record<string, Glyph> = {
  sword: (g, c) => {
    line(g, METAL, 6, [18, 46, 46, 18]);
    line(g, c, 5, [14, 38, 26, 50]);
    line(g, WOOD, 4, [20, 44, 12, 52]);
  },
  dagger: (g, c) => {
    shape(g, METAL, () => (g.moveTo(44, 16), g.lineTo(48, 20), g.lineTo(28, 40), g.lineTo(24, 36), g.closePath()));
    line(g, c, 4, [20, 32, 32, 44]);
    line(g, WOOD, 4, [24, 40, 16, 48]);
  },
  axe: (g, c) => {
    line(g, WOOD, 5, [20, 50, 40, 16]);
    shape(g, METAL, () => (g.moveTo(34, 20), g.quadraticCurveTo(52, 14, 50, 34), g.lineTo(38, 28), g.closePath()));
    g.fillStyle = c;
    g.fillRect(36, 18, 4, 4);
  },
  bow: (g, c) => {
    g.beginPath();
    g.arc(20, 32, 22, -1.1, 1.1);
    g.lineWidth = 7;
    g.strokeStyle = 'rgba(12,9,6,0.9)';
    g.stroke();
    g.lineWidth = 4;
    g.strokeStyle = WOOD;
    g.stroke();
    line(g, '#efe6cf', 1.5, [30, 13, 30, 51]);
    line(g, c, 3, [16, 32, 50, 32]);
  },
  crown: (g, c) => {
    shape(g, GOLD, () => (g.moveTo(14, 44), g.lineTo(14, 22), g.lineTo(24, 32), g.lineTo(32, 18), g.lineTo(40, 32), g.lineTo(50, 22), g.lineTo(50, 44), g.closePath()));
    shape(g, c, () => g.arc(32, 38, 4, 0, 7), undefined, 2);
  },
  chain: (g, c) => {
    for (const [x, y] of [[20, 22], [32, 32], [44, 42]] as const) {
      g.beginPath();
      g.ellipse(x, y, 9, 6, Math.PI / 4, 0, 7);
      g.lineWidth = 7;
      g.strokeStyle = 'rgba(12,9,6,0.9)';
      g.stroke();
      g.lineWidth = 4;
      g.strokeStyle = c;
      g.stroke();
    }
  },
  shield: (g, c) => {
    shape(g, c, () => (g.moveTo(32, 12), g.lineTo(50, 18), g.quadraticCurveTo(50, 42, 32, 54), g.quadraticCurveTo(14, 42, 14, 18), g.closePath()));
    line(g, METAL, 3, [32, 16, 32, 48]);
  },
  cloak: (g, c) => {
    shape(g, c, () => (g.moveTo(24, 12), g.lineTo(40, 12), g.lineTo(52, 52), g.quadraticCurveTo(32, 46, 12, 52), g.closePath()));
    line(g, GOLD, 3, [24, 16, 40, 16]);
  },
  staff: (g, c) => {
    line(g, WOOD, 5, [20, 52, 40, 20]);
    g.fillStyle = c;
    g.shadowColor = c;
    g.shadowBlur = 10;
    g.beginPath();
    g.arc(43, 17, 8, 0, 7);
    g.fill();
    g.shadowBlur = 0;
  },
  book: (g, c) => {
    shape(g, c, () => g.rect(16, 14, 30, 38));
    g.fillStyle = '#efe6cf';
    g.fillRect(44, 17, 4, 33);
    line(g, GOLD, 2, [22, 24, 38, 24]);
  },
  ring: (g, c) => {
    g.beginPath();
    g.arc(32, 36, 13, 0, 7);
    g.lineWidth = 9;
    g.strokeStyle = 'rgba(12,9,6,0.9)';
    g.stroke();
    g.lineWidth = 5;
    g.strokeStyle = GOLD;
    g.stroke();
    shape(g, c, () => (g.moveTo(32, 12), g.lineTo(39, 20), g.lineTo(32, 27), g.lineTo(25, 20), g.closePath()));
  },
  gem: (g, c) => {
    shape(g, c, () => (g.moveTo(32, 10), g.lineTo(48, 28), g.lineTo(32, 54), g.lineTo(16, 28), g.closePath()));
    line(g, 'rgba(255,255,255,0.7)', 2, [22, 28, 32, 14]);
  },
  lamp: (g, c) => {
    shape(g, GOLD, () => (g.moveTo(22, 46), g.lineTo(42, 46), g.lineTo(46, 52), g.lineTo(18, 52), g.closePath()));
    g.fillStyle = c;
    g.shadowColor = c;
    g.shadowBlur = 12;
    g.beginPath();
    g.ellipse(32, 32, 9, 13, 0, 0, 7);
    g.fill();
    g.shadowBlur = 0;
    line(g, GOLD, 3, [22, 18, 42, 18]);
  },
  hourglass: (g, c) => {
    line(g, WOOD, 4, [18, 14, 46, 14]);
    line(g, WOOD, 4, [18, 50, 46, 50]);
    shape(g, 'rgba(230,240,255,0.5)', () => (g.moveTo(22, 16), g.lineTo(42, 16), g.lineTo(34, 32), g.lineTo(42, 48), g.lineTo(22, 48), g.lineTo(30, 32), g.closePath()), undefined, 2);
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(25, 47);
    g.lineTo(39, 47);
    g.lineTo(32, 38);
    g.closePath();
    g.fill();
  },
  belt: (g, c) => {
    shape(g, c, () => g.rect(10, 26, 44, 12));
    shape(g, GOLD, () => g.rect(26, 23, 12, 18), undefined, 2);
  },
  horn: (g, c) => shape(g, c, () => (g.moveTo(14, 46), g.quadraticCurveTo(20, 20, 50, 14), g.quadraticCurveTo(36, 30, 24, 50), g.closePath())),
  heart: (g, c) =>
    shape(g, c, () => (g.moveTo(32, 52), g.bezierCurveTo(4, 32, 16, 8, 32, 22), g.bezierCurveTo(48, 8, 60, 32, 32, 52), g.closePath())),
  boot: (g, c) => shape(g, c, () => (g.moveTo(22, 12), g.lineTo(36, 12), g.lineTo(36, 38), g.lineTo(52, 44), g.lineTo(52, 52), g.lineTo(18, 52), g.closePath())),
  potion: (g, c) => {
    shape(g, c, () => g.arc(32, 40, 13, 0, 7));
    shape(g, '#efe6cf', () => g.rect(28, 14, 8, 14), undefined, 2);
  },
  eye: (g, c) => {
    shape(g, '#efe6cf', () => (g.moveTo(10, 32), g.quadraticCurveTo(32, 12, 54, 32), g.quadraticCurveTo(32, 52, 10, 32), g.closePath()));
    g.fillStyle = c;
    g.beginPath();
    g.arc(32, 32, 8, 0, 7);
    g.fill();
  },
  fang: (g, c) => {
    shape(g, '#efe6cf', () => (g.moveTo(20, 14), g.lineTo(44, 14), g.quadraticCurveTo(40, 36, 30, 54), g.quadraticCurveTo(26, 34, 20, 14), g.closePath()));
    line(g, c, 3, [24, 18, 40, 18]);
  },
};

/** Glyph from the (German) item id; fallback by main stat. */
function itemGlyph(it: ItemData): string {
  const id = it.id;
  const rules: [RegExp, string][] = [
    [/stiefel/, 'boot'], [/trank/, 'potion'], [/ward/, 'eye'], [/zahn/, 'fang'], [/bogen/, 'bow'], [/krone/, 'crown'],
    [/dolch/, 'dagger'], [/beil|hacke/, 'axe'], [/schwert|klinge|stahl|brecher/, 'sword'], [/kettenhemd|weste|wallherz/, 'shield'],
    [/kette/, 'chain'], [/mantel|gewand/, 'cloak'], [/stab/, 'staff'], [/buch/, 'book'], [/ring/, 'ring'], [/lampe/, 'lamp'],
    [/uhr|zeit/, 'hourglass'], [/guertel/, 'belt'], [/horn/, 'horn'], [/herz|wurzel/, 'heart'],
    [/kristall|splitter|glas|kern|schale|kelch/, 'gem'],
  ];
  for (const [re, gl] of rules) if (re.test(id)) return gl;
  const st = it.stats;
  if (st.ad || st.lethality) return 'sword';
  if (st.ap) return 'staff';
  if (st.armor) return 'shield';
  if (st.mr) return 'cloak';
  return 'gem';
}

/** Category hue from the item's stats: physical warm red, magic violet, tank green, resistances steel/blue, etc. */
function itemHue(it: ItemData): [number, number] {
  const st = it.stats;
  if (it.tier === 'boots') return [32, 35];
  if (it.tier === 'consumable') return [it.id.includes('ward') ? 50 : 350, 55];
  if (st.critPct || st.asPct) return [42, 70];
  if (st.ad || st.lethality) return [8, 60];
  if (st.ap) return [272, 45];
  if (st.mr) return [205, 45];
  if (st.armor) return [30, 18];
  if (st.hp) return [120, 35];
  if (st.mana || st.manaRegenPct || st.healShieldPowerPct) return [190, 55];
  return [40, 20];
}

const TIER_FRAME: Record<string, string> = { legendary: GOLD, component: '#b9c0c8', boots: '#a07850', basic: '#8a6a44', starter: '#8a6a44', consumable: '#6a5a44' };

/** Element accent from the (German) item id: [motif key, hue]. */
const ITEM_ACCENT: [RegExp, string, number][] = [
  [/sturm|wetter|funken/, 'bolt', 52],
  [/frost|kalt/, 'snow', 195],
  [/brand/, 'flame', 22],
  [/blut/, 'drop', 355],
  [/schleier|schwarz/, 'moon', 270],
  [/uhr|zeit/, 'gear', 42],
  [/leben|wurzel/, 'leaf', 110],
  [/schnelligkeit|eifer/, 'wing', 48],
  [/hueter|spender/, 'sun', 48],
];

/** Hash -> 0..1 (stable per id): small per-item variation inside a stat category. */
function idRand(id: string, k: number): number {
  let h = k * 2654435761;
  for (const ch of id) h = (Math.imul(h ^ ch.charCodeAt(0), 2246822519) + 3266489917) >>> 0;
  return (h % 10007) / 10007;
}

/** Painterly backdrop: radial light + a few soft diagonal brush strokes (fixed per item). */
function paintedBackdrop(g: CanvasRenderingContext2D, id: string, h: number, s: number): void {
  backdrop(g, hsl(h, s, 40), hsl(h, s * 0.8, 11));
  g.save();
  g.globalAlpha = 0.13;
  for (let i = 0; i < 7; i++) {
    const y = idRand(id, i + 1) * S;
    const x = idRand(id, i + 11) * S * 0.5;
    g.strokeStyle = i % 2 ? hsl(h, s, 70) : hsl(h, s * 0.6, 6);
    g.lineWidth = 5 + idRand(id, i + 21) * 7;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x - 10, y + 12);
    g.lineTo(x + 40, y - 14);
    g.stroke();
  }
  g.restore();
}

/** Tier frame: basic bronze, component silver with rivets, legendary gold with corner gems + inner glow. */
function tierFrame(g: CanvasRenderingContext2D, tier: string, h: number): void {
  if (tier === 'legendary') {
    const glow = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.72);
    glow.addColorStop(0, 'rgba(255,220,140,0)');
    glow.addColorStop(1, 'rgba(255,200,110,0.35)');
    g.fillStyle = glow;
    g.fillRect(0, 0, S, S);
    frame(g, '#5a4210', 6);
    frame(g, GOLD, 3);
    for (const [x, y] of [[4, 4], [S - 4, 4], [4, S - 4], [S - 4, S - 4]] as const) {
      g.fillStyle = hsl(h, 70, 55);
      g.beginPath();
      g.moveTo(x, y - 4);
      g.lineTo(x + 4, y);
      g.lineTo(x, y + 4);
      g.lineTo(x - 4, y);
      g.closePath();
      g.fill();
      g.strokeStyle = '#2a1e08';
      g.lineWidth = 1;
      g.stroke();
    }
  } else if (tier === 'component') {
    frame(g, '#2c2f33', 5);
    frame(g, '#c9d0d8', 2);
    g.fillStyle = '#e6ecf2';
    for (const [x, y] of [[5, 5], [S - 5, 5], [5, S - 5], [S - 5, S - 5]] as const) {
      g.beginPath();
      g.arc(x, y, 2, 0, 7);
      g.fill();
    }
  } else frame(g, TIER_FRAME[tier] ?? '#6a5a44', 3);
}

export function itemIcon(id: string): string | null {
  const it = itemById(id);
  if (!it) return null;
  return cached(`item:${id}`, (g) => {
    const [h0, s] = itemHue(it);
    const h = (h0 + (idRand(id, 99) - 0.5) * 24 + 360) % 360; // same category, slightly different hue per item
    paintedBackdrop(g, id, h, s);
    // main object with a drop shadow, then a soft top-left highlight (painted look)
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = 4;
    g.shadowOffsetX = 2;
    g.shadowOffsetY = 3;
    GLYPHS[itemGlyph(it)]!(g, hsl(h, Math.max(s, 55), 64));
    g.restore();
    const hl = g.createRadialGradient(S * 0.3, S * 0.25, 2, S * 0.3, S * 0.25, S * 0.45);
    hl.addColorStop(0, 'rgba(255,250,235,0.28)');
    hl.addColorStop(1, 'rgba(255,250,235,0)');
    g.fillStyle = hl;
    g.fillRect(0, 0, S, S);
    // element accent badge (bottom right)
    const acc = ITEM_ACCENT.find(([re]) => re.test(id));
    if (acc && it.tier !== 'basic') {
      g.save();
      g.fillStyle = 'rgba(12,9,6,0.82)';
      g.beginPath();
      g.arc(48, 48, 12, 0, 7);
      g.fill();
      g.translate(37, 37);
      g.scale(0.34, 0.34);
      (MOTIF[acc[1]] ?? GLYPHS[acc[1]] ?? GLYPHS.gem)!(g, hsl(acc[2], 85, 64));
      g.restore();
    }
    tierFrame(g, it.tier, h);
  });
}

// ------------------------------------------------------------------------------------------------ abilities
const hexToHsl = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  const r = ((n >> 16) & 255) / 255;
  const gg = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const mx = Math.max(r, gg, b);
  const mn = Math.min(r, gg, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = mx === r ? ((gg - b) / d) % 6 : mx === gg ? (b - r) / d + 2 : (r - gg) / d + 4;
  return [(h * 60 + 360) % 360, s * 100, l * 100];
};

/** Base + accent colour from the champion's outfit (most saturated material = accent). */
function champColors(champ: string): { base: string; accent: string } {
  const o = championKit(champ)?.outfit;
  if (!o) {
    let hsh = 0;
    for (const ch of champ) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
    return { base: hsl(hsh % 360, 35, 30), accent: hsl((hsh + 40) % 360, 70, 62) };
  }
  const mats = [o.coat?.mat, o.top, o.sleeves, o.cape?.mat, o.scarf?.mat, o.belt?.mat, o.apron?.mat, o.legs].filter((m): m is NonNullable<typeof m> => !!m && m.c.startsWith('#'));
  const base = (o.coat?.mat ?? o.top).c;
  let accent = base;
  let best = -1;
  for (const m of mats) {
    const [, s, l] = hexToHsl(m.c);
    const score = s * (1 - Math.abs(l - 55) / 60);
    if (score > best) (best = score), (accent = m.c);
  }
  return { base, accent };
}

const ABILITY_GLYPH: Record<string, Glyph> = {
  skillshot_line: (g, c) => {
    line(g, c, 6, [12, 52, 44, 20]);
    shape(g, c, () => (g.moveTo(52, 12), g.lineTo(48, 32), g.lineTo(32, 16), g.closePath()));
  },
  skillshot_circle: (g, c) => {
    for (const r of [18, 10]) {
      g.beginPath();
      g.arc(32, 34, r, 0, 7);
      g.lineWidth = 6;
      g.strokeStyle = 'rgba(12,9,6,0.85)';
      g.stroke();
      g.lineWidth = 3;
      g.strokeStyle = c;
      g.stroke();
    }
    shape(g, c, () => g.arc(32, 34, 4, 0, 7), undefined, 2);
  },
  zone: (g, c) => {
    g.fillStyle = c;
    g.globalAlpha = 0.35;
    g.beginPath();
    g.ellipse(32, 38, 24, 14, 0, 0, 7);
    g.fill();
    g.globalAlpha = 1;
    g.beginPath();
    g.ellipse(32, 38, 24, 14, 0, 0, 7);
    g.lineWidth = 3;
    g.strokeStyle = c;
    g.stroke();
    line(g, c, 3, [24, 34, 24, 18]);
    line(g, c, 3, [32, 36, 32, 12]);
    line(g, c, 3, [40, 34, 40, 18]);
  },
  cone: (g, c) => shape(g, c, () => (g.moveTo(12, 50), g.lineTo(52, 18), g.quadraticCurveTo(58, 40, 44, 56), g.closePath())),
  self: (g, c) => {
    g.shadowColor = c;
    g.shadowBlur = 14;
    shape(g, c, () => {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const r = i % 2 ? 9 : 22;
        const x = 32 + Math.cos(a) * r;
        const y = 32 + Math.sin(a) * r;
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.closePath();
    });
    g.shadowBlur = 0;
  },
  dash: (g, c) => {
    for (const x of [14, 28, 42]) line(g, c, 5, [x, 18, x + 10, 32, x, 46]);
  },
  blink: (g, c) => {
    g.setLineDash([4, 6]);
    line(g, c, 3, [12, 48, 40, 24]);
    g.setLineDash([]);
    shape(g, c, () => {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = i % 2 ? 4 : 12;
        const x = 44 + Math.cos(a) * r;
        const y = 20 + Math.sin(a) * r;
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.closePath();
    });
  },
  targeted: (g, c) => shape(g, c, () => (g.moveTo(38, 8), g.lineTo(18, 36), g.lineTo(30, 36), g.lineTo(24, 56), g.lineTo(46, 26), g.lineTo(34, 26), g.closePath())),
  summon: (g, c) => {
    shape(g, c, () => g.ellipse(32, 40, 11, 9, 0, 0, 7));
    for (const [x, y] of [[18, 26], [26, 18], [38, 18], [46, 26]] as const) shape(g, c, () => g.arc(x, y, 5, 0, 7), undefined, 2);
  },
};

// ------------------------------------------------------------------------------------------------ ability motifs
/** Thematic glyphs: what the ability IS (fire, lightning, hook…), not only its targeting type. */
const MOTIF: Record<string, Glyph> = {
  arrow: (g, c) => {
    line(g, WOOD, 4, [14, 50, 46, 18]);
    shape(g, METAL, () => (g.moveTo(52, 12), g.lineTo(48, 28), g.lineTo(36, 16), g.closePath()));
    line(g, c, 4, [14, 50, 10, 42]);
    line(g, c, 4, [14, 50, 22, 54]);
  },
  flame: (g, c) => {
    shape(g, c, () => (g.moveTo(32, 6), g.bezierCurveTo(54, 26, 50, 40, 44, 50), g.quadraticCurveTo(32, 60, 20, 50), g.bezierCurveTo(12, 38, 18, 26, 26, 18), g.quadraticCurveTo(26, 30, 32, 32), g.quadraticCurveTo(28, 18, 32, 6), g.closePath()));
    shape(g, '#ffe7a0', () => (g.moveTo(32, 30), g.quadraticCurveTo(42, 40, 38, 48), g.quadraticCurveTo(32, 54, 26, 48), g.quadraticCurveTo(24, 40, 32, 30), g.closePath()), undefined, 2);
  },
  bolt: (g, c) => shape(g, c, () => (g.moveTo(38, 4), g.lineTo(16, 34), g.lineTo(30, 34), g.lineTo(22, 60), g.lineTo(48, 26), g.lineTo(34, 26), g.lineTo(42, 4), g.closePath())),
  wave: (g, c) => {
    for (const y of [22, 34, 46]) line(g, c, 5, [8, y, 18, y - 6, 28, y, 38, y - 6, 48, y, 56, y - 5]);
  },
  hook: (g, c) => {
    line(g, METAL, 5, [32, 6, 32, 34]);
    g.beginPath();
    g.arc(24, 36, 12, 0, Math.PI, false);
    g.lineWidth = 9;
    g.strokeStyle = 'rgba(12,9,6,0.9)';
    g.stroke();
    g.lineWidth = 6;
    g.strokeStyle = c;
    g.stroke();
    shape(g, c, () => (g.moveTo(10, 36), g.lineTo(6, 26), g.lineTo(16, 32), g.closePath()), undefined, 2);
  },
  web: (g, c) => {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      line(g, c, 2, [32, 32, 32 + Math.cos(a) * 26, 32 + Math.sin(a) * 26]);
    }
    for (const r of [9, 17, 25]) {
      g.beginPath();
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        if (i) g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
        else g.moveTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
      }
      g.lineWidth = 2;
      g.strokeStyle = c;
      g.stroke();
    }
  },
  gear: (g, c) => {
    shape(g, c, () => {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const r = i % 2 ? 18 : 25;
        if (i) g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
        else g.moveTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
      }
      g.closePath();
    });
    shape(g, '#1a1410', () => g.arc(32, 32, 8, 0, 7), undefined, 2);
    line(g, '#efe6cf', 3, [32, 32, 32, 16]);
  },
  bell: (g, c) => {
    shape(g, c, () => (g.moveTo(32, 8), g.bezierCurveTo(46, 8, 46, 22, 48, 42), g.lineTo(54, 48), g.lineTo(10, 48), g.lineTo(16, 42), g.bezierCurveTo(18, 22, 18, 8, 32, 8), g.closePath()));
    shape(g, METAL, () => g.arc(32, 52, 5, 0, 7), undefined, 2);
  },
  claw: (g, c) => {
    for (const dx of [-12, 0, 12]) line(g, c, 5, [24 + dx, 10, 34 + dx, 30, 30 + dx, 54]);
  },
  moon: (g, c) => {
    shape(g, c, () => (g.arc(32, 32, 22, Math.PI * 0.3, Math.PI * 1.7, false), g.arc(40, 30, 17, Math.PI * 1.55, Math.PI * 0.45, true), g.closePath()));
    shape(g, '#efe6cf', () => g.arc(46, 18, 3, 0, 7), undefined, 1);
  },
  sun: (g, c) => {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      line(g, c, 4, [32 + Math.cos(a) * 16, 32 + Math.sin(a) * 16, 32 + Math.cos(a) * 27, 32 + Math.sin(a) * 27]);
    }
    shape(g, '#ffe7a0', () => g.arc(32, 32, 12, 0, 7));
  },
  bomb: (g, c) => {
    shape(g, '#3a3028', () => g.arc(30, 38, 17, 0, 7));
    line(g, WOOD, 3, [40, 24, 48, 14]);
    GLYPHS_SPARK(g, c, 50, 11);
  },
  banner: (g, c) => {
    line(g, WOOD, 4, [18, 8, 18, 58]);
    shape(g, c, () => (g.moveTo(20, 10), g.lineTo(50, 10), g.lineTo(44, 22), g.lineTo(50, 34), g.lineTo(20, 34), g.closePath()));
  },
  spiral: (g, c) => {
    g.beginPath();
    for (let i = 0; i <= 60; i++) {
      const a = i * 0.32;
      const r = 3 + i * 0.42;
      if (i) g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
      else g.moveTo(32, 32);
    }
    g.lineWidth = 8;
    g.strokeStyle = 'rgba(12,9,6,0.9)';
    g.stroke();
    g.lineWidth = 5;
    g.strokeStyle = c;
    g.stroke();
  },
  snow: (g, c) => {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI;
      line(g, c, 4, [32 - Math.cos(a) * 24, 32 - Math.sin(a) * 24, 32 + Math.cos(a) * 24, 32 + Math.sin(a) * 24]);
    }
  },
  glass: (g, c) => shape(g, c, () => (g.moveTo(32, 6), g.lineTo(50, 24), g.lineTo(40, 58), g.lineTo(24, 58), g.lineTo(14, 24), g.closePath())),
  root: (g, c) => {
    line(g, c, 6, [32, 8, 32, 40, 18, 56]);
    line(g, c, 5, [32, 40, 46, 56]);
    line(g, c, 4, [32, 26, 46, 18]);
    line(g, c, 4, [32, 30, 18, 22]);
  },
  drop: (g, c) => shape(g, c, () => (g.moveTo(32, 6), g.bezierCurveTo(46, 26, 50, 36, 44, 48), g.quadraticCurveTo(32, 60, 20, 48), g.bezierCurveTo(14, 36, 18, 26, 32, 6), g.closePath())),
  leaf: (g, c) => {
    shape(g, c, () => (g.moveTo(10, 54), g.quadraticCurveTo(14, 12, 54, 10), g.quadraticCurveTo(50, 50, 10, 54), g.closePath()));
    line(g, 'rgba(12,9,6,0.6)', 2, [14, 50, 46, 16]);
  },
  wing: (g, c) => {
    for (const [dy, len] of [[0, 40], [10, 34], [20, 26]] as const) shape(g, c, () => (g.moveTo(14, 20 + dy), g.quadraticCurveTo(14 + len * 0.6, 8 + dy, 14 + len, 14 + dy), g.quadraticCurveTo(14 + len * 0.5, 22 + dy, 14, 28 + dy), g.closePath()), undefined, 2);
  },
};

function GLYPHS_SPARK(g: CanvasRenderingContext2D, c: string, x: number, y: number): void {
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    line(g, c, 2, [x, y, x + Math.cos(a) * 7, y + Math.sin(a) * 7]);
  }
}


function abilityMotif(champ: string, slot: number): [Glyph, number] | null {
  const m = abilityTheme(champ, slot);
  return m ? [(MOTIF[m.motif] ?? GLYPHS[m.motif])!, m.hue] : null;
}

/** Ability icon for champion `champ`, slot 0..3 (R gets a gold frame): thematic motif + element colour on the champion palette. */
export function abilityIcon(champ: string, slot: number): string | null {
  const ab = championData(champ)?.abilities[slot];
  if (!ab) return null;
  return cached(`ab:${champ}:${slot}`, (g) => {
    const { base, accent } = champColors(champ);
    const [h, s] = hexToHsl(base);
    backdrop(g, hsl(h, Math.min(60, s + 10), 30), hsl(h, s, 8));
    const motif = abilityMotif(champ, slot);
    if (motif) {
      // same motif on an earlier slot of this champion: shift the hue so Q/W/E/R stay distinguishable
      let repeats = 0;
      for (let k = 0; k < slot; k++) if (abilityMotif(champ, k)?.[0] === motif[0]) repeats++;
      motif[0](g, hsl((motif[1] + repeats * 47) % 360, 75, 62));
      // small targeting-type badge (line / circle / dash / zone …) in the corner
      g.save();
      g.fillStyle = 'rgba(12,9,6,0.8)';
      g.beginPath();
      g.arc(50, 50, 12, 0, 7);
      g.fill();
      g.translate(39, 39);
      g.scale(0.34, 0.34);
      (ABILITY_GLYPH[ab.type] ?? ABILITY_GLYPH.self!)(g, '#efe6cf');
      g.restore();
    } else {
      const [ah, as] = hexToHsl(accent);
      (ABILITY_GLYPH[ab.type] ?? ABILITY_GLYPH.self!)(g, hsl(ah, Math.max(55, as), 66));
    }
    frame(g, slot === 3 ? GOLD : 'rgba(12,9,6,0.9)', slot === 3 ? 4 : 2);
  });
}

const SUMMONER: Record<string, [number, Glyph]> = {
  sprung: [50, ABILITY_GLYPH.blink!],
  heilen: [120, (g, c) => shape(g, c, () => (g.rect(26, 12, 12, 40), g.rect(12, 26, 40, 12)))],
  geist: [190, ABILITY_GLYPH.dash!],
  entflammen: [18, (g, c) => shape(g, c, () => (g.moveTo(32, 8), g.quadraticCurveTo(52, 30, 44, 50), g.quadraticCurveTo(32, 58, 20, 50), g.quadraticCurveTo(12, 30, 32, 8), g.closePath()))],
  erschoepfen: [30, (g, c) => line(g, c, 5, [16, 20, 28, 30, 20, 38, 34, 48])],
  reinigen: [175, ABILITY_GLYPH.self!],
  teleport: [280, (g, c) => {
    for (const r of [20, 13, 6]) {
      g.beginPath();
      g.arc(32, 32, r, 0, 7);
      g.lineWidth = 4;
      g.strokeStyle = c;
      g.stroke();
    }
  }],
  bannen: [345, ABILITY_GLYPH.targeted!],
};

export function summonerIcon(id: string): string | null {
  const def = SUMMONER[id];
  if (!def) return null;
  return cached(`sum:${id}`, (g) => {
    const [h, glyph] = def;
    backdrop(g, hsl(h, 55, 36), hsl(h, 45, 10));
    glyph(g, hsl(h, 80, 68));
    frame(g, '#a07850', 3);
  });
}

// ------------------------------------------------------------------------------------------------ passive / runes / roles / stats
/** Champion passive: champion palette, gem glyph, round silver frame. */
export function passiveIcon(champ: string): string | null {
  if (!championData(champ)) return null;
  return cached(`pas:${champ}`, (g) => {
    const { base, accent } = champColors(champ);
    const [h, s] = hexToHsl(base);
    backdrop(g, hsl(h, Math.min(60, s + 10), 30), hsl(h, s, 8));
    const p = championData(champ)!.passive;
    const text = `${p.name.en} ${p.desc.en}`.toLowerCase();
    const rule = MOTIF_RULES.find(([re]) => re.test(text));
    const [ah, as] = hexToHsl(accent);
    if (rule) (MOTIF[rule[1]] ?? GLYPHS[rule[1]])!(g, hsl(rule[2], 70, 64));
    else GLYPHS.gem!(g, hsl(ah, Math.max(55, as), 68));
    frame(g, '#b9b2a2', 3);
  });
}

const RUNE_GLYPHS = ['sword', 'dagger', 'crown', 'shield', 'staff', 'book', 'gem', 'heart', 'horn', 'eye', 'fang', 'hourglass'];

/** Rune (Prägung): keystones big glyph + gold frame, minors smaller with bronze frame; hue + glyph from the id. */
export function runeIcon(id: string, keystone: boolean): string {
  return cached(`rune:${id}`, (g) => {
    let hsh = 0;
    for (const ch of id) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
    const h = hsh % 360;
    backdrop(g, hsl(h, 45, keystone ? 34 : 26), hsl(h, 40, 8));
    GLYPHS[RUNE_GLYPHS[hsh % RUNE_GLYPHS.length]!]!(g, hsl(h, 75, keystone ? 70 : 62));
    frame(g, keystone ? GOLD : '#8a6a44', keystone ? 4 : 3);
  });
}

const ROLE_GLYPH: Record<string, [number, string]> = { top: [25, 'shield'], jungle: [110, 'fang'], mid: [265, 'staff'], adc: [5, 'bow'], support: [190, 'heart'] };

export function roleIcon(role: string): string | null {
  const def = ROLE_GLYPH[role];
  if (!def) return null;
  return cached(`role:${role}`, (g) => {
    backdrop(g, hsl(def[0], 30, 26), hsl(def[0], 25, 8));
    GLYPHS[def[1]]!(g, hsl(def[0], 60, 70));
    frame(g, '#8a7550', 2);
  });
}

const STAT_GLYPH: Record<string, [number, string]> = {
  ad: [20, 'sword'], ap: [275, 'book'], armor: [35, 'shield'], mr: [200, 'cloak'], as: [45, 'dagger'],
  ms: [100, 'boot'], range: [5, 'bow'], crit: [0, 'axe'], hp: [130, 'heart'], mana: [215, 'potion'], haste: [175, 'hourglass'],
};

export function statIcon(stat: string): string | null {
  const def = STAT_GLYPH[stat];
  if (!def) return null;
  return cached(`stat:${stat}`, (g) => {
    g.clearRect(0, 0, S, S);
    GLYPHS[def[1]]!(g, hsl(def[0], 70, 64));
  });
}

/** Kesselbrut (grub objective): a curled, segmented violet grub with ember mandibles on a transparent ground. */
export function kesselbrutIcon(): string {
  return cached('obj:kesselbrut', (g) => {
    g.clearRect(0, 0, S, S);
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(12,9,6,0.95)';
    // body: four segments shrinking towards the tail, curled around the centre
    const segs: [number, number, number][] = [[22, 40, 9], [34, 44, 11], [44, 34, 12], [40, 20, 13]];
    segs.forEach(([x, y, r], i) => {
      const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.4, 1, x, y, r);
      gr.addColorStop(0, i === 3 ? '#e4c8ff' : '#c9a6f0');
      gr.addColorStop(1, '#5d3d8c');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    });
    // mandibles + eye glow
    g.fillStyle = '#ff9a3c';
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(40 + s * 5, 10);
      g.lineTo(40 + s * 11, 2);
      g.lineTo(40 + s * 2, 7);
      g.closePath();
      g.fill();
      g.stroke();
    }
    g.fillStyle = '#ffe2a0';
    g.beginPath();
    g.arc(44, 17, 2.6, 0, Math.PI * 2);
    g.fill();
  });
}
