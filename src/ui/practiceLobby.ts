// Lobby for the practice modes (lane, sandbox): any champion, summoners, rune preset. Same look as the 5v5 lobby.
import './gamePanels.css';
import type { PlayerSetup } from '../sim/types';
import { CHAMPION_DATA } from '../sim/champions';
import { SUMMONERS } from '../sim/summoners';
import { RUNES, runePresets, runesFromPreset, type RuneChoice } from '../sim/items/runes';
import { settings, updateSettings } from '../settings';
import { champName, summonerName } from './names';
import { t } from '../i18n';
import { setPortrait } from '../render/portraits';
import { setTip } from './tooltip';
import { renderShowcase } from './showcase';
import { renderPickLine } from './voiceBubbles';
import { runeIcon, setIcon, summonerIcon } from './icons';

type Role = PlayerSetup['role'];
const FILTERS: (Role | 'all')[] = ['all', 'top', 'jungle', 'mid', 'adc', 'support'];

export interface PracticePick {
  champion: string;
  summoners: [string, string];
  runes: RuneChoice;
}

const pick = { filter: 'all' as Role | 'all', champ: 'mira', summoners: ['sprung', 'heilen'] as [string, string] };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** `options` (trainers, Phase 5) renders extra settings above the start button; it is re-run on every redraw. */
export function renderPracticeLobby(root: HTMLElement, title: string, onBack: () => void, onStart: (p: PracticePick) => void, options?: (parent: HTMLElement) => void): void {
  root.textContent = '';
  root.classList.add('menu-screen', 'classic-lobby');
  const panel = el('div', 'menu-panel classic-panel practice-panel', root);
  el('h2', 'menu-title', panel, title);
  const body = el('div', '', panel);

  const draw = (): void => {
    body.textContent = '';
    el('div', 'field-label', body, t('classic.champion'));
    const tabs = el('div', 'role-tabs', body);
    for (const f of FILTERS) {
      const b = el('button', `role-tab${f === pick.filter ? ' active' : ''}`, tabs, f === 'all' ? t('practice.all') : t(`role.${f}`));
      b.addEventListener('click', () => {
        pick.filter = f;
        draw();
      });
    }
    const grid = el('div', 'champ-grid', body);
    const ids = Object.keys(CHAMPION_DATA)
      .filter((id) => pick.filter === 'all' || (CHAMPION_DATA[id]!.roles as readonly string[]).includes(pick.filter))
      .sort((a, b) => champName(a).localeCompare(champName(b)));
    for (const id of ids) {
      const d = CHAMPION_DATA[id]!;
      const c = el('button', `champ-card${id === pick.champ ? ' selected' : ''}`, grid);
      setPortrait(el('div', 'champ-portrait', c), id);
      el('div', 'champ-name', c, champName(id));
      el('div', 'champ-title', c, d.title[settings.lang]);
      c.title = `${champName(id)}, ${d.title[settings.lang]}`;
      c.addEventListener('click', () => {
        pick.champ = id;
        draw();
      });
    }

    renderShowcase(body, pick.champ);
    renderPickLine(body, pick.champ);
    const cols = el('div', 'classic-cols', body);
    const left = el('div', '', cols);
    const right = el('div', '', cols);
    el('div', 'field-label', left, t('lobby.summoners'));
    for (const i of [0, 1] as const) {
      const srow = el('div', 'summ-icons', left);
      el('span', 'summ-key', srow, i === 0 ? 'D' : 'F');
      for (const s of SUMMONERS.filter((x) => !x.todo)) {
        const b = el('button', `summ-icon${s.id === pick.summoners[i] ? ' selected' : ''}`, srow);
        setIcon(b, summonerIcon(s.id));
        setTip(b, `summoner:${s.id}`);
        b.setAttribute('aria-label', summonerName(s.id));
        b.addEventListener('click', () => {
          const next: [string, string] = [...pick.summoners];
          next[i] = s.id;
          if (next[0] === next[1]) next[1 - i] = pick.summoners[i]; // swap instead of duplicate
          pick.summoners = next;
          draw();
        });
      }
    }
    const d = CHAMPION_DATA[pick.champ]!;
    el('div', 'field-label', right, d.name);
    el('div', 'practice-info', right, `${d.title[settings.lang]} · ${d.roles.map((r) => t(`role.${r}`)).join(' / ')} · ${d.trainingPurpose[settings.lang]}`);

    el('div', 'field-label', body, t('lobby.runes'));
    const presets = runePresets(pick.champ);
    const chosen = presets.find((p) => p.id === settings.runePresets[pick.champ])?.id ?? presets[0]?.id;
    const pg = el('div', 'preset-grid', body);
    const runeName = (id: string): string => (RUNES.find((x) => x.id === id) as { name?: { de: string; en: string } } | undefined)?.name?.[settings.lang] ?? id;
    for (const p of presets) {
      const c = el('button', `preset-card${p.id === chosen ? ' selected' : ''}`, pg);
      el('div', 'preset-name', c, p.name[settings.lang]);
      el('div', 'preset-desc', c, p.desc[settings.lang]);
      const rr = el('div', 'rune-icons', c);
      [p.keystone, ...p.minor].forEach((id, k) => {
        const ic = el('span', `rune-icon${k === 0 ? ' key' : ''}`, rr);
        setIcon(ic, runeIcon(id, k === 0));
        setTip(ic, `rune:${id}`);
        ic.setAttribute('aria-label', runeName(id));
      });
      c.addEventListener('click', () => {
        updateSettings({ runePresets: { ...settings.runePresets, [pick.champ]: p.id } });
        draw();
      });
    }

    if (options) options(el('div', '', body));
    const row = el('div', 'row-buttons', body);
    el('button', 'menu-btn secondary', row, t('menu.back')).addEventListener('click', onBack);
    el('button', 'menu-btn', row, t('lobby.start')).addEventListener('click', () =>
      onStart({ champion: pick.champ, summoners: pick.summoners, runes: runesFromPreset(pick.champ, settings.runePresets[pick.champ]) }),
    );
  };
  draw();
}
