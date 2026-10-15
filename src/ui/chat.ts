// In-game team chat (bottom left): bot lines from the sim (spec-bots §9, incl. flame), own messages with Enter.
import './chat.css';
import type { PlayerSetup, SimEvent } from '../sim/types';
import { champName } from './names';
import { t } from '../i18n';

const SHOW_MS = 12000;
const MAX_LINES = 40;

export class ChatBox {
  readonly root: HTMLDivElement;
  private readonly log: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
    if (this.typing || this.blocked()) return;
    e.preventDefault();
    this.open();
  };

  constructor(
    parent: HTMLElement,
    private readonly players: PlayerSetup[],
    private readonly mySlot: number,
    private readonly send: (text: string) => void,
    private readonly blocked: () => boolean,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'chat-box';
    this.log = document.createElement('div');
    this.log.className = 'chat-log';
    this.input = document.createElement('input');
    this.input.className = 'chat-input';
    this.input.maxLength = 120;
    this.input.placeholder = t('chat.placeholder');
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing must not cast abilities
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        const text = this.input.value.trim();
        if (text) this.send(text);
        this.close();
      } else if (e.code === 'Escape') this.close();
    });
    this.input.addEventListener('blur', () => this.close());
    this.root.append(this.log, this.input);
    parent.appendChild(this.root);
    window.addEventListener('keydown', this.onKey);
  }

  get typing(): boolean {
    return this.root.classList.contains('typing');
  }

  private open(): void {
    this.root.classList.add('typing');
    this.input.value = '';
    this.input.focus();
  }

  private close(): void {
    if (!this.typing) return;
    this.root.classList.remove('typing');
    this.input.blur();
  }

  /** Chat events of the own team (the snapshot already filters to it). */
  onEvent(ev: SimEvent): void {
    if (ev.e !== 'chat') return;
    const p = this.players.find((x) => x.slot === ev.slot);
    const who = p ? (p.slot === this.mySlot ? t('chat.you') : (p.bot?.name ?? champName(p.champion))) : '?';
    const line = document.createElement('div');
    line.className = 'chat-line' + (ev.slot === this.mySlot ? ' mine' : '');
    const name = document.createElement('span');
    name.className = 'who';
    name.textContent = `${who}${p ? ` (${champName(p.champion)})` : ''}: `;
    line.append(name, document.createTextNode(ev.text));
    this.log.appendChild(line);
    while (this.log.childElementCount > MAX_LINES) this.log.firstElementChild!.remove();
    setTimeout(() => line.classList.add('old'), SHOW_MS);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    this.root.remove();
  }
}
