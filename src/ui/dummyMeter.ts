// Damage meter for the practice dummy (sandbox, like LoL's practice tool): total / DPS / auto vs ability / by damage type
// of the last "fight" at a dummy. A fight ends after idleSec without a hit; the next hit starts a new one. Client-only:
// reads damage events (own champion -> Kind.Dummy) from the snapshot stream, no sim state.
import type { ClientState } from '../game/state';
import { Kind, type SimEvent } from '../sim/types';
import { t } from '../i18n';

const IDLE_SEC = 4;
/** DPS needs a time span: below this the first hit would read as absurd DPS. */
const MIN_SPAN_SEC = 1;

export interface Fight {
  total: number;
  auto: number;
  phys: number;
  magic: number;
  true: number;
  first: number;
  last: number;
}
const fresh = (at: number): Fight => ({ total: 0, auto: 0, phys: 0, magic: 0, true: 0, first: at, last: at });

/** Adds one damage hit at game time `now`; starts a new fight after the idle gap. Pure (tested). */
export function addHit(f: Fight | null, now: number, amount: number, type: 'phys' | 'magic' | 'true', auto: boolean): Fight {
  const g = f && now - f.last <= IDLE_SEC ? f : fresh(now);
  g.total += amount;
  g[type] += amount;
  if (auto) g.auto += amount;
  g.last = now;
  return g;
}
export const fightDps = (f: Fight): number => f.total / Math.max(MIN_SPAN_SEC, f.last - f.first);

const el = (tag: string, cls: string, parent: HTMLElement, text = ''): HTMLElement => {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  parent.appendChild(e);
  return e;
};

export class DummyMeter {
  readonly root = document.createElement('div');
  private fight: Fight | null = null;
  private readonly grid: HTMLElement;

  constructor() {
    this.root.className = 'dm-panel';
    this.root.style.display = 'none';
    const head = el('div', 'lt-head', this.root);
    el('span', 'lt-title', head, t('dm.title'));
    const reset = el('button', 'lt-rank', head, t('dm.reset'));
    reset.addEventListener('mousedown', (e) => e.stopPropagation());
    reset.addEventListener('click', () => ((this.fight = null), (this.root.style.display = 'none')));
    this.grid = el('div', 'lt-grid', this.root);
  }

  onEvent(ev: SimEvent, state: ClientState): void {
    const me = state.snap?.me;
    if (ev.e !== 'damage' || !me || ev.src !== me.eid || state.byId.get(ev.dst)?.kind !== Kind.Dummy) return;
    this.fight = addHit(this.fight, state.snap!.time, ev.amount, ev.type, !!ev.auto);
  }

  update(state: ClientState): void {
    const f = this.fight;
    if (!f) return;
    this.root.style.display = '';
    const live = (state.snap?.time ?? 0) - f.last <= IDLE_SEC;
    this.root.classList.toggle('done', !live);
    const row = (k: string, v: string): void => void (el('span', 'k', this.grid, k), el('span', 'v', this.grid, v), el('span', 'g', this.grid));
    this.grid.textContent = '';
    row(t('dm.total'), String(Math.round(f.total)));
    row('DPS', String(Math.round(fightDps(f))));
    row(t('dm.time'), `${(f.last - f.first).toFixed(1)} s`);
    row(t('dm.auto'), f.total ? `${Math.round((100 * f.auto) / f.total)} %` : '–');
    for (const k of ['phys', 'magic', 'true'] as const) if (f[k] > 0) row(t(`dm.${k}`), String(Math.round(f[k])));
  }
}
