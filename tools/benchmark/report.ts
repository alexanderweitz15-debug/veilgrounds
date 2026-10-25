// Report builder: results (GameRaw[]) -> markdown summary + self-contained HTML (inline CSS / inline SVG, no CDN).

import { RANKS } from '../../src/ai/profiles/schema';
import { METRICS, METRIC_BY_ID, type MetricDef } from './metrics';
import { aggregate, metricKeys, type AggRow, type Estimate } from './stats';
import type { GameRaw } from './play';

export interface ReportMeta {
  commands: string[];
  head: string;
  note?: string;
}

const rankIdx = (r: string): number => RANKS.indexOf(r as (typeof RANKS)[number]);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function scale(def: MetricDef, v: number): number {
  return def.unit === 'pct' ? v * 100 : v;
}
function digits(def: MetricDef): number {
  return def.unit === 'ms' ? 0 : def.unit === 'x' ? 2 : def.unit === 'count' ? (def.id.startsWith('recall') ? 0 : 1) : 1;
}
const unitSuffix = (def: MetricDef): string => (def.unit === 'pct' ? ' %' : def.unit === 'ms' ? ' ms' : def.unit === 'min' ? ' min' : '');
export function fmt(def: MetricDef, e: Estimate | undefined): string {
  if (!e || !Number.isFinite(e.value)) return '-';
  const d = digits(def);
  const se = Number.isFinite(e.se) ? ` ±${scale(def, e.se).toFixed(d)}` : ' ±?';
  return `${scale(def, e.value).toFixed(d)}${se}`;
}
export function fmtCi(def: MetricDef, e: Estimate | undefined): string {
  if (!e || !Number.isFinite(e.lo)) return '';
  const d = digits(def);
  return `[${scale(def, e.lo).toFixed(d)}; ${scale(def, e.hi).toFixed(d)}]`;
}

/** Rows of one brain, one set (falling back to the other set), ordered by rank X. */
function ladder(rows: AggRow[], brain: string, set: string): AggRow[] {
  return rows.filter((r) => r.brain === brain && r.set === set).sort((a, b) => rankIdx(a.x) - rankIdx(b.x) || a.ref.localeCompare(b.ref));
}

export type Verdict = { ok: boolean; notes: string[]; significant: boolean };

/** Monotonicity of a metric over the ranks of a ladder (all rows share the reference rank). */
export function monotone(def: MetricDef, rows: AggRow[], key = def.id): Verdict {
  const notes: string[] = [];
  let ok = true;
  let significant = false;
  const sign = def.better === 'down' ? -1 : 1;
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i]!.est[key];
    const b = rows[i + 1]!.est[key];
    if (!a || !b || !Number.isFinite(a.value) || !Number.isFinite(b.value)) continue;
    const delta = sign * (b.value - a.value);
    if (delta > 0) continue;
    ok = false;
    const noise = 1.96 * Math.sqrt((Number.isFinite(a.se) ? a.se : 0) ** 2 + (Number.isFinite(b.se) ? b.se : 0) ** 2);
    const sig = -delta > noise;
    if (sig) significant = true;
    notes.push(`${cap(rows[i]!.x)} -> ${cap(rows[i + 1]!.x)}: ${sig ? 'signifikant' : 'im Rauschen'}`);
  }
  return { ok, notes, significant };
}

function headline(rows: AggRow[]): { brain: string; set: string; rows: AggRow[] }[] {
  const out: { brain: string; set: string; rows: AggRow[] }[] = [];
  const keys = new Set(rows.map((r) => `${r.brain}|${r.set}`));
  for (const k of [...keys].sort()) {
    const [brain, set] = k.split('|') as [string, string];
    out.push({ brain, set, rows: ladder(rows, brain, set) });
  }
  return out;
}

/** The ladder for a metric: its preferred set if present, else the other. */
function ladderFor(rows: AggRow[], brain: string, def: MetricDef): AggRow[] {
  const pref = ladder(rows, brain, def.set);
  return pref.length ? pref : ladder(rows, brain, def.set === 'L' ? 'F' : 'L');
}

const brainLabel = (b: string): string => (b === 'new' ? 'Neues Gehirn (Beta, --brain=new)' : 'Altes Gehirn (Standard)');

export function buildMarkdown(games: GameRaw[], meta: ReportMeta): string {
  const rows = aggregate(games);
  const o: string[] = [];
  const brains = [...new Set(rows.map((r) => r.brain))].sort().reverse();
  o.push('# Benchmark-Bericht');
  o.push('');
  o.push(`Stand: \`${meta.head}\`. ${meta.note ?? ''}`);
  o.push('');
  o.push('## Läufe');
  o.push('');
  o.push('| Gehirn | Menge | Paar (Rang X vs Referenz) | Partien | Ø Dauer (min) |');
  o.push('|---|---|---|---|---|');
  for (const r of rows) o.push(`| ${r.brain} | ${r.set} | ${r.pair} | ${r.games} | ${r.minutes.toFixed(1)} |`);
  o.push('');
  o.push('Menge L = kurze Partien (Lane-Metriken), Menge F = Partien bis zum Nexus oder Zeitlimit (Spiellänge, Objectives, Siegquote). Werte: gepoolter Wert ± Standardfehler (Bootstrap über Partien, 1000 Ziehungen, fester Seed). Eine Partie ist eine Einheit; die zehn Champions einer Partie sind nicht unabhängig.');
  o.push('');
  for (const brain of brains) {
    o.push(`## ${brainLabel(brain)}: Kernmetriken je Rang`);
    o.push('');
    const core = METRICS.filter((d) => d.core);
    const ranks = [...new Set(rows.filter((r) => r.brain === brain).map((r) => r.x))].sort((a, b) => rankIdx(a) - rankIdx(b));
    o.push(`| Metrik | Erwartung | ${ranks.map(cap).join(' | ')} | Monoton? |`);
    o.push(`|---|---|${ranks.map(() => '---').join('|')}|---|`);
    for (const def of core) {
      const lad = ladderFor(rows, brain, def);
      const cells = ranks.map((rk) => fmt(def, lad.find((r) => r.x === rk)?.est[def.id]));
      const v = def.better ? monotone(def, lad) : { ok: true, notes: [], significant: false };
      const flag = !def.better ? '-' : v.ok ? 'ja' : `**nein** (${v.notes.join('; ')})`;
      o.push(`| ${def.label} [${def.set}] | ${def.better === 'up' ? 'steigt' : def.better === 'down' ? 'sinkt' : '-'} | ${cells.join(' | ')} | ${flag} |`);
    }
    o.push('');
  }
  if (brains.length > 1) {
    o.push('## Neu gegen Alt (gleiche Seeds)');
    o.push('');
    o.push('Differenz Neu minus Alt je Rang; fett = außerhalb von 1,96 x Standardfehler der Differenz (Paarung der Seeds wird konservativ nicht ausgenutzt).');
    o.push('');
    const ranks = [...new Set(rows.map((r) => r.x))].sort((a, b) => rankIdx(a) - rankIdx(b));
    o.push(`| Metrik | ${ranks.map(cap).join(' | ')} |`);
    o.push(`|---|${ranks.map(() => '---').join('|')}|`);
    for (const def of METRICS.filter((d) => d.core)) {
      const cells = ranks.map((rk) => {
        const a = ladderFor(rows, 'old', def).find((r) => r.x === rk)?.est[def.id];
        const b = ladderFor(rows, 'new', def).find((r) => r.x === rk)?.est[def.id];
        if (!a || !b || !Number.isFinite(a.value) || !Number.isFinite(b.value)) return '-';
        const d = scale(def, b.value) - scale(def, a.value);
        const se = Math.sqrt((Number.isFinite(a.se) ? scale(def, a.se) : 0) ** 2 + (Number.isFinite(b.se) ? scale(def, b.se) : 0) ** 2);
        const s = `${d >= 0 ? '+' : ''}${d.toFixed(digits(def))}`;
        return Math.abs(d) > 1.96 * se ? `**${s}**` : s;
      });
      o.push(`| ${def.label}${unitSuffix(def)} | ${cells.join(' | ')} |`);
    }
    o.push('');
  }
  o.push('## Definitionen');
  o.push('');
  for (const def of METRICS) o.push(`- **${def.label}** (\`${def.id}\`, ${def.set}): ${def.def}`);
  o.push('');
  return o.join('\n');
}

// ---------------------------------------------------------------------------------------------------- HTML

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const COL: Record<string, string> = { old: '#6b7280', new: '#2563eb' };

function chart(def: MetricDef, rows: AggRow[], brains: string[]): string {
  const ranks = [...new Set(rows.map((r) => r.x))].sort((a, b) => rankIdx(a) - rankIdx(b));
  const W = 260;
  const H = 120;
  const pts: { b: string; i: number; v: number; lo: number; hi: number }[] = [];
  for (const b of brains) {
    ladderFor(rows, b, def).forEach((r) => {
      const e = r.est[def.id];
      if (!e || !Number.isFinite(e.value)) return;
      const i = ranks.indexOf(r.x);
      pts.push({ b, i, v: scale(def, e.value), lo: Number.isFinite(e.lo) ? scale(def, e.lo) : scale(def, e.value), hi: Number.isFinite(e.hi) ? scale(def, e.hi) : scale(def, e.value) });
    });
  }
  if (!pts.length) return '';
  const min = Math.min(...pts.map((p) => p.lo));
  const max = Math.max(...pts.map((p) => p.hi));
  const pad = (max - min || 1) * 0.15;
  const y = (v: number): number => 14 + (H - 34) * (1 - (v - (min - pad)) / (max - min + 2 * pad));
  const x = (i: number): number => 28 + ((W - 44) * (i + 0.5)) / ranks.length;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(def.label)}">`;
  ranks.forEach((r, i) => (s += `<text x="${x(i)}" y="${H - 4}" text-anchor="middle" class="ax">${cap(r).slice(0, 4)}</text>`));
  s += `<text x="2" y="${y(max + pad / 2) + 3}" class="ax">${(max).toFixed(digits(def))}</text><text x="2" y="${y(min - pad / 2) + 3}" class="ax">${min.toFixed(digits(def))}</text>`;
  for (const b of brains) {
    const mine = pts.filter((p) => p.b === b).sort((p, q) => p.i - q.i);
    const off = (b === 'new' ? 4 : -4);
    if (mine.length > 1) s += `<polyline fill="none" stroke="${COL[b] ?? '#888'}" stroke-width="1.5" points="${mine.map((p) => `${x(p.i) + off},${y(p.v)}`).join(' ')}"/>`;
    for (const p of mine) s += `<line x1="${x(p.i) + off}" x2="${x(p.i) + off}" y1="${y(p.lo)}" y2="${y(p.hi)}" stroke="${COL[b] ?? '#888'}" stroke-width="1"/><circle cx="${x(p.i) + off}" cy="${y(p.v)}" r="3" fill="${COL[b] ?? '#888'}"><title>${b} ${cap(ranks[p.i]!)}: ${p.v.toFixed(digits(def))}</title></circle>`;
  }
  return s + '</svg>';
}

export function buildHtml(games: GameRaw[], meta: ReportMeta): string {
  const rows = aggregate(games);
  const brains = [...new Set(rows.map((r) => r.brain))].sort().reverse();
  const ranks = [...new Set(rows.map((r) => r.x))].sort((a, b) => rankIdx(a) - rankIdx(b));
  const h: string[] = [];
  h.push(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Veilgrounds Benchmark</title><style>
:root{--bg:#fff;--fg:#1f2430;--mut:#667;--line:#dde1e8;--card:#f6f7fa;--bad:#b42318;--ok:#067647}
@media (prefers-color-scheme:dark){:root{--bg:#14161b;--fg:#e6e8ee;--mut:#9aa3b2;--line:#2c313c;--card:#1b1e25;--bad:#f97066;--ok:#47cd89}}
body{margin:0 auto;max-width:1180px;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
h1,h2,h3{margin:1.2em 0 .4em}table{border-collapse:collapse;width:100%;margin:.5em 0 1em;font-size:13px}
th,td{border:1px solid var(--line);padding:4px 7px;text-align:right}th:first-child,td:first-child{text-align:left}
th{background:var(--card)}.bad{color:var(--bad);font-weight:600}.ok{color:var(--ok)}.mut{color:var(--mut)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}.card{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:6px 8px}
.card b{font-size:12px}svg{width:100%;height:auto}.ax{font-size:9px;fill:var(--mut)}code{background:var(--card);padding:1px 4px;border-radius:3px}
.tw{overflow-x:auto}.leg span{display:inline-block;margin-right:12px}.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px}
</style></head><body>`);
  h.push(`<h1>Veilgrounds Benchmark</h1><p class="mut">Stand <code>${esc(meta.head)}</code>. ${esc(meta.note ?? '')}</p>`);
  h.push(`<p class="leg">${brains.map((b) => `<span><i class="dot" style="background:${COL[b] ?? '#888'}"></i>${esc(brainLabel(b))}</span>`).join('')}</p>`);
  h.push('<h2>Befehle</h2><pre>' + esc(meta.commands.join('\n')) + '</pre>');
  h.push('<h2>Läufe</h2><div class="tw"><table><tr><th>Gehirn</th><th>Menge</th><th>Paar</th><th>Partien</th><th>Ø Minuten</th></tr>');
  for (const r of rows) h.push(`<tr><td>${r.brain}</td><td>${r.set}</td><td>${r.pair}</td><td>${r.games}</td><td>${r.minutes.toFixed(1)}</td></tr>`);
  h.push('</table></div><p class="mut">Werte: gepoolter Wert ± Standardfehler (Bootstrap über Partien, 1000 Ziehungen). Menge L = kurze Partien, F = bis zum Nexus oder Zeitlimit.</p>');
  h.push('<h2>Kernmetriken</h2><div class="grid">');
  for (const def of METRICS.filter((d) => d.core)) {
    const c = chart(def, rows, brains);
    if (c) h.push(`<div class="card"><b>${esc(def.label)}</b> <span class="mut">(${def.better === 'up' ? 'soll steigen' : def.better === 'down' ? 'soll sinken' : ''})</span>${c}</div>`);
  }
  h.push('</div>');
  for (const brain of brains) {
    h.push(`<h2>${esc(brainLabel(brain))}: Monotonie über die Ränge</h2><div class="tw"><table><tr><th>Metrik</th><th>Erwartung</th>${ranks.map((r) => `<th>${cap(r)}</th>`).join('')}<th>Monoton?</th></tr>`);
    for (const def of METRICS.filter((d) => d.core)) {
      const lad = ladderFor(rows, brain, def);
      const v = def.better ? monotone(def, lad) : { ok: true, notes: [] as string[], significant: false };
      h.push(`<tr><td>${esc(def.label)} <span class="mut">[${def.set}]</span></td><td>${def.better === 'up' ? 'steigt' : 'sinkt'}</td>${ranks.map((rk) => {
        const e = lad.find((r) => r.x === rk)?.est[def.id];
        return `<td title="${esc(fmtCi(def, e))} n=${e?.games ?? 0}">${esc(fmt(def, e))}</td>`;
      }).join('')}<td class="${v.ok ? 'ok' : 'bad'}">${v.ok ? 'ja' : 'nein: ' + esc(v.notes.join('; '))}</td></tr>`);
    }
    h.push('</table></div>');
  }
  h.push('<h2>Alle Metriken je Lauf</h2>');
  for (const g of headline(rows)) {
    h.push(`<h3>${esc(brainLabel(g.brain))}, Menge ${g.set}</h3><div class="tw"><table><tr><th>Metrik</th>${g.rows.map((r) => `<th>${esc(r.pair)}<br><span class="mut">n=${r.games}</span></th>`).join('')}</tr>`);
    for (const def of METRICS) {
      for (const key of metricKeys(def)) {
        if (!g.rows.some((r) => Number.isFinite(r.est[key]?.value))) continue;
        const lab = key === def.id ? def.label : `&nbsp;&nbsp;${esc(def.label)} (${key.split('.')[1]})`;
        h.push(`<tr><td>${key === def.id ? lab : lab}</td>${g.rows.map((r) => `<td title="${esc(fmtCi(def, r.est[key]))}">${esc(fmt(def, r.est[key]))}</td>`).join('')}</tr>`);
      }
    }
    h.push('</table></div>');
  }
  h.push('<h2>Definitionen</h2><dl>');
  for (const def of METRICS) h.push(`<dt><b>${esc(def.label)}</b> <code>${def.id}</code> <span class="mut">Menge ${def.set}${def.vsOnly ? ', nur gegen feste Referenz aussagekräftig' : ''}</span></dt><dd>${esc(def.def)}</dd>`);
  h.push('</dl></body></html>');
  return h.join('\n');
}

export { METRIC_BY_ID };
