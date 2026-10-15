// Radial ping wheel (hold G, move the mouse towards a ping, release). Releasing without moving = "Achtung".
import type { PingKind } from '../sim/types';
import { t } from '../i18n';

/** Eight wheel slots, clockwise from the top. */
export const WHEEL: PingKind[] = ['danger', 'onMyWay', 'help', 'vision', 'missing', 'back', 'group', 'ok'];
const DEADZONE = 22;

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
};

export class PingWheel {
  readonly el: HTMLDivElement;
  private ox = 0;
  private oy = 0;
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
      s.textContent = t(`ping.${k}`);
      this.el.appendChild(s);
    });
    parent.appendChild(this.el);
  }

  show(x: number, y: number): void {
    this.ox = x;
    this.oy = y;
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
    const dx = mx - this.ox;
    const dy = my - this.oy;
    if (dx * dx + dy * dy < DEADZONE * DEADZONE) return 'alert';
    const a = Math.atan2(dy, dx) + Math.PI / 2; // 0 = up, clockwise
    const i = Math.round((a / (Math.PI * 2)) * WHEEL.length + WHEEL.length) % WHEEL.length;
    return WHEEL[i]!;
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
