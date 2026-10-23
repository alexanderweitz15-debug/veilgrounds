// In-game team chat (bottom left): bot lines from the sim (spec-bots §9, incl. flame), own messages with Enter.
// Chat commands (C4): /help, /mute, /unmute, /ff, /all (src/ui/chatCommands.ts); system lines are local only.
// All chat (S1, 2.8): Shift+Enter or "/all text" goes to both teams; enemy lines show with an [All] tag.
import './chat.css';
import type { PlayerSetup, SimEvent } from '../sim/types';
import { champName } from './names';
import { parseChat } from './chatCommands';
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
    this.open(e.shiftKey);
  };

  constructor(
    parent: HTMLElement,
    private readonly players: PlayerSetup[],
    private readonly mySlot: number,
    private readonly send: (text: string, all?: boolean) => void,
    private readonly blocked: () => boolean,
    /** Muted slots (shared with ClientState, which drops their pings). */
    private readonly muted: Set<number> = new Set(),
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
        if (text) this.submit(text, e.shiftKey);
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

  /** A team chat line from the HUD (objective timer, summoner timer, item ping). */
  say(text: string): void {
    this.send(text);
  }

  private submit(text: string, shift = false): void {
    const a = parseChat(text, this.players, this.mySlot, shift);
    switch (a.kind) {
      case 'send':
        return this.send(a.text);
      case 'help':
        return this.system(t('chat.help'));
      case 'mute':
        if (a.unknown !== undefined) return this.system(t('chat.noPlayer', { name: a.unknown }));
        for (const s of a.slots) (a.on ? this.muted.add(s) : this.muted.delete(s));
        return this.system(t(a.on ? 'chat.muted' : 'chat.unmuted', { names: a.slots.map((s) => this.nameOf(s)).join(', ') }));
      case 'surrender':
        return this.system(t('chat.ffNo'));
      case 'all':
        return a.text ? this.send(a.text, true) : this.system(t('chat.allNo'));
      default:
        return this.system(t('chat.unknownCmd', { cmd: a.cmd }));
    }
  }

  private nameOf(slot: number): string {
    const p = this.players.find((x) => x.slot === slot);
    return p ? (p.bot?.name ?? champName(p.champion)) : '?';
  }

  /** Local line (command feedback), never sent. */
  system(text: string): void {
    const line = document.createElement('div');
    line.className = 'chat-line system';
    line.textContent = text;
    this.append(line);
  }

  private append(line: HTMLElement): void {
    this.log.appendChild(line);
    while (this.log.childElementCount > MAX_LINES) this.log.firstElementChild!.remove();
    setTimeout(() => line.classList.add('old'), SHOW_MS);
  }

  /** `all` (Shift+Enter): starts with the "/all " prefix so the line is visibly an all-chat line. */
  private open(all = false): void {
    this.root.classList.add('typing');
    this.input.value = all ? '/all ' : '';
    this.input.focus();
  }

  private close(): void {
    if (!this.typing) return;
    this.root.classList.remove('typing');
    this.input.blur();
  }

  /** Chat events of the own team (the snapshot already filters to it). */
  onEvent(ev: SimEvent): void {
    if (ev.e !== 'chat' || this.muted.has(ev.slot)) return;
    const p = this.players.find((x) => x.slot === ev.slot);
    const enemy = ev.team !== (this.players.find((x) => x.slot === this.mySlot)?.team ?? ev.team);
    const who = p ? (p.slot === this.mySlot ? t('chat.you') : (p.bot?.name ?? champName(p.champion))) : '?';
    const line = document.createElement('div');
    line.className = 'chat-line' + (ev.slot === this.mySlot ? ' mine' : '') + (enemy ? ' enemy' : '') + (ev.all ? ' all' : '');
    const name = document.createElement('span');
    name.className = 'who';
    name.textContent = `${ev.all ? `${t('chat.allTag')} ` : ''}${who}${p ? ` (${champName(p.champion)})` : ''}: `;
    line.append(name, document.createTextNode(ev.text));
    this.append(line);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    this.root.remove();
  }
}
