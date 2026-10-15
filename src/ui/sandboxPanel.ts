// Sandbox+ panel (Phase 5): the cheats the HUD's basic sandbox list does not have. Set level, gold, permanent
// cooldown reset, god mode, minion wave now, jungle camps now, lane minions on/off. Toggle states come back from
// the snapshot (PlayerHud.sandbox), so the buttons always show what the sim actually does.
import './trainer.css';
import type { CheatOp } from '../sim/types';
import type { PlayerHud } from '../sim/snapshot';
import { t } from '../i18n';

export type SendCheat = (op: CheatOp, value?: number) => void;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
};

export class SandboxPanel {
  readonly root: HTMLElement;
  private readonly noCd: HTMLButtonElement;
  private readonly god: HTMLButtonElement;

  constructor(parent: HTMLElement, send: SendCheat) {
    this.root = el('div', 'sbx-panel', parent);
    // clicks here must not reach the game canvas (move orders)
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    el('div', 'tr-title', this.root, t('sandbox.title'));
    const lvl = el('select', '', this.root);
    el('option', '', lvl, t('sandbox.level')).value = '';
    for (let l = 1; l <= 18; l++) el('option', '', lvl, `${t('sandbox.levelN')} ${l}`).value = String(l);
    lvl.addEventListener('change', () => {
      if (lvl.value) send('setLevel', Number(lvl.value));
      lvl.value = '';
    });
    const gold = el('div', 'sbx-row', this.root);
    el('button', '', gold, '+1000 G').addEventListener('click', () => send('gold', 1000));
    el('button', '', gold, '+10000 G').addEventListener('click', () => send('gold', 10000));
    this.noCd = el('button', '', this.root, t('sandbox.noCd'));
    this.noCd.addEventListener('click', () => send('noCooldowns'));
    this.god = el('button', '', this.root, t('sandbox.god'));
    this.god.addEventListener('click', () => send('godMode'));
    el('button', '', this.root, t('sandbox.wave')).addEventListener('click', () => send('spawnWave'));
    el('button', '', this.root, t('sandbox.camps')).addEventListener('click', () => send('respawnCamps'));
    el('button', '', this.root, t('cheat.toggleMinions')).addEventListener('click', () => send('toggleMinions'));
  }

  update(me: PlayerHud | null | undefined): void {
    this.noCd.classList.toggle('on', !!me?.sandbox?.noCd);
    this.god.classList.toggle('on', !!me?.sandbox?.god);
  }

  dispose(): void {
    this.root.remove();
  }
}
