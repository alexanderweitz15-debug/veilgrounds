// Classic 5v5 vs bots lobby: role + champion, summoners, rune preset, bot rank (all + per-bot override), variance.
// The other 9 slots are filled role-conform without duplicate champions by src/ai/runner.ts classicConfig (Agent G).
// Then a loading screen shows all ten players with bot names and ranks.
import './gamePanels.css';
import type { PlayerSetup, SimConfig } from '../sim/types';
import { CHAMPION_DATA } from '../sim/champions';
import { SUMMONERS } from '../sim/summoners';
import { RUNES, runePresets, runesFromPreset } from '../sim/items/runes';
import { classicConfig } from '../ai/runner';
import { botNames } from '../ai/humanize/names';
import { RANKS, type Rank } from '../ai/profiles/schema';
import { Rng } from '../sim/rng';
import { settings, updateSettings } from '../settings';
import { champName, summonerName } from './names';
import { t } from '../i18n';

type Role = PlayerSetup['role'];
type Variance = 'stable' | 'normal' | 'volatile';
const ROLES: Role[] = ['top', 'jungle', 'mid', 'adc', 'support'];
const DEFAULT_SUMMONERS: Record<Role, [string, string]> = {
  top: ['sprung', 'entflammen'],
  jungle: ['sprung', 'bannen'],
  mid: ['sprung', 'entflammen'],
  adc: ['sprung', 'heilen'],
  support: ['sprung', 'entflammen'],
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** Lobby choices survive going back to the menu (per page session). */
const pick = {
  role: 'mid' as Role,
  champ: '',
  summoners: null as [string, string] | null,
  rank: 3, // gold
  variance: 'normal' as Variance,
  seed: (Math.random() * 2 ** 31) | 0,
  overrides: new Map<number, Rank>(),
};

export const championsFor = (role: Role): string[] =>
  Object.keys(CHAMPION_DATA)
    .filter((id) => (CHAMPION_DATA[id]!.roles as readonly string[]).includes(role))
    .sort((a, b) => Number(CHAMPION_DATA[b]!.roles[0] === role) - Number(CHAMPION_DATA[a]!.roles[0] === role) || a.localeCompare(b));

/** Usable summoners (implemented ones). */
const summonerIds = (): string[] => SUMMONERS.filter((s) => !s.todo).map((s) => s.id);

/** Build the match config from the current lobby choices (deterministic for pick.seed). */
export function buildClassicConfig(): SimConfig {
  if (!championsFor(pick.role).includes(pick.champ)) pick.champ = championsFor(pick.role)[0] ?? 'mira';
  const champ = pick.champ;
  const presetId = settings.runePresets[champ];
  const cfg = classicConfig(champ, pick.role, RANKS[pick.rank]!, {
    seed: pick.seed,
    summoners: pick.summoners ?? DEFAULT_SUMMONERS[pick.role],
    runes: runesFromPreset(champ, presetId),
    variance: pick.variance,
  });
  const bots = cfg.players.filter((p) => !p.isHuman && p.bot);
  const names = botNames(new Rng(pick.seed ^ 0x5eed), bots.length, 'realistic', Object.values(CHAMPION_DATA).map((c) => c.name));
  bots.forEach((p, i) => {
    p.bot!.name = names[i];
    const o = pick.overrides.get(p.slot);
    if (o) p.bot!.rank = o;
  });
  return cfg;
}

export function renderClassicLobby(root: HTMLElement, onBack: () => void, onStart: (cfg: SimConfig) => void): void {
  root.textContent = '';
  root.classList.add('menu-screen', 'classic-lobby');
  const panel = el('div', 'menu-panel classic-panel', root);
  el('h2', 'menu-title', panel, t('classic.title'));
  const cols = el('div', 'classic-cols', panel);
  const left = el('div', 'classic-left', cols);
  const right = el('div', 'classic-right', cols);

  const draw = (): void => {
    if (!championsFor(pick.role).includes(pick.champ)) pick.champ = championsFor(pick.role)[0] ?? 'mira';
    left.textContent = '';
    right.textContent = '';

    // role
    el('div', 'field-label', left, t('classic.role'));
    const tabs = el('div', 'role-tabs', left);
    for (const r of ROLES) {
      const b = el('button', `role-tab${r === pick.role ? ' active' : ''}`, tabs, t(`role.${r}`));
      b.addEventListener('click', () => {
        pick.role = r;
        pick.summoners = null;
        draw();
      });
    }

    // champion
    el('div', 'field-label', left, t('classic.champion'));
    const grid = el('div', 'champ-grid', left);
    for (const id of championsFor(pick.role)) {
      const d = CHAMPION_DATA[id]!;
      const c = el('button', `champ-card${id === pick.champ ? ' selected' : ''}`, grid);
      el('div', 'champ-portrait', c, champName(id).charAt(0));
      el('div', 'champ-name', c, champName(id));
      el('div', 'champ-title', c, d.title[settings.lang]);
      c.title = `${d.title[settings.lang]}\n${d.roles.map((r) => t(`role.${r}`)).join(' / ')}`;
      c.addEventListener('click', () => {
        pick.champ = id;
        draw();
      });
    }

    // summoners
    el('div', 'field-label', left, t('lobby.summoners'));
    const sums = pick.summoners ?? DEFAULT_SUMMONERS[pick.role];
    const srow = el('div', 'summ-row', left);
    for (const i of [0, 1] as const) {
      const sel = el('select', 'summ-select', srow);
      for (const id of summonerIds()) {
        const o = el('option', '', sel, summonerName(id));
        o.value = id;
        if (id === sums[i]) o.selected = true;
      }
      sel.addEventListener('change', () => {
        const next: [string, string] = [...sums];
        next[i] = sel.value;
        if (next[0] === next[1]) next[1 - i] = sums[i]; // swap instead of duplicate
        pick.summoners = next;
        draw();
      });
    }

    // runes
    el('div', 'field-label', left, t('lobby.runes'));
    const presets = runePresets(pick.champ);
    const chosen = presets.find((p) => p.id === settings.runePresets[pick.champ])?.id ?? presets[0]?.id;
    const pg = el('div', 'preset-grid', left);
    const runeName = (id: string): string => (RUNES.find((x) => x.id === id) as { name?: { de: string; en: string } } | undefined)?.name?.[settings.lang] ?? id;
    for (const p of presets) {
      const c = el('button', `preset-card${p.id === chosen ? ' selected' : ''}`, pg);
      el('div', 'preset-name', c, p.name[settings.lang]);
      el('div', 'preset-desc', c, p.desc[settings.lang]);
      el('div', 'runes', c, [p.keystone, ...p.minor].map(runeName).join(' · '));
      c.addEventListener('click', () => {
        updateSettings({ runePresets: { ...settings.runePresets, [pick.champ]: p.id } });
        draw();
      });
    }

    // bots: global rank, variance, per-bot override
    el('div', 'field-label', right, t('classic.botRank'));
    const rr = el('div', 'rank-row', right);
    const slider = el('input', 'rank-slider', rr);
    slider.type = 'range';
    slider.min = '0';
    slider.max = String(RANKS.length - 1);
    slider.value = String(pick.rank);
    el('span', 'rank-value', rr, t(`rank.${RANKS[pick.rank]}`));
    slider.addEventListener('input', () => {
      pick.rank = Number(slider.value);
      pick.overrides.clear();
      draw();
    });
    el('div', 'field-label', right, t('classic.variance'));
    const vr = el('div', 'role-tabs', right);
    for (const v of ['stable', 'normal', 'volatile'] as const) {
      const b = el('button', `role-tab${v === pick.variance ? ' active' : ''}`, vr, t(`variance.${v}`));
      b.addEventListener('click', () => {
        pick.variance = v;
        draw();
      });
    }
    const cfg = buildClassicConfig();
    for (const team of [0, 1] as const) {
      el('div', 'field-label', right, t(team === 0 ? 'classic.allies' : 'classic.enemies'));
      const list = el('div', `bot-list team${team}`, right);
      for (const p of cfg.players.filter((x) => x.team === team)) {
        const row = el('div', `bot-row${p.isHuman ? ' me' : ''}`, list);
        el('span', 'bot-role', row, t(`role.${p.role}`));
        el('span', 'bot-champ', row, champName(p.champion));
        el('span', 'bot-name', row, p.isHuman ? t('score.you') : (p.bot?.name ?? 'Bot'));
        if (!p.isHuman && p.bot) {
          const sel = el('select', 'bot-rank', row);
          for (const r of RANKS) {
            const o = el('option', '', sel, t(`rank.${r}`));
            o.value = r;
            if (r === p.bot.rank) o.selected = true;
          }
          sel.addEventListener('change', () => {
            pick.overrides.set(p.slot, sel.value as Rank);
            draw();
          });
        }
      }
    }
    const reroll = el('button', 'menu-btn secondary', right, t('classic.reroll'));
    reroll.addEventListener('click', () => {
      pick.seed = (Math.random() * 2 ** 31) | 0;
      pick.overrides.clear();
      draw();
    });
  };
  draw();

  const row = el('div', 'row-buttons', panel);
  el('button', 'menu-btn secondary', row, t('menu.back')).addEventListener('click', onBack);
  el('button', 'menu-btn', row, t('lobby.start')).addEventListener('click', () => onStart(buildClassicConfig()));
}

/** Loading screen: both teams with champion, bot name and rank. Calls onDone after a short delay or on click. */
export function renderLoading(root: HTMLElement, cfg: SimConfig, onDone: () => void): void {
  root.textContent = '';
  root.classList.add('menu-screen', 'loading-screen');
  el('div', 'menu-title', root, t('classic.loading'));
  for (const team of [0, 1] as const) {
    const row = el('div', `loading-row team${team}`, root);
    for (const p of cfg.players.filter((x) => x.team === team)) {
      const c = el('div', `loading-card${p.isHuman ? ' me' : ''}`, row);
      el('div', 'champ-portrait', c, champName(p.champion).charAt(0));
      el('div', 'champ-name', c, champName(p.champion));
      el('div', 'bot-name', c, p.isHuman ? t('score.you') : (p.bot?.name ?? 'Bot'));
      el('div', 'bot-rank', c, p.isHuman ? t(`role.${p.role}`) : `${t(`rank.${p.bot?.rank ?? 'gold'}`)} · ${t(`role.${p.role}`)}`);
    }
    if (team === 0) el('div', 'loading-vs', root, 'VS');
  }
  el('div', 'loading-hint', root, t('classic.clickToStart'));
  let done = false;
  const go = (): void => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    onDone();
  };
  const timer = setTimeout(go, 2500);
  root.addEventListener('click', go);
}
