// Entry: main menu -> lobby (rune preset) -> game view. Vanilla DOM, German default with English toggle.
import './ui/style.css';
import { loadSettings, settings, updateSettings } from './settings';
import { loadBinds } from './input/keybinds';
import { t } from './i18n';
import type { TrainerMode, TrainerSetup } from './game/modes';
import type { SimConfig } from './sim/types';
import type { SessionResult } from './game/session';
import type { Replay } from './replay/replay';
import { buildSettingsPanel } from './ui/settingsPanel';
import { renderMainMenu, type MenuEntry } from './ui/mainMenu';
import { installDisplaySettings } from './ui/display';
// Code-split (Phase 6): the game view (three.js, renderer, HUD), encyclopedia, trainer hub and post-game screen
// load on demand, so the main menu starts without them.
const loadGame = () => import('./game/game');
const loadTrainerMenu = () => import('./ui/trainerMenu');
const loadClassicLobby = () => import('./ui/classicLobby');
/** Practice lobby + mode configs (sim data, champion sprites for portraits). */
const loadPlay = async () => {
  const [modes, lobbyMod, runes] = await Promise.all([import('./game/modes'), import('./ui/practiceLobby'), import('./sim/items/runes')]);
  return { ...modes, ...lobbyMod, ...runes };
};

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
    { name: t('menu.trainer'), desc: t('menu.trainerDesc'), meta: t('menu.trainerMeta'), onSelect: () => trainerMenu() },
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
      { label: t('rp.nav'), onSelect: () => replayBrowser() },
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
  void loadClassicLobby().then(({ renderClassicLobby, renderLoading }) => {
    if (s.isConnected) renderClassicLobby(s, mainMenu, (cfg) => renderLoading(screen(), cfg, () => start(cfg)));
  });
}

function encyclopedia(): void {
  const s = screen();
  s.classList.add('menu-screen');
  void import('./ui/encyclopedia').then(({ renderEncyclopedia }) => {
    if (s.isConnected) renderEncyclopedia(s, mainMenu);
  });
}

/** Replay browser (S2): saved games, watch / delete. */
function replayBrowser(): void {
  const s = screen();
  void Promise.all([import('./ui/replayBrowser'), import('./replay/store')]).then(([{ renderReplayBrowser }, { loadReplay }]) => {
    if (!s.isConnected) return;
    renderReplayBrowser(s, mainMenu, (id) => void loadReplay(id).then((r) => (r ? watchReplay(r, 0, replayBrowser) : alert(t('rp.missing')))));
  });
}

/** Replay viewer: the normal game view fed by the replay worker (read-only), `back` runs when the player leaves. */
function watchReplay(replay: Replay, start: number, back: () => void): void {
  disposeMenu?.();
  disposeMenu = null;
  app.textContent = '';
  void Promise.all([loadGame(), import('./replay/replayLink'), import('./ui/replayBar')]).then(([{ Game }, { replayLink }, { replayMount }]) => {
    const link = replayLink(replay, replay.humanSlot ?? 0, start);
    new Game(app, replay.config, () => back(), { link, clock: link.clock, silent: () => link.speed > 2, mount: replayMount(link) });
  });
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
  void loadPlay().then(({ renderPracticeLobby, configFor }) => {
    if (!s.isConnected) return;
    renderPracticeLobby(s, `${t('lobby.title')} – ${mode === 'lane' ? t('menu.lane') : t('menu.sandbox')}`, mainMenu, (p) =>
      start(configFor(mode, p.runes, p.champion, p.summoners)),
    );
  });
}

/** Trainer hub (Phase 5) -> practice lobby with the trainer's options -> game. Options persist per trainer. */
const trainerSetups = new Map<TrainerMode, TrainerSetup>();

function trainerMenu(): void {
  const s = screen();
  void loadTrainerMenu().then(({ renderTrainerMenu }) => {
    if (s.isConnected)
      renderTrainerMenu(s, mainMenu, (m) => void trainerLobby(m), (m, opts) => {
        // training plan "Starten": the plan's suggested options on top of the mode's current setup
        void loadTrainerMenu().then(({ defaultSetup }) => {
          const d = trainerSetups.get(m) ?? defaultSetup(m);
          trainerSetups.set(m, { ...d, opts: { ...d.opts, ...opts } });
          void trainerLobby(m);
        });
      });
  });
}

async function trainerLobby(mode: TrainerMode): Promise<void> {
  const [{ defaultSetup, trainerOptions }, { renderPracticeLobby, trainerConfig }] = await Promise.all([loadTrainerMenu(), loadPlay()]);
  const setup = trainerSetups.get(mode) ?? defaultSetup(mode);
  trainerSetups.set(mode, setup);
  const s = screen();
  renderPracticeLobby(s, `${t('lobby.title')} – ${t(`trainer.mode.${mode}`)}`, trainerMenu, (p) => start(trainerConfig(setup, p)), trainerOptions(setup));
}

/** Post-game analysis for classic games and trainer runs (not for short or sandbox sessions). */
function afterGame(config: SimConfig | null, r?: SessionResult): void {
  if (!config || !r) return mainMenu();
  // finished game: keep the replay for the replay browser (IndexedDB, capped; no-op when unavailable)
  if (r.replay && r.replay.ticks >= 1800) void import('./replay/store').then((m) => m.saveReplay(r.replay!)).catch(() => undefined);
  if (r.retry) return start({ ...structuredClone(config), seed: (Math.random() * 2 ** 31) | 0 });
  // match history for the training plan (IndexedDB; no-op when unavailable)
  if (r.summary.duration >= 60) void import('./stats/history').then((h) => h.saveRecord(h.recordFromSummary(r.summary, Date.now()))).catch(() => undefined);
  const auto = (config.mode === 'classic' || config.mode === 'laneOnly') && r.summary.duration >= 60;
  if (!r.analysis && !auto) return mainMenu();
  showPostGame(config, r);
}

function showPostGame(config: SimConfig, r: SessionResult): void {
  const s = screen();
  void Promise.all([import('./ui/postGame'), import('./game/session'), import('./stats/errorList')]).then(([{ renderPostGame }, { isTrainerMode }, { buildErrorList }]) => {
    if (!s.isConnected) return;
    const replay = r.replay;
    // mistake list: bots from the bot log, the player from the replay; "replay moment" opens the viewer 5 s before it
    const errors = replay && (replay.botLog || replay.player) ? { list: buildErrorList(replay), onJump: (tick: number) => void import('./replay/timeline').then(({ momentTick }) => watchReplay(replay, momentTick(replay, tick), () => showPostGame(config, r))) } : undefined;
    renderPostGame(s, r.summary, mainMenu, isTrainerMode(config.mode) || config.mode === 'classic' ? () => afterGame(config, { ...r, retry: true, replay: undefined }) : undefined, errors);
  });
}

function start(config: SimConfig | null): void {
  disposeMenu?.();
  disposeMenu = null;
  void loadGame().then(({ Game }) => {
    app.textContent = '';
    new Game(app, config, (r) => afterGame(config, r));
  });
}

void (async () => {
  await Promise.all([loadSettings(), loadBinds()]);
  installDisplaySettings();
  setTimeout(() => void loadGame(), 1500); // warm the game chunk while the menu is shown
  document.documentElement.lang = settings.lang;
  const q = new URLSearchParams(location.search);
  // dev shortcuts: ?mock, ?play=lane|sandbox
  if (q.has('mock')) start(null);
  else if (q.get('play') === 'classic') start((await loadClassicLobby()).buildClassicConfig());
  else if (q.has('play')) {
    const { TRAINER_MODES, MIRA_ID, trainerConfig, configFor, runesFromPreset } = await loadPlay();
    const play = q.get('play');
    if (TRAINER_MODES.includes(play as TrainerMode)) {
      const { defaultSetup } = await loadTrainerMenu();
      start(trainerConfig(defaultSetup(play as TrainerMode), { champion: MIRA_ID, summoners: ['sprung', 'heilen'], runes: runesFromPreset(MIRA_ID, settings.runePresets[MIRA_ID]) }));
    } else if (play === 'lane' || play === 'sandbox') start(configFor(play, runesFromPreset(MIRA_ID, settings.runePresets[MIRA_ID])));
    else mainMenu();
  } else mainMenu();
})();
