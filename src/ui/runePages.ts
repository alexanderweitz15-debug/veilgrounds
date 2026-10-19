// Editor for the own rune page (C5, FEATURE-GAP 4.2; LoL "Prägungen-Seite bearbeiten"). Storage and rules: src/game/runePages.ts.
import { RUNES, runesFromPreset, type RuneChoice } from '../sim/items/runes';
import { settings } from '../settings';
import { MINORS, customPage, saveCustomPage, toggleMinor, validPage } from '../game/runePages';
import { runeIcon, setIcon } from './icons';
import { setTip } from './tooltip';
import { t } from '../i18n';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/**
 * Editor for the champion's own page: keystone row, minor rune grid (pick three), save. `onSaved` re-renders the
 * lobby (the page becomes selected).
 */
export function renderRuneEditor(parent: HTMLElement, champ: string, onSaved: () => void): void {
  const base = customPage(champ) ?? runesFromPreset(champ, settings.runePresets[champ]);
  let key = base.keystone;
  let minor: string[] = [...base.minor];
  const box = el('div', 'rune-editor', parent);
  const draw = (): void => {
    box.textContent = '';
    el('div', 're-label', box, t('runes.keystone'));
    const kr = el('div', 're-row', box);
    for (const r of RUNES.filter((x) => x.kind === 'keystone')) {
      const b = el('button', `re-rune key${r.id === key ? ' on' : ''}`, kr);
      setIcon(b, runeIcon(r.id, true));
      setTip(b, `rune:${r.id}`);
      b.addEventListener('click', () => {
        key = r.id;
        draw();
      });
    }
    el('div', 're-label', box, t('runes.minor', { n: minor.length, max: MINORS }));
    const mr = el('div', 're-row', box);
    for (const r of RUNES.filter((x) => x.kind === 'minor')) {
      const b = el('button', `re-rune${minor.includes(r.id) ? ' on' : ''}`, mr);
      setIcon(b, runeIcon(r.id, false));
      setTip(b, `rune:${r.id}`);
      b.addEventListener('click', () => {
        minor = toggleMinor(minor, r.id);
        draw();
      });
    }
    const page = { keystone: key, minor: minor as RuneChoice['minor'] };
    const save = el('button', 'menu-btn re-save', box, t('runes.save'));
    save.disabled = !validPage(page);
    save.addEventListener('click', () => {
      saveCustomPage(champ, page);
      onSaved();
    });
  };
  draw();
}
