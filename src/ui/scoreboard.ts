// Scoreboard (Tab): both teams with K/D/A, CS, level; gold for the own team, item value for enemies (fog-safe).
import './gamePanels.css';
import type { Snapshot } from '../sim/snapshot';
import type { PlayerSetup } from '../sim/types';
import { champName } from './names';
import { itemAbbr, itemTooltip } from './shop';
import { t } from '../i18n';

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

export class Scoreboard {
  private key = '';

  constructor(private readonly root: HTMLElement, private readonly players: readonly PlayerSetup[]) {
    root.textContent = '';
  }

  update(snap: Snapshot | null): void {
    if (!snap || !this.root.classList.contains('open')) return;
    const rows = snap.players ?? [];
    const key = JSON.stringify(rows) + snap.team;
    if (key === this.key) return;
    this.key = key;
    const r = this.root;
    r.textContent = '';
    el('div', 'ttl', r, t('hud.scoreboardTitle'));
    for (const team of [snap.team, snap.team === 0 ? 1 : 0]) {
      const tab = el('table', `score-table ${team === snap.team ? 'ally' : 'enemy'}`, r);
      const hr = el('tr', '', el('thead', '', tab));
      for (const h of ['score.champ', 'score.player', 'score.level', 'score.kda', 'score.cs', team === snap.team ? 'score.gold' : 'score.itemValue', 'score.items'])
        el('th', '', hr, t(h));
      const body = el('tbody', '', tab);
      for (const p of rows.filter((x) => x.team === team).sort((a, b) => a.slot - b.slot)) {
        const tr = el('tr', `${p.dead ? 'dead' : ''}${snap.me && p.slot === this.players.find((x) => x.isHuman)?.slot ? ' me' : ''}`, body);
        el('td', 'champ', tr, champName(p.champ));
        el('td', 'name', tr, playerLabel(this.players.find((x) => x.slot === p.slot)));
        el('td', '', tr, String(p.level));
        el('td', '', tr, `${p.kills} / ${p.deaths} / ${p.assists}`);
        el('td', '', tr, String(p.cs));
        el('td', 'gold-cell', tr, String(p.gold ?? p.itemValue));
        const items = el('td', 'items-cell', tr);
        for (const id of p.items ?? []) {
          const s = el('span', `mini-item${id ? '' : ' empty'}`, items, id ? itemAbbr(id) : '');
          if (id) s.title = itemTooltip(id);
        }
      }
    }
  }
}
