// Trainer HUD (Phase 5): live panel (clock, trainer stats from Snapshot.trainer) and the result dialog at the end.
import './trainer.css';
import type { TrainerHud, TrainerStat } from '../sim/trainer';
import { t } from '../i18n';
import { settings } from '../settings';

export interface TrainerResultActions {
  retry(): void;
  analysis(): void;
  quit(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
};

export const clock = (s: number): string => {
  const v = Math.max(0, Math.floor(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
};

export function formatStat(s: TrainerStat): string {
  switch (s.fmt) {
    case 'pct':
      return `${Math.round(s.v)} %`;
    case 'sec':
      return clock(s.v);
    case 'dec':
      return settings.lang === 'de' ? s.v.toFixed(1).replace('.', ',') : s.v.toFixed(1);
    default:
      return String(Math.round(s.v));
  }
}

/** Stat label; the dodge difficulty shows its name instead of the number. */
const statValue = (s: TrainerStat): string => (s.k === 'difficulty' ? t(`trainer.diff.${s.v}`) : formatStat(s));

export class TrainerPanel {
  readonly root: HTMLElement;

  private readonly clockEl: HTMLElement;
  private readonly stats: HTMLElement;
  private result: HTMLElement | null = null;
  private lastKey = '';

  constructor(parent: HTMLElement, private readonly kind: string, private readonly actions: TrainerResultActions) {
    this.root = el('div', 'tr-panel', parent);
    el('div', 'tr-title', this.root, t(`trainer.mode.${kind}`));
    this.clockEl = el('div', 'tr-clock', this.root, '0:00');
    this.stats = el('div', 'tr-stats', this.root);
    el('div', 'tr-hint', this.root, t(`trainer.hint.${kind}`));
  }

  /** Called every frame with the newest trainer state. Returns true once the run is over (dialog shown). */
  update(h: TrainerHud | undefined): boolean {
    if (!h) return false;
    this.clockEl.textContent = h.duration > 0 ? `${clock(h.time)} / ${clock(h.duration)}` : clock(h.time);
    const key = h.stats.map((s) => statValue(s)).join('|');
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.stats.textContent = '';
      for (const s of h.stats) {
        el('div', 'k', this.stats, t(`trainer.stat.${s.k}`));
        el('div', 'v', this.stats, statValue(s));
      }
    }
    if (h.done && !this.result) this.showResult(h);
    return h.done;
  }

  private showResult(h: TrainerHud): void {
    const wrap = el('div', 'tr-result', this.root.parentElement ?? document.body);
    this.result = wrap;
    const box = el('div', 'tr-box', wrap);
    el('h2', '', box, `${t(`trainer.mode.${this.kind}`)} – ${t('trainer.result')}`);
    if (h.won !== undefined) el('div', 'tr-score', box, h.won ? t('trainer.won') : t('trainer.lost'));
    if (h.grade) el('div', 'tr-grade', box, h.grade);
    el('div', 'tr-score', box, this.kind === 'dodge' ? `${t('trainer.stat.survived')}: ${clock(h.score)}` : `${t('trainer.score')}: ${Math.round(h.score)}`);
    const st = el('div', 'tr-stats', box);
    for (const s of h.stats) {
      el('div', 'k', st, t(`trainer.stat.${s.k}`));
      el('div', 'v', st, statValue(s));
    }
    const row = el('div', 'row-buttons', box);
    el('button', 'menu-btn secondary', row, t('menu.quit')).addEventListener('click', () => this.actions.quit());
    el('button', 'menu-btn secondary', row, t('trainer.analysis')).addEventListener('click', () => this.actions.analysis());
    el('button', 'menu-btn', row, t('trainer.retry')).addEventListener('click', () => this.actions.retry());
    for (const b of row.querySelectorAll('button')) b.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  dispose(): void {
    this.root.remove();
    this.result?.remove();
  }
}
