// Death recap (LoL-like): records the damage the own champion took (snapshot `damage` events, dst = me) and on
// death shows "Getötet von X" plus a breakdown of the last RECAP_S seconds by source (champion / tower / minions /
// monsters), physical / magic / true and basic attacks vs abilities. Pure DOM, pointer-events off (camera stays free).
import type { ClientState } from '../game/state';
import { Kind, isMinion, type DamageType, type SimEvent } from '../sim/types';
import { t } from '../i18n';
import { deathHint } from '../game/deathHint';
import { champName } from './names';
import { setPortrait } from '../render/portraits';

const RECAP_S = 10;

type SrcKind = 'champ' | 'tower' | 'minion' | 'monster' | 'other';

interface Hit {
  at: number;
  key: string;
  name: string;
  kind: SrcKind;
  champ: string | null;
  amount: number;
  type: DamageType;
  auto: boolean;
}

interface Source {
  name: string;
  kind: SrcKind;
  champ: string | null;
  total: number;
  byType: Record<DamageType, number>;
  autos: number;
  abilities: number;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

type Described = { key: string; name: string; kind: SrcKind; champ: string | null };

function describeKind(kind: number): Described {
  if (kind === Kind.Tower || kind === Kind.Nexus) return { key: 'tower', name: t('recap.tower'), kind: 'tower', champ: null };
  if (isMinion(kind)) return { key: 'minion', name: t('recap.minion'), kind: 'minion', champ: null };
  if (kind === Kind.Monster) return { key: 'monster', name: t('recap.monster'), kind: 'monster', champ: null };
  return { key: 'other', name: t('recap.other'), kind: 'other', champ: null };
}

function describe(state: ClientState, eid: number): Described {
  const e = eid >= 0 ? state.entity(eid) : undefined;
  if (!e) return describeKind(-1);
  if (e.kind === Kind.Champion) return { key: `c${e.id}`, name: champName(e.champ), kind: 'champ', champ: e.champ };
  return describeKind(e.kind);
}

/** The killer as the death event names it (its eid may be fog-masked to -1 or already gone from the snapshot). */
function describeKiller(state: ClientState, ev: Extract<SimEvent, { e: 'death' }>): Described {
  if (ev.killerChamp !== undefined) return { key: 'killer', name: champName(ev.killerChamp), kind: 'champ', champ: ev.killerChamp };
  const d = describe(state, ev.killer);
  return d.kind === 'other' && ev.killerKind !== undefined ? describeKind(ev.killerKind) : d;
}

export class DeathRecap {
  readonly root: HTMLElement;
  private hits: Hit[] = [];
  private shown = false;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'death-recap', parent);
  }

  onEvent(ev: SimEvent, state: ClientState): void {
    const snap = state.snap;
    const me = snap?.me;
    if (!snap || !me) return;
    if (ev.e === 'damage' && ev.dst === me.eid && ev.amount > 0) {
      const d = describe(state, ev.src);
      this.hits.push({ at: snap.time, ...d, amount: ev.amount, type: ev.type, auto: !!ev.auto });
      // keep a little more than the window
      if (this.hits.length > 400 || (this.hits.length && this.hits[0]!.at < snap.time - RECAP_S * 2)) this.hits = this.hits.filter((h) => h.at >= snap.time - RECAP_S);
    } else if (ev.e === 'death' && ev.eid === me.eid) {
      this.build(state, ev, snap.time);
      this.hits = [];
    }
  }

  /** Visible while the own champion is dead. */
  update(dead: boolean): void {
    if (dead === this.shown) return;
    this.shown = dead;
    this.root.classList.toggle('open', dead);
  }

  private build(state: ClientState, death: Extract<SimEvent, { e: 'death' }>, now: number): void {
    const r = this.root;
    r.textContent = '';
    const src = new Map<string, Source>();
    let total = 0;
    const byType: Record<DamageType, number> = { phys: 0, magic: 0, true: 0 };
    for (const h of this.hits) {
      if (h.at < now - RECAP_S) continue;
      let s = src.get(h.key);
      if (!s) src.set(h.key, (s = { name: h.name, kind: h.kind, champ: h.champ, total: 0, byType: { phys: 0, magic: 0, true: 0 }, autos: 0, abilities: 0 }));
      s.total += h.amount;
      s.byType[h.type] += h.amount;
      if (h.kind !== 'champ' || h.auto) s.autos += h.amount;
      else s.abilities += h.amount;
      total += h.amount;
      byType[h.type] += h.amount;
    }
    const k = describeKiller(state, death);
    const head = el('div', 'dr-head', r);
    const pic = el('div', `dr-portrait ${k.kind}`, head, k.kind === 'champ' ? k.name.charAt(0) : k.kind === 'tower' ? '♜' : k.kind === 'minion' ? '⚔' : '✶');
    if (k.champ) setPortrait(pic, k.champ);
    const ht = el('div', 'dr-headtext', head);
    el('div', 'dr-killed', ht, k.kind === 'other' ? t('recap.executed') : t('recap.killedBy', { name: k.name }));
    el('div', 'dr-total', ht, t('recap.total', { n: Math.round(total), s: RECAP_S }));
    if (total > 0) {
      const bar = el('div', 'dr-bar', r);
      for (const ty of ['phys', 'magic', 'true'] as const) if (byType[ty] > 0) el('span', `dr-seg ${ty}`, bar).style.flexGrow = String(byType[ty]);
      const legend = el('div', 'dr-legend', r);
      for (const ty of ['phys', 'magic', 'true'] as const)
        if (byType[ty] > 0) el('span', `dr-key ${ty}`, legend, `${t(`recap.${ty}`)} ${Math.round(byType[ty])} (${Math.round((100 * byType[ty]) / total)} %)`);
    } else el('div', 'dr-none', r, t('recap.none'));
    if (total > 0) {
      const recent = this.hits.filter((h) => h.at >= now - RECAP_S).map((h) => ({ ago: now - h.at, kind: h.kind, key: h.key, amount: h.amount, type: h.type }));
      el('div', 'dr-hint', r, t(`recap.hint.${deathHint(recent)}`));
    }
    const rows = [...src.values()].sort((a, b) => b.total - a.total).slice(0, 5);
    for (const s of rows) {
      const row = el('div', 'dr-row', r);
      el('span', 'dr-name', row, s.name);
      const parts: string[] = [];
      if (s.kind === 'champ') {
        if (s.autos > 0) parts.push(`${t('recap.auto')} ${Math.round(s.autos)}`);
        if (s.abilities > 0) parts.push(`${t('recap.ability')} ${Math.round(s.abilities)}`);
      }
      el('span', 'dr-detail', row, parts.join(' · '));
      el('span', 'dr-amount', row, String(Math.round(s.total)));
      const mini = el('div', 'dr-bar small', row);
      for (const ty of ['phys', 'magic', 'true'] as const) if (s.byType[ty] > 0) el('span', `dr-seg ${ty}`, mini).style.flexGrow = String(s.byType[ty]);
    }
  }
}
