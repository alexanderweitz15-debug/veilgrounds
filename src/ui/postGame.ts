// Post-game analysis (Phase 5): after a classic match or a trainer run. Summary tiles, CS and gold curves with death
// markers, damage dealt/taken per minute. Data comes from src/game/matchStats.ts (client snapshots only).
import './trainer.css';
import type { MatchSummary, StatSample } from '../game/matchStats';
import { champName } from './names';
import { t } from '../i18n';
import { clock, formatStat } from './trainerHud';
import { renderGhostReview } from './ghostReview';

const NS = 'http://www.w3.org/2000/svg';
const COL = { line: '#c8aa6e', line2: '#7fb2d9', death: '#e0604a', kill: '#7dcf8a', grid: 'rgba(255,255,255,0.08)', axis: '#a09b8c' };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
};

function svg(tag: string, attrs: Record<string, string | number>, parent?: Element, text?: string): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

const W = 480;
const H = 200;
const PAD = { l: 44, r: 10, t: 10, b: 24 };

/** Rounded "nice" axis maximum. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

function frame(parent: HTMLElement, title: string, duration: number, yMax: number): { g: SVGElement; x: (t: number) => number; y: (v: number) => number } {
  const box = el('div', 'pg-chart', parent);
  el('div', 'ttl', box, title);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title }, box);
  const x = (s: number): number => PAD.l + (s / Math.max(1, duration)) * (W - PAD.l - PAD.r);
  const y = (v: number): number => H - PAD.b - (v / yMax) * (H - PAD.t - PAD.b);
  for (let i = 0; i <= 4; i++) {
    const v = (yMax * i) / 4;
    svg('line', { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v), stroke: COL.grid }, root);
    svg('text', { x: PAD.l - 6, y: y(v) + 4, 'text-anchor': 'end', fill: COL.axis, 'font-size': 11 }, root, String(Math.round(v)));
  }
  const step = duration > 1200 ? 300 : duration > 300 ? 120 : 60;
  for (let s = 0; s <= duration; s += step) svg('text', { x: x(s), y: H - 6, 'text-anchor': 'middle', fill: COL.axis, 'font-size': 11 }, root, clock(s));
  return { g: root, x, y };
}

function lineChart(parent: HTMLElement, title: string, d: MatchSummary, pick: (s: StatSample) => number): void {
  const yMax = niceMax(Math.max(1, ...d.samples.map(pick)));
  const { g, x, y } = frame(parent, title, d.duration, yMax);
  for (const at of d.deaths) svg('line', { x1: x(at), x2: x(at), y1: PAD.t, y2: H - PAD.b, stroke: COL.death, 'stroke-dasharray': '3 3' }, g);
  for (const at of d.kills) svg('line', { x1: x(at), x2: x(at), y1: PAD.t, y2: H - PAD.b, stroke: COL.kill, 'stroke-dasharray': '2 4' }, g);
  if (d.samples.length > 1) {
    const pts = d.samples.map((s) => `${x(s.t).toFixed(1)},${y(pick(s)).toFixed(1)}`).join(' ');
    svg('polyline', { points: pts, fill: 'none', stroke: COL.line, 'stroke-width': 2, 'stroke-linejoin': 'round' }, g);
  }
  const box = g.parentElement!;
  const legend = el('div', 'legend', box);
  if (d.deaths.length) el('span', '', legend).innerHTML = `<i style="background:${COL.death}"></i>${t('post.deaths')}`;
  if (d.kills.length) el('span', '', legend).innerHTML = `<i style="background:${COL.kill}"></i>${t('post.kills')}`;
}

function damageChart(parent: HTMLElement, d: MatchSummary): void {
  const n = Math.max(1, d.dealtAll.length, d.taken.length);
  const yMax = niceMax(Math.max(1, ...d.dealtChamp, ...d.taken));
  const dur = n * 60;
  const { g, x, y } = frame(parent, t('post.damage'), dur, yMax);
  const bw = Math.max(2, (x(60) - x(0)) / 2 - 2);
  for (let m = 0; m < n; m++) {
    const a = d.dealtChamp[m] ?? 0;
    const b = d.taken[m] ?? 0;
    svg('rect', { x: x(m * 60) + 1, y: y(a), width: bw, height: Math.max(0, H - PAD.b - y(a)), fill: COL.line }, g);
    svg('rect', { x: x(m * 60) + 2 + bw, y: y(b), width: bw, height: Math.max(0, H - PAD.b - y(b)), fill: COL.line2 }, g);
  }
  const legend = el('div', 'legend', g.parentElement!);
  el('span', '', legend).innerHTML = `<i style="background:${COL.line}"></i>${t('post.dealt')}`;
  el('span', '', legend).innerHTML = `<i style="background:${COL.line2}"></i>${t('post.taken')}`;
}

const sum = (a: number[]): number => a.reduce((p, v) => p + v, 0);

export function renderPostGame(root: HTMLElement, d: MatchSummary, onBack: () => void, onRetry?: () => void): void {
  root.textContent = '';
  root.classList.add('menu-screen', 'pg-screen');
  const panel = el('div', 'menu-panel pg-panel', root);
  const modeName = d.mode === 'classic' ? t('menu.classic') : d.trainer ? t(`trainer.mode.${d.mode}`) : t(`post.mode.${d.mode}`);
  el('h2', '', panel, `${t('post.title')} – ${modeName}`);
  const result = d.winner !== null ? ` · ${d.winner === d.team ? t('hud.victory') : t('hud.defeat')}` : d.trainer?.won !== undefined ? ` · ${d.trainer.won ? t('trainer.won') : t('trainer.lost')}` : '';
  el('div', 'pg-sub', panel, `${champName(d.champion)} · ${t('post.duration')} ${clock(d.duration)}${result}`);

  const last = d.samples[d.samples.length - 1];
  const min = Math.max(1, d.duration) / 60;
  const tiles = el('div', 'pg-tiles', panel);
  const tile = (k: string, v: string): void => {
    const b = el('div', 'pg-tile', tiles);
    el('div', 'v', b, v);
    el('div', 'k', b, k);
  };
  if (d.trainer?.grade) tile(t('trainer.grade'), d.trainer.grade);
  for (const s of d.trainer?.stats ?? []) tile(t(`trainer.stat.${s.k}`), s.k === 'difficulty' ? t(`trainer.diff.${s.v}`) : formatStat(s));
  tile('CS', String(last?.cs ?? 0));
  tile(t('post.csPerMin'), ((last?.cs ?? 0) / min).toFixed(1));
  tile(t('post.gpm'), String(Math.round(((last?.gold ?? 0) - (d.samples[0]?.gold ?? 0)) / min)));
  tile(t('post.kills'), String(d.kills.length));
  tile(t('post.deaths'), String(d.deaths.length));
  tile(t('post.dealt'), String(Math.round(sum(d.dealtChamp))));
  tile(t('post.taken'), String(Math.round(sum(d.taken))));

  // scenarios are seconds long and start at a set match time: curves over the whole clock say nothing there
  const charts = el('div', 'pg-charts', d.mode === 'scenario' ? document.createElement('div') : panel);
  if (d.samples.length > 1) {
    lineChart(charts, t('post.cs'), d, (s) => s.cs);
    lineChart(charts, t('post.gold'), d, (s) => s.gold);
  } else el('div', 'pg-sub', charts, t('post.none'));
  damageChart(charts, d);

  if (d.deaths.length) el('div', 'pg-sub', panel, `${t('post.deaths')}: ${d.deaths.map((s) => clock(s)).join(', ')}`);
  renderGhostReview(panel, d.ghost); // Challenger-Geist timeline
  const row = el('div', 'row-buttons', panel);
  el('button', 'menu-btn secondary', row, t('menu.quit')).addEventListener('click', onBack);
  if (onRetry) el('button', 'menu-btn', row, t('trainer.retry')).addEventListener('click', onRetry);
}
