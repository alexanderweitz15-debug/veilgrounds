// "Jungle-Tracker" panel: camps by side with timers (src/game/jungleTracker.ts, only what the team saw). A small
// button above the minimap toggles it; the "show estimate" checkbox switches the clearly marked jungler guess.
// Both choices are remembered per browser (localStorage, optional).
import './jungleTracker.css';
import type { ClientState } from '../game/state';
import { type CampView } from '../game/jungleTracker';
import { CAMPS } from '../sim/systems/jungle';
import { t } from '../i18n';
import { mmss } from './scoreboard';

const LS_OPEN = 'vg.jungle.open';
const LS_EST = 'vg.jungle.estimate';

function load(k: string): boolean {
  try {
    return localStorage.getItem(k) === '1';
  } catch {
    return false;
  }
}
function save(k: string, v: boolean): void {
  try {
    localStorage.setItem(k, v ? '1' : '0');
  } catch {
    /* private mode: the choice just is not remembered */
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

/** Row text for a camp state ("back in 1:42", "seen empty, back by 1:42", ...). */
export function campDetail(c: CampView): string {
  const s = c.left === null ? '' : mmss(c.left);
  switch (c.state) {
    case 'pending': return t('jungle.pending', { s });
    case 'cleared': return t('jungle.cleared', { s });
    case 'empty': return t('jungle.empty', { s });
    case 'estimate': return t('jungle.estimate.row', { s });
    case 'up': return c.seenAgo === null ? t('jungle.up') : t('jungle.seen', { s: mmss(c.seenAgo) });
    default: return t('jungle.unknown');
  }
}

export class JungleTrackerPanel {
  readonly root = document.createElement('div');
  private readonly body: HTMLElement;
  private key = '';
  private nextAt = 0;
  private tracker: ClientState['jungle'] | null = null;

  constructor() {
    this.root.className = 'jungle-tracker';
    const panel = el('div', 'jt-panel', this.root);
    el('div', 'jt-ttl', panel, t('jungle.title'));
    this.body = el('div', 'jt-body', panel);
    const opt = el('label', 'jt-opt', panel);
    const box = el('input', '', opt);
    box.type = 'checkbox';
    box.checked = load(LS_EST);
    el('span', '', opt, t('jungle.estimate'));
    box.addEventListener('change', () => {
      save(LS_EST, box.checked);
      if (this.tracker) this.tracker.estimate = box.checked;
      this.key = '';
    });
    const btn = el('button', 'jt-btn', this.root, t('jungle.btn'));
    btn.title = t('jungle.tip');
    btn.addEventListener('mousedown', (e) => e.stopPropagation());
    btn.addEventListener('click', () => this.setOpen(!this.root.classList.contains('open')));
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());
    this.setOpen(load(LS_OPEN));
  }

  setOpen(on: boolean): void {
    this.root.classList.toggle('open', on);
    save(LS_OPEN, on);
    this.key = '';
  }

  update(state: ClientState, now: number): void {
    const j = state.jungle;
    if (!this.tracker) {
      this.tracker = j;
      j.estimate = load(LS_EST);
    }
    this.root.style.display = j.enabled ? '' : 'none';
    if (!j.enabled || !this.root.classList.contains('open') || now < this.nextAt) return;
    this.nextAt = now + 250;
    const g = j.grouped();
    const groups: [string, CampView[]][] = [['jungle.own', g.own], ['jungle.enemy', g.enemy], ['jungle.river', g.river]];
    const rows = groups.map(([title, list]) => ({ title, list: list.map((c) => ({ c, text: campDetail(c) })) }));
    const key = rows.map((r) => r.list.map((x) => `${x.c.state}${x.text}`).join('|')).join('/') + String(j.estimate);
    if (key === this.key) return;
    this.key = key;
    this.body.textContent = '';
    for (const r of rows) {
      el('div', 'jt-grp', this.body, t(r.title));
      for (const x of r.list) {
        const row = el('div', `jt-row ${x.c.state}`, this.body);
        el('span', 'jt-name', row, this.name(x.c));
        el('span', 'jt-t', row, x.text);
      }
    }
  }

  private name(c: CampView): string {
    const base = t(`unit.${CAMPS[c.id].monsters[0]!.type}`);
    return c.side === 2 ? `${base} (${t(c.key === 'river:0' ? 'jungle.riverTop' : 'jungle.riverBottom')})` : base;
  }
}
