// A14 scratch: trace the shop of one bot around a tick window (phantom gold hunt).
import { botGameConfig } from '../../src/ai/runner';
import { runBotGame } from '../../src/ai/harness';
import { quote, inventory, canShop } from '../../src/sim/items/inventory';
import { BUILDS } from '../../src/ai/bot/builds';
import sevBuild from '../../src/data/builds/sev.json';
BUILDS.sev ??= sevBuild as (typeof BUILDS)[string];

declare const process: { argv: string[] };
declare const console: { log: (...a: unknown[]) => void };
const args = new Map(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true'] as const; }));
const slot = Number(args.get('slot') ?? 5);
const from = Number(args.get('from') ?? 27940);
const to = Number(args.get('to') ?? 28040);
const config = botGameConfig(Number(args.get('seed') ?? 101), 'gold');
config.botUtility = true;
runBotGame(
  config,
  to + 1,
  (sim, inputs, r) => {
    const T = sim.tick;
    if (T < from || T > to) return;
    const bots = (r as unknown as { bots: { ctx: { slot: number }; mem: { pendingBuy: unknown; phantomGold: number; shopVisitDone: boolean }; next: number }[] }).bots;
    const b = bots.find((x) => x.ctx.slot === slot)!;
    const e = sim.slots[slot]!;
    const buys = inputs.filter((i) => i.slot === slot && i.cmd.t === 'buy').map((i) => (i.cmd as { item: string }).item);
    if (args.get('onlybuys') && !buys.length) return;
    console.log(T, 'gold', Math.round(sim.c.Champ.gold[e]!), 'pending', JSON.stringify(b.mem.pendingBuy), 'phantom', b.mem.phantomGold, 'visitDone', b.mem.shopVisitDone, 'buys', buys.join(','), 'next', b.next, 'quote', JSON.stringify(quote(sim, e, String(args.get('item') ?? 'stiefel'))), 'canShop', canShop(sim, e), JSON.stringify(inventory(sim, e)));
  },
  { noVariance: true, reflex: true },
);
