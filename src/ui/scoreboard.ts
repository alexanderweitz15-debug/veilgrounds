// Scoreboard (Tab): both teams with K/D/A, CS, level; gold for the own team, item value for enemies (fog-safe).
import './gamePanels.css';
import type { Snapshot } from '../sim/snapshot';
import type { PlayerSetup } from '../sim/types';
import { champName } from './names';
import { itemAbbr, itemTooltip } from './shop';
import { t } from '../i18n';
import { resolvePlaystyle } from '../ai/params';
import { scaleTitle } from './playstyleView';
import { PLAYSTYLE_AXES } from '../ai/contract';
import { setPortrait } from '../render/portraits';
import { itemIcon, setIcon } from './icons';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export const RANK_KEYS = ['iron', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'master', 'grandmaster', 'challenger'] as const;

/** Display name of a player slot: bot name + rank, or "You". */
export function playerLabel(p: PlayerSetup | undefined): string {
  if (!p) return '';
  if (p.isHuman) return t('score.you');
  return p.bot?.name ? `${p.bot.name} (${t(`rank.${p.bot.rank}`)})` : `Bot (${t(`rank.${p.bot?.rank ?? 'gold'}`)})`;
}

interface RowView {
  tr: HTMLTableRowElement;
  level: HTMLElement;
  kda: HTMLElement;
  cs: HTMLElement;
  gold: HTMLElement;
  items: HTMLElement;
  itemKey: string;
}

/** Playstyle of a bot slot as tooltip text (spec-bots §2; same pure roll as the worker, src/ai/params.ts). */
function styleTitle(setup: PlayerSetup | undefined): string {
  if (!setup?.bot || setup.isHuman) return '';
  const ps = resolvePlaystyle(setup).playstyle;
  return [t('score.style'), ...PLAYSTYLE_AXES.map((a) => scaleTitle(a, ps[a]))].join('\n');
}

export class Scoreboard {
  /** Table structure (slots + champions); rows are built once and only their cells are updated. */
  private structKey = '';
  private readonly rows = new Map<number, RowView>();

  constructor(private readonly root: HTMLElement, private readonly players: readonly PlayerSetup[]) {
    root.textContent = '';
  }

  update(snap: Snapshot | null): void {
    if (!snap || !this.root.classList.contains('open')) return;
    const rows = snap.players ?? [];
    const struct = `${snap.team}|${rows.map((p) => `${p.slot}:${p.champ}`).join(',')}`;
    if (struct !== this.structKey) this.build(snap, struct);
    const meSlot = this.players.find((x) => x.isHuman)?.slot;
    for (const p of rows) {
      const v = this.rows.get(p.slot);
      if (!v) continue;
      const cls = `${p.dead ? 'dead' : ''}${snap.me && p.slot === meSlot ? ' me' : ''}`;
      if (v.tr.className !== cls) v.tr.className = cls;
      set(v.level, String(p.level));
      set(v.kda, `${p.kills} / ${p.deaths} / ${p.assists}`);
      set(v.cs, String(p.cs));
      set(v.gold, String(p.gold ?? p.itemValue));
      const ik = (p.items ?? []).join(',');
      if (ik !== v.itemKey) {
        v.itemKey = ik;
        v.items.textContent = '';
        for (const id of p.items ?? []) {
          const icon = id ? itemIcon(id) : null;
          const s = el('span', `mini-item${id ? '' : ' empty'}`, v.items, id && !icon ? itemAbbr(id) : '');
          setIcon(s, icon);
          if (id) s.title = itemTooltip(id);
        }
      }
    }
  }

  private build(snap: Snapshot, struct: string): void {
    this.structKey = struct;
    this.rows.clear();
    const r = this.root;
    r.textContent = '';
    el('div', 'ttl', r, t('hud.scoreboardTitle'));
    const rows = snap.players ?? [];
    for (const team of [snap.team, snap.team === 0 ? 1 : 0]) {
      const tab = el('table', `score-table ${team === snap.team ? 'ally' : 'enemy'}`, r);
      const hr = el('tr', '', el('thead', '', tab));
      for (const h of ['score.champ', 'score.player', 'score.level', 'score.kda', 'score.cs', team === snap.team ? 'score.gold' : 'score.itemValue', 'score.items'])
        el('th', '', hr, t(h));
      const body = el('tbody', '', tab);
      for (const p of rows.filter((x) => x.team === team).sort((a, b) => a.slot - b.slot)) {
        const tr = el('tr', '', body);
        const ct = el('td', 'champ', tr);
        // every row gets a portrait (built once, so the lazy portrait queue can finish)
        const pic = el('span', 'score-portrait', ct, champName(p.champ).charAt(0));
        if (p.champ) setPortrait(pic, p.champ);
        ct.append(champName(p.champ));
        const setup = this.players.find((x) => x.slot === p.slot);
        const name = el('td', 'name', tr, playerLabel(setup));
        name.title = styleTitle(setup);
        const level = el('td', '', tr);
        const kda = el('td', 'kda', tr);
        const cs = el('td', '', tr);
        const gold = el('td', 'gold-cell', tr);
        const items = el('td', 'items-cell', tr);
        this.rows.set(p.slot, { tr, level, kda, cs, gold, items, itemKey: '-' });
      }
    }
  }
}

function set(e: HTMLElement, s: string): void {
  if (e.textContent !== s) e.textContent = s;
}
