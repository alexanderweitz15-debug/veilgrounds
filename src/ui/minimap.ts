// Minimap (bottom right) drawn like a hand-inked field map: parchment, washed river, inked lanes and cliffs.
// Left click/drag moves the camera, right click sends a move command.
import type { MapData, Pt } from '../sim/map';
import type { ClientState } from '../game/state';
import type { World } from '../render/world';
import type { FogOfWar } from '../render/fog';
import { Kind } from '../sim/types';
import { canvasToSim, mulberry, simToCanvas, MAP_SIZE } from '../render/coords';
import { REL, INK } from '../render/palette';

const SIZE = 280;
const REDRAW_MS = 66;

export class Minimap {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly bg: HTMLCanvasElement;
  private readonly fogTint = document.createElement('canvas');
  private last = -Infinity;
  private dpr = 1;
  dragging = false;
  dispose: () => void = () => {};

  constructor(map: MapData, private readonly onCamera: (x: number, y: number) => void, private readonly onMove: (x: number, y: number) => void) {
    this.canvas.className = 'minimap';
    this.dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = this.canvas.height = Math.round(SIZE * this.dpr);
    this.ctx = this.canvas.getContext('2d')!;
    this.bg = paintParchment(map, this.canvas.width);
    this.fogTint.width = this.fogTint.height = 256;
    const toSim = (e: MouseEvent): [number, number] => {
      const r = this.canvas.getBoundingClientRect();
      return canvasToSim(((e.clientX - r.left) / r.width) * SIZE, ((e.clientY - r.top) / r.height) * SIZE, SIZE);
    };
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      const [x, y] = toSim(e);
      if (e.button === 0) {
        this.dragging = true;
        this.onCamera(x, y);
      } else if (e.button === 2) this.onMove(x, y);
    });
    const move = (e: MouseEvent): void => {
      if (this.dragging) this.onCamera(...toSim(e));
    };
    const up = (): void => {
      this.dragging = false;
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    this.dispose = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }

  draw(state: ClientState, world: World, fog: FogOfWar, now: number): void {
    if (now - this.last < REDRAW_MS) return;
    this.last = now;
    const ctx = this.ctx;
    const W = this.canvas.width;
    ctx.drawImage(this.bg, 0, 0);
    // fog: dark wash where fogged (fog canvas alpha = fogged)
    const ft = this.fogTint.getContext('2d')!;
    ft.globalCompositeOperation = 'source-over';
    ft.clearRect(0, 0, 256, 256);
    ft.fillStyle = '#1e1a24';
    ft.fillRect(0, 0, 256, 256);
    ft.globalCompositeOperation = 'destination-in';
    ft.drawImage(fog.canvas, 0, 0);
    ctx.globalAlpha = 0.42;
    ctx.drawImage(this.fogTint, 0, 0, W, W);
    ctx.globalAlpha = 1;

    const snap = state.snap;
    if (snap) {
      const myEid = snap.me?.eid ?? -1;
      const P = (x: number, y: number): [number, number] => simToCanvas(x, y, W);
      const d = this.dpr;
      // structures first, then minions, then champions on top
      for (const pass of [0, 1, 2]) {
        for (const e of snap.entities) {
          const structure = e.kind >= Kind.Tower && e.kind <= Kind.Nexus;
          const champ = e.kind === Kind.Champion;
          if ((pass === 0) !== structure || (pass === 2) !== champ) continue;
          const [x, y] = P(state.x(e), state.y(e));
          const col = e.team === state.myTeam ? REL.ally : e.team <= 1 ? REL.enemy : '#d8c37a';
          ctx.lineWidth = 1.5 * d;
          ctx.strokeStyle = INK;
          if (structure) {
            const s = (e.kind === Kind.Nexus ? 7 : e.kind === Kind.Inhibitor ? 5 : 4.5) * d;
            ctx.fillStyle = e.alive ? col : '#6d665a';
            ctx.beginPath();
            if (e.kind === Kind.Inhibitor) {
              ctx.moveTo(x, y - s);
              ctx.lineTo(x + s, y);
              ctx.lineTo(x, y + s);
              ctx.lineTo(x - s, y);
              ctx.closePath();
            } else ctx.rect(x - s, y - s, s * 2, s * 2);
            ctx.fill();
            ctx.stroke();
          } else if (champ) {
            if (!e.alive) continue;
            const r = 7 * d;
            ctx.fillStyle = col;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.lineWidth = (e.id === myEid ? 3 : 1.5) * d;
            ctx.strokeStyle = e.id === myEid ? REL.me : INK;
            ctx.stroke();
            ctx.fillStyle = '#fff';
            ctx.font = `bold ${9 * d}px system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText((e.champ ?? '?').charAt(0).toUpperCase(), x, y + 0.5 * d);
          } else {
            if (!e.alive) continue;
            const r = (e.kind === Kind.MinionSiege || e.kind === Kind.MinionSuper ? 3 : 2.2) * d;
            ctx.fillStyle = col;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
    // camera footprint
    const fp = world.rig.footprint();
    ctx.strokeStyle = 'rgba(255,250,235,0.9)';
    ctx.lineWidth = 1.5 * this.dpr;
    ctx.beginPath();
    fp.forEach((p, i) => {
      const [x, y] = simToCanvas(Math.max(0, Math.min(MAP_SIZE, p.x)), Math.max(0, Math.min(MAP_SIZE, p.y)), W);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
  }
}

/** placeholder art: parchment map with inked lanes, washed river, hatched cliffs. */
function paintParchment(map: MapData, W: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = W;
  const ctx = c.getContext('2d')!;
  const rnd = mulberry(3);
  const P = (p: Pt): [number, number] => simToCanvas(p.x, p.y, W);
  const k = W / MAP_SIZE;
  ctx.fillStyle = '#d9c9a3';
  ctx.fillRect(0, 0, W, W);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(120,95,60,0.08)' : 'rgba(255,248,225,0.12)';
    ctx.beginPath();
    ctx.arc(rnd() * W, rnd() * W, 2 + rnd() * 14, 0, Math.PI * 2);
    ctx.fill();
  }
  // jungle tint
  ctx.fillStyle = 'rgba(90,110,70,0.22)';
  ctx.fillRect(0, 0, W, W);
  // river wash
  ctx.strokeStyle = 'rgba(105,135,150,0.55)';
  ctx.lineWidth = 1100 * k;
  ctx.beginPath();
  ctx.moveTo(...P({ x: 0, y: MAP_SIZE }));
  ctx.lineTo(...P({ x: MAP_SIZE, y: 0 }));
  ctx.stroke();
  // bases
  for (const team of [0, 1] as const) {
    const [x, y] = P(map.sides[team].nexus);
    ctx.fillStyle = team === 0 ? 'rgba(201,160,100,0.45)' : 'rgba(90,80,90,0.45)';
    ctx.beginPath();
    ctx.arc(x, y, 3800 * k, 0, Math.PI * 2);
    ctx.fill();
  }
  // lanes: wobbly double ink line
  const wob = (): number => (rnd() - 0.5) * 1.2;
  for (const lane of Object.values(map.sides[0].lanes)) {
    for (const [col, w] of [['rgba(150,120,80,0.55)', 520 * k], ['rgba(60,45,30,0.75)', 1.2]] as const) {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      lane.forEach((p, i) => {
        const [x, y] = P(p);
        if (i) ctx.lineTo(x + wob(), y + wob());
        else ctx.moveTo(x, y);
      });
      ctx.stroke();
    }
  }
  // cliffs: ink outline + hatching
  for (const poly of map.walls) {
    ctx.beginPath();
    poly.forEach((p, i) => (i ? ctx.lineTo(...P(p)) : ctx.moveTo(...P(p))));
    ctx.closePath();
    ctx.fillStyle = 'rgba(70,60,45,0.55)';
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(30,22,15,0.5)';
    ctx.lineWidth = 0.8;
    for (let i = -W; i < W; i += 4) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + W, W);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  for (const b of map.bushes) {
    const [x, y] = P(b);
    ctx.fillStyle = 'rgba(50,90,60,0.7)';
    ctx.beginPath();
    ctx.arc(x, y, Math.max(2, b.r * k), 0, Math.PI * 2);
    ctx.fill();
  }
  // border
  ctx.strokeStyle = '#3b2c1c';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, W - 4, W - 4);
  return c;
}
