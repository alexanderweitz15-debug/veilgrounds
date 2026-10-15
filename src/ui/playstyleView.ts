// Playstyle scales (spec-bots §2 display "kurz --x-------- lang"): full editor rows for the lobby and mini scales
// for the scoreboard. Values are integers -5..+5; one cell per value.
import './playstyle.css';
import { PLAYSTYLE_AXES, type Playstyle, type PlaystyleAxis } from '../ai/contract';
import { AXIS_LABELS, formatScale, signed } from '../ai/params';
import { settings } from '../settings';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** Tooltip text: "Trades: kurz --x-------- lang (-3)". */
export const scaleTitle = (axis: PlaystyleAxis, v: number): string =>
  `${AXIS_LABELS[axis].name[settings.lang]}: ${formatScale(axis, v, settings.lang)} (${signed(v)})`;

function track(parent: HTMLElement, v: number, cls: string): HTMLElement {
  const tr = el('span', cls, parent);
  for (let i = -5; i <= 5; i++) el('span', `cell${i === v ? ' on' : ''}${i === 0 ? ' mid' : ''}`, tr);
  return tr;
}

/** Ten compact scales (scoreboard, lobby row): one tiny track per axis, tooltip with the full scale. */
export function renderMiniScales(parent: HTMLElement, s: Playstyle): HTMLElement {
  const wrap = el('span', 'ps-mini', parent);
  for (const a of PLAYSTYLE_AXES) track(wrap, s[a], 'ps-mini-track').title = scaleTitle(a, s[a]);
  wrap.title = PLAYSTYLE_AXES.map((a) => scaleTitle(a, s[a])).join('\n');
  return wrap;
}

/** Full editor: name, left label, [-], scale, [+], right label, value. onChange(axis, newValue). */
export function renderScaleEditor(parent: HTMLElement, s: Playstyle, onChange: (axis: PlaystyleAxis, v: number) => void): HTMLElement {
  const grid = el('div', 'ps-editor', parent);
  const lang = settings.lang;
  for (const a of PLAYSTYLE_AXES) {
    const l = AXIS_LABELS[a];
    el('span', 'ps-name', grid, l.name[lang]);
    el('span', 'ps-left', grid, l.left[lang]);
    const minus = el('button', 'ps-step', grid, '−');
    const tr = track(grid, s[a], 'ps-track');
    tr.title = scaleTitle(a, s[a]);
    // click a cell to jump there
    Array.from(tr.children).forEach((c, i) => c.addEventListener('click', () => onChange(a, i - 5)));
    const plus = el('button', 'ps-step', grid, '+');
    el('span', 'ps-right', grid, l.right[lang]);
    el('span', 'ps-val', grid, signed(s[a]));
    minus.disabled = s[a] <= -5;
    plus.disabled = s[a] >= 5;
    minus.addEventListener('click', () => onChange(a, s[a] - 1));
    plus.addEventListener('click', () => onChange(a, s[a] + 1));
  }
  return grid;
}
