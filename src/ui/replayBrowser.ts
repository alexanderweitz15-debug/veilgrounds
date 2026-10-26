// Replay browser (S2, FEATURE-GAP 6.6): list of the saved games (IndexedDB, newest first), watch / delete.
import './replay.css';
import { deleteReplay, listReplays, REPLAY_CAP, type ReplayMeta } from '../replay/store';
import { clockOf } from '../replay/timeline';
import { champName } from './names';
import { t } from '../i18n';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
};

export function renderReplayBrowser(root: HTMLElement, onBack: () => void, onWatch: (id: string) => void): void {
  root.textContent = '';
  root.classList.add('menu-screen', 'classic-lobby');
  const panel = el('div', 'menu-panel classic-panel', root);
  el('h2', 'menu-title', panel, t('rp.title'));
  el('div', 'pg-sub', panel, t('rp.sub', { n: REPLAY_CAP }));
  const list = el('ul', 'rp-list', panel);
  const row = el('div', 'row-buttons', panel);
  el('button', 'menu-btn', row, t('menu.back')).addEventListener('click', onBack);

  const draw = (metas: ReplayMeta[]): void => {
    list.textContent = '';
    if (!metas.length) return void el('li', 'rp-empty', list, t('rp.empty'));
    for (const m of [...metas].reverse()) {
      const li = el('li', `rp-item ${m.win === null ? '' : m.win ? 'win' : 'loss'}`, list);
      el('span', 'stripe', li);
      const main = el('div', 'main', li);
      el('span', 'champ', main, champName(m.champion));
      el('span', 'res', main, t(m.win === null ? 'rp.undecided' : m.win ? 'rp.win' : 'rp.loss'));
      el('span', 'meta', main, `${clockOf(m.ticks)} · ${t('rp.kd', { k: m.kills, d: m.deaths })} · ${new Date(m.at).toLocaleString(document.documentElement.lang || 'de')}`);
      const btns = el('div', 'row-buttons', li);
      el('button', 'menu-btn', btns, t('rp.open')).addEventListener('click', () => onWatch(m.id));
      el('button', 'menu-btn secondary', btns, t('rp.delete')).addEventListener('click', () => void deleteReplay(m.id).then(() => listReplays().then(draw)));
    }
  };
  void listReplays().then(draw);
}
