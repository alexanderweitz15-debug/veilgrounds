// Post-game "Was ein Challenger getan hätte" (Challenger-Geist, src/ai/ghost.ts): a timeline of the most impactful
// moments where a shadow Challenger brain on the player's own (fog-filtered) view decided differently.
// Each card: time, situation, what you did, what the ghost would have done, why (its decision-log reason).
import './ghostReview.css';
import type { GhostMoment } from '../ai/ghost';
import { t } from '../i18n';
import { clock } from './trainerHud';
import { setTip } from './tooltip';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
};

/** Known decision-log reasons (English dev strings from src/ai) -> i18n key; others are shown as they are. */
const REASONS: [RegExp, string][] = [
  [/^low hp/, 'lowHp'],
  [/^tower aggro/, 'towerAggro'],
  [/^outnumbered/, 'outnumbered'],
  [/^still unsafe/, 'unsafe'],
  [/^winProb ([\d.]+) vs ([\d.]+)/, 'winProb'],
  [/^flee/, 'flee'],
  [/^b: safe point not reachable/, 'flashSafe'],
  [/danger ping/, 'dangerPing'],
  [/skillshot|dodge/, 'dodge'],
  [/^won skirmish/, 'wonSkirmish'],
  [/objective|dragon|leviathan|baron|safety/i, 'objective'],
  [/last hit|lasthit/, 'lastHit'],
  [/kill/, 'kill'],
];

/** German (or English) explanation of a ghost reason. */
export function ghostReason(why: string): string {
  for (const [re, key] of REASONS) {
    const m = re.exec(why);
    if (!m) continue;
    if (key === 'winProb') return t('ghost.reason.winProb', { p: Math.round(Number(m[1]) * 100), need: Math.round(Number(m[2]) * 100) });
    return t(`ghost.reason.${key}`);
  }
  return why;
}

const vars = (m: GhostMoment): Record<string, string | number> => {
  const v: Record<string, string | number> = { ...m.vars };
  if (typeof v.obj === 'string') v.obj = t(`ghost.obj.${v.obj}`);
  return v;
};

export function renderGhostReview(parent: HTMLElement, moments: GhostMoment[] | undefined): void {
  if (!moments) return;
  const box = el('section', 'gh-review', parent);
  const head = el('div', 'gh-head', box);
  el('h3', '', head, t('ghost.title'));
  const info = el('span', 'gh-info', head, '?');
  setTip(info, `text:${t('ghost.about')}`);
  if (!moments.length) {
    el('div', 'gh-empty', box, t('ghost.none'));
    return;
  }
  el('div', 'gh-sub', box, moments.length === 1 ? t('ghost.sub1') : t('ghost.sub', { n: moments.length }));
  const list = el('ol', 'gh-list', box);
  for (const m of moments) {
    const li = el('li', `gh-item gh-${m.kind}`, list);
    const side = el('div', 'gh-time', li);
    el('div', 'clk', side, clock(m.t));
    const bar = el('div', 'gh-impact', side);
    bar.style.setProperty('--impact', String(Math.max(0.1, Math.min(1, m.impact / 10))));
    setTip(bar, `text:${t('ghost.impact', { n: Math.round(m.impact * 10) / 10 })}`);
    const body = el('div', 'gh-body', li);
    const v = vars(m);
    el('div', 'gh-sit', body, t(`ghost.${m.kind}.situation`, v));
    const you = el('div', 'gh-row you', body);
    el('span', 'k', you, t('ghost.you'));
    el('span', 'v', you, t(`ghost.out.${m.outcome}`, v));
    const gh = el('div', 'gh-row ghost', body);
    el('span', 'k', gh, t('ghost.ghost'));
    el('span', 'v', gh, t(`ghost.${m.kind}.ghost`, v));
    const why = el('div', 'gh-row why', body);
    el('span', 'k', why, t('ghost.why'));
    el('span', 'v', why, ghostReason(m.why));
  }
}
