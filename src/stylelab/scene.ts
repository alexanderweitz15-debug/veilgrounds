// Builds the comparison scene for one variant: a mid-lane segment with a tower per team, minions of both teams
// fighting, the four example champions, jungle (walls, trees, bush), the river and the rift with mist, plus a
// structure lineup (tower / inhibitor / nexus per team) further south. Same layout for every variant.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CHAMPS, SIZE, sprite, type Key } from './figures';
import { REL, type TeamColors, type Variant } from './styles';
import { PITCH, at, disposeOutlineMats, mix, mulberry, outlineMesh, paint, radialCanvas, scale } from './util';

type V2 = [number, number];

// ------------------------------------------------------------------------------------------------ layout
export const BOUNDS = { x0: -3800, x1: 3800, y0: -6400, y1: 3000 };
const LANE_DIR: V2 = [0.848, 0.53];
const LANE_N: V2 = [-0.53, 0.848];
const LANE_HW = 380;
const LANE: V2[] = [
  [-4600, -2875],
  [4600, 2875],
];
const RIVER_HW = 330;
const RIVER: V2[] = (() => {
  const pts: V2[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const w = Math.sin(t * Math.PI * 3) * 120;
    pts.push([-2500 + 3200 * t + w * 0.7, 2600 - 3300 * t + w * 0.6]);
  }
  return pts;
})();
const RIFT_A: V2 = [520, -430];
const RIFT_B: V2 = [1850, -1020];
const RIFT_HW = 240;
const RIFT: V2[] = (() => {
  const rnd = mulberry(11);
  const [ax, ay] = RIFT_A;
  const dx = RIFT_B[0] - ax;
  const dy = RIFT_B[1] - ay;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  const up: V2[] = [];
  const down: V2[] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const hw = riftHw(t);
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    up.push([cx + nx * (hw + (rnd() - 0.5) * 70), cy + ny * (hw + (rnd() - 0.5) * 70)]);
    down.push([cx - nx * (hw + (rnd() - 0.5) * 70), cy - ny * (hw + (rnd() - 0.5) * 70)]);
  }
  return [...up, ...down.reverse()];
})();
function riftHw(t: number): number {
  return RIFT_HW * Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.55) + 6;
}
const WALLS: V2[][] = [
  [
    [-2100, 150],
    [-1450, 0],
    [-1150, 350],
    [-1300, 750],
    [-1850, 850],
    [-2250, 500],
  ],
  [
    [1500, -50],
    [2150, -220],
    [2550, 250],
    [2250, 620],
    [1700, 500],
  ],
  [
    [-1700, -1350],
    [-1050, -1500],
    [-800, -1150],
    [-1200, -950],
    [-1750, -1000],
  ],
];
const BUSHES = [
  { x: -1000, y: 150, r: 210 },
  { x: 1150, y: -150, r: 200 },
];
/** Lane position: s along the lane, o across it. */
function lane(s: number, o: number): V2 {
  return [LANE_DIR[0] * s + LANE_N[0] * o, LANE_DIR[1] * s + LANE_N[1] * o];
}
const TOWERS = [
  { team: 0, p: lane(-1220, 0) },
  { team: 1, p: lane(1330, 0) },
];
const LINEUP_Y = [-5350, -4350]; // Lichtwerk front row, Aschehalle back row
const LINEUP_X = { tower: -1450, inhib: -350, nexus: 1000 };

interface Unit {
  key: Key;
  team: number;
  s: number;
  o: number;
}
const UNITS: Unit[] = [
  { key: 'super', team: 0, s: -860, o: -70 },
  { key: 'siege', team: 0, s: -720, o: 60 },
  { key: 'caster', team: 0, s: -560, o: -40 },
  { key: 'caster', team: 0, s: -560, o: 120 },
  { key: 'melee', team: 0, s: -360, o: -60 },
  { key: 'melee', team: 0, s: -350, o: 80 },
  { key: 'melee', team: 1, s: -190, o: -40 },
  { key: 'melee', team: 1, s: -180, o: 100 },
  { key: 'caster', team: 1, s: 20, o: -10 },
  { key: 'caster', team: 1, s: 30, o: 140 },
  { key: 'siege', team: 1, s: 200, o: 50 },
  { key: 'super', team: 1, s: 360, o: -70 },
  { key: 'mira', team: 0, s: -760, o: -300 },
  { key: 'hagen', team: 0, s: -330, o: -280 },
  { key: 'renn', team: 1, s: 30, o: -300 },
  { key: 'isolde', team: 1, s: -120, o: 300 },
];

// ------------------------------------------------------------------------------------------------ geometry queries
function distSeg(px: number, py: number, a: V2, b: V2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - a[0] - dx * t, py - a[1] - dy * t);
}
function distPoly(px: number, py: number, pts: V2[]): number {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, distSeg(px, py, pts[i]!, pts[i + 1]!));
  return d;
}
function inPoly(px: number, py: number, poly: V2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** 0..1 how deep inside the (smooth) rift a point is; 0 = outside. */
function riftDepth(px: number, py: number): number {
  const dx = RIFT_B[0] - RIFT_A[0];
  const dy = RIFT_B[1] - RIFT_A[1];
  const len2 = dx * dx + dy * dy;
  const t = ((px - RIFT_A[0]) * dx + (py - RIFT_A[1]) * dy) / len2;
  if (t < 0 || t > 1) return 0;
  const d = Math.abs((px - RIFT_A[0]) * dy - (py - RIFT_A[1]) * dx) / Math.sqrt(len2);
  const hw = riftHw(t);
  return d < hw ? Math.min(1, (hw - d) / 90) : 0;
}
function inPlaza(_px: number, py: number): number {
  return py < -3500 ? Math.min(1, (-3500 - py) / 300) : 0;
}

// ------------------------------------------------------------------------------------------------ materials
type MatFn = (p: THREE.MeshLambertMaterialParameters) => THREE.MeshLambertMaterial;

const HEADER = `
uniform vec3 uPaper; uniform vec3 uInk; uniform vec3 uShadow; uniform vec3 uRim; uniform vec3 uSun;
uniform float uToneRef; uniform float uPx;
float labLine(float d, float spacing, float halfW) {
  float x = abs(fract(d / spacing) - 0.5) * spacing;
  return 1.0 - smoothstep(halfW, halfW + 0.9, x);
}
`;
const TONE = `
  float labBase = max(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.02);
  float tone = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722)) / labBase / uToneRef;
`;
// A: engraving. Flat paper-tinted base colour; light only decides how many hatch layers are cut in.
const HATCH = `
  ${TONE}
  vec2 fc = gl_FragCoord.xy / uPx;
  float ink = 0.0;
  ink = max(ink, labLine(fc.x + fc.y, 7.0, 0.85) * (1.0 - smoothstep(0.78, 0.84, tone)));
  ink = max(ink, labLine(fc.x - fc.y, 7.0, 0.85) * (1.0 - smoothstep(0.46, 0.52, tone)));
  ink = max(ink, labLine(fc.y, 3.5, 0.7) * (1.0 - smoothstep(0.2, 0.26, tone)));
  vec3 labCol = mix(diffuseColor.rgb, uPaper, 0.12) * mix(0.9, 1.0, smoothstep(0.78, 0.84, tone));
  gl_FragColor = vec4(mix(labCol, uInk, ink * 0.9), diffuseColor.a);
`;
// C: gouache. Three hard value steps, shadows shift to cool violet, warm terminator, fresnel rim light.
const PAINT = `
  ${TONE}
  vec3 dc = diffuseColor.rgb;
  vec3 shadowC = mix(dc * 0.38, uShadow, 0.38);
  vec3 midC = mix(dc * 0.66, uShadow, 0.14);
  vec3 litC = dc * mix(vec3(1.0), uSun, 0.35) * 1.12;
  vec3 labCol = mix(shadowC, midC, smoothstep(0.26, 0.31, tone));
  labCol = mix(labCol, litC, smoothstep(0.55, 0.6, tone));
  labCol += uRim * 0.12 * (1.0 - clamp(abs(tone - 0.575) / 0.07, 0.0, 1.0));
  float fres = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 3.0);
  labCol += uRim * fres * 0.5 * smoothstep(0.2, 0.5, tone);
  gl_FragColor = vec4(labCol, diffuseColor.a);
`;

function lumLin(hex: string): number {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function makeMat(v: Variant, pxRatio: number): MatFn {
  const W = v.world;
  const sun = new THREE.Vector3(...W.sun.dir).normalize();
  // tone of fully lit flat ground = 1.0 (lambert: (sun * N.L + hemi) / PI)
  const toneRef = (lumLin(W.sun.color) * W.sun.intensity * sun.y + lumLin(W.hemi.sky) * W.hemi.intensity) / Math.PI;
  const uni = {
    uPaper: { value: new THREE.Color(W.paper) },
    uInk: { value: new THREE.Color(v.sprite.ink) },
    uShadow: { value: new THREE.Color(W.shadowTint) },
    uRim: { value: new THREE.Color(W.rimColor) },
    uSun: { value: new THREE.Color(W.sun.color) },
    uToneRef: { value: toneRef },
    uPx: { value: pxRatio },
  };
  return (p) => {
    const m = new THREE.MeshLambertMaterial(p);
    if (W.mode === 'flat') {
      m.flatShading = true;
      return m;
    }
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.fragmentShader = HEADER + sh.fragmentShader.replace('#include <opaque_fragment>', W.mode === 'hatch' ? HATCH : PAINT);
    };
    m.customProgramCacheKey = () => 'lab-' + W.mode;
    return m;
  };
}

// ------------------------------------------------------------------------------------------------ ground
const K = 0.3; // texture px per world unit
function gx(x: number): number {
  return (x - BOUNDS.x0) * K;
}
function gy(y: number): number {
  return (BOUNDS.y1 - y) * K;
}

function offsetLine(pts: V2[], o: number, wobble = 0, phase = 0): V2[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const w = wobble ? Math.sin(i * 1.7 + phase) * wobble : 0;
    return [p[0] - (dy / l) * (o + w), p[1] + (dx / l) * (o + w)];
  });
}
function densify(pts: V2[], step: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

function paintGround(v: Variant, trees: V2[]): HTMLCanvasElement {
  const G = v.world.ground;
  const mode = v.world.mode;
  const ink = v.sprite.ink;
  const c = document.createElement('canvas');
  c.width = Math.round((BOUNDS.x1 - BOUNDS.x0) * K);
  c.height = Math.round((BOUNDS.y1 - BOUNDS.y0) * K);
  const ctx = c.getContext('2d')!;
  const rnd = mulberry(42);
  const path = (pts: V2[], close = false) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(gx(x), gy(y)) : ctx.moveTo(gx(x), gy(y))));
    if (close) ctx.closePath();
  };
  const strokeLine = (pts: V2[], width: number, color: string, alpha = 1) => {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width * K;
    ctx.lineCap = ctx.lineJoin = 'round';
    path(pts);
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  const W = c.width;
  const H = c.height;

  // base grass + patches
  ctx.fillStyle = G.grass;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = rnd() < 0.5 ? G.grassDark : mix(G.grass, G.grassDark, 0.5);
    ctx.globalAlpha = mode === 'paint' ? 0.35 : 0.3;
    ctx.beginPath();
    ctx.ellipse(rnd() * W, rnd() * H, 30 + rnd() * 110, 20 + rnd() * 70, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // jungle floor darkens under trees
  for (const [x, y] of trees) {
    ctx.fillStyle = G.grassDark;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(gx(x), gy(y), 150 * K, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // plaza for the structure lineup
  for (let row = 0; row < 2; row++) {
    const y = LINEUP_Y[row]!;
    const col = G.plaza[row]!;
    ctx.fillStyle = col;
    ctx.fillRect(gx(-2600), gy(y + 480), 5200 * K, 960 * K);
    ctx.strokeStyle = mode === 'hatch' ? ink : scale(col, 0.8);
    ctx.globalAlpha = mode === 'hatch' ? 0.5 : 0.6;
    ctx.lineWidth = mode === 'hatch' ? 1.6 : 2;
    for (let yy = y - 480; yy <= y + 480; yy += 120) {
      ctx.beginPath();
      ctx.moveTo(gx(-2600), gy(yy));
      ctx.lineTo(gx(2600), gy(yy));
      ctx.stroke();
      for (let xx = -2600 + ((yy / 120) % 2 ? 0 : 90); xx < 2600; xx += 180) {
        ctx.beginPath();
        ctx.moveTo(gx(xx), gy(yy));
        ctx.lineTo(gx(xx), gy(yy + 120));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
  // soil under walls
  for (const poly of WALLS) {
    path(poly, true);
    ctx.fillStyle = G.rockDark;
    ctx.strokeStyle = G.rockDark;
    ctx.lineWidth = 160 * K;
    ctx.stroke();
    ctx.fill();
  }
  // lane
  strokeLine(LANE, LANE_HW * 2 + 90, G.laneEdge);
  strokeLine(LANE, LANE_HW * 2, G.lane);
  // river
  strokeLine(RIVER, RIVER_HW * 2 + 120, mix(G.river, G.grassDark, 0.5));
  strokeLine(RIVER, RIVER_HW * 2, G.river);
  if (mode === 'paint') {
    // sky reflection: warm streak down the middle
    strokeLine(RIVER, RIVER_HW * 0.9, G.riverLight, 0.18);
    strokeLine(RIVER, RIVER_HW * 0.35, G.riverLight, 0.3);
  } else strokeLine(RIVER, RIVER_HW * 1.1, G.riverLight, 0.35);
  // lane crossing stays readable through the water (ford)
  strokeLine(LANE.map(([x, y]) => [x * 0.12, y * 0.12] as V2), LANE_HW * 2, G.lane, 0.35);

  // style marks
  if (mode === 'hatch') {
    // engraved water lines
    ctx.strokeStyle = ink;
    for (let o = -RIVER_HW + 30; o < RIVER_HW; o += 38) {
      ctx.globalAlpha = 0.35 + 0.25 * Math.abs(o / RIVER_HW);
      ctx.lineWidth = 1.3;
      path(densify(offsetLine(RIVER, o, 14, o * 0.1), 60));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // inked banks and lane edges (broken line, like a burin)
    for (const [pts, o] of [
      [RIVER, RIVER_HW + 30],
      [RIVER, -RIVER_HW - 30],
      [LANE, LANE_HW + 20],
      [LANE, -LANE_HW - 20],
    ] as [V2[], number][]) {
      ctx.setLineDash([26, 10, 8, 10]);
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = ink;
      path(densify(offsetLine(pts, o), 80));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // grass tufts and lane stipple
    for (let i = 0; i < 9000; i++) {
      const x = BOUNDS.x0 + rnd() * (BOUNDS.x1 - BOUNDS.x0);
      const y = BOUNDS.y0 + rnd() * (BOUNDS.y1 - BOUNDS.y0);
      const onLane = distPoly(x, y, LANE) < LANE_HW;
      const onRiver = distPoly(x, y, RIVER) < RIVER_HW + 40;
      if (onRiver || inPlaza(x, y)) continue;
      ctx.fillStyle = ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.55;
      if (onLane) {
        if (rnd() < 0.5) ctx.fillRect(gx(x), gy(y), 1.6, 1.6);
      } else if (rnd() < 0.5) {
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(gx(x) - 3, gy(y) - 5);
        ctx.lineTo(gx(x), gy(y));
        ctx.lineTo(gx(x) + 3, gy(y) - 6);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  } else if (mode === 'paint') {
    // gouache brush strokes: short, oriented, limited palette
    const tones = [G.grass, G.grassDark, mix(G.grass, '#8a8a5a', 0.3), mix(G.grassDark, '#2a2440', 0.3)];
    for (let i = 0; i < 24000; i++) {
      const x = BOUNDS.x0 + rnd() * (BOUNDS.x1 - BOUNDS.x0);
      const y = BOUNDS.y0 + rnd() * (BOUNDS.y1 - BOUNDS.y0);
      const dl = distPoly(x, y, LANE);
      const dr = distPoly(x, y, RIVER);
      let col = tones[(rnd() * tones.length) | 0]!;
      let ang = -0.35 + (rnd() - 0.5) * 0.5;
      if (inPlaza(x, y)) continue;
      if (dr < RIVER_HW) {
        col = rnd() < 0.15 ? G.riverLight : mix(G.river, '#3a3058', rnd() * 0.4);
        ang = -0.85;
      } else if (dl < LANE_HW) {
        col = rnd() < 0.5 ? G.lane : mix(G.lane, rnd() < 0.5 ? '#d8b483' : G.laneEdge, 0.5);
        ang = 0.56;
      }
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.22 + rnd() * 0.25;
      ctx.beginPath();
      ctx.ellipse(gx(x), gy(y), 10 + rnd() * 14, 1.6 + rnd() * 1.4, -ang, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // rift
  if (mode === 'paint') {
    const [cx, cy] = [(RIFT_A[0] + RIFT_B[0]) / 2, (RIFT_A[1] + RIFT_B[1]) / 2];
    const g = ctx.createRadialGradient(gx(cx), gy(cy), 0, gx(cx), gy(cy), 1000 * K);
    g.addColorStop(0, 'rgba(165,138,224,0.55)');
    g.addColorStop(1, 'rgba(165,138,224,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  path(RIFT, true);
  ctx.fillStyle = G.riftDeep;
  ctx.fill();
  ctx.save();
  path(RIFT, true);
  ctx.clip();
  // depth cue: the far (north) inner wall of the crack faces the camera -> a lit band along the north edge
  const north = RIFT.slice(0, 15);
  const farWall = mode === 'paint' ? mix(G.rockDark, G.riftGlow, 0.35) : G.rockDark;
  strokeLine(north, 230, farWall);
  if (mode === 'hatch') {
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.4;
    for (const p of densify(north, 22)) {
      ctx.beginPath();
      ctx.moveTo(gx(p[0]), gy(p[1]));
      ctx.lineTo(gx(p[0]), gy(p[1]) + 34 * K + Math.sin(p[0]) * 8);
      ctx.stroke();
    }
  }
  strokeLine([RIFT_A, RIFT_B], 70, G.riftGlow, mode === 'paint' ? 0.75 : 0.3);
  ctx.restore();
  if (mode === 'hatch') {
    ctx.strokeStyle = ink;
    ctx.lineWidth = 3;
    path(RIFT, true);
    ctx.stroke();
    // radiating cut lines around the crack
    ctx.lineWidth = 1.3;
    for (let i = 0; i < RIFT.length; i++) {
      const [x, y] = RIFT[i]!;
      const mx = (RIFT_A[0] + RIFT_B[0]) / 2;
      const my = (RIFT_A[1] + RIFT_B[1]) / 2;
      const l = Math.hypot(x - mx, y - my);
      for (let k = 0; k < 3; k++) {
        const j = (k - 1) * 18;
        ctx.beginPath();
        ctx.moveTo(gx(x + j), gy(y + j));
        ctx.lineTo(gx(x + j + ((x - mx) / l) * 90), gy(y + j + ((y - my) / l) * 90));
        ctx.stroke();
      }
    }
  } else {
    ctx.strokeStyle = scale(G.riftDeep, 0.6);
    ctx.lineWidth = 3;
    path(RIFT, true);
    ctx.stroke();
  }
  // dark ground under bushes
  for (const b of BUSHES) {
    ctx.fillStyle = mode === 'hatch' ? 'rgba(29,23,18,0.25)' : 'rgba(20,30,22,0.45)';
    ctx.beginPath();
    ctx.arc(gx(b.x), gy(b.y), b.r * 1.15 * K, 0, Math.PI * 2);
    ctx.fill();
  }
  if (mode === 'hatch') {
    // paper fibres over everything
    for (let i = 0; i < 20000; i++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,250,235,0.35)' : 'rgba(80,60,30,0.08)';
      ctx.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 3, 1);
    }
  }
  // cut the rift out of the ground (alphaTest hole; the 3D pit underneath shows through), then ink the lip
  ctx.globalCompositeOperation = 'destination-out';
  path(RIFT, true);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = mode === 'hatch' ? ink : scale(G.riftDeep, 0.6);
  ctx.lineWidth = mode === 'hatch' ? 6 : 4;
  path(RIFT, true);
  ctx.stroke();
  return c;
}

/** A/C: real depth for the rift – inner walls (lighter at the lip, dark at the bottom) and a glowing floor. */
function riftPit(v: Variant, mat: MatFn): THREE.Object3D {
  const G = v.world.ground;
  const DEPTH = 520;
  const pos: number[] = [];
  const col: number[] = [];
  const top = new THREE.Color(G.rockDark);
  const bottom = new THREE.Color(G.riftDeep);
  for (let i = 0; i < RIFT.length; i++) {
    const a = RIFT[i]!;
    const b = RIFT[(i + 1) % RIFT.length]!;
    const quad: [V2, number][] = [
      [a, 0],
      [b, 0],
      [b, -DEPTH],
      [a, 0],
      [b, -DEPTH],
      [a, -DEPTH],
    ];
    for (const [p, y] of quad) {
      pos.push(p[0], y, -p[1]);
      const c = y === 0 ? top : bottom;
      col.push(c.r, c.g, c.b);
    }
  }
  const walls = new THREE.BufferGeometry();
  walls.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  walls.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  walls.computeVertexNormals();
  const group = new THREE.Group();
  const wm = new THREE.Mesh(walls, mat({ vertexColors: true, side: THREE.DoubleSide }));
  wm.receiveShadow = true;
  group.add(wm);
  const floor = new THREE.ShapeGeometry(new THREE.Shape(RIFT.map(([x, y]) => new THREE.Vector2(x, y))));
  floor.rotateX(-Math.PI / 2);
  floor.translate(0, -DEPTH, 0);
  group.add(new THREE.Mesh(floor, new THREE.MeshBasicMaterial({ color: G.riftDeep, side: THREE.DoubleSide })));
  // glowing seam along the bottom
  const len = Math.hypot(RIFT_B[0] - RIFT_A[0], RIFT_B[1] - RIFT_A[1]);
  const seam = new THREE.PlaneGeometry(len * 0.8, 60);
  seam.rotateX(-Math.PI / 2);
  const sm = new THREE.Mesh(seam, new THREE.MeshBasicMaterial({ color: G.riftGlow }));
  sm.position.copy(at((RIFT_A[0] + RIFT_B[0]) / 2, (RIFT_A[1] + RIFT_B[1]) / 2, -DEPTH + 4));
  sm.rotation.y = Math.atan2(RIFT_B[1] - RIFT_A[1], RIFT_B[0] - RIFT_A[0]);
  group.add(sm);
  return group;
}

/** B: faceted low-poly ground with real height (river channel, rift pit) and per-face colours. */
function facetGround(v: Variant): THREE.BufferGeometry {
  const G = v.world.ground;
  const STEP = 95;
  const nx = Math.ceil((BOUNDS.x1 - BOUNDS.x0) / STEP);
  const ny = Math.ceil((BOUNDS.y1 - BOUNDS.y0) / STEP);
  const hash = (i: number, j: number) => {
    const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const height = (x: number, y: number) => {
    const rd = riftDepth(x, y);
    if (rd > 0) return -380 * rd;
    const dr = distPoly(x, y, RIVER);
    if (dr < RIVER_HW) return -55 * Math.min(1, (RIVER_HW - dr) / 90);
    if (distPoly(x, y, LANE) < LANE_HW + 40 || inPlaza(x, y)) return 0;
    return 5 * Math.sin(x / 310) * Math.cos(y / 270) + 4;
  };
  const vx: number[][] = [];
  const vy: number[][] = [];
  for (let i = 0; i <= nx; i++) {
    vx.push([]);
    vy.push([]);
    for (let j = 0; j <= ny; j++) {
      const edge = i === 0 || j === 0 || i === nx || j === ny;
      vx[i]!.push(BOUNDS.x0 + i * STEP + (edge ? 0 : (hash(i, j) - 0.5) * STEP * 0.5));
      vy[i]!.push(BOUNDS.y0 + j * STEP + (edge ? 0 : (hash(j, i) - 0.5) * STEP * 0.5));
    }
  }
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const tri = (a: V2, b: V2, d: V2) => {
    const cx = (a[0] + b[0] + d[0]) / 3;
    const cy = (a[1] + b[1] + d[1]) / 3;
    const rd = riftDepth(cx, cy);
    const dr = distPoly(cx, cy, RIVER);
    const dl = distPoly(cx, cy, LANE);
    let hex: string;
    if (rd > 0.97) hex = mix(G.riftDeep, G.riftGlow, 0.45);
    else if (rd > 0.75) hex = G.riftDeep;
    else if (rd > 0) hex = mix(G.rockDark, G.riftDeep, rd);
    else if (dr < RIVER_HW - 60) hex = scale(G.river, 0.75);
    else if (dr < RIVER_HW + 40) hex = G.laneEdge;
    else if (inPlaza(cx, cy)) hex = cy < (LINEUP_Y[0]! + LINEUP_Y[1]!) / 2 ? G.plaza[0] : G.plaza[1];
    else if (dl < LANE_HW) hex = G.lane;
    else if (dl < LANE_HW + 60) hex = G.laneEdge;
    else hex = Math.sin(cx / 520 + Math.cos(cy / 410) * 2) > 0.35 ? G.grassDark : G.grass;
    c.set(hex);
    const jit = 0.96 + hash(cx, cy) * 0.06;
    for (const p of [a, b, d]) {
      pos.push(p[0], height(p[0], p[1]), -p[1]);
      col.push(c.r * jit, c.g * jit, c.b * jit);
    }
  };
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      const p00: V2 = [vx[i]![j]!, vy[i]![j]!];
      const p10: V2 = [vx[i + 1]![j]!, vy[i + 1]![j]!];
      const p01: V2 = [vx[i]![j + 1]!, vy[i]![j + 1]!];
      const p11: V2 = [vx[i + 1]![j + 1]!, vy[i + 1]![j + 1]!];
      // counter-clockwise seen from above (three: z = -y)
      tri(p00, p10, p11);
      tri(p00, p11, p01);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------------------------------------ props
function cyl(rt: number, rb: number, h: number, seg: number, y: number, color: string, rot = 0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  if (rot) g.rotateY(rot);
  g.translate(0, y + h / 2, 0);
  return paint(g, color);
}
function moved(g: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
  g.translate(x, y, z);
  return g;
}

function wallGeometry(v: Variant): THREE.BufferGeometry {
  const G = v.world.ground;
  const rnd = mulberry(7);
  const parts: THREE.BufferGeometry[] = [];
  for (const poly of WALLS) {
    if (v.world.mode === 'flat') {
      // B: terraced chunky blocks with grass caps (board-game cliffs)
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const [x, y] of poly) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      for (let x = minX + 60; x < maxX; x += 125)
        for (let y = minY + 60; y < maxY; y += 125) {
          if (!inPoly(x, y, poly)) continue;
          const h = rnd() < 0.45 ? 260 : 170;
          const s = 130 + rnd() * 30;
          const box = new THREE.BoxGeometry(s, h, s);
          box.rotateY((rnd() - 0.5) * 0.3);
          box.translate(x + (rnd() - 0.5) * 30, h / 2, -y + (rnd() - 0.5) * 30);
          parts.push(paint(box, rnd() < 0.5 ? G.rock : G.rockDark));
          const cap = new THREE.BoxGeometry(s + 8, 18, s + 8);
          cap.rotateY((rnd() - 0.5) * 0.3);
          cap.translate(x, h + 9, -y);
          parts.push(paint(cap, rnd() < 0.5 ? G.grass : G.grassDark));
        }
      continue;
    }
    const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
    const h = v.world.mode === 'paint' ? 210 : 170;
    const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: true, bevelSize: 40, bevelThickness: 40, bevelSegments: 1, steps: 1 });
    g.rotateX(-Math.PI / 2);
    parts.push(paint(g, G.rockDark));
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      const n = Math.max(1, Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / 240));
      for (let k = 0; k < n; k++) {
        const t = (k + rnd()) / n;
        const r = 70 + rnd() * 80;
        const rock = v.world.mode === 'paint' ? new THREE.ConeGeometry(r * 0.8, r * 3, 5) : new THREE.IcosahedronGeometry(r, 0);
        if (v.world.mode !== 'paint') rock.scale(1, 0.7 + rnd() * 0.8, 1);
        rock.rotateY(rnd() * 6);
        rock.translate(a[0] + (b[0] - a[0]) * t, h * (0.4 + rnd() * 0.7), -(a[1] + (b[1] - a[1]) * t));
        parts.push(paint(rock, rnd() < 0.5 ? G.rock : G.rockDark));
      }
    }
    // break up the flat top: boulders / crags across the whole plateau
    for (let i = 0; i < 60; i++) {
      const x = poly.reduce((a, p) => Math.min(a, p[0]), Infinity) + rnd() * 1300;
      const y = poly.reduce((a, p) => Math.min(a, p[1]), Infinity) + rnd() * 1000;
      if (!inPoly(x, y, poly)) continue;
      const r = 80 + rnd() * 90;
      const rock = v.world.mode === 'paint' ? new THREE.ConeGeometry(r * 0.9, r * 2.6, 5) : new THREE.DodecahedronGeometry(r, 0);
      if (v.world.mode !== 'paint') rock.scale(1, 0.6 + rnd() * 0.6, 1);
      rock.rotateY(rnd() * 6);
      rock.translate(x, h + (v.world.mode === 'paint' ? r * 0.9 : r * 0.2), -y);
      parts.push(paint(rock, rnd() < 0.6 ? G.rockDark : G.rock));
    }
  }
  return mergeGeometries(parts)!;
}

function treeSpots(): V2[] {
  const rnd = mulberry(23);
  const out: V2[] = [];
  for (let i = 0; i < 900 && out.length < 46; i++) {
    const x = -2600 + rnd() * 5600;
    const y = -1500 + rnd() * 3700;
    if (distPoly(x, y, LANE) < LANE_HW + 380) continue;
    if (distPoly(x, y, RIVER) < RIVER_HW + 200) continue;
    if (riftDepth(x, y) > 0 || distSeg(x, y, RIFT_A, RIFT_B) < RIFT_HW + 260) continue;
    if (WALLS.some((w) => inPoly(x, y, w))) continue;
    if (BUSHES.some((b) => Math.hypot(x - b.x, y - b.y) < b.r + 160)) continue;
    if (out.some(([ox, oy]) => Math.hypot(x - ox, y - oy) < 260)) continue;
    out.push([x, y]);
  }
  return out;
}

function treeGeometry(v: Variant, spots: V2[]): THREE.BufferGeometry {
  const G = v.world.ground;
  const rnd = mulberry(5);
  const parts: THREE.BufferGeometry[] = [];
  for (const [x, y] of spots) {
    const s = 0.8 + rnd() * 0.5;
    const z = -y;
    if (v.world.mode === 'flat') {
      parts.push(moved(cyl(18 * s, 26 * s, 150 * s, 5, 0, G.trunk), x, 0, z));
      const crown = new THREE.IcosahedronGeometry(120 * s, 0);
      crown.scale(1, 1.1, 1);
      parts.push(moved(paint(crown, rnd() < 0.5 ? G.tree[0] : G.tree[1]), x, 230 * s, z));
    } else if (v.world.mode === 'hatch') {
      parts.push(moved(cyl(16 * s, 24 * s, 120 * s, 6, 0, G.trunk), x, 0, z));
      for (let k = 0; k < 2; k++) {
        const cone = new THREE.ConeGeometry((140 - k * 40) * s, 200 * s, 7);
        parts.push(moved(paint(cone, G.tree[k % 2]!), x, (200 + k * 110) * s, z));
      }
    } else {
      parts.push(moved(cyl(14 * s, 22 * s, 120 * s, 5, 0, G.trunk), x, 0, z));
      for (let k = 0; k < 3; k++) {
        const cone = new THREE.ConeGeometry((110 - k * 28) * s, 210 * s, 6);
        parts.push(moved(paint(cone, G.tree[k % 2]!), x, (190 + k * 120) * s, z));
      }
    }
  }
  return mergeGeometries(parts)!;
}

function bushGeometry(v: Variant): THREE.BufferGeometry {
  const G = v.world.ground;
  const rnd = mulberry(3);
  const parts: THREE.BufferGeometry[] = [];
  for (const b of BUSHES) {
    const n = v.world.mode === 'paint' ? 26 : Math.round(b.r / 32);
    for (let i = 0; i < n; i++) {
      const ang = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * b.r * 0.85;
      const x = b.x + Math.cos(ang) * d;
      const z = -(b.y + Math.sin(ang) * d);
      const color = rnd() < 0.5 ? G.bush[0] : G.bush[1];
      if (v.world.mode === 'paint') {
        // spiky tall grass: reads as "you can hide here"
        const blade = new THREE.ConeGeometry(28 + rnd() * 16, 150 + rnd() * 90, 4);
        blade.rotateZ((rnd() - 0.5) * 0.5);
        blade.rotateX((rnd() - 0.5) * 0.5);
        parts.push(moved(paint(blade, color), x, 80, z));
      } else {
        const r = 55 + rnd() * 45;
        const leaf = new THREE.IcosahedronGeometry(r, v.world.mode === 'flat' ? 1 : 0);
        leaf.scale(1, 0.8 + rnd() * 0.4, 1);
        parts.push(moved(paint(leaf, color), x, r * 0.6, z));
      }
    }
  }
  return mergeGeometries(parts)!;
}

// ------------------------------------------------------------------------------------------------ structures
interface StructParts {
  body: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
  height: number;
}

function structure(v: Variant, kind: 'tower' | 'inhib' | 'nexus', team: number): StructParts {
  const t: TeamColors = v.team[team]!;
  const { w, h, seg } = v.world.structure;
  const parts: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const sq = Math.PI / 4;
  if (kind === 'tower') {
    if (team === 0) {
      // Lichtwerk: round lantern tower – copper shaft, brass band, glowing lens under a copper cap
      parts.push(cyl(150 * w, 170 * w, 60, seg, 0, t.stone));
      parts.push(cyl(82 * w, 108 * w, 330 * h, seg, 60, t.primary));
      parts.push(cyl(118 * w, 98 * w, 40, seg, 60 + 330 * h, t.accent));
      const top = 100 + 330 * h;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + sq;
        parts.push(moved(cyl(12, 12, 150, 5, top, t.accent), Math.cos(a) * 80 * w, 0, Math.sin(a) * 80 * w));
      }
      parts.push(cyl(100 * w, 100 * w, 20, seg, top, t.secondary));
      // small cap high above the lens so the light stays visible from the 56° camera
      const roof = new THREE.ConeGeometry(95 * w, 120 * h, seg);
      roof.translate(0, top + 150 + 60 * h, 0);
      parts.push(paint(roof, t.primary));
      const fin = new THREE.SphereGeometry(22, 8, 6);
      fin.translate(0, top + 150 + 120 * h + 10, 0);
      parts.push(paint(fin, t.accent));
      const lens = new THREE.IcosahedronGeometry(64 * w, 1);
      lens.translate(0, top + 84, 0);
      glow.push(lens);
      return { body: mergeGeometries(parts)!, glow: mergePlain(glow), height: top + 300 };
    }
    // Aschehalle: square slate shaft with rust plates, coal brazier with embers and spikes
    parts.push(cyl(160 * w, 180 * w, 60, 4, 0, t.stone, sq));
    parts.push(cyl(78 * w, 112 * w, 340 * h, 4, 60, t.primary, sq));
    parts.push(cyl(100 * w, 108 * w, 34, 4, 60 + 110 * h, t.secondary, sq));
    parts.push(cyl(90 * w, 96 * w, 34, 4, 60 + 250 * h, t.secondary, sq));
    const top = 60 + 340 * h;
    parts.push(cyl(140 * w, 70 * w, 80, 6, top, t.accent));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + sq;
      const spike = new THREE.ConeGeometry(26, 200 * h, 4);
      spike.rotateZ(Math.cos(a) * -0.25);
      spike.rotateX(Math.sin(a) * 0.25);
      spike.translate(Math.cos(a) * 120 * w, top + 120, Math.sin(a) * 120 * w);
      parts.push(paint(spike, t.accent));
    }
    const ember = new THREE.ConeGeometry(80 * w, 110, 6);
    ember.translate(0, top + 110, 0);
    glow.push(ember);
    return { body: mergeGeometries(parts)!, glow: mergePlain(glow), height: top + 260 };
  }
  if (kind === 'inhib') {
    if (team === 0) {
      parts.push(cyl(190 * w, 210 * w, 50, seg + 2, 0, t.stone));
      parts.push(cyl(150 * w, 170 * w, 30, seg + 2, 50, t.primary));
      for (const rot of [0, Math.PI / 2]) {
        const ring = new THREE.TorusGeometry(125 * w, 22, 6, seg + 4);
        ring.rotateY(rot + 0.4);
        ring.translate(0, 220 * h, 0);
        parts.push(paint(ring, t.accent));
      }
      parts.push(cyl(14, 14, 100 * h, 5, 80, t.accent));
      const core = new THREE.IcosahedronGeometry(70, 1);
      core.translate(0, 220 * h, 0);
      glow.push(core);
      return { body: mergeGeometries(parts)!, glow: mergePlain(glow), height: 400 };
    }
    parts.push(cyl(200 * w, 220 * w, 50, 4, 0, t.stone, sq));
    const anvil = new THREE.BoxGeometry(260 * w, 110 * h, 150 * w);
    anvil.translate(0, 50 + 55 * h, 0);
    parts.push(paint(anvil, t.primary));
    const horn = new THREE.ConeGeometry(70 * w, 170 * w, 4);
    horn.rotateZ(-Math.PI / 2);
    horn.translate(200 * w, 50 + 80 * h, 0);
    parts.push(paint(horn, t.primary));
    const plate = new THREE.BoxGeometry(280 * w, 40, 170 * w);
    plate.translate(0, 50 + 110 * h + 20, 0);
    parts.push(paint(plate, t.secondary));
    const crack = new THREE.BoxGeometry(200 * w, 24, 36);
    crack.translate(0, 50 + 110 * h + 44, 0);
    glow.push(crack);
    const shard = new THREE.OctahedronGeometry(60);
    shard.scale(1, 1.6, 1);
    shard.translate(0, 50 + 110 * h + 150, 0);
    glow.push(shard);
    return { body: mergeGeometries(parts)!, glow: mergePlain(glow), height: 380 };
  }
  // nexus
  if (team === 0) {
    parts.push(cyl(330 * w, 360 * w, 80, seg * 2, 0, t.stone));
    parts.push(cyl(250 * w, 285 * w, 100 * h, seg * 2, 80, t.primary));
    const dome = new THREE.SphereGeometry(230 * w, seg * 2, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.translate(0, 80 + 100 * h, 0);
    parts.push(paint(dome, t.secondary));
    parts.push(cyl(70 * w, 90 * w, 60, seg, 80 + 100 * h + 200 * w, t.accent));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + sq;
      parts.push(moved(cyl(28, 40, 360 * h, seg, 0, t.accent), Math.cos(a) * 310 * w, 0, Math.sin(a) * 310 * w));
      const cap = new THREE.SphereGeometry(42, 8, 6);
      cap.translate(Math.cos(a) * 310 * w, 360 * h + 20, Math.sin(a) * 310 * w);
      parts.push(paint(cap, t.primary));
    }
    const lens = new THREE.IcosahedronGeometry(95 * w, 1);
    lens.translate(0, 80 + 100 * h + 300 * w, 0);
    glow.push(lens);
    return { body: mergeGeometries(parts)!, glow: mergePlain(glow), height: 820 };
  }
  parts.push(cyl(340 * w, 370 * w, 80, 4, 0, t.stone, sq));
  const hall = new THREE.BoxGeometry(420 * w, 230 * h, 330 * w);
  hall.translate(0, 80 + 115 * h, 0);
  parts.push(paint(hall, t.primary));
  const roof = new THREE.CylinderGeometry(0, 300 * w, 140 * h, 4, 1);
  roof.rotateY(sq);
  roof.scale(1, 1, 0.8);
  roof.translate(0, 80 + 230 * h + 70 * h, 0);
  parts.push(paint(roof, t.secondary));
  for (const [cx, hh] of [
    [-150, 380],
    [0, 470],
    [150, 340],
  ] as const) {
    parts.push(moved(cyl(40 * w, 52 * w, hh * h, 4, 80, t.accent, sq), cx * w, 0, -90 * w));
    const ember = new THREE.ConeGeometry(40 * w, 70, 4);
    ember.translate(cx * w, 80 + hh * h + 35, -90 * w);
    glow.push(ember);
  }
  const mouth = new THREE.BoxGeometry(170 * w, 110 * h, 30);
  mouth.translate(0, 80 + 60 * h, 168 * w);
  glow.push(mouth);
  return { body: mergeGeometries(parts)!, glow: mergePlain(glow), height: 760 };
}

// ------------------------------------------------------------------------------------------------ decals (gameplay layer)
function decalMaterial(color: string, mode: 'line' | 'circle'): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 uColor; uniform float uTime; varying vec2 vUv;
      void main() {
        float k = fract(uTime / 1.6);
        ${
          mode === 'circle'
            ? `float r = length(vUv - 0.5) * 2.0; if (r > 1.0) discard;
               float rim = smoothstep(0.9, 0.94, r);
               float fill = step(r, k) * 0.32 + 0.12;`
            : `float r = max(abs(vUv.x - 0.5) * 2.0, abs(vUv.y - 0.5) * 2.0);
               float rim = smoothstep(0.86, 0.9, abs(vUv.x - 0.5) * 2.0) + step(0.985, vUv.y) + step(vUv.y, 0.015);
               float fill = step(vUv.y, k) * 0.32 + 0.12;`
        }
        gl_FragColor = vec4(uColor, clamp(max(rim * 0.95, fill), 0.0, 1.0));
        #include <colorspace_fragment>
      }`,
  });
}

// ------------------------------------------------------------------------------------------------ scene
export interface Label {
  text: string;
  pos: THREE.Vector3;
  cls: string;
}
export interface LabScene {
  scene: THREE.Scene;
  labels: Label[];
  update(t: number): void;
  dispose(): void;
}

export function buildScene(v: Variant, renderer: THREE.WebGLRenderer): LabScene {
  const W = v.world;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(W.background);
  if (W.fog) scene.fog = new THREE.Fog(W.fog.color, W.fog.near, W.fog.far);
  renderer.shadowMap.type = W.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  const mat = makeMat(v, renderer.getPixelRatio());
  // B's ground has real relief: lift ground decals above the highest bump
  const decalY = W.mode === 'flat' ? 12 : 2;
  const labels: Label[] = [];
  const animated: ((t: number) => void)[] = [];
  const outline = (geo: THREE.BufferGeometry, kind: 'structures' | 'terrain', target: THREE.Object3D) => {
    if (!W.outline) return;
    const o = outlineMesh(geo, W.outline[kind], W.outline.color);
    o.position.copy(target.position);
    o.rotation.copy(target.rotation);
    o.scale.copy(target.scale);
    scene.add(o);
  };

  // lights
  scene.add(new THREE.HemisphereLight(W.hemi.sky, W.hemi.ground, W.hemi.intensity));
  const sunDir = new THREE.Vector3(...W.sun.dir).normalize();
  const sun = new THREE.DirectionalLight(W.sun.color, W.sun.intensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -5600;
  sc.right = sc.top = 5600;
  sc.near = 100;
  sc.far = 16000;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 4;
  if (W.softShadows) sun.shadow.radius = 4;
  const centre = at(0, -1700);
  sun.target.position.copy(centre);
  sun.position.copy(centre).addScaledVector(sunDir, 7000);
  scene.add(sun, sun.target);

  // ground
  const spots = treeSpots();
  if (W.mode === 'flat') {
    const g = new THREE.Mesh(facetGround(v), mat({ vertexColors: true }));
    g.receiveShadow = true;
    scene.add(g);
    // water ribbon over the river channel, stops where the river falls into the rift
    const pts = RIVER.filter((_, i) => i <= RIVER.length - 3);
    const left = offsetLine(pts, RIVER_HW - 10);
    const right = offsetLine(pts, -RIVER_HW + 10);
    const pos: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = left[i]!;
      const b = left[i + 1]!;
      const c = right[i]!;
      const d = right[i + 1]!;
      pos.push(a[0], -16, -a[1], c[0], -16, -c[1], b[0], -16, -b[1]);
      pos.push(b[0], -16, -b[1], c[0], -16, -c[1], d[0], -16, -d[1]);
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    wg.computeVertexNormals();
    const water = new THREE.Mesh(wg, new THREE.MeshLambertMaterial({ color: W.ground.river, transparent: true, opacity: 0.82, side: THREE.DoubleSide }));
    water.receiveShadow = true;
    scene.add(water);
  } else {
    const tex = new THREE.CanvasTexture(paintGround(v, spots));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const geo = new THREE.PlaneGeometry(BOUNDS.x1 - BOUNDS.x0, BOUNDS.y1 - BOUNDS.y0);
    geo.rotateX(-Math.PI / 2);
    geo.translate((BOUNDS.x0 + BOUNDS.x1) / 2, 0, -(BOUNDS.y0 + BOUNDS.y1) / 2);
    const g = new THREE.Mesh(geo, mat({ map: tex, alphaTest: 0.5 }));
    g.receiveShadow = true;
    scene.add(g, riftPit(v, mat));
  }

  // walls, trees, bushes
  for (const [geo, kind] of [
    [wallGeometry(v), 'terrain'],
    [treeGeometry(v, spots), 'terrain'],
    [bushGeometry(v), 'terrain'],
  ] as const) {
    const m = new THREE.Mesh(geo, mat({ vertexColors: true }));
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    outline(geo, kind, m);
  }
  labels.push({ text: 'Busch', pos: at(BUSHES[0]!.x, BUSHES[0]!.y, 120), cls: 'terrain' });
  labels.push({ text: 'Fluss', pos: at(-1300, 1300, 0), cls: 'terrain' });
  labels.push({ text: 'Schleierbruch', pos: at(1350, -800, 60), cls: 'terrain' });
  labels.push({ text: 'Dschungel', pos: at(-1800, 900, 200), cls: 'terrain' });

  // structures
  const glowMats = [0, 1].map((tm) => new THREE.MeshBasicMaterial({ color: v.team[tm]!.glow }));
  const glowMeshes: THREE.Mesh[] = [];
  const place = (kind: 'tower' | 'inhib' | 'nexus', team: number, x: number, y: number, name: string) => {
    const s = structure(v, kind, team);
    const m = new THREE.Mesh(s.body, mat({ vertexColors: true }));
    m.position.copy(at(x, y));
    m.scale.setScalar(0.8);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    outline(s.body, 'structures', m);
    const gm = new THREE.Mesh(s.glow, glowMats[team]);
    gm.position.copy(m.position);
    gm.scale.copy(m.scale);
    gm.castShadow = true;
    scene.add(gm);
    if (W.outline) outline(s.glow, 'structures', gm);
    glowMeshes.push(gm);
    labels.push({ text: name, pos: at(x, y, s.height * 0.8 + 40), cls: team ? 'enemy' : 'ally' });
  };
  for (const tw of TOWERS) place('tower', tw.team, tw.p[0], tw.p[1], tw.team ? 'Turm Aschehalle' : 'Turm Lichtwerk');
  for (const team of [0, 1]) {
    const y = LINEUP_Y[team]!;
    const n = team ? 'Aschehalle' : 'Lichtwerk';
    place('tower', team, LINEUP_X.tower, y, `Turm ${n}`);
    place('inhib', team, LINEUP_X.inhib, y, `Inhibitor ${n}`);
    place('nexus', team, LINEUP_X.nexus, y, `Nexus ${n}`);
  }
  animated.push((t) => {
    glowMats[1]!.color.set(v.team[1]!.glow).multiplyScalar(0.85 + 0.15 * Math.sin(t * 9) * Math.sin(t * 5.3));
    glowMats[0]!.color.set(v.team[0]!.glow).multiplyScalar(0.92 + 0.08 * Math.sin(t * 1.7));
  });

  // units (camera-facing quads like the game, separate shadow-casting quads facing the sun)
  const qVis = new THREE.Quaternion().setFromEuler(new THREE.Euler(-PITCH, 0, 0));
  const qCast = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(sunDir.x, sunDir.z), 0));
  const quad = new THREE.PlaneGeometry(1, 1);
  quad.translate(0, 0.5, 0);
  const texCache = new Map<string, THREE.CanvasTexture>();
  const tex = (key: Key, team: number) => {
    const id = key + team;
    let t = texCache.get(id);
    if (!t) {
      t = new THREE.CanvasTexture(sprite(v, key, team));
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      texCache.set(id, t);
    }
    return t;
  };
  const ringGeo = new THREE.RingGeometry(0.84, 1, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const units: { mesh: THREE.Mesh; cast: THREE.Mesh; base: THREE.Vector3; size: number; flip: number; phase: number; dir: number; champ: boolean }[] = [];
  UNITS.forEach((u, i) => {
    const [x, y] = lane(u.s, u.o);
    const champ = CHAMPS.includes(u.key);
    const size = SIZE[u.key];
    const map = tex(u.key, u.team);
    const m = new THREE.Mesh(quad, new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide }));
    const flip = u.team ? -1 : 1;
    m.quaternion.copy(qVis);
    m.position.copy(at(x, y));
    m.scale.set(flip * size, size, 1);
    const cast = new THREE.Mesh(quad, new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, colorWrite: false, depthWrite: false, side: THREE.DoubleSide }));
    cast.castShadow = true;
    cast.quaternion.copy(qCast);
    cast.position.copy(m.position);
    cast.scale.set(size * 0.8, size, 1);
    scene.add(m, cast);
    units.push({ mesh: m, cast, base: m.position.clone(), size, flip, phase: i * 1.37, dir: u.team ? -1 : 1, champ });
    if (champ) {
      const r = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: u.team ? REL.enemy : REL.ally, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
      r.position.copy(at(x, y, decalY));
      r.scale.setScalar(95);
      scene.add(r);
      labels.push({ text: ({ mira: 'Mira Quell', renn: 'Renn Sieben', hagen: 'Mutter Hagen', isolde: 'Isolde Glasmacherin' } as Record<string, string>)[u.key]!, pos: at(x, y + Math.sin(PITCH) * size, Math.cos(PITCH) * size + 30), cls: u.team ? 'enemy' : 'ally' });
    }
  });
  animated.push((t) => {
    for (const u of units) {
      const k = t * (u.champ ? 1.3 : 2.2) + u.phase;
      // minions trade blows: small lunge toward the enemy and back
      const lunge = u.champ ? 0 : Math.max(0, Math.sin(k)) ** 6 * 26;
      u.mesh.position.set(u.base.x + LANE_DIR[0] * lunge * u.dir, u.base.y + (u.champ ? Math.abs(Math.sin(k * 2)) * 4 : 0), u.base.z - LANE_DIR[1] * lunge * u.dir);
      u.mesh.scale.set(u.flip * u.size * (1 + lunge / 900), u.size * (1 + Math.sin(k * 1.7) * 0.012), 1);
      u.cast.position.copy(u.mesh.position);
    }
  });

  // gameplay decals: enemy skillshot (warm red) toward Mira, own AoE (cold blue) around Mutter Hagen
  const isolde = lane(-120, 300);
  const mira = lane(-760, -300);
  const ang = Math.atan2(mira[1] - isolde[1], mira[0] - isolde[0]);
  const len = 950;
  const shotGeo = new THREE.PlaneGeometry(130, len);
  shotGeo.translate(0, len / 2, 0);
  shotGeo.rotateX(-Math.PI / 2);
  const shotMat = decalMaterial(REL.enemyShot, 'line');
  const shot = new THREE.Mesh(shotGeo, shotMat);
  shot.position.copy(at(isolde[0], isolde[1], decalY + 1));
  shot.rotation.y = ang - Math.PI / 2;
  const hagen = lane(-330, -280);
  const aoeGeo = new THREE.PlaneGeometry(700, 700);
  aoeGeo.rotateX(-Math.PI / 2);
  const aoeMat = decalMaterial(REL.ownShot, 'circle');
  const aoe = new THREE.Mesh(aoeGeo, aoeMat);
  aoe.position.copy(at(hagen[0], hagen[1], decalY + 1));
  shot.renderOrder = aoe.renderOrder = 2;
  scene.add(shot, aoe);
  animated.push((t) => {
    shotMat.uniforms.uTime!.value = t;
    aoeMat.uniforms.uTime!.value = t + 0.6;
  });

  // rift mist
  const mistGroup = new THREE.Group();
  scene.add(mistGroup);
  const puffs: { o: THREE.Object3D; x: number; z: number; phase: number; setAlpha: (a: number) => void }[] = [];
  const rnd = mulberry(99);
  let mistTex: THREE.Texture | null = null;
  if (W.mode === 'hatch') {
    // engraved cloud: scalloped ink outline + a few inner lines, violet wash
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(142,127,168,0.55)';
    g.strokeStyle = v.sprite.ink;
    g.lineWidth = 3;
    g.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      g.arc(64 + Math.cos(a) * 30, 64 + Math.sin(a) * 22, 20, a - 1.4, a + 1.4);
    }
    g.closePath();
    g.fill();
    g.stroke();
    g.lineWidth = 1.5;
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      g.arc(64, 72 + k * 6, 26 - k * 6, Math.PI * 1.1, Math.PI * 1.9);
      g.stroke();
    }
    mistTex = new THREE.CanvasTexture(c);
  } else if (W.mode === 'paint') {
    mistTex = new THREE.CanvasTexture(radialCanvas('rgba(190,165,240,0.9)', 'rgba(120,100,170,0)'));
  }
  if (mistTex) mistTex.colorSpace = THREE.SRGBColorSpace;
  for (let i = 0; i < 14; i++) {
    const t = rnd();
    const x = RIFT_A[0] + (RIFT_B[0] - RIFT_A[0]) * t + (rnd() - 0.5) * 120;
    const y = RIFT_A[1] + (RIFT_B[1] - RIFT_A[1]) * t + (rnd() - 0.5) * 120;
    let o: THREE.Object3D;
    let setAlpha: (a: number) => void;
    if (mistTex) {
      const sm = new THREE.SpriteMaterial({
        map: mistTex,
        transparent: true,
        depthWrite: false,
        blending: W.mode === 'paint' ? THREE.AdditiveBlending : THREE.NormalBlending,
        color: W.mode === 'paint' ? '#b9a4f0' : '#ffffff',
      });
      o = new THREE.Sprite(sm);
      setAlpha = (a) => (sm.opacity = a * (W.mode === 'paint' ? 0.85 : 0.95));
    } else {
      const pm = new THREE.MeshLambertMaterial({ color: W.mist, transparent: true, flatShading: true, depthWrite: false });
      o = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), pm);
      setAlpha = (a) => (pm.opacity = a * 0.7);
    }
    mistGroup.add(o);
    puffs.push({ o, x, z: -y, phase: rnd(), setAlpha });
  }
  animated.push((t) => {
    for (const p of puffs) {
      const k = (t / 7 + p.phase) % 1;
      const s = (W.mode === 'flat' ? 70 : W.mode === 'paint' ? 420 : 260) * (0.6 + k * 1.2);
      p.o.position.set(p.x + Math.sin(k * 6 + p.phase * 9) * 40, -170 + k * 520, p.z);
      p.o.scale.set(s, W.mode === 'flat' ? s * 0.8 : s * 0.75, s);
      p.o.rotation.y = k * 2;
      p.setAlpha(Math.sin(k * Math.PI));
    }
  });

  return {
    scene,
    labels,
    update(t) {
      for (const f of animated) f(t);
    },
    dispose() {
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mm of mats) {
          for (const val of Object.values(mm)) if (val instanceof THREE.Texture) val.dispose();
          mm.dispose();
        }
      });
      sun.shadow.map?.dispose();
      disposeOutlineMats();
    },
  };
}

/** Camera presets (same pitch/FOV as the game). */
export const VIEWS = {
  lane: { x: -110, y: -170, dist: 2900 },
  structures: { x: -200, y: -4850, dist: 3100 },
};

/** Merge geometries of mixed origin (indexed / non-indexed, with / without uv) into one non-indexed geometry. */
function mergePlain(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(
    list.map((g) => {
      const n = g.index ? g.toNonIndexed() : g;
      if (n.getAttribute('uv')) n.deleteAttribute('uv');
      n.computeVertexNormals();
      return n;
    }),
  )!;
}
