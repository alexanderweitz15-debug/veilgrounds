// Dodge trainer measurements for the post-run screens (FEATURE-GAP 7.4): hit-rate buckets, "last hits" review with a
// small canvas per hit, trend over earlier runs. Data: TrainerHud.dodge (src/sim/trainer/dodgeMetrics.ts).
import type { BucketStat, DodgeReport, ReviewHit } from '../sim/trainer/dodgeMetrics';
import type { TrainerHud } from '../sim/trainer';
import { t } from '../i18n';
import { settings } from '../settings';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
};

const SIZE = 180;
const COL = { shot: '#e0604a', path: '#e3c26a', box: '#7fb2d9', bg: 'rgba(255,255,255,0.03)' };

/** Draws one hit: projectile path (band of its real width), the player's path and his hitbox at the impact. */
export function drawHit(c: HTMLCanvasElement, h: ReviewHit): void {
  c.width = c.height = SIZE;
  const g = c.getContext('2d');
  if (!g) return;
  const pts: number[] = [...h.path, h.px, h.py];
  if (h.shot) pts.push(h.shot.x0, h.shot.y0, h.shot.hx, h.shot.hy);
  if (h.zone) pts.push(h.zone.x - h.zone.r, h.zone.y - h.zone.r, h.zone.x + h.zone.r, h.zone.y + h.zone.r);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]! - h.pr); x1 = Math.max(x1, pts[i]! + h.pr);
    y0 = Math.min(y0, pts[i + 1]! - h.pr); y1 = Math.max(y1, pts[i + 1]! + h.pr);
  }
  const k = (SIZE - 16) / Math.max(1, x1 - x0, y1 - y0);
  const X = (x: number): number => 8 + (x - x0) * k;
  const Y = (y: number): number => SIZE - 8 - (y - y0) * k; // map y points up
  g.fillStyle = COL.bg;
  g.fillRect(0, 0, SIZE, SIZE);
  g.lineCap = 'round';
  if (h.shot) {
    g.strokeStyle = 'rgba(224,96,74,0.28)';
    g.lineWidth = Math.max(2, h.shot.w * k);
    g.beginPath(); g.moveTo(X(h.shot.x0), Y(h.shot.y0)); g.lineTo(X(h.shot.hx), Y(h.shot.hy)); g.stroke();
    g.strokeStyle = COL.shot;
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(X(h.shot.x0), Y(h.shot.y0)); g.lineTo(X(h.shot.hx), Y(h.shot.hy)); g.stroke();
    g.fillStyle = COL.shot;
    g.beginPath(); g.arc(X(h.shot.hx), Y(h.shot.hy), 3, 0, Math.PI * 2); g.fill();
  }
  if (h.zone) {
    g.fillStyle = 'rgba(224,96,74,0.25)'; g.strokeStyle = COL.shot; g.lineWidth = 1.5;
    g.beginPath(); g.arc(X(h.zone.x), Y(h.zone.y), h.zone.r * k, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  g.strokeStyle = COL.path;
  g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i < h.path.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, X(h.path[i]!), Y(h.path[i + 1]!));
  g.stroke();
  g.strokeStyle = COL.box;
  g.lineWidth = 1.5;
  g.beginPath(); g.arc(X(h.px), Y(h.py), Math.max(3, h.pr * k), 0, Math.PI * 2); g.stroke();
}

const dec = (v: number): string => (settings.lang === 'de' ? String(v).replace('.', ',') : String(v));

function bucketLabel(b: BucketStat): string {
  return b.lo === 0 ? t('trainer.dodge.rangeLt', { hi: b.hi }) : b.hi < 0 ? t('trainer.dodge.rangeGe', { lo: b.lo }) : t('trainer.dodge.rangeMid', { lo: b.lo, hi: b.hi });
}

function bucketTable(parent: HTMLElement, title: string, bs: BucketStat[]): void {
  if (bs.filter((b) => b.threats > 0).length === 0) return;
  el('h3', 'pg-h3', parent, title);
  const grid = el('div', 'tr-stats', parent);
  for (const b of bs) {
    if (!b.threats) continue;
    el('div', 'k', grid, bucketLabel(b));
    el('div', 'v', grid, t('trainer.dodge.bucketRow', { hits: b.hits, threats: b.threats, pct: dec(Math.round((b.hits / b.threats) * 1000) / 10) }));
  }
}

/** Post-run analysis: help, speed / width buckets, last-hits review. */
export function renderDodgeAnalysis(parent: HTMLElement, d: DodgeReport): void {
  el('h3', 'pg-h3', parent, t('trainer.dodge.title'));
  el('div', 'pg-sub', parent, t('trainer.dodge.help'));
  const grid = el('div', 'tr-stats', parent);
  const row = (k: string, v: string | number): void => {
    el('div', 'k', grid, t(k));
    el('div', 'v', grid, String(v));
  };
  if (d.reactions) row('trainer.dodge.reactionBest', `${d.reactionBestMs} ms`);
  row('trainer.dodge.reactions', d.reactions);
  row('trainer.dodge.threats', d.threats);
  row('trainer.dodge.shotHits', d.shotHits);
  row('trainer.dodge.zoneHits', d.zoneHits);
  bucketTable(parent, t('trainer.dodge.bySpeed'), d.speedBuckets);
  bucketTable(parent, t('trainer.dodge.byWidth'), d.widthBuckets);
  el('h3', 'pg-h3', parent, t('trainer.dodge.review'));
  const hits = d.review ?? [];
  if (!hits.length) return void el('div', 'pg-sub', parent, t('trainer.dodge.reviewNone'));
  el('div', 'pg-sub', parent, t('trainer.dodge.reviewLegend'));
  const list = el('div', 'dg-review', parent);
  for (const h of [...hits].reverse()) {
    const card = el('div', 'dg-hit', list);
    drawHit(el('canvas', '', card), h);
    const lines = [t('trainer.dodge.hitLine', { t: dec(h.t) }), t(`trainer.dodge.cause.${h.cause}`)];
    if (h.latencyMs >= 0) lines.push(t('trainer.dodge.latency', { ms: h.latencyMs }));
    for (const l of lines) el('div', 'cap', card, l);
  }
}

const TREND: [key: string, label: string][] = [['score', 'trendScore'], ['reactionMs', 'trendReaction'], ['hitRate', 'trendHitRate'], ['panic', 'trendPanic']];

/** Earlier runs of the dodge trainer against this one; async (IndexedDB). */
export function renderDodgeTrend(parent: HTMLElement, h: TrainerHud, durationS: number): void {
  const box = el('div', 'dg-trend', parent);
  void import('../stats/history').then(async (hist) => {
    const past = hist.withoutRun(await hist.loadHistory(), { kind: 'dodge', score: h.score, durationS, at: Date.now() });
    if (!box.isConnected) return;
    const now: Record<string, number | undefined> = { score: h.score, ...hist.trainerMetrics(h) };
    el('h3', 'pg-h3', box, t('trainer.dodge.trend'));
    if (!past.some((r) => r.trainer?.kind === 'dodge')) return void el('div', 'pg-sub', box, t('trainer.dodge.trendNone'));
    const grid = el('div', 'tr-stats', box);
    for (const [key, label] of TREND) {
      const tr = hist.trainerTrend(past, 'dodge', key, now[key]);
      if (!tr.past.length || tr.now === undefined) continue;
      const seq = [...tr.past, tr.now].map((v) => dec(Math.round(v * 10) / 10)).join(' → ');
      const d = tr.delta === undefined ? '' : ` (${tr.delta > 0 ? '+' : ''}${dec(Math.round(tr.delta * 10) / 10)})`;
      el('div', 'k', grid, t(`trainer.dodge.${label}`));
      el('div', 'v', grid, seq + d);
    }
  }).catch(() => undefined);
}
