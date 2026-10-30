// Minimap (bottom right) drawn like a hand-inked field map: parchment, washed river, inked lanes and cliffs.
// Left click/drag moves the camera, right click sends a move command.
import { PING_COLOR, PING_ICON } from './pingWheel';
import { PING_STYLE } from '../render/pingAnim';
import type { MapData, Pt } from '../sim/map';
import type { ClientState } from '../game/state';
import type { World } from '../render/world';
import type { FogOfWar } from '../render/fog';
import { Kind } from '../sim/types';
import { canvasToSim, mulberry, simToCanvas, MAP_SIZE } from '../render/coords';
import { REL, INK } from '../render/palette';
import { organicOutline } from '../render/organic';
import { CAMPS } from '../sim/systems/jungle';
import { campLabel } from '../game/jungleTracker';

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

  constructor(private readonly map: MapData, private readonly onCamera: (x: number, y: number) => void, private readonly onMove: (x: number, y: number) => void, private readonly onPing?: (x: number, y: number) => void) {
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
      if (e.button === 0 && e.altKey && this.onPing) this.onPing(x, y); // Alt+click: danger ping on the map
      else if (e.button === 0) {
        this.dragging = true;
        this.onCamera(x, y);
      } else if (e.button === 2) this.onMove(x, y);
    });
    const move = (e: MouseEvent): void => {
      // the button was released outside the window (no mouseup reached us): the drag is over
      if (this.dragging && !(e.buttons & 1)) this.dragging = false;
      if (this.dragging) this.onCamera(...toSim(e));
    };
    const up = (): void => {
      this.dragging = false;
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('blur', up);
    this.dispose = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('blur', up);
    };
  }

  /** Map point under a screen position when it is over the minimap (ping wheel on the minimap), else null. */
  simAtClient(cx: number, cy: number): [number, number] | null {
    const r = this.canvas.getBoundingClientRect();
    if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return null;
    return canvasToSim(((cx - r.left) / r.width) * SIZE, ((cy - r.top) / r.height) * SIZE, SIZE);
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
    // epic objectives as small badges (position only: kills in the fog are not known). The pit holds the Kesselbrut
    // until it leaves at 19:45, then the Schleierwaechter.
    const time = snap?.time ?? 0;
    const pitKessel = time < (CAMPS.kesselbrut.until ?? 0);
    epicBadge(ctx, ...simToCanvas(this.map.objectives.leviathan.x, this.map.objectives.leviathan.y, W), this.dpr, 'leviathan');
    epicBadge(ctx, ...simToCanvas(this.map.objectives.kesselbrut.x, this.map.objectives.kesselbrut.y, W), this.dpr, pitKessel ? 'kesselbrut' : 'schleierwaechter');
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
          } else if (e.kind === Kind.Ward) {
            // player wards as small diamonds; jungle river vision (no e.ward) is not drawn
            if (!e.alive || !e.ward) continue;
            // revealed enemy Schleierward (B1 `stealth` flag, optional until sim/b-mechanics is merged): hollow
            // diamond with an eye dot in the enemy colour
            const revealed = (e as { stealth?: true }).stealth === true && e.team !== state.myTeam;
            const r = (e.ward === 'seal' ? 3.2 : 2.6) * d;
            ctx.fillStyle = e.ward === 'seal' ? (e.team === state.myTeam ? REL.allySeal : REL.enemySeal) : col;
            ctx.beginPath();
            ctx.moveTo(x, y - r);
            ctx.lineTo(x + r, y);
            ctx.lineTo(x, y + r);
            ctx.lineTo(x - r, y);
            ctx.closePath();
            if (revealed) {
              ctx.strokeStyle = col;
              ctx.lineWidth = 1.6 * d;
              ctx.stroke();
              ctx.beginPath();
              ctx.arc(x, y, 0.9 * d, 0, Math.PI * 2);
              ctx.fill();
              continue;
            }
            ctx.fill();
            ctx.lineWidth = 1 * d;
            ctx.stroke();
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
    this.drawGhosts(state);
    this.drawJungle(state);
    // team pings: pulsing rings
    for (const pg of state.pings) {
      const age = (now - pg.at) / 3000;
      if (age > 1) continue;
      const [x, y] = simToCanvas(pg.x, pg.y, W);
      ctx.strokeStyle = PING_COLOR[pg.kind];
      ctx.globalAlpha = 1 - age;
      ctx.lineWidth = 2.5 * this.dpr;
      const inward = PING_STYLE[pg.kind].inward; // "back"/"on my way" rings shrink onto the spot, the rest expand
      for (const k of [0, 0.5]) {
        const w = (age * 3 + k) % 1;
        const r = (6 + (inward ? 1 - w : w) * 14) * this.dpr;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = PING_COLOR[pg.kind];
      ctx.font = `900 ${11 * this.dpr}px "Segoe UI Symbol", "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(PING_ICON[pg.kind], x, y - 1 * this.dpr);
      ctx.globalAlpha = 1;
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

  /**
   * Jungle-Tracker timers under each camp (src/game/jungleTracker.ts, only what the team saw): "1:42" exact, "~1:42"
   * upper bound after finding the camp empty, "~1:42?" optional estimate (orange), "?" unseen. Camps up show nothing.
   */
  private drawJungle(state: ClientState): void {
    if (!state.jungle.enabled) return;
    const ctx = this.ctx;
    const d = this.dpr;
    ctx.font = `bold ${8 * d}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 2.5 * d;
    ctx.lineJoin = 'round';
    for (const c of state.jungle.camps()) {
      const text = campLabel(c);
      if (!text) continue;
      const [x, y] = simToCanvas(c.x, c.y, this.canvas.width);
      ctx.globalAlpha = c.state === 'unknown' ? 0.6 : 1;
      ctx.strokeStyle = 'rgba(27,22,18,0.9)';
      ctx.strokeText(text, x, y + 4 * d);
      ctx.fillStyle = c.state === 'estimate' ? '#ffb15a' : c.state === 'unknown' ? '#d8d0bc' : '#fff6da';
      ctx.fillText(text, x, y + 4 * d);
    }
    ctx.globalAlpha = 1;
  }

  /** Last seen enemy champions: faded, dashed ring with the initial and a "?" (fades out over GHOST_S). */
  private drawGhosts(state: ClientState): void {
    const ctx = this.ctx;
    const d = this.dpr;
    for (const g of state.lastSeenEnemies(GHOST_S)) {
      const [x, y] = simToCanvas(g.x, g.y, this.canvas.width);
      ctx.globalAlpha = 0.85 * (1 - g.age / GHOST_S) + 0.15;
      ctx.fillStyle = 'rgba(30, 24, 30, 0.75)';
      ctx.strokeStyle = REL.enemy;
      ctx.lineWidth = 1.5 * d;
      ctx.setLineDash([2.5 * d, 2 * d]);
      ctx.beginPath();
      ctx.arc(x, y, 7 * d, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#f1e6c8';
      ctx.font = `bold ${8 * d}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${g.champ.charAt(0).toUpperCase()}?`, x, y + 0.5 * d);
    }
    ctx.globalAlpha = 1;
  }
}

/** Seconds a vanished enemy champion stays on the minimap at its last seen position (fading out). */
const GHOST_S = 45;

const PLANT_FILL: Record<string, string> = { sprungfrucht: '#f08a3a', honigfrucht: '#f2cf4a', spaehfrucht: '#6fb6f0', manafrucht: '#4a7ae0', windfrucht: '#8fe0c0', schildfrucht: '#e8e8f0' };

type Epic = 'leviathan' | 'kesselbrut' | 'schleierwaechter';
const EPIC_FILL: Record<Epic, string> = { leviathan: '#3f9fb4', kesselbrut: '#8a5cc8', schleierwaechter: '#5a3a8e' };

/** Round inked badge with a tiny glyph: Leviathan = wave crest, Kesselbrut = three grubs, Schleierwaechter = veiled eye. */
function epicBadge(ctx: CanvasRenderingContext2D, x: number, y: number, d: number, kind: Epic): void {
  const r = (kind === 'schleierwaechter' ? 8 : 7) * d;
  ctx.fillStyle = EPIC_FILL[kind];
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5 * d;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,240,210,0.9)';
  ctx.lineWidth = 1.2 * d;
  ctx.beginPath();
  ctx.arc(x, y, r - 1.6 * d, 0, Math.PI * 2);
  ctx.stroke();
  const fg = '#fff3d6';
  ctx.fillStyle = fg;
  ctx.strokeStyle = fg;
  ctx.lineWidth = 1.4 * d;
  ctx.lineCap = 'round';
  if (kind === 'leviathan') {
    ctx.beginPath();
    ctx.moveTo(x - 4 * d, y + 2 * d);
    ctx.quadraticCurveTo(x - 2 * d, y - 4 * d, x + 1 * d, y - 1 * d);
    ctx.quadraticCurveTo(x + 3 * d, y + 1 * d, x + 4 * d, y - 2 * d);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 4 * d, y + 3.5 * d);
    ctx.lineTo(x + 4 * d, y + 3.5 * d);
    ctx.stroke();
  } else if (kind === 'kesselbrut') {
    for (const [dx, dy] of [[-2.6, 1.6], [2.6, 1.6], [0, -2.4]] as const) {
      ctx.beginPath();
      ctx.arc(x + dx * d, y + dy * d, 1.7 * d, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.beginPath();
    ctx.moveTo(x - 4.5 * d, y);
    ctx.quadraticCurveTo(x, y - 4.5 * d, x + 4.5 * d, y);
    ctx.quadraticCurveTo(x, y + 4.5 * d, x - 4.5 * d, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 1.6 * d, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineCap = 'butt';
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
  map.walls.forEach((wall, wi) => {
    // same rounded, wobbly outline as the 3D cliffs (render/organic.ts)
    const poly = organicOutline(wall, wi * 1.7 + 0.3);
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
  });
  for (const b of map.bushes) {
    const [x, y] = P(b);
    ctx.fillStyle = 'rgba(50,90,60,0.7)';
    ctx.beginPath();
    ctx.arc(x, y, Math.max(2, b.r * k), 0, Math.PI * 2);
    ctx.fill();
  }
  // jungle camps + objectives (Agent H): small inked rings; buffs tinted blue/red, objectives larger
  const camp = (p: { x: number; y: number }, r: number, fill: string): void => {
    const [x, y] = P(p);
    ctx.fillStyle = fill;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  };
  const campFill: Record<string, string> = {
    dornenbock: 'rgba(90,140,210,0.9)',
    glutwaechter: 'rgba(210,100,70,0.9)',
    sumpfunke: 'rgba(96,170,110,0.95)', // swamp toad: mossy green, the one camp that stands alone
  };
  const d = W / SIZE;
  for (const side of map.sides) {
    for (const c of side.camps) camp(c, (c.id === 'sumpfunke' ? 3.6 : 3) * d, campFill[c.id] ?? 'rgba(215,190,120,0.85)');
    // plants: small leaf-diamonds tinted by type (Sprungfrucht orange, Honigfrucht gold, Spaehfrucht blue)
    for (const pl of side.plants) {
      const [x, y] = P(pl);
      const r = 2.6 * d;
      ctx.fillStyle = PLANT_FILL[pl.type] ?? '#9fc27a';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.8 * d;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.quadraticCurveTo(x + r, y, x, y + r);
      ctx.quadraticCurveTo(x - r, y, x, y - r);
      ctx.fill();
      ctx.stroke();
    }
  }
  for (const p of map.objectives.nebelschleicher) camp(p, 3 * d, 'rgba(160,210,200,0.9)');
  // border
  ctx.strokeStyle = '#3b2c1c';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, W - 4, W - 4);
  return c;
}
