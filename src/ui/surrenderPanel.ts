// Surrender vote panel (S1, FEATURE-GAP 2.10): shown while a vote of the own team runs. One chip per voter (green yes,
// red no, grey open), tally with the votes needed, countdown bar, Yes / No buttons and the keys F5 / F6 (as in LoL).
import './surrender.css';
import type { PlayerSetup, SimEvent } from '../sim/types';
import { ffReduce, ffSecondsLeft, myVote, type FfView } from '../game/surrender';
import { t } from '../i18n';
import { champName } from './names';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
};

export class SurrenderPanel {
  readonly root: HTMLElement;
  private view: FfView | null = null;
  private readonly chips: HTMLElement;
  private readonly tally: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly yes: HTMLButtonElement;
  private readonly no: HTMLButtonElement;
  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.view || (e.code !== 'F5' && e.code !== 'F6')) return;
    e.preventDefault(); // F5 must not reload the page while a vote is open
    this.cast(e.code === 'F5');
  };

  constructor(
    parent: HTMLElement,
    private readonly players: readonly PlayerSetup[],
    private readonly mySlot: number,
    private readonly vote: (yes: boolean) => void,
  ) {
    this.root = el('div', 'ff-panel', parent);
    el('div', 'ff-title', this.root, t('ff.title'));
    this.chips = el('div', 'ff-chips', this.root);
    this.tally = el('div', 'ff-tally', this.root);
    this.bar = el('div', 'ff-bar', el('div', 'ff-bar-track', this.root));
    const row = el('div', 'ff-buttons', this.root);
    this.yes = el('button', 'ff-yes', row, t('ff.yes'));
    this.no = el('button', 'ff-no', row, t('ff.no'));
    this.yes.addEventListener('click', () => this.cast(true));
    this.no.addEventListener('click', () => this.cast(false));
    window.addEventListener('keydown', this.onKey);
  }

  private cast(yes: boolean): void {
    if (this.view && !myVote(this.view, this.mySlot)) this.vote(yes);
  }

  onEvent(ev: SimEvent): void {
    if (ev.e !== 'ff') return;
    this.view = ffReduce(this.view, ev);
    this.root.classList.toggle('open', !!this.view);
    if (this.view) this.draw(this.view);
  }

  private draw(v: FfView): void {
    this.chips.textContent = '';
    for (const slot of v.voters) {
      const p = this.players.find((x) => x.slot === slot);
      const s = v.yes.includes(slot) ? 'yes' : v.no.includes(slot) ? 'no' : 'open';
      const c = el('span', `ff-chip ${s}`, this.chips, champName(p?.champion ?? null).charAt(0));
      c.title = `${p?.bot?.name ?? champName(p?.champion ?? null)}: ${t(`ff.state.${s}`)}`;
    }
    this.tally.textContent = t('ff.tally', { yes: v.yes.length, no: v.no.length, need: v.need, total: v.voters.length });
    const mine = myVote(v, this.mySlot);
    this.yes.disabled = this.no.disabled = mine !== null;
    this.root.classList.toggle('voted', mine !== null);
  }

  /** Per frame while open: countdown bar. */
  update(tick: number): void {
    if (!this.view) return;
    const left = ffSecondsLeft(this.view, tick);
    this.bar.style.width = `${Math.min(100, (left / 30) * 100)}%`;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    this.root.remove();
  }
}
