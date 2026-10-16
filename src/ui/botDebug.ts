// F9 bot debug overlay (spec-bots §1, BRAIN-REWORK §3): per bot current mode, intent (or tree node) with its top-3
// candidate scores, active reflex plans with countdown, attack utilisation of the last 30 s, attention state, last
// reason, injected error, reaction time of the last event and perception age. Rows come from the worker's BotRunner
// (src/ai/log.ts); every BRAIN-REWORK field is optional and shows "–" until its producer fills it.
import './playstyle.css';
import type { BotDebugRow } from '../ai/log';
import { ARCHETYPE_NAMES } from '../ai/params';
import type { Archetype } from '../ai/contract';
import { settings } from '../settings';
import { champName } from './names';
import { t } from '../i18n';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

const fmt = (v: number | undefined, unit = ''): string => (v === undefined ? '–' : `${Math.round(v)}${unit}`);

export class BotDebugPanel {
  readonly root: HTMLElement;
  private key = '';

  constructor(parent: HTMLElement) {
    this.root = el('div', 'bot-debug', parent);
  }

  update(rows: readonly BotDebugRow[], tick: number): void {
    const key = JSON.stringify(rows);
    if (key === this.key) return;
    this.key = key;
    const r = this.root;
    r.textContent = '';
    if (!rows.length) {
      el('div', 'bot-debug-empty', r, t('botDebug.none'));
      return;
    }
    el('div', 'bot-debug-head', r, `${t('botDebug.title')} · tick ${tick}`);
    const tab = el('table', 'bot-debug-table', r);
    const hr = el('tr', '', el('thead', '', tab));
    for (const h of ['bot', 'mode', 'node', 'scores', 'plans', 'util', 'attention', 'reason', 'error', 'reaction', 'perception']) el('th', '', hr, t(`botDebug.${h}`));
    const body = el('tbody', '', tab);
    for (const row of rows) {
      const tr = el('tr', `${row.slot < 5 ? 'team0' : 'team1'}${row.injectedError && tick - (row.errorTick ?? -1e9) < 90 ? ' err' : ''}${row.attention?.text.startsWith('distracted') ? ' distracted' : ''}`, body);
      const who = el('td', 'who', tr);
      el('div', 'champ', who, champName(row.champ));
      const style = row.archetype ? ARCHETYPE_NAMES[row.archetype as Archetype]?.[settings.lang] ?? row.archetype : t('botDebug.rolled');
      el('div', 'sub', who, `${t(`rank.${row.rank}`)} ${row.skill} · ${style}`);
      el('td', 'mode', tr, row.mode);
      // BRAIN-REWORK §3: current intent (utility model) and its top-3 candidates; without an intent (tree only, or the
      // utility model off) the tree node and its scores as before. The reflex lane intent goes below the node.
      const node = el('td', 'node', tr, row.intent ? `${t('botDebug.intent')}: ${row.intent.chosen}` : row.node === '-' ? '–' : `${row.node} → ${row.chosen}`);
      if (row.intent && row.node !== '-') el('div', 'sub', node, `${row.node} → ${row.chosen}`);
      if (row.reflex?.intent && row.reflex.intent !== 'none') el('div', 'sub', node, `reflex: ${row.reflex.intent}`);
      const cands = row.intent?.candidates.length ? row.intent.candidates : row.topScores;
      el('td', 'scores', tr, cands.map(([k, v]) => `${k} ${v.toFixed(2)}`).join('  ') || '–');
      const plans = row.reflex?.plans ?? [];
      el('td', 'plans', tr, plans.length ? plans.map((p) => `${p.kind}#${p.targetId} ${(p.inTicks / 30).toFixed(1)}s${p.reason ? ` (${p.reason})` : ''}`).join('  ') : '–');
      el('td', 'num', tr, row.reflex ? `${Math.round(row.reflex.util30s * 100)} %` : '–');
      el('td', 'attention', tr, row.attention ? `${row.attention.text} · ${Math.round(row.attention.share * 100)} %` : '–');
      const reason = el('td', 'reason', tr, row.reason || '–');
      reason.title = row.reason;
      el('td', 'error', tr, row.injectedError ? `${row.injectedError} @${row.errorTick}` : '–');
      el('td', 'num', tr, fmt(row.reactionMs, ' ms'));
      el('td', 'num', tr, fmt(row.perceptionAgeMs, ' ms'));
    }
  }
}
