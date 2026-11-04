// A14 idle diagnosis: npx tsx tools/a14/idleDiag.ts --seed=22 --rank=challenger [--minutes=20] [--brain=new]
// Counts, per bot, the ticks without an order (Move.mode 0, no attack target / wind-up, not busy, not recalling, not in
// the fountain, from 1:45) and classifies them by the governing intent decision, bot mode, and what is around.
// Measurement only: reads the Sim, never feeds the brains.
import { botGameConfig } from '../../src/ai/runner';
import { runBotGame } from '../../src/ai/harness';
import { isBusy } from '../../src/sim/systems/abilities';
import { Kind } from '../../src/sim/types';
import { utilityDebug } from '../../src/ai/utility/select';
import { reflexState } from '../../src/ai/reflex/state';
import type { Rank } from '../../src/ai/profiles/schema';
import { BUILDS } from '../../src/ai/bot/builds';
import sevBuild from '../../src/data/builds/sev.json';
BUILDS.sev ??= sevBuild as (typeof BUILDS)[string];

declare const process: { argv: string[]; stdout: { write(s: string): void } };
const args = new Map(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true'] as const; }));
const seed = Number(args.get('seed') ?? 22);
const rank = (args.get('rank') ?? 'challenger') as Rank;
const minutes = Number(args.get('minutes') ?? 20);
const newBrain = (args.get('brain') ?? 'new') === 'new';
const noVariance = args.get('variance') === '0';
const config = botGameConfig(seed, rank);
if (newBrain) config.botUtility = true;

const alive = new Map<number, number>(); // slot -> ticks counted (alive, not home, not recalling)
const idle = new Map<number, number>();
const cats = new Map<string, number>();
const byIntent = new Map<string, number>();
const reachIdle = new Map<number, number>();
const roleOf = new Map<number, string>();
for (const p of config.players) roleOf.set(p.slot, p.role);
const bump = (m: Map<string, number>, k: string): void => void m.set(k, (m.get(k) ?? 0) + 1);

interface Runner {
  bots: { ctx: { slot: number }; mem: never }[];
  log: { latest(bot: number, pred?: (x: { node: string }) => boolean): { node: string; chosen: string; reason: string; inputs: Record<string, number | string | boolean> } | undefined };
}

const res = runBotGame(
  config,
  Math.round(minutes * 60 * 30),
  (sim, _in, runnerAny) => {
    const runner = runnerAny as unknown as Runner;
    const T = sim.tick;
    if (T < 105 * 30) return;
    const { Unit, Pos, Hp, Move, Atk, Champ, Stats } = sim.c;
    for (const p of config.players) {
      const e = sim.slots[p.slot]!;
      if (!Unit.alive[e]) continue;
      const f = sim.map.sides[Unit.team[e]!]!.fountain;
      if (Math.hypot(Pos.x[e]! - f.x, Pos.y[e]! - f.y) <= f.r || Champ.recallAt[e]! > 0) continue;
      alive.set(p.slot, (alive.get(p.slot) ?? 0) + 1);
      const isIdle = Move.mode[e] === 0 && Atk.phase[e] === 0 && Atk.target[e] === -1 && !isBusy(sim, e);
      if (!isIdle) continue;
      idle.set(p.slot, (idle.get(p.slot) ?? 0) + 1);
      if (T % 6 !== 0) continue; // classify every 6th tick (cheap)
      const b = runner.bots.find((x) => x.ctx.slot === p.slot)!;
      const ud = utilityDebug(b.mem);
      const le = runner.log.latest(p.slot, (x) => x.node === 'intent');
      const rs = reflexState(b.mem);
      let enemyMin = 0;
      let enemyChamp = 0;
      let ownMin = 0;
      let inReach = false;
      for (let o = 0; o < Unit.kind.length; o++) {
        if (!Unit.alive[o]) continue;
        const k = Unit.kind[o]!;
        const d = Math.hypot(Pos.x[o]! - Pos.x[e]!, Pos.y[o]! - Pos.y[e]!);
        if (Unit.alive[o] && Unit.team[o] !== p.team && (Kind.MinionMelee <= k && k <= Kind.MinionSuper ? true : k === Kind.Champion) && d <= Stats.range[e]! + Unit.radius[e]! + 200 + Unit.radius[o]!) inReach = true;
        if (d > 1200) continue;
        const isMin = k === Kind.MinionMelee || k === Kind.MinionCaster || k === Kind.MinionSiege || k === Kind.MinionSuper;
        if (isMin) {
          if (Unit.team[o] !== p.team) enemyMin++;
          else ownMin++;
        } else if (k === Kind.Champion && Unit.team[o] !== p.team && o !== e) enemyChamp++;
      }
      const hp = Math.floor((10 * Hp.cur[e]!) / Hp.max[e]!) * 10;
      const stand = rs.stand ? Math.round(Math.hypot(rs.stand.x - Pos.x[e]!, rs.stand.y - Pos.y[e]!) / 100) * 100 : -1;
      const m = (b.mem as { mode: string }).mode;
      if (inReach) reachIdle.set(p.slot, (reachIdle.get(p.slot) ?? 0) + 6);
      bump(byIntent, `${p.role === 'jungle' ? 'jungle' : 'laner'}|intent=${ud?.intent ?? '-'}|log=${le ? le.chosen : '-'}`);
      const inp = le?.inputs ?? {};
      const why = le && (le.chosen === 'none' || le.chosen === 'wait') ? ` best=${inp.best} risk=${Number(inp.t_gankRisk ?? -1).toFixed(1)} exp>0=${Number(inp.t_exposure ?? 0) > 0 ? 'y' : 'n'} ben>0=${Number(inp.benefit ?? 0) > 0 ? 'y' : 'n'}` : '';
      bump(cats, `${p.role}|intent=${ud?.intent ?? '-'}|mode=${m}|log=${le ? le.chosen + ':' + le.reason : '-'}${why}|eMin=${enemyMin > 0 ? 'y' : 'n'} oMin=${ownMin > 0 ? 'y' : 'n'} eChamp=${enemyChamp > 0 ? 'y' : 'n'} inReach=${inReach ? 'y' : 'n'}|hp>=${hp}|laneIntent=${rs.intent ? rs.intent.wave + (rs.intent.farm ? '/farm' : '/nofarm') : 'none'}|standD=${stand}`);
    }
  },
  { noVariance, reflex: newBrain },
);

const out: string[] = [];
out.push(`# idleDiag seed=${seed} rank=${rank} brain=${newBrain ? 'new' : 'default'} minutes=${res.minutes.toFixed(1)} winner=${res.winner}`);
const byRole = new Map<string, [number, number]>();
for (const [s, a] of alive) {
  const r = roleOf.get(s)!;
  const x = byRole.get(r) ?? [0, 0];
  x[0] += a;
  x[1] += idle.get(s) ?? 0;
  byRole.set(r, x);
}
let ta = 0;
let ti = 0;
for (const [r, [a, i]] of byRole) {
  out.push(`  ${r.padEnd(8)} idle ${((100 * i) / a).toFixed(1)} %  (${(a / 30).toFixed(0)} s counted)`);
  ta += a;
  ti += i;
}
{ let r = 0; for (const [, c] of reachIdle) r += c; out.push(`  of which with an enemy unit in auto reach+200: ${((100 * r) / ta).toFixed(1)} %`); }
out.push(`  ALL      idle ${((100 * ti) / ta).toFixed(1)} %`);
out.push('idle seconds by intent:');
for (const [k, c] of [...byIntent.entries()].sort((a, b) => b[1] - a[1])) out.push(`  ${((c * 6) / 30).toFixed(0).padStart(5)} s  ${k}`);
out.push('top idle categories (every 6th tick sampled, shown as seconds):');
const top = [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, Number(args.get('top') ?? 40));
for (const [k, c] of top) out.push(`  ${((c * 6) / 30).toFixed(0).padStart(5)} s  ${k}`);
process.stdout.write(out.join('\n') + '\n');
