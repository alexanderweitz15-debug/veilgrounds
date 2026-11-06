// ARAM champion select: the random champion of the human, one reroll (the roster of the other 9 changes with it).
import './gamePanels.css';
import type { SimConfig } from '../sim/types';
import { variantConfig } from '../game/modes';
import { settings } from '../settings';
import { champName } from './names';
import { t } from '../i18n';
import { setPortrait } from '../render/portraits';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

export function renderAramSelect(root: HTMLElement, onBack: () => void, onStart: (cfg: SimConfig) => void): void {
  root.textContent = '';
  root.classList.add('menu-screen', 'classic-lobby');
  const box = el('div', 'menu-panel classic-panel settings-panel', root);
  el('h2', 'menu-title', box, t('menu.aram'));
  const seed = (Math.random() * 2 ** 31) | 0;
  let rerolled = false;
  let cfg = variantConfig('aram', 'gold', seed);
  const card = el('div', 'loading-card me', box);
  const portrait = el('div', 'champ-portrait', card);
  const name = el('div', 'champ-name', card);
  const draw = (): void => {
    const c = cfg.players[0]!.champion;
    portrait.textContent = champName(c).charAt(0);
    setPortrait(portrait, c);
    name.textContent = champName(c);
    reroll.disabled = rerolled;
    reroll.textContent = rerolled ? t('aram.rerolled') : t('aram.reroll');
  };
  const row = el('div', 'row-buttons', box);
  const reroll = el('button', 'btn', row);
  reroll.addEventListener('click', () => {
    if (rerolled) return;
    rerolled = true;
    cfg = variantConfig('aram', 'gold', seed ^ 0x77, undefined);
    draw();
  });
  const start = el('button', 'btn primary', row, t('aram.start'));
  start.addEventListener('click', () => onStart({ ...cfg, botToxicity: settings.botToxicity }));
  el('button', 'btn', row, t('aram.back')).addEventListener('click', onBack);
  draw();
}
