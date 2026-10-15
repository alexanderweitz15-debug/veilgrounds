// Main menu in the style of MOBA clients: top bar (wordmark, PLAY, nav), live map scene behind, mode list on the left,
// build notes on the right. No decorative glow; typography carries the look (Spectral SC + Barlow Condensed).
import './menu.css';

export interface MenuEntry {
  name: string;
  desc?: string;
  /** Short meta line on the right, e.g. "1 Spieler · Mira Quell". */
  meta?: string;
  kind?: 'primary' | 'dev';
  onSelect: () => void;
}

export interface MainMenuOpts {
  title: string;
  subtitle: string;
  playLabel: string;
  modesLabel: string;
  modes: MenuEntry[];
  nav: { label: string; onSelect: () => void }[];
  notesTitle: string;
  notes: string[];
  footer: string;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
};

/** Renders into `screen` (already holding the language toggle). Returns a disposer. */
export function renderMainMenu(screen: HTMLElement, o: MainMenuOpts): () => void {
  screen.classList.add('menu-screen', 'client');
  const canvas = el('canvas', 'menu-bg');
  screen.prepend(canvas);
  el('div', 'menu-shade', undefined, screen);

  const bar = el('header', 'client-bar', undefined, screen);
  const brand = el('div', 'brand', undefined, bar);
  el('div', 'wordmark', o.title, brand);
  el('div', 'brand-sub', o.subtitle, brand);
  const play = el('button', 'play-btn', o.playLabel, bar);
  const nav = el('nav', 'client-nav', undefined, bar);
  for (const n of o.nav) el('button', 'nav-item', n.label, nav).addEventListener('click', n.onSelect);
  // language toggle (created by main.ts) moves into the bar
  const lang = screen.querySelector('.lang-toggle');
  if (lang) bar.appendChild(lang);

  const modes = el('section', 'modes', undefined, screen);
  el('div', 'section-label', o.modesLabel, modes);
  const rows: HTMLButtonElement[] = [];
  for (const m of o.modes) {
    const r = el('button', `mode-row ${m.kind ?? ''}`, undefined, modes);
    const left = el('span', 'mode-text', undefined, r);
    el('span', 'mode-name', m.name, left);
    if (m.desc) el('span', 'mode-desc', m.desc, left);
    if (m.meta) el('span', 'mode-meta', m.meta, r);
    r.addEventListener('click', m.onSelect);
    rows.push(r);
  }
  play.addEventListener('click', () => (rows.find((r) => !r.classList.contains('dev')) ?? rows[0])?.click());

  const notes = el('aside', 'notes', undefined, screen);
  el('div', 'section-label', o.notesTitle, notes);
  const ul = el('ul', '', undefined, notes);
  for (const n of o.notes) el('li', '', n, ul);

  el('footer', 'client-foot', o.footer, screen);

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    const n = ev.key === 'ArrowDown' ? (i + 1) % rows.length : (i - 1 + rows.length) % rows.length;
    rows[n]?.focus();
    ev.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  let stopScene: () => void = () => {};
  let disposed = false;
  // the 3D backdrop (three.js + headless sim) is its own chunk: the menu is usable before it arrives
  void import('./menuScene')
    .then(({ startMenuScene }) => {
      if (!disposed) stopScene = startMenuScene(canvas);
    })
    .catch(() => canvas.remove()); // no WebGL: plain background
  return () => {
    disposed = true;
    stopScene();
    window.removeEventListener('keydown', onKey);
  };
}
