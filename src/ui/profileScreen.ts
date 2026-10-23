// Profile screen (S1 / FEATURE-GAP 4.8), opened from the main menu: overview and streaks, rank-estimate trend per
// category, stats per champion, match history list. Data: src/stats/history.ts (IndexedDB), aggregation in
// src/game/profile.ts (pure, tested). Texts: i18n keys profile.*.
import './profile.css';
import { t } from '../i18n';
import { settings } from '../settings';
import { RANKS } from '../ai/profiles/schema';
import { CATEGORY_IDS, type CategoryId } from '../stats/rankCalibration';
import { streaks, type MatchRecord } from '../stats/history';
import { championStats, currentEstimate, kdaOf, overview, rankOfIndex, rankTrend, recent, type TrendPoint } from '../game/profile';
import { champName } from './names';
import { setPortrait } from '../render/portraits';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
};

const SVG = 'http://www.w3.org/2000/svg';
const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const pct = (v: number): string => `${Math.round(v * 100)} %`;
const fix1 = (v: number): string => (Math.round(v * 10) / 10).toFixed(1);
const rankName = (i: number): string => t(`rank.${rankOfIndex(i)}`);

/** Sparkline of rank indices on a fixed 0..9 scale (Iron..Challenger); the last point is marked. */
function trendLine(parent: HTMLElement, pts: readonly number[]): void {
  const w = 190;
  const h = 44;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('class', 'pf-spark');
  const top = RANKS.length - 1;
  for (let r = 0; r <= top; r += 3) {
    const y = h - 4 - (r / top) * (h - 8);
    const g = document.createElementNS(SVG, 'line');
    g.setAttribute('x1', '0');
    g.setAttribute('x2', String(w));
    g.setAttribute('y1', y.toFixed(1));
    g.setAttribute('y2', y.toFixed(1));
    g.setAttribute('class', 'pf-grid');
    svg.appendChild(g);
  }
  const xy = pts.map((v, i) => [pts.length === 1 ? w / 2 : 4 + (i / (pts.length - 1)) * (w - 8), h - 4 - (Math.max(0, Math.min(top, v)) / top) * (h - 8)] as const);
  if (xy.length > 1) {
    const line = document.createElementNS(SVG, 'polyline');
    line.setAttribute('points', xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
    line.setAttribute('class', 'pf-spark-line');
    svg.appendChild(line);
  }
  const [lx, ly] = xy[xy.length - 1]!;
  const dot = document.createElementNS(SVG, 'circle');
  dot.setAttribute('cx', lx.toFixed(1));
  dot.setAttribute('cy', ly.toFixed(1));
  dot.setAttribute('r', '3');
  dot.setAttribute('class', 'pf-spark-dot');
  svg.appendChild(dot);
  parent.appendChild(svg);
}

function head(parent: HTMLElement, text: string): HTMLElement {
  return el('h3', 'pf-h', parent, text);
}

function portrait(parent: HTMLElement, champion: string): void {
  const p = el('span', 'pf-portrait', parent, champName(champion).charAt(0));
  setPortrait(p, champion);
}

function stat(parent: HTMLElement, label: string, value: string, cls = ''): void {
  const b = el('div', `pf-stat ${cls}`, parent);
  el('div', 'pf-stat-v', b, value);
  el('div', 'pf-stat-l', b, label);
}

function renderOverview(root: HTMLElement, history: readonly MatchRecord[], now: number): void {
  const o = overview(history);
  const st = streaks(history, now);
  const box = el('section', 'pf-sec', root);
  head(box, t('profile.overview'));
  const row = el('div', 'pf-stats', box);
  stat(row, t('profile.games'), String(o.games));
  stat(row, t('profile.winLoss'), o.decided ? `${o.wins} / ${o.losses}` : '–');
  stat(row, t('profile.winRate'), o.decided ? pct(o.winRate) : '–', o.decided && o.winRate >= 0.5 ? 'good' : '');
  stat(row, t('profile.kda'), o.games ? fix1(o.kda) : '–');
  stat(row, t('profile.kdaAvg'), o.games ? `${fix1(o.kills / o.games)} / ${fix1(o.deaths / o.games)} / ${fix1(o.assists / o.games)}` : '–');
  const chips = el('div', 'pf-chips', box);
  if (st.win || st.bestWin) el('span', 'pf-chip', chips, t('profile.streakWin', { n: st.win, best: st.bestWin }));
  if (st.csUp) el('span', 'pf-chip', chips, t('profile.streakCs', { n: st.csUp }));
  if (st.days) el('span', 'pf-chip', chips, t('profile.streakDays', { n: st.days }));
}

function renderTrend(root: HTMLElement, trend: readonly TrendPoint[]): void {
  const box = el('section', 'pf-sec', root);
  head(box, t('profile.trend'));
  const est = currentEstimate(trend);
  if (!est) {
    el('div', 'pf-empty', box, t('profile.trendNone'));
    return;
  }
  const top = el('div', 'pf-est', box);
  el('span', 'pf-est-rank', top, rankName(est.index));
  const d = est.delta;
  if (d !== null) el('span', `pf-est-delta ${d > 0.05 ? 'up' : d < -0.05 ? 'down' : ''}`, top, d > 0.05 ? `▲ ${fix1(d)}` : d < -0.05 ? `▼ ${fix1(-d)}` : '■');
  el('span', 'pf-est-note', top, t('profile.trendNote', { n: est.games }));
  const grid = el('div', 'pf-trends', box);
  const lines: { key: string; label: string; vals: number[]; cur: number | undefined; cls: string }[] = [
    { key: 'all', label: t('profile.trendAll'), vals: trend.map((p) => p.index), cur: est.index, cls: 'all' },
    ...CATEGORY_IDS.map((id: CategoryId) => ({
      key: id,
      label: t(`plan.cat.${id}`),
      vals: trend.map((p) => p.cat[id]).filter((x): x is number => x !== undefined),
      cur: est.cat[id],
      cls: id,
    })),
  ];
  for (const l of lines) {
    if (!l.vals.length) continue;
    const c = el('div', `pf-trend cat-${l.cls}`, grid);
    const hd = el('div', 'pf-trend-h', c);
    el('span', 'pf-trend-l', hd, l.label);
    el('span', 'pf-trend-r', hd, l.cur !== undefined ? rankName(l.cur) : '');
    trendLine(c, l.vals.slice(-30));
  }
}

function renderChampions(root: HTMLElement, history: readonly MatchRecord[]): void {
  const box = el('section', 'pf-sec', root);
  head(box, t('profile.champions'));
  const rows = championStats(history);
  if (!rows.length) {
    el('div', 'pf-empty', box, t('profile.none'));
    return;
  }
  const tbl = el('table', 'pf-table', box);
  const hr = el('tr', '', el('thead', '', tbl));
  for (const k of ['champion', 'games', 'winRate', 'kda', 'csPerMin', 'goldPerMin']) el('th', k === 'champion' ? 'l' : '', hr, t(`profile.col.${k}`));
  const body = el('tbody', '', tbl);
  for (const r of rows) {
    const tr = el('tr', '', body);
    const c = el('div', 'pf-champ', el('td', 'l', tr));
    portrait(c, r.champion);
    el('span', '', c, champName(r.champion));
    el('td', '', tr, String(r.games));
    el('td', r.decided && r.winRate >= 0.5 ? 'good' : '', tr, r.decided ? `${pct(r.winRate)} (${r.wins}/${r.decided})` : '–');
    el('td', '', tr, `${fix1(r.kda)} · ${fix1(r.kills / r.games)}/${fix1(r.deaths / r.games)}/${fix1(r.assists / r.games)}`);
    el('td', '', tr, fix1(r.csPerMin));
    el('td', '', tr, String(Math.round(r.goldPerMin)));
  }
}

function renderMatches(root: HTMLElement, history: readonly MatchRecord[]): void {
  const box = el('section', 'pf-sec', root);
  head(box, t('profile.matches'));
  const list = recent(history, 40);
  if (!list.length) {
    el('div', 'pf-empty', box, t('profile.none'));
    return;
  }
  const tbl = el('table', 'pf-table pf-matches', box);
  const hr = el('tr', '', el('thead', '', tbl));
  for (const k of ['date', 'champion', 'result', 'duration', 'kda', 'csPerMin', 'goldPerMin', 'rank']) el('th', k === 'champion' || k === 'date' ? 'l' : '', hr, t(`profile.col.${k}`));
  const body = el('tbody', '', tbl);
  for (const r of list) {
    const tr = el('tr', '', body);
    el('td', 'l pf-date', tr, new Date(r.at).toLocaleString(settings.lang === 'en' ? 'en-GB' : 'de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }));
    const c = el('div', 'pf-champ', el('td', 'l', tr));
    portrait(c, r.champion);
    el('span', '', c, champName(r.champion));
    if (r.mode !== 'classic') el('span', 'pf-mode', c, r.trainer ? t(`trainer.mode.${r.trainer.kind}`) : t(`profile.mode.${r.mode}`));
    const res = r.win === null ? t('profile.draw') : r.win ? t('profile.win') : t('profile.loss');
    el('td', `pf-result ${r.win === null ? '' : r.win ? 'win' : 'loss'}`, tr, res);
    el('td', '', tr, clock(r.durationS));
    el('td', '', tr, `${r.kills}/${r.deaths}/${r.assists ?? 0}  ·  ${fix1(kdaOf(r.kills, r.deaths, r.assists ?? 0))}`);
    el('td', '', tr, fix1(r.csPerMin));
    el('td', '', tr, String(Math.round(r.goldPerMin)));
    const tp = rankTrend([r])[0];
    el('td', 'pf-rank', tr, tp ? rankName(tp.index) : '–');
  }
}

/** Renders the profile into the menu `root`; `history` is already loaded (empty = no games yet). */
export function renderProfile(root: HTMLElement, history: readonly MatchRecord[], onBack: () => void, now = Date.now()): void {
  root.textContent = '';
  root.classList.add('menu-screen', 'classic-lobby');
  const panel = el('div', 'menu-panel classic-panel pf', root);
  el('h2', 'menu-title', panel, t('profile.title'));
  if (!history.length) {
    el('div', 'pf-empty big', panel, t('profile.empty'));
  } else {
    renderOverview(panel, history, now);
    renderTrend(panel, rankTrend(history));
    renderChampions(panel, history);
    renderMatches(panel, history);
  }
  const row = el('div', 'row-buttons', panel);
  el('button', 'menu-btn secondary', row, t('menu.back')).addEventListener('click', onBack);
}
