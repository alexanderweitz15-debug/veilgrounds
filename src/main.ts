// Entry: main menu -> lobby (rune preset) -> game view. Vanilla DOM, German default with English toggle.
import './ui/style.css';
import { loadSettings, settings, updateSettings } from './settings';
import { loadBinds } from './input/keybinds';
import { t } from './i18n';
import { Game } from './game/game';
import { configFor, MIRA_ID } from './game/modes';
import { buildSettingsPanel } from './ui/settingsPanel';
import { runesFromPreset } from './sim/items/runes';
import { renderMainMenu, type MenuEntry } from './ui/mainMenu';
import { renderEncyclopedia } from './ui/encyclopedia';
import { renderPracticeLobby } from './ui/practiceLobby';
import { buildClassicConfig, renderClassicLobby, renderLoading } from './ui/classicLobby';

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
  const modes: MenuEntry[] = [
    { name: t('menu.classic'), desc: t('menu.classicDesc'), meta: t('menu.classicMeta'), onSelect: () => classicLobby() },
    { name: t('menu.lane'), desc: t('menu.laneDesc'), meta: t('menu.laneMeta'), onSelect: () => lobby('lane') },
    { name: t('menu.sandbox'), desc: t('menu.sandboxDesc'), meta: t('menu.sandboxMeta'), onSelect: () => lobby('sandbox') },
    ...(new URLSearchParams(location.search).has('dev') ? [{ name: t('menu.mock'), desc: t('menu.mockDesc'), kind: 'dev' as const, onSelect: () => start(null) }] : []),
  ];
  disposeMenu = renderMainMenu(s, {
    title: t('title'),
    subtitle: t('subtitle'),
    playLabel: t('menu.play'),
    modesLabel: t('menu.modes'),
    modes,
    nav: [
      { label: t('menu.encyclopedia'), onSelect: () => encyclopedia() },
      { label: t('menu.settings'), onSelect: () => settingsScreen() },
    ],
    notesTitle: t('menu.notesTitle'),
    notes: [t('menu.note1'), t('menu.note2'), t('menu.note3')],
    footer: t('menu.footVersion'),
  });
}

/** Classic 5v5 vs bots (Agent H): lobby -> loading screen -> game. */
function classicLobby(): void {
  const s = screen();
  renderClassicLobby(s, mainMenu, (cfg) => renderLoading(screen(), cfg, () => start(cfg)));
}

function encyclopedia(): void {
  const s = screen();
  s.classList.add('menu-screen');
  renderEncyclopedia(s, mainMenu);
}

function settingsScreen(): void {
  const s = screen();
  s.classList.add('menu-screen', 'classic-lobby');
  const box = h('div', 'menu-panel classic-panel settings-panel', undefined, s);
  h('h2', 'menu-title', t('menu.settings'), box);
  box.appendChild(buildSettingsPanel(() => settingsScreen()));
  const row = h('div', 'row-buttons', undefined, box);
  h('button', 'menu-btn', t('menu.back'), row).addEventListener('click', mainMenu);
}

/** Pre-game for the practice modes: any champion, summoners, rune preset (same look as the 5v5 lobby). */
function lobby(mode: 'lane' | 'sandbox'): void {
  const s = screen();
  renderPracticeLobby(s, `${t('lobby.title')} – ${mode === 'lane' ? t('menu.lane') : t('menu.sandbox')}`, mainMenu, (p) =>
    start(configFor(mode, p.runes, p.champion, p.summoners)),
  );
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
  else if (q.get('play') === 'classic') start(buildClassicConfig());
  else if (q.get('play') === 'lane' || q.get('play') === 'sandbox') start(configFor(q.get('play') as 'lane' | 'sandbox', runesFromPreset(MIRA_ID, settings.runePresets[MIRA_ID])));
  else mainMenu();
})();
