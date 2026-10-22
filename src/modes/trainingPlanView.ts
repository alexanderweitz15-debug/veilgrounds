// D5: training plan + history panel for the trainer hub (agent C mounts it in src/ui/trainerMenu.ts, see
// docs/agents/shared-changes.md). Three suggestion cards (mode, settings, minutes, reason from the weakest category),
// rank bars per category, sparklines per metric, streak chips. Data: src/stats (pure), texts: i18n keys with a local
// fallback (planStrings.json) until the keys exist in src/i18n.
import './trainingPlan.css';
import { t } from '../i18n';
import { settings } from '../settings';
import { RANKS } from '../ai/profiles/schema';
import { series, streaks, type MatchRecord, type Metric } from '../stats/history';
import { trainingPlan, type PlanItem } from '../stats/trainingPlan';
import strings from './planStrings.json';

const FALLBACK = strings as unknown as Record<'de' | 'en', Record<string, string>>;
const METRICS: Metric[] = ['cs10', 'deathsPer30', 'goldPerMin', 'trainerScore'];

/** i18n with the local fallback table (the plan keys are a proposal for src/i18n). */
function tr(key: string, vars?: Record<string, string | number>): string {
  const s = t(key, vars);
  if (s !== key) return s;
  let f = FALLBACK[settings.lang]?.[key] ?? FALLBACK.de[key] ?? key;
  if (vars) for (const k in vars) f = f.split(`{${k}}`).join(String(vars[k]));
  return f;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

const SVG = 'http://www.w3.org/2000/svg';

function sparkline(parent: HTMLElement, label: string, pts: { v: number }[]): void {
  const box = el('div', 'tp-spark', parent);
  el('div', 'tp-spark-l', box, label);
  if (pts.length < 2) {
    el('div', 'tp-spark-e', box, pts.length ? String(Math.round(pts[0]!.v * 10) / 10) : tr('plan.empty'));
    return;
  }
  const w = 160;
  const h = 40;
  const vs = pts.map((p) => p.v);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  const line = document.createElementNS(SVG, 'polyline');
  line.setAttribute('points', vs.map((v, i) => `${((i / (vs.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 3 - ((v - lo) / Math.max(1e-9, hi - lo)) * (h - 6)).toFixed(1)}`).join(' '));
  line.setAttribute('class', 'tp-spark-line');
  svg.appendChild(line);
  box.appendChild(svg);
  el('div', 'tp-spark-v', box, String(Math.round(vs[vs.length - 1]! * 10) / 10));
}

/** Renders the plan into `parent`; `onStart` launches the trainer of a suggestion (mode + opts). */
export function renderTrainingPlan(parent: HTMLElement, history: readonly MatchRecord[], onStart: (item: PlanItem) => void, now = Date.now()): HTMLElement {
  const plan = trainingPlan(history);
  const root = el('section', 'tp', parent);
  el('h3', 'tp-title', root, tr('plan.title'));
  el('div', 'tp-note', root, plan.provisional ? tr('plan.provisional', { n: plan.matches }) : tr('plan.basis', { n: plan.matches }));
  const cards = el('div', 'tp-cards', root);
  for (const it of plan.items) {
    const c = el('div', `tp-card cat-${it.category}`, cards);
    const head = el('div', 'tp-card-h', c);
    el('span', 'tp-mode', head, t(`trainer.mode.${it.mode}`));
    el('span', 'tp-min', head, tr('plan.minutes', { m: it.minutes }));
    const params = { ...it.params, ...(typeof it.params.rank === 'string' ? { rank: t(`rank.${it.params.rank}`) } : {}) };
    el('div', 'tp-reason', c, tr(it.reasonKey, params));
    el('button', 'menu-btn tp-start', c, tr('plan.start')).addEventListener('click', () => onStart(it));
  }
  if (plan.standings.length) {
    el('div', 'tp-sub', root, tr('plan.standings'));
    const bars = el('div', 'tp-bars', root);
    for (const s of plan.standings) {
      const row = el('div', 'tp-bar', bars);
      el('span', 'tp-bar-l', row, tr(`plan.cat.${s.category}`));
      const track = el('span', 'tp-bar-t', row);
      const fill = el('span', 'tp-bar-f', track);
      fill.style.width = `${((s.index + 0.5) / RANKS.length) * 100}%`;
      el('span', 'tp-bar-r', row, t(`rank.${s.rank}`));
    }
  }
  el('div', 'tp-sub', root, tr('plan.history'));
  const sp = el('div', 'tp-sparks', root);
  // game metrics from classic games only (trainer runs are short and not comparable), trainer score from runs
  for (const m of METRICS) sparkline(sp, tr(`plan.metric.${m}`), series(history, m, m === 'trainerScore' ? undefined : 'classic').slice(-30));
  const st = streaks(history, now);
  const chips = el('div', 'tp-chips', root);
  if (st.win || st.bestWin) el('span', 'tp-chip', chips, tr('plan.streak.win', { n: st.win, best: st.bestWin }));
  if (st.csUp) el('span', 'tp-chip', chips, tr('plan.streak.cs', { n: st.csUp }));
  if (st.days) el('span', 'tp-chip', chips, tr('plan.streak.days', { n: st.days }));
  return root;
}
