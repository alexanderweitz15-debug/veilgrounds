// Classic 5v5 vs bots lobby: role + champion, summoners, rune preset, bot rank (all + per-bot override), variance.
// The other 9 slots are filled role-conform without duplicate champions by src/ai/runner.ts classicConfig (Agent G).
// Then a loading screen shows all ten players with bot names and ranks.
import './gamePanels.css';
import './botDifficulty.css';
import type { PlayerSetup, SimConfig } from '../sim/types';
import { CHAMPION_DATA } from '../sim/champions';
import { SUMMONERS } from '../sim/summoners';
import { RUNES, runePresets, runesFromPreset } from '../sim/items/runes';
import { classicConfig } from '../ai/runner';
import { botNames } from '../ai/humanize/names';
import { RANKS, type Rank } from '../ai/profiles/schema';
import { ARCHETYPES, type Archetype, type Playstyle } from '../ai/contract';
import { ARCHETYPE_NAMES, clampAxis, resolvePlaystyle } from '../ai/params';
import { renderMiniScales, renderScaleEditor } from './playstyleView';
import { Rng } from '../sim/rng';
import { settings, updateSettings } from '../settings';
import { champName, summonerName } from './names';
import { t } from '../i18n';
import { setPortrait } from '../render/portraits';
import { setTip } from './tooltip';
import { renderShowcase } from './showcase';
import { roleIcon, runeIcon, setIcon, summonerIcon } from './icons';
import { getChampionAtlas, getMinionAtlas } from '../render/sheets';

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
  /** Per-slot manual playstyle (archetype preset or axes); absent = rolled. Survives rerolls. */
  styles: new Map<number, { archetype?: Archetype; playstyle?: Playstyle }>(),
  /** Slots whose 10-axis editor is open. */
  expanded: new Set<number>(),
  /** "Erweitert": per-bot rank, variance and playstyle editors (default: one difficulty for all bots). */
  advanced: false,
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
  cfg.botToxicity = settings.botToxicity;
  const bots = cfg.players.filter((p) => !p.isHuman && p.bot);
  const names = botNames(new Rng(pick.seed ^ 0x5eed), bots.length, 'realistic', Object.values(CHAMPION_DATA).map((c) => c.name));
  bots.forEach((p, i) => {
    p.bot!.name = names[i];
    const o = pick.overrides.get(p.slot);
    if (o) p.bot!.rank = o;
    const st = pick.styles.get(p.slot);
    if (st?.archetype) p.bot!.archetype = st.archetype;
    if (st?.playstyle) p.bot!.playstyle = { ...st.playstyle };
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

  /** Spec-bots §2: archetype preset dropdown, mini scales and the expandable 10-axis editor of one bot. */
  const drawStyle = (list: HTMLElement, p: PlayerSetup): void => {
    const res = resolvePlaystyle(p);
    const line = el('div', 'bot-style', list);
    const sel = el('select', 'bot-archetype', line);
    const manual = pick.styles.get(p.slot);
    const opts: [string, string][] = [['', t('classic.styleRolled')], ...ARCHETYPES.map((a): [string, string] => [a, ARCHETYPE_NAMES[a][settings.lang]])];
    if (manual?.playstyle && !manual.archetype) opts.push(['manual', t('classic.styleManual')]);
    const current = manual?.archetype ?? (manual?.playstyle ? 'manual' : '');
    for (const [v, label] of opts) {
      const o = el('option', '', sel, label);
      o.value = v;
      if (v === current) o.selected = true;
    }
    sel.addEventListener('change', () => {
      if (sel.value === '') pick.styles.delete(p.slot);
      else if (sel.value !== 'manual') pick.styles.set(p.slot, { archetype: sel.value as Archetype });
      draw();
    });
    renderMiniScales(line, res.playstyle);
    const open = pick.expanded.has(p.slot);
    const edit = el('button', `bot-style-edit${open ? ' active' : ''}`, line, t('classic.styleEdit'));
    edit.addEventListener('click', () => {
      if (open) pick.expanded.delete(p.slot);
      else pick.expanded.add(p.slot);
      draw();
    });
    if (!open) return;
    const box = el('div', 'bot-style-box', list);
    renderScaleEditor(box, res.playstyle, (axis, v) => {
      // manual edit: the full current playstyle becomes manual (no champion bias, archetype label dropped)
      pick.styles.set(p.slot, { playstyle: { ...res.playstyle, [axis]: clampAxis(v) } });
      draw();
    });
    const foot = el('div', 'bot-style-foot', box);
    el('span', 'bot-style-hint', foot, res.rolled ? t('classic.styleRolled') : t('classic.styleHint'));
    const reset = el('button', 'bot-style-edit', foot, t('classic.styleReset'));
    reset.addEventListener('click', () => {
      pick.styles.delete(p.slot);
      draw();
    });
  };

  const draw = (): void => {
    if (!championsFor(pick.role).includes(pick.champ)) pick.champ = championsFor(pick.role)[0] ?? 'mira';
    left.textContent = '';
    right.textContent = '';

    // role
    el('div', 'field-label', left, t('classic.role'));
    const tabs = el('div', 'role-tabs', left);
    for (const r of ROLES) {
      const b = el('button', `role-tab${r === pick.role ? ' active' : ''}`, tabs);
      setIcon(el('span', 'role-icon', b), roleIcon(r));
      b.append(t(`role.${r}`));
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
      setPortrait(el('div', 'champ-portrait', c, champName(id).charAt(0)), id);
      el('div', 'champ-name', c, champName(id));
      el('div', 'champ-title', c, d.title[settings.lang]);
      c.title = `${champName(id)}, ${d.title[settings.lang]}`;
      c.addEventListener('click', () => {
        pick.champ = id;
        draw();
      });
    }

    // selected champion: splash + passive/abilities with LoL-style hover tooltips
    renderShowcase(left, pick.champ);

    // summoners: one icon row per slot (D, F)
    el('div', 'field-label', left, t('lobby.summoners'));
    const sums = pick.summoners ?? DEFAULT_SUMMONERS[pick.role];
    for (const i of [0, 1] as const) {
      const srow = el('div', 'summ-icons', left);
      el('span', 'summ-key', srow, i === 0 ? 'D' : 'F');
      for (const id of summonerIds()) {
        const b = el('button', `summ-icon${id === sums[i] ? ' selected' : ''}`, srow);
        setIcon(b, summonerIcon(id));
        setTip(b, `summoner:${id}`);
        b.setAttribute('aria-label', summonerName(id));
        b.addEventListener('click', () => {
          const next: [string, string] = [...sums];
          next[i] = id;
          if (next[0] === next[1]) next[1 - i] = sums[i]; // swap instead of duplicate
          pick.summoners = next;
          draw();
        });
      }
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

    // bots: ONE difficulty for all bots (user request); per-bot ranks, variance and playstyles only under "Erweitert"
    el('div', 'field-label', right, t('classic.botDifficulty'));
    const rr = el('div', 'rank-pick', right);
    RANKS.forEach((r, i) => {
      const b = el('button', `rank-btn rank-${r}${i === pick.rank && !pick.overrides.size ? ' active' : ''}`, rr, t(`rank.${r}`));
      b.addEventListener('click', () => {
        pick.rank = i;
        pick.overrides.clear();
        draw();
      });
    });
    if (pick.overrides.size) el('div', 'rank-mixed', right, t('classic.rankMixed'));

    const cfg = buildClassicConfig();
    for (const team of [0, 1] as const) {
      el('div', 'field-label', right, t(team === 0 ? 'classic.allies' : 'classic.enemies'));
      const list = el('div', `bot-list team${team}${pick.advanced ? '' : ' compact'}`, right);
      for (const p of cfg.players.filter((x) => x.team === team)) {
        const row = el('div', `bot-row${p.isHuman ? ' me' : ''}`, list);
        setIcon(el('span', 'role-icon', row), roleIcon(p.role));
        setPortrait(el('span', 'bot-portrait', row), p.champion);
        el('span', 'bot-champ', row, champName(p.champion));
        el('span', 'bot-name', row, p.isHuman ? t('score.you') : (p.bot?.name ?? 'Bot'));
        if (!p.isHuman && p.bot) {
          if (!pick.advanced) {
            el('span', `bot-rank-badge rank-${p.bot.rank}`, row, t(`rank.${p.bot.rank}`));
            continue;
          }
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
          drawStyle(list, p);
        }
      }
    }
    const tools = el('div', 'row-buttons', right);
    const reroll = el('button', 'menu-btn secondary', tools, t('classic.reroll'));
    reroll.addEventListener('click', () => {
      pick.seed = (Math.random() * 2 ** 31) | 0;
      draw();
    });
    const adv = el('button', `menu-btn secondary${pick.advanced ? ' active' : ''}`, tools, `${t('classic.advanced')} ${pick.advanced ? '▾' : '▸'}`);
    adv.addEventListener('click', () => {
      pick.advanced = !pick.advanced;
      draw();
    });
    if (pick.advanced) {
      el('div', 'field-label', right, t('classic.variance'));
      const vr = el('div', 'role-tabs', right);
      for (const v of ['stable', 'normal', 'volatile'] as const) {
        const b = el('button', `role-tab${v === pick.variance ? ' active' : ''}`, vr, t(`variance.${v}`));
        b.addEventListener('click', () => {
          pick.variance = v;
          draw();
        });
      }
    }
  };
  draw();

  const row = el('div', 'row-buttons', panel);
  el('button', 'menu-btn secondary', row, t('menu.back')).addEventListener('click', onBack);
  el('button', 'menu-btn', row, t('lobby.start')).addEventListener('click', () => onStart(buildClassicConfig()));
}

/**
 * Loading screen: both teams with champion, bot name and rank. Bakes the match's sprite atlases meanwhile (the game
 * picks them up from the cache) and calls onDone once they are ready and a short delay or a click has passed.
 */
/** Loading-screen tips `tip.1` .. `tip.N` in de/en.json, rotated every TIP_MS. */
const TIP_COUNT = 12;
const TIP_MS = 7000;

export function renderLoading(root: HTMLElement, cfg: SimConfig, onDone: () => void): void {
  root.textContent = '';
  root.classList.add('menu-screen', 'loading-screen');
  el('div', 'menu-title', root, t('classic.loading'));
  for (const team of [0, 1] as const) {
    const row = el('div', `loading-row team${team}`, root);
    for (const p of cfg.players.filter((x) => x.team === team)) {
      const c = el('div', `loading-card${p.isHuman ? ' me' : ''}`, row);
      setPortrait(el('div', 'champ-portrait', c, champName(p.champion).charAt(0)), p.champion);
      el('div', 'champ-name', c, champName(p.champion));
      el('div', 'bot-name', c, p.isHuman ? t('score.you') : (p.bot?.name ?? 'Bot'));
      el('div', 'bot-rank', c, p.isHuman ? t(`role.${p.role}`) : `${t(`rank.${p.bot?.rank ?? 'gold'}`)} · ${t(`role.${p.role}`)}`);
    }
    if (team === 0) el('div', 'loading-vs', root, 'VS');
  }
  const hint = el('div', 'loading-hint', root, t('classic.clickToStart'));
  // training tips while the sprites are painted (FEATURE-GAP 4.6): a random one, then the next every TIP_MS
  const tip = el('div', 'loading-tip', root);
  let ti = Math.floor(Math.random() * TIP_COUNT);
  const showTip = (): void => {
    if (!tip.isConnected) return clearInterval(tipTimer); // loading screen left
    tip.textContent = `${t('tip.label')} ${t(`tip.${(ti++ % TIP_COUNT) + 1}`)}`;
  };
  const tipTimer = window.setInterval(showTip, TIP_MS);
  showTip();
  const bar = el('div', 'loading-bake', root);
  bar.style.cssText = 'font-size:13px;letter-spacing:0.06em;color:#a09b8c;min-height:1.2em';
  const paint = (k: number): void => {
    bar.textContent = `${settings.lang === 'en' ? 'Painting sprites…' : 'Sprites werden gemalt…'} ${Math.round(k * 100)} %`;
  };
  paint(0);
  // champions first, then the (session-cached) minions: one worker pool at a time. The game starts once they are
  // baked (or after 20 s at most: it then shows placeholder sprites until the bake finishes).
  let ready = false;
  let wanted = false;
  let done = false;
  const release = (): void => {
    ready = true;
    bar.textContent = '';
    if (wanted) go();
  };
  void getChampionAtlas(cfg.players.map((p) => p.champion), (d, n) => paint((d / n) * 0.8))
    .catch((e) => console.warn('champion atlas failed on the loading screen', e))
    .then(() => getMinionAtlas((d, n) => paint(0.8 + (d / n) * 0.2)))
    .catch((e) => console.warn('minion atlas failed on the loading screen', e))
    .finally(release);
  const cap = setTimeout(release, 20000);
  const go = (): void => {
    wanted = true;
    if (done) return;
    if (!ready) {
      hint.textContent = settings.lang === 'en' ? 'Starting as soon as the sprites are ready…' : 'Startet, sobald die Sprites fertig sind…';
      return;
    }
    done = true;
    clearTimeout(timer);
    clearTimeout(cap);
    onDone();
  };
  const timer = setTimeout(go, 2500);
  root.addEventListener('click', (e) => {
    e.stopPropagation();
    go();
  }, { once: true });
}
