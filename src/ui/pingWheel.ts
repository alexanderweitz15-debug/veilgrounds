// Radial ping wheel (hold G, move the mouse towards a ping, release). Releasing without moving = "Achtung".
import type { PingKind } from '../sim/types';
import { t } from '../i18n';

/** Eight wheel slots, clockwise from the top. */
export const WHEEL: PingKind[] = ['danger', 'onMyWay', 'help', 'vision', 'missing', 'back', 'group', 'ok'];
const DEADZONE = 22;
const WHEEL_MARGIN_X = 170;
const WHEEL_MARGIN_Y = 110;

/** Glyph per kind: wheel slots, world badges (src/render/pings.ts) and the minimap share it. */
export const PING_ICON: Record<PingKind, string> = {
  alert: '!',
  danger: '⚠',
  onMyWay: '➜',
  back: '↶',
  missing: '?',
  vision: '◉',
  help: '✚',
  group: '⚑',
  focus: '◎',
  objective: '★',
  ok: '✓',
  question: '?',
  myBad: '✗',
};

/** Wheel slot for a mouse offset from the wheel centre (dx, dy in px, y down); 'alert' inside the dead zone. */
export function pickWheel(dx: number, dy: number): PingKind {
  if (dx * dx + dy * dy < DEADZONE * DEADZONE) return 'alert';
  const a = Math.atan2(dy, dx) + Math.PI / 2; // 0 = up, clockwise
  const i = Math.round((a / (Math.PI * 2)) * WHEEL.length + WHEEL.length) % WHEEL.length;
  return WHEEL[i]!;
}

export const PING_COLOR: Record<PingKind, string> = {
  alert: '#e8d9a8',
  danger: '#e0473a',
  onMyWay: '#4aa6e8',
  back: '#e8a23a',
  missing: '#f0d24a',
  vision: '#9ad8a0',
  help: '#4aa6e8',
  group: '#c39cf0',
  focus: '#e0473a',
  objective: '#f0d24a',
  ok: '#9ad8a0',
  question: '#f0d24a',
  myBad: '#b8a8d8',
};

export class PingWheel {
  readonly el: HTMLDivElement;
  /** Wheel centre (kept inside the window) and the press point (the dead zone is measured from it). */
  private ox = 0;
  private oy = 0;
  private px = 0;
  private py = 0;
  private open = false;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'ping-wheel';
    WHEEL.forEach((k, i) => {
      const s = document.createElement('div');
      s.className = 'ping-slot';
      s.dataset.kind = k;
      const a = (i / WHEEL.length) * Math.PI * 2 - Math.PI / 2;
      s.style.left = `${Math.cos(a) * 78}px`;
      s.style.top = `${Math.sin(a) * 78}px`;
      s.style.setProperty('--c', PING_COLOR[k]);
      const g = document.createElement('span');
      g.className = 'ping-glyph';
      g.textContent = PING_ICON[k];
      s.append(g, t(`ping.${k}`));
      this.el.appendChild(s);
    });
    // centre: releasing without moving pings "Achtung / Hier hin"
    const c = document.createElement('div');
    c.className = 'ping-slot ping-centre';
    c.dataset.kind = 'alert';
    c.style.setProperty('--c', PING_COLOR.alert);
    c.textContent = PING_ICON.alert;
    c.title = t('ping.alert');
    this.el.appendChild(c);
    parent.appendChild(this.el);
  }

  show(x: number, y: number): void {
    this.px = x;
    this.py = y;
    // the wheel is ~160 px wide per side and ~100 px tall per side: shift it in from the window edge (minimap in the corner)
    this.ox = Math.min(Math.max(x, WHEEL_MARGIN_X), Math.max(WHEEL_MARGIN_X, window.innerWidth - WHEEL_MARGIN_X));
    this.oy = Math.min(Math.max(y, WHEEL_MARGIN_Y), Math.max(WHEEL_MARGIN_Y, window.innerHeight - WHEEL_MARGIN_Y));
    x = this.ox;
    y = this.oy;
    this.open = true;
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
    this.el.classList.add('open');
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Ping kind for the current mouse position (alert inside the dead zone). */
  pick(mx: number, my: number): PingKind {
    return Math.hypot(mx - this.px, my - this.py) < DEADZONE ? 'alert' : pickWheel(mx - this.ox, my - this.oy);
  }

  highlight(mx: number, my: number): void {
    const k = this.pick(mx, my);
    for (const s of this.el.children) (s as HTMLElement).classList.toggle('on', (s as HTMLElement).dataset.kind === k);
  }

  hide(): void {
    this.open = false;
    this.el.classList.remove('open');
  }
}
