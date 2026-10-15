// Entry: main menu -> lobby (rune preset) -> game view. Vanilla DOM, German default with English toggle.
import './ui/style.css';
import { loadSettings, settings, updateSettings } from './settings';
import { loadBinds } from './input/keybinds';
import { t } from './i18n';
import { Game } from './game/game';
import { configFor, MIRA_ID } from './game/modes';
import { buildSettingsPanel } from './ui/settingsPanel';
import { champName, summonerName } from './ui/names';
import { RUNES, runePresets, runesFromPreset } from './sim/items/runes';
import { CHAMPION_DATA } from './sim/champions';
import { renderMainMenu, type MenuEntry } from './ui/mainMenu';
import { renderEncyclopedia } from './ui/encyclopedia';

const app = document.getElementById('app')!;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

let disposeMenu: (() => void) | null = null;

function screen(): HTMLElement {
  disposeMenu?.();
  disposeMenu = null;
  app.textContent = '';
  const s = h('div', 'screen menu', undefined, app);
  const lang = h('div', 'lang-toggle', undefined, s);
  for (const l of ['de', 'en'] as const) {
    const b = h('button', `btn small${settings.lang === l ? ' on' : ''}`, l.toUpperCase(), lang);
    b.addEventListener('click', () => {
      updateSettings({ lang: l });
      mainMenu();
    });
  }
  return s;
}

function mainMenu(): void {
  const s = screen();
  // One line per mode; the classic 5v5 entry is added by the classic-lobby work.
  const entries: MenuEntry[] = [
    { icon: '⚔', name: t('menu.lane'), desc: t('menu.laneDesc'), tag: t('menu.tagTraining'), kind: 'primary', onSelect: () => lobby('lane') },
    { icon: '◎', name: t('menu.sandbox'), desc: t('menu.sandboxDesc'), tag: t('menu.tagTraining'), onSelect: () => lobby('sandbox') },
    { icon: '❖', name: t('menu.encyclopedia'), desc: t('menu.encyclopediaDesc'), onSelect: () => encyclopedia() },
    { icon: '⚙', name: t('menu.settings'), onSelect: () => settingsScreen() },
    { icon: '◇', name: t('menu.mock'), desc: t('menu.mockDesc'), kind: 'dev', onSelect: () => start(null) },
  ];
  s.style.background = 'none';
  disposeMenu = renderMainMenu(s, t('title'), t('subtitle'), entries, [t('menu.footBots'), t('menu.footVersion')]);
}

function encyclopedia(): void {
  const s = screen();
  s.classList.add('menu-screen');
  renderEncyclopedia(s, mainMenu);
}

function settingsScreen(): void {
  const s = screen();
  const box = h('div', 'menu-box wide', undefined, s);
  h('h2', '', t('menu.settings'), box);
  box.appendChild(buildSettingsPanel(() => settingsScreen()));
  h('button', 'btn', t('menu.back'), box).addEventListener('click', mainMenu);
}

/** Pre-game: champion card + rune preset picker (last pick remembered per champion). */
function lobby(mode: 'lane' | 'sandbox'): void {
  const s = screen();
  const box = h('div', 'menu-box wide lobby', undefined, s);
  h('h2', '', `${t('lobby.title')} – ${mode === 'lane' ? t('menu.lane') : t('menu.sandbox')}`, box);
  const champ = MIRA_ID;
  const data = CHAMPION_DATA[champ];
  const card = h('div', 'champ-card', undefined, box);
  h('div', 'champ-portrait', champName(champ).charAt(0), card);
  const info = h('div', 'champ-info', undefined, card);
  h('div', 'champ-name', champName(champ), info);
  if (data) h('div', 'champ-title', data.title[settings.lang], info);
  h('div', 'champ-meta', `${t('lobby.role')} · ${t('lobby.summoners')}: ${summonerName('sprung')}, ${summonerName('heilen')}`, info);

  h('h3', '', t('lobby.runes'), box);
  const presets = runePresets(champ);
  let picked = presets.find((p) => p.id === settings.runePresets[champ])?.id ?? presets[0]?.id;
  const grid = h('div', 'presets', undefined, box);
  const runeName = (id: string): { name: string; desc: string } => {
    const r = RUNES.find((x) => x.id === id) as { name?: { de: string; en: string }; desc?: { de: string; en: string } } | undefined;
    return { name: r?.name?.[settings.lang] ?? id, desc: r?.desc?.[settings.lang] ?? '' };
  };
  const renderPresets = (): void => {
    grid.textContent = '';
    for (const p of presets) {
      const c = h('button', `preset${p.id === picked ? ' on' : ''}`, undefined, grid);
      h('div', 'preset-name', p.name[settings.lang], c);
      h('div', 'preset-desc', p.desc[settings.lang], c);
      const runes = h('div', 'runes', undefined, c);
      const ks = runeName(p.keystone);
      const kEl = h('span', 'rune keystone', ks.name, runes);
      kEl.title = `${t('lobby.keystone')}: ${ks.name}\n${ks.desc}`;
      for (const m of p.minor) {
        const r = runeName(m);
        h('span', 'rune', r.name, runes).title = `${r.name}\n${r.desc}`;
      }
      c.addEventListener('click', () => {
        picked = p.id;
        updateSettings({ runePresets: { ...settings.runePresets, [champ]: p.id } });
        renderPresets();
      });
    }
  };
  renderPresets();

  const row = h('div', 'row-buttons', undefined, box);
  h('button', 'btn', t('menu.back'), row).addEventListener('click', mainMenu);
  h('button', 'btn primary', t('lobby.start'), row).addEventListener('click', () => start(configFor(mode, runesFromPreset(champ, picked))));
}

function start(config: ReturnType<typeof configFor> | null): void {
  disposeMenu?.();
  disposeMenu = null;
  app.textContent = '';
  new Game(app, config, () => mainMenu());
}

void (async () => {
  await Promise.all([loadSettings(), loadBinds()]);
  document.documentElement.lang = settings.lang;
  const q = new URLSearchParams(location.search);
  // dev shortcuts: ?mock, ?play=lane|sandbox
  if (q.has('mock')) start(null);
  else if (q.get('play') === 'lane' || q.get('play') === 'sandbox') start(configFor(q.get('play') as 'lane' | 'sandbox', runesFromPreset(MIRA_ID, settings.runePresets[MIRA_ID])));
  else mainMenu();
})();
