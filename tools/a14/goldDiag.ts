// A14: unspent gold. npx tsx tools/a14/goldDiag.ts --seed=101 --rank=gold --at=18.5
// At the given minute: per bot gold, spendable, phantom gold, next planned item price, buy index / plan length, items.
import { botGameConfig } from '../../src/ai/runner';
import { runBotGame } from '../../src/ai/harness';
import { buildPlan, itemPrice, nextItemPrice, spendable } from '../../src/ai/bot/shop';
import { utilityDebug } from '../../src/ai/utility/select';
import type { Rank } from '../../src/ai/profiles/schema';
import { BUILDS } from '../../src/ai/bot/builds';
import sevBuild from '../../src/data/builds/sev.json';
import { inventory } from '../../src/sim/items/inventory';
BUILDS.sev ??= sevBuild as (typeof BUILDS)[string];

declare const process: { argv: string[]; stdout: { write(s: string): void } };
const args = new Map(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true'] as const; }));
const seed = Number(args.get('seed') ?? 101);
const rank = (args.get('rank') ?? 'gold') as Rank;
const at = Math.round(Number(args.get('at') ?? 18.5) * 1800);
const config = botGameConfig(seed, rank);
config.botUtility = true;
const out: string[] = [];
const lastPhantom = new Map<number, number>();
runBotGame(
  config,
  at + 1,
  (sim, inputs, runnerAny) => {
    const rn = runnerAny as unknown as { bots: { ctx: { slot: number; role: string; build?: unknown }; mem: { buyIdx: number; phantomGold: number; pendingBuy: { goldBefore: number; cost: number } | null } }[] };
    for (const b of rn.bots) {
      const prev = lastPhantom.get(b.ctx.slot) ?? 0;
      if (b.mem.phantomGold !== prev) {
        const e = sim.slots[b.ctx.slot]!;
        const plan = buildPlan(b.ctx as never);
        out.push(`  phantom ${prev} -> ${b.mem.phantomGold} slot ${b.ctx.slot} ${b.ctx.role} tick ${sim.tick} (${Math.round(sim.tick / 1800)}min) gold ${Math.round(sim.c.Champ.gold[e]!)} buyIdx ${b.mem.buyIdx} last ${plan[b.mem.buyIdx - 1]}`);
        lastPhantom.set(b.ctx.slot, b.mem.phantomGold);
      }
    }
    for (const i of inputs) if (i.cmd.t === 'buy' && (i.slot === 2 || i.slot === 5)) out.push(`  buy cmd slot ${i.slot} ${(i.cmd as { item: string }).item} tick ${sim.tick} gold ${Math.round(sim.c.Champ.gold[sim.slots[i.slot]!]!)}`);
    if (sim.tick !== at) return;
    const runner = runnerAny as unknown as { bots: { ctx: { slot: number; role: string; build?: unknown }; mem: { buyIdx: number; phantomGold: number } }[] };
    const { Champ } = sim.c;
    for (const b of runner.bots) {
      const e = sim.slots[b.ctx.slot]!;
      const plan = buildPlan(b.ctx as never);
      const inv = inventory(sim, e) as unknown;
      out.push(
        `${String(b.ctx.role).padEnd(7)} slot ${b.ctx.slot} gold ${Math.round(Champ.gold[e]!)} phantom ${Math.round(b.mem.phantomGold)} buyIdx ${b.mem.buyIdx}/${plan.length} next ${plan[b.mem.buyIdx] ?? '-'} price ${nextItemPrice(b.ctx as never, b.mem as never)} intent ${utilityDebug(b.mem as never)?.intent} inv ${JSON.stringify(inv).slice(0, 160)}`,
      );
    }
    void spendable;
    void itemPrice;
  },
  { noVariance: args.get('variance') === '0', reflex: true },
);
process.stdout.write(out.join('\n') + '\n');
