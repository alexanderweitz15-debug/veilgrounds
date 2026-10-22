// D2: crowd-control symbols for the HP-bar chips (src/ui/overlay.ts draws the chip; agent C wires the glyph in, see
// docs/agents/shared-changes.md). Each CC type has its own shape, not only a colour: stun = circling stars, root =
// vine knot, slow = down chevrons, silence = crossed-out mouth, blind = closed eye, airborne = up arrow, suppress =
// chain link, stasis = hourglass. Canvas 2D only, drawn into a box of size s centred at (x, y); no DOM access here.

export type CcKey = 'stasis' | 'suppress' | 'airborne' | 'stun' | 'fear' | 'root' | 'silence' | 'blind' | 'slow';
export const CC_GLYPH_KEYS: readonly CcKey[] = ['stasis', 'suppress', 'airborne', 'stun', 'fear', 'root', 'silence', 'blind', 'slow'];

type Draw = (g: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, t: number) => void;

const stroke = (g: CanvasRenderingContext2D, color: string, w: number): void => {
  g.strokeStyle = color;
  g.lineWidth = w;
  g.lineCap = 'round';
  g.lineJoin = 'round';
};

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
}

const GLYPHS: Record<CcKey, Draw> = {
  stun: (g, x, y, s, c, t) => {
    g.fillStyle = c;
    for (let i = 0; i < 3; i++) {
      const a = t / 260 + (i / 3) * Math.PI * 2;
      star(g, x + Math.cos(a) * s * 0.32, y + Math.sin(a) * s * 0.16, s * 0.2);
    }
  },
  root: (g, x, y, s, c) => {
    stroke(g, c, s * 0.12);
    g.beginPath();
    g.ellipse(x, y + s * 0.15, s * 0.38, s * 0.16, 0, 0, Math.PI * 2);
    g.moveTo(x - s * 0.2, y + s * 0.1);
    g.quadraticCurveTo(x - s * 0.35, y - s * 0.3, x - s * 0.1, y - s * 0.38);
    g.moveTo(x + s * 0.2, y + s * 0.1);
    g.quadraticCurveTo(x + s * 0.35, y - s * 0.3, x + s * 0.1, y - s * 0.38);
    g.stroke();
  },
  slow: (g, x, y, s, c) => {
    stroke(g, c, s * 0.13);
    g.beginPath();
    for (const dy of [-0.18, 0.12]) {
      g.moveTo(x - s * 0.3, y + dy * s - s * 0.1);
      g.lineTo(x, y + dy * s + s * 0.12);
      g.lineTo(x + s * 0.3, y + dy * s - s * 0.1);
    }
    g.stroke();
  },
  silence: (g, x, y, s, c) => {
    stroke(g, c, s * 0.11);
    g.beginPath();
    g.ellipse(x, y, s * 0.3, s * 0.18, 0, 0, Math.PI * 2);
    g.moveTo(x - s * 0.38, y + s * 0.32);
    g.lineTo(x + s * 0.38, y - s * 0.32);
    g.stroke();
  },
  blind: (g, x, y, s, c) => {
    stroke(g, c, s * 0.11);
    g.beginPath();
    g.moveTo(x - s * 0.38, y);
    g.quadraticCurveTo(x, y + s * 0.32, x + s * 0.38, y);
    for (const k of [-0.22, 0, 0.22]) {
      g.moveTo(x + k * s, y + s * 0.15);
      g.lineTo(x + k * s * 1.3, y + s * 0.32);
    }
    g.stroke();
  },
  airborne: (g, x, y, s, c, t) => {
    const b = Math.sin(t / 150) * s * 0.06;
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(x, y - s * 0.42 + b);
    g.lineTo(x + s * 0.32, y - s * 0.02 + b);
    g.lineTo(x + s * 0.12, y - s * 0.02 + b);
    g.lineTo(x + s * 0.12, y + s * 0.38 + b);
    g.lineTo(x - s * 0.12, y + s * 0.38 + b);
    g.lineTo(x - s * 0.12, y - s * 0.02 + b);
    g.lineTo(x - s * 0.32, y - s * 0.02 + b);
    g.closePath();
    g.fill();
  },
  suppress: (g, x, y, s, c) => {
    stroke(g, c, s * 0.11);
    g.beginPath();
    g.ellipse(x - s * 0.15, y, s * 0.2, s * 0.12, -0.5, 0, Math.PI * 2);
    g.moveTo(x + s * 0.35, y);
    g.ellipse(x + s * 0.15, y, s * 0.2, s * 0.12, -0.5, 0, Math.PI * 2);
    g.stroke();
  },
  fear: (g, x, y, s, c, t) => {
    // wide eye with a shaking pupil and a sweat drop (Sev R / fear CC)
    const j = Math.sin(t / 45) * s * 0.04;
    stroke(g, c, s * 0.1);
    g.beginPath();
    g.moveTo(x - s * 0.4, y);
    g.quadraticCurveTo(x, y - s * 0.38, x + s * 0.4, y);
    g.quadraticCurveTo(x, y + s * 0.38, x - s * 0.4, y);
    g.stroke();
    g.fillStyle = c;
    g.beginPath();
    g.arc(x + j, y, s * 0.1, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(x + s * 0.38, y - s * 0.42);
    g.quadraticCurveTo(x + s * 0.48, y - s * 0.26, x + s * 0.38, y - s * 0.2);
    g.quadraticCurveTo(x + s * 0.28, y - s * 0.26, x + s * 0.38, y - s * 0.42);
    g.fill();
  },
  stasis: (g, x, y, s, c) => {
    stroke(g, c, s * 0.1);
    g.beginPath();
    g.moveTo(x - s * 0.28, y - s * 0.38);
    g.lineTo(x + s * 0.28, y - s * 0.38);
    g.lineTo(x - s * 0.28, y + s * 0.38);
    g.lineTo(x + s * 0.28, y + s * 0.38);
    g.closePath();
    g.stroke();
  },
};

/** Draws the symbol of CC `key` (box size s centred at x, y); `t` = ms clock for the animated ones. */
export function drawCcGlyph(g: CanvasRenderingContext2D, key: string, x: number, y: number, s: number, color: string, t: number): void {
  const d = GLYPHS[key as CcKey];
  if (!d) return;
  g.save();
  d(g, x, y, s, color, t);
  g.restore();
}
