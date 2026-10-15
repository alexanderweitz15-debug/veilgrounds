// Main menu screen: animated backdrop + entry list. Entries come from main.ts so new modes are one line each.
import './menu.css';
import { startMenuBackground } from './menuBackground';

export interface MenuEntry {
  icon: string;
  name: string;
  desc?: string;
  tag?: string;
  kind?: 'primary' | 'dev';
  onSelect: () => void;
}

/** Renders into `screen` (already holding the language toggle). Returns a disposer for the animation. */
export function renderMainMenu(screen: HTMLElement, title: string, subtitle: string, entries: MenuEntry[], foot: string[]): () => void {
  screen.classList.add('menu-screen');
  const canvas = document.createElement('canvas');
  canvas.className = 'menu-bg';
  screen.prepend(canvas);

  const col = document.createElement('div');
  col.className = 'main-menu';
  col.innerHTML = '<div class="emblem"></div>';
  const h1 = document.createElement('h1');
  h1.className = 'menu-title';
  h1.textContent = title;
  const sub = document.createElement('div');
  sub.className = 'menu-sub';
  sub.textContent = subtitle;
  col.append(h1, sub);

  const buttons: HTMLButtonElement[] = [];
  entries.forEach((e, i) => {
    const b = document.createElement('button');
    b.className = `menu-entry ${e.kind ?? ''}`;
    b.style.animationDelay = `${0.12 + i * 0.05}s`;
    const ico = document.createElement('span');
    ico.className = 'ico';
    ico.textContent = e.icon;
    const text = document.createElement('span');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = e.name;
    text.appendChild(name);
    if (e.desc) {
      const d = document.createElement('div');
      d.className = 'desc';
      d.textContent = e.desc;
      text.appendChild(d);
    }
    b.append(ico, text);
    if (e.tag) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = e.tag;
      b.appendChild(tag);
    }
    b.addEventListener('click', e.onSelect);
    buttons.push(b);
    col.appendChild(b);
  });
  screen.appendChild(col);

  const f = document.createElement('div');
  f.className = 'menu-foot';
  for (const line of foot) {
    const s = document.createElement('span');
    s.innerHTML = line; // static strings from i18n only
    f.appendChild(s);
  }
  screen.appendChild(f);

  // keyboard: arrows move focus, Enter/Space activate (native button behaviour)
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const n = ev.key === 'ArrowDown' ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length;
    buttons[n]?.focus();
    ev.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  const stopBg = startMenuBackground(canvas);
  return () => {
    stopBg();
    window.removeEventListener('keydown', onKey);
  };
}
