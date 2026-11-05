// Live training widget in the match HUD (setting trainingHud): CS/min and gold/min against a chosen rank target, missed
// CS, CS@10 projection, and the last-hit timing bar under the targeted minion's HP bar (drawn by overlay.ts from
// `lastHitMarks`). Reads client snapshots only; the math is in liveTrainingCalc.ts.
import './liveTraining.css';
import type { ClientState } from '../game/state';
import { isMinion, type SimEvent } from '../sim/types';
import { MINION_STATS } from '../sim/systems/minions';
import { t } from '../i18n';
import { settings, updateSettings } from '../settings';
import {
  LT, autoDamage, dropRate, hitDelay, isMissedCs, lastHitMark, nextRank, perMin, projectCs10, pushSample, rankGoal, widgetVisible,
  type HpSample, type LastHitMark,
} from './liveTrainingCalc';

/** Timing marks of the enemy minions near the own champion (eid -> mark); rebuilt every frame, read by the overlay. */
export const lastHitMarks = new Map<number, LastHitMark>();

const el = (tag: string, cls: string, parent: HTMLElement, text = ''): HTMLElement => {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  parent.appendChild(e);
  return e;
};

interface Row {
  value: HTMLElement;
  goal: HTMLElement;
}

export class LiveTraining {
  readonly root = document.createElement('div');
  private readonly rank: HTMLButtonElement;
  private readonly rows: Record<'csMin' | 'missed' | 'goldMin' | 'cs10', Row>;
  private missed = 0;
  private startGold = -1;
  private cs10: number | null = null;
  private readonly hp = new Map<number, HpSample[]>();
  private lastTick = -1;

  constructor(private readonly mode: string | undefined) {
    this.root.className = 'lt-panel';
    const head = el('div', 'lt-head', this.root);
    el('span', 'lt-title', head, t('lt.title'));
    this.rank = el('button', 'lt-rank', head) as HTMLButtonElement;
    this.rank.addEventListener('mousedown', (e) => e.stopPropagation());
    this.rank.addEventListener('click', () => updateSettings({ trainingRank: nextRank(settings.trainingRank) }));
    const grid = el('div', 'lt-grid', this.root);
    const row = (label: string): Row => {
      el('span', 'k', grid, label);
      return { value: el('span', 'v', grid), goal: el('span', 'g', grid) };
    };
    this.rows = { csMin: row(t('lt.csMin')), missed: row(t('lt.missed')), goldMin: row(t('lt.goldMin')), cs10: row(t('lt.cs10')) };
  }

  onEvent(ev: SimEvent, state: ClientState): void {
    const me = state.snap?.me;
    const meE = me && state.byId.get(me.eid);
    if (me && meE && !me.dead && isMissedCs(ev, me.eid, state.myTeam, meE.x, meE.y)) this.missed++;
  }

  update(state: ClientState): void {
    const on = widgetVisible(settings.trainingHud, this.mode);
    this.root.style.display = on ? '' : 'none';
    const snap = state.snap;
    const me = snap?.me;
    if (!snap || !me) return lastHitMarks.clear();
    // tallies run even while hidden, so switching the widget on mid-match shows true values
    if (this.startGold < 0) this.startGold = me.totalGold ?? me.gold;
    if (this.cs10 === null && snap.time >= 600) this.cs10 = me.cs;
    if (!on) return lastHitMarks.clear();

    const goal = rankGoal(settings.trainingRank);
    this.rank.textContent = t(`rank.${settings.trainingRank}`);
    this.rank.title = t('lt.rankTip');
    const csMin = perMin(me.cs, snap.time);
    const goldMin = perMin((me.totalGold ?? me.gold) - this.startGold, snap.time);
    const proj = projectCs10(me.cs, snap.time, this.cs10);
    this.fill(this.rows.csMin, csMin, goal.csPerMin, 1);
    this.fill(this.rows.goldMin, goldMin, goal.goldPerMin, 0);
    this.fill(this.rows.cs10, proj, goal.csAt10, 0, snap.time < 600 ? '~' : '');
    this.rows.missed.value.textContent = String(this.missed);
    this.rows.missed.goal.textContent = me.cs + this.missed > 0 ? `${Math.round((100 * this.missed) / (me.cs + this.missed))} %` : '';

    if (snap.tick !== this.lastTick) {
      this.lastTick = snap.tick;
      this.marks(state, snap.time);
    }
  }

  private fill(r: Row, v: number | null, goal: number, digits: number, prefix = ''): void {
    r.value.textContent = v === null ? '–' : prefix + v.toFixed(digits);
    r.goal.textContent = `/ ${goal.toFixed(digits)}`;
    r.value.className = `v ${v === null ? '' : v >= goal ? 'good' : 'bad'}`;
  }

  /** HP history + kill window of every enemy minion near the own champion. */
  private marks(state: ClientState, time: number): void {
    const snap = state.snap!;
    const me = snap.me!;
    const meE = state.byId.get(me.eid);
    lastHitMarks.clear();
    const seen = new Set<number>();
    for (const e of snap.entities) {
      if (!isMinion(e.kind) || e.team === state.myTeam || !e.alive) continue;
      seen.add(e.id);
      let buf = this.hp.get(e.id);
      if (!buf) this.hp.set(e.id, (buf = []));
      pushSample(buf, time, e.hp);
      if (!meE || me.dead) continue;
      const dist = Math.hypot(e.x - meE.x, e.y - meE.y);
      if (dist > LT.markRangeU) continue;
      const dmg = autoDamage(me.stats.ad, MINION_STATS[e.kind]?.armor ?? 0);
      lastHitMarks.set(e.id, lastHitMark(e.hp, dmg, dropRate(buf), hitDelay(me.stats.range, dist)));
    }
    for (const id of this.hp.keys()) if (!seen.has(id)) this.hp.delete(id);
  }
}

/** Eid of the enemy minion the own champion attacks, else -1 (the overlay draws its timing bar; hovered bars get one too). */
export function attackedMinion(state: ClientState): number {
  const me = state.snap?.me;
  const a = me ? state.byId.get(me.eid)?.atkTarget : undefined;
  const tg = a !== undefined && a >= 0 ? state.byId.get(a) : undefined;
  return tg && isMinion(tg.kind) && tg.team !== state.myTeam ? tg.id : -1;
}

const MARK_COLOR: Record<LastHitMark['state'], string> = { kill: '#7dff6a', soon: '#ffd24a', wait: '#8a8f98', late: '#ff5a4a' };

/** Timing bar under a minion's HP bar (x/y/bw/bh = the HP bar rect): fills as the own auto approaches a kill, full = attack now. */
export function drawLastHitMark(ctx: CanvasRenderingContext2D, m: LastHitMark, x: number, y: number, bw: number, bh: number): void {
  const ty = y + bh + 3;
  ctx.fillStyle = 'rgba(12,10,8,0.85)';
  ctx.fillRect(x - 2, ty - 1, bw + 4, 5);
  ctx.fillStyle = MARK_COLOR[m.state];
  ctx.fillRect(x, ty, bw * m.frac, 3);
}
