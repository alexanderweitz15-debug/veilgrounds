// Post-game mistake list (S2, FEATURE-GAP 6.3): bot errors + attention (from the bot log) and the player's own patterns,
// every row with "Replay moment" (jumps into the replay viewer 5 s before the mistake). Data: src/stats/errorList.ts.
import './replay.css';
import type { ErrorList } from '../stats/errorList';
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

/** Sentence of a player pattern (pe.you.<id> with its vars). */
export const youText = (id: string, vars: Record<string, number | string>): string => t(`pe.you.${id}`, { ...vars, died: vars.died ? t('pe.died') : '' });

export function renderErrorList(parent: HTMLElement, list: ErrorList, onJump?: (tick: number) => void): void {
  const box = el('div', 'pe-box', parent);
  el('h3', 'pg-h3', box, t('pe.title'));
  el('div', 'pg-sub', box, t('pe.sub'));
  if (!onJump) el('div', 'rp-warn', box, t('pe.noReplay'));
  const row = (ul: HTMLElement, tick: number, text: string, cls = ''): void => {
    const li = el('li', `pe-row ${cls}`, ul);
    el('span', 'pe-t', li, clockOf(tick));
    el('span', 'pe-x', li, text);
    if (onJump) el('button', 'rp-btn', li, t('pe.jump')).addEventListener('click', () => onJump(tick));
  };

  el('h4', 'pe-h', box, t('pe.bots'));
  const bots = el('ul', 'pe-list', box);
  for (const e of list.bots) {
    const how = e.detectedAfterS === null ? t('pe.undetected') : `${t('pe.detected', { s: e.detectedAfterS })}${e.myBad ? `, ${t('pe.myBad')}` : ''}`;
    row(bots, e.tick, `${champName(e.champ)}: ${t(`pe.err.${e.id}`)} (${t('pe.dur', { s: e.durS })}) - ${how}`);
  }
  for (const a of list.attention) {
    row(bots, a.longestTick, t('pe.attention', { bot: champName(a.champ), n: a.windows, s: a.distractedS, pct: a.pct, why: t(`pe.att.${a.top.toLowerCase()}`) }), 'att');
  }
  if (!list.bots.length && !list.attention.length) el('li', 'rp-empty', bots, t('pe.none.bots'));

  el('h4', 'pe-h', box, t('pe.you'));
  const you = el('ul', 'pe-list', box);
  for (const e of list.you) row(you, e.tick, youText(e.id, e.vars));
  if (!list.you.length) el('li', 'rp-empty', you, t('pe.none.you'));
}
