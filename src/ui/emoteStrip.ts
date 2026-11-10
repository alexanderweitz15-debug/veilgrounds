// Emotes (key `emote`, default Z): a small strip of six quick phrases above the HUD; a pick shows as the own champion's
// speech bubble (voiceBubbles.ts emote()). Click or Esc / the key again closes it.
import { t } from '../i18n';

export const EMOTE_COUNT = 6;

export class EmoteStrip {
  readonly root = document.createElement('div');

  constructor(parent: HTMLElement, private readonly onPick: (text: string) => void) {
    this.root.className = 'emote-strip';
    this.root.style.display = 'none';
    for (let i = 1; i <= EMOTE_COUNT; i++) {
      const b = document.createElement('button');
      b.textContent = t(`emote.${i}`);
      b.addEventListener('mousedown', (e) => e.stopPropagation());
      b.addEventListener('click', () => {
        this.onPick(t(`emote.${i}`));
        this.toggle(false);
      });
      this.root.appendChild(b);
    }
    parent.appendChild(this.root);
  }

  get open(): boolean {
    return this.root.style.display !== 'none';
  }

  toggle(on = !this.open): void {
    this.root.style.display = on ? '' : 'none';
  }

  dispose(): void {
    this.root.remove();
  }
}
