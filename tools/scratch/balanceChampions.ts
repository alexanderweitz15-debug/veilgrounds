// Champion balance measurement (docs/agents/balance-champions.md).
//   npx tsx tools/scratch/balanceChampions.ts games --games=60 --part=0/2 --out=a.json   (all champions rotated through
//       every role they list, same seeds + line-ups every run; Gold, variance off)
//   npx tsx tools/scratch/balanceChampions.ts duels --seeds=3 --part=0/2 --out=d.json     (1v1 arena at level 11 with
//       the standard build's boots + first two core items, per role pool, both sides)
//   npx tsx tools/scratch/balanceChampions.ts report a.json b.json ...                    (aggregate)
// Parts run as separate processes (the swarm rules allow two at a time).
import { botGameConfig } from '../../src/ai/runner';
import { runBotGame } from '../../src/ai/harness';
import { CHAMPION_DATA } from '../../src/sim/champions';
import { botRunes } from '../../src/sim/items/runes';
import { Rng } from '../../src/sim/rng';
import { profileOf } from '../../src/ai/profiles';
import { arenaItems } from '../../src/game/modes';
import type { PlayerSetup, SimConfig } from '../../src/sim/types';

declare const process: { argv: string[] };
const fsMod = (await import('node:' + 'fs')) as { writeFileSync(p: string, d: string): void; readFileSync(p: string, e: string): string };
const args = new Map(process.argv.slice(3).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true'] as const; }));
const cmd = process.argv[2];
const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;
type Role = (typeof ROLES)[number];
const ids = Object.keys(CHAMPION_DATA).sort();
const pool = (role: Role): string[] => ids.filter((id) => (CHAMPION_DATA[id]!.roles as readonly string[]).includes(role));

function shuffled<T>(xs: T[], seed: number): T[] {
  const r = new Rng(seed);
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = r.int(i + 1); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}
/** Draw k-th champion of a role from a bag of shuffled epochs, skipping already taken ones. */
function draw(role: Role, k: number, taken: Set<string>): string {
  const p = pool(role);
  for (let j = 0; ; j++) {
    const kk = k + j;
    const c = shuffled(p, Math.floor(kk / p.length) * 977 + ROLES.indexOf(role) + 5)[kk % p.length]!;
    if (!taken.has(c)) { taken.add(c); return c; }
  }
}

function lineup(g: number): Record<Role, [string, string]> {
  const taken = new Set<string>();
  const out = {} as Record<Role, [string, string]>;
  for (const r of ROLES) {
    const a = draw(r, 2 * g, taken);
    const b = draw(r, 2 * g + 1, taken);
    out[r] = g % 2 === 0 ? [a, b] : [b, a];
  }
  return out;
}

const [partI, partN] = (args.get('part') ?? '0/1').split('/').map(Number) as [number, number];
const out = args.get('out')!;

if (cmd === 'games') {
  const games = Number(args.get('games') ?? 60);
  const minutes = Number(args.get('minutes') ?? 20);
  const seed0 = Number(args.get('seed') ?? 1);
  const rows: unknown[] = [];
  for (let g = 0; g < games; g++) {
    if (g % partN !== partI) continue;
    const seed = seed0 + g;
    const cfg = botGameConfig(seed, 'gold', 'stable');
    const lu = lineup(g);
    const rng = new Rng(seed ^ 0x77);
    for (const p of cfg.players) {
      const champ = lu[p.role as Role][p.team]!;
      p.champion = champ;
      p.runes = botRunes(champ, profileOf('gold').behavior.optimalRunesPct, rng);
    }
    const res = runBotGame(cfg, minutes * 60 * 30, undefined, { noVariance: true });
    const gold = (t: number): number => res.stats.filter((s) => s.team === t).reduce((a, s) => a + s.goldEarned, 0);
    const winner = res.winner ?? (gold(0) > gold(1) ? 0 : 1);
    const dmgT = [0, 1].map((t) => res.stats.filter((s) => s.team === t).reduce((a, s) => a + s.damageToChampions, 0));
    for (const s of res.stats) rows.push({ g, seed, champion: s.champion, role: s.role, team: s.team, won: winner === s.team ? 1 : 0, nexus: res.winner === s.team ? 1 : 0, kills: s.kills, deaths: s.deaths, dmg: s.damageToChampions, dmgShare: s.damageToChampions / Math.max(1, dmgT[s.team]!), gpm: s.goldEarned / res.minutes, cs: s.cs, min: res.minutes });
    console.error(`game ${g} done ${res.minutes.toFixed(1)} min winner ${res.winner}`);
  }
  fsMod.writeFileSync(out, JSON.stringify(rows));
} else if (cmd === 'duels') {
  const seeds = Number(args.get('seeds') ?? 3);
  const rows: unknown[] = [];
  let n = 0;
  for (const role of ROLES) {
    const p = pool(role);
    for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
      if (n++ % partN !== partI) continue;
      for (let s = 0; s < seeds; s++) for (const swap of [0, 1]) {
        const [a, b] = swap ? [p[j]!, p[i]!] : [p[i]!, p[j]!];
        const mk = (slot: number, team: 0 | 1, champion: string): PlayerSetup => ({ slot, team, champion, role: 'mid', summoners: ['sprung', 'heilen'], isHuman: false, bot: { rank: 'gold', variance: 'stable' } });
        const items: Record<string, string[]> = { '0': arenaItems(a), '5': arenaItems(b) };
        const cfg: SimConfig = { seed: 100 + s, mode: 'arena', players: [mk(0, 0, a), mk(5, 1, b)], minionsEnabled: false, trainer: { level: 11, rounds: 3, roundSec: 45, items } };
        const res = runBotGame(cfg, 8 * 60 * 30, undefined, { noVariance: true });
        const hp = res.stats; // damage as tie-break info
        rows.push({ role, a, b, seed: 100 + s, swap, winner: res.winner === 0 ? a : res.winner === 1 ? b : null, dmgA: hp[0]!.damageToChampions, dmgB: hp[1]!.damageToChampions });
      }
    }
  }
  fsMod.writeFileSync(out, JSON.stringify(rows));
} else if (cmd === 'report') {
  const files = process.argv.slice(3).filter((a) => !a.startsWith('--'));
  const rows = files.flatMap((f) => JSON.parse(fsMod.readFileSync(f, 'utf8')) as any[]);
  if (rows[0] && 'champion' in rows[0]) {
    const by = new Map<string, any[]>();
    for (const r of rows) { const k = `${r.role}|${r.champion}`; by.set(k, [...(by.get(k) ?? []), r]); }
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    const lines: string[] = ['role | champion | n | win% | K | D | K/D | dmgShare% | gpm | cs'];
    for (const [k, rs] of [...by].sort()) {
      const [role, champion] = k.split('|');
      const K = mean(rs.map((r) => r.kills)), D = mean(rs.map((r) => r.deaths));
      lines.push(`${role} | ${champion} | ${rs.length} | ${(100 * mean(rs.map((r) => r.won))).toFixed(0)} | ${K.toFixed(1)} | ${D.toFixed(1)} | ${(K / Math.max(0.1, D)).toFixed(2)} | ${(100 * mean(rs.map((r) => r.dmgShare))).toFixed(1)} | ${mean(rs.map((r) => r.gpm)).toFixed(0)} | ${mean(rs.map((r) => r.cs)).toFixed(0)}`);
    }
    const games = new Set(rows.map((r) => r.g)).size;
    lines.push(`games ${games}, blue win% ${(100 * mean(rows.filter((r) => r.team === 0).map((r) => r.won))).toFixed(0)}`);
    console.log(lines.join('\n'));
  } else {
    const wins = new Map<string, [number, number]>();
    const pair = new Map<string, Map<string, [number, number]>>();
    for (const r of rows) {
      for (const [c, o] of [[r.a, r.b], [r.b, r.a]] as const) {
        const w = wins.get(`${r.role}|${c}`) ?? [0, 0];
        w[1]++;
        if (r.winner === c) w[0]++;
        wins.set(`${r.role}|${c}`, w);
        void o;
      }
      const key = `${r.role}|${r.a}|${r.b}`;
      const m = pair.get(key) ?? new Map();
      void m;
    }
    const lines = ['role | champion | duels | win%'];
    for (const [k, [w, n]] of [...wins].sort()) lines.push(`${k.split('|')[0]} | ${k.split('|')[1]} | ${n} | ${(100 * w / n).toFixed(0)}`);
    console.log(lines.join('\n'));
  }
}
