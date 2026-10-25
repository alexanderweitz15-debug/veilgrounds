// Branch comparison: a result file of a candidate branch against the committed baseline, game by game on the same
// seeds. Differences are bootstrapped over matched games (paired), so shared line-up / seed noise cancels.
//   npx tsx tools/benchmark/cli.ts compare --base=tools/benchmark/baseline/new-L.json --new=mine.json [--out=compare.md]
// Merge rule of docs/agents/wave1-rules.md: improvement in the own target metrics, no core metric more than 5 % worse
// (relative to the baseline value); "worse" counts as a violation only when the paired 95 % interval excludes zero,
// otherwise it is reported as "within noise".

import { METRICS, type MetricDef } from './metrics';
import { clustersFor, type Cluster } from './stats';
import type { GameRaw } from './play';

const BOOT = 1000;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hashStr = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const quant = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo]! + (s[Math.min(s.length - 1, lo + 1)]! - s[lo]!) * (i - lo);
};

function value(cs: Cluster[], kind: 'ratio' | 'samples'): number {
  if (kind === 'ratio') {
    let n = 0;
    let d = 0;
    for (const c of cs) {
      const r = (c as { r: [number, number] }).r;
      n += r[0];
      d += r[1];
    }
    return d > 0 ? n / d : NaN;
  }
  const all: number[] = [];
  for (const c of cs) all.push(...(c as { s: number[] }).s);
  return all.length ? quant(all, 0.5) : NaN;
}

export interface Delta {
  base: number;
  now: number;
  delta: number;
  lo: number;
  hi: number;
  /** Matched games used. */
  n: number;
}

/** Paired bootstrap of (now - base) over games that exist in both lists (same pair, seed and side). */
export function pairedDelta(base: GameRaw[], now: GameRaw[], key: string, kind: 'ratio' | 'samples', seedKey: string): Delta | null {
  const idOf = (g: GameRaw): string => `${g.spec.pair}|${g.spec.seed}|${g.spec.flip ? 1 : 0}`;
  const bm = new Map(base.map((g) => [idOf(g), g]));
  const pairs = now.filter((g) => bm.has(idOf(g))).map((g) => [bm.get(idOf(g))!, g] as const);
  if (!pairs.length) return null;
  const cb = pairs.map(([b]) => clustersFor([b], key, kind)[0]!);
  const cn = pairs.map(([, g]) => clustersFor([g], key, kind)[0]!);
  const has = (c: Cluster): boolean => ('r' in c ? c.r[1] > 0 : c.s.length > 0);
  const idx = pairs.map((_, i) => i).filter((i) => has(cb[i]!) && has(cn[i]!));
  if (!idx.length) return null;
  const vb = value(idx.map((i) => cb[i]!), kind);
  const vn = value(idx.map((i) => cn[i]!), kind);
  if (idx.length < 2) return { base: vb, now: vn, delta: vn - vb, lo: NaN, hi: NaN, n: idx.length };
  const rand = rng(hashStr(seedKey));
  const ds: number[] = [];
  for (let b = 0; b < BOOT; b++) {
    const pick = Array.from({ length: idx.length }, () => idx[Math.floor(rand() * idx.length)]!);
    const d = value(pick.map((i) => cn[i]!), kind) - value(pick.map((i) => cb[i]!), kind);
    if (Number.isFinite(d)) ds.push(d);
  }
  return { base: vb, now: vn, delta: vn - vb, lo: ds.length ? quant(ds, 0.025) : NaN, hi: ds.length ? quant(ds, 0.975) : NaN, n: idx.length };
}

const scale = (d: MetricDef, v: number): number => (d.unit === 'pct' ? v * 100 : v);
const dig = (d: MetricDef): number => (d.unit === 'ms' ? 0 : d.unit === 'x' ? 2 : 1);

export function compareMarkdown(base: GameRaw[], now: GameRaw[], opts: { focus?: string[] } = {}): string {
  const out: string[] = ['# Benchmark-Vergleich (gleiche Seeds, gepaart)', ''];
  out.push('Differenz = Kandidat minus Baseline, 95-%-Intervall aus Bootstrap über gepaarte Partien (Paarung: Paar, Seed, Seite). "besser"/"schlechter" nur, wenn das Intervall die 0 ausschließt; relative Änderung in % des Baseline-Werts.');
  out.push('');
  const keyOf = (g: GameRaw): string => `${g.spec.set}|${g.spec.pair}`;
  const groups = [...new Set(now.map(keyOf))].sort();
  const violations: string[] = [];
  const focus = new Set(opts.focus ?? []);
  for (const gk of groups) {
    const b = base.filter((g) => keyOf(g) === gk);
    const n = now.filter((g) => keyOf(g) === gk);
    if (!b.length) continue;
    const [set, pair] = gk.split('|') as [string, string];
    out.push(`## Paar ${pair} (Menge ${set})`);
    out.push('');
    out.push('| Metrik | Baseline | Kandidat | Differenz [95 %] | rel. | Urteil | Spiele |');
    out.push('|---|---|---|---|---|---|---|');
    for (const def of METRICS) {
      if (!def.core && !focus.has(def.id)) continue;
      const d = pairedDelta(b, n, def.id, def.kind, `${gk}|${def.id}`);
      if (!d) continue;
      const rel = d.base !== 0 && Number.isFinite(d.base) ? (100 * d.delta) / Math.abs(d.base) : NaN;
      const sign = def.better === 'down' ? -1 : 1;
      const sig = Number.isFinite(d.lo) && (d.lo > 0 || d.hi < 0);
      const good = def.better ? sign * d.delta > 0 : null;
      let verdict = 'unverändert';
      if (def.better === null) verdict = sig ? 'geändert' : 'unverändert';
      else if (sig) verdict = good ? 'besser' : 'schlechter';
      else verdict = Math.abs(rel) > 0 && good === false ? 'schlechter (im Rauschen)' : 'im Rauschen';
      if (def.better && good === false && Number.isFinite(rel) && Math.abs(rel) > 5) violations.push(`${pair} ${def.label}: ${rel.toFixed(1)} % ${sig ? '(signifikant)' : '(im Rauschen)'}`);
      const ci = Number.isFinite(d.lo) ? ` [${scale(def, d.lo).toFixed(dig(def))}; ${scale(def, d.hi).toFixed(dig(def))}]` : '';
      out.push(`| ${def.label} | ${scale(def, d.base).toFixed(dig(def))} | ${scale(def, d.now).toFixed(dig(def))} | ${d.delta >= 0 ? '+' : ''}${scale(def, d.delta).toFixed(dig(def))}${ci} | ${Number.isFinite(rel) ? rel.toFixed(1) + ' %' : '-'} | ${sig && good === false ? '**' + verdict + '**' : verdict} | ${d.n} |`);
    }
    out.push('');
  }
  out.push('## Merge-Regel: Kernmetriken > 5 % schlechter als die Baseline');
  out.push('');
  out.push(violations.length ? violations.map((v) => `- ${v}`).join('\n') : 'Keine.');
  out.push('');
  return out.join('\n');
}
