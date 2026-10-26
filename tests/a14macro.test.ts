// A14 macro decisions of the beta brain: idle first (baseline farm, no stand-still on negative risk), the shop's
// phantom-gold fix (beta only), closing multiplier, the reflex wave override handling of the selector.
import { describe, expect, it } from 'vitest';
import type { Rank } from '../src/ai/profiles/schema';
import { TeamAI } from '../src/ai/bot/teamai';
import { BUILDS } from '../src/ai/bot/builds';
import { buildPlan, nextItemPrice, settleBuys, shop } from '../src/ai/bot/shop';
import { INTENT_NODE, utilitySelect } from '../src/ai/utility/select';
import { closingMult } from '../src/ai/utility/value';
import { VALUES } from '../src/ai/utility/values';
import { clearForcedWave } from '../src/ai/utility/intents';
import { reflexState } from '../src/ai/reflex/state';
import { MAP, PLAYERS, ScriptedBot, champEnt, hud, paramsFor, snapshot } from './botScenario';

function midBot(rank: Rank, utility: boolean, seed = 1): ScriptedBot {
  const bot = new ScriptedBot(2, paramsFor(rank, {}, 2), seed);
  (bot.ctx as { teamAI: TeamAI }).teamAI = new TeamAI(0, MAP, PLAYERS, seed, bot.ctx.log);
  (bot.ctx as { utility?: boolean }).utility = utility;
  (bot.ctx as { build: unknown }).build = BUILDS[PLAYERS[2]!.champion] ?? null;
  return bot;
}
const mid = (t: number): { x: number; y: number } => ({ x: 1800 + 12400 * t, y: 1800 + 12400 * t });

describe('idle first: the lane presence is never abandoned for a risk term', () => {
  it('high gank risk and no minion in reach: farm runs as the logged baseline, not an idle choice', () => {
    const bot = midBot('challenger', true);
    const p = mid(0.3);
    const n = bot.node(snapshot({ tick: 9000, team: 0, entities: [champEnt(2, p.x, p.y)], me: hud(2) }));
    (n.pv.gankRisk as { mid: number }).mid = 0.95;
    utilitySelect(n);
    const e = bot.log.filter((x) => x.node === INTENT_NODE).pop()!;
    expect(e.chosen).not.toBe('none');
    expect(e.chosen).not.toBe('wait');
    expect(Object.keys(e.scores ?? {}).length).toBeGreaterThan(0);
  });
});

describe('shop (beta): phantom gold', () => {
  it('the beta plan buys the base boots before the upgrade, the default plan is unchanged', () => {
    const beta = midBot('gold', true);
    const old = midBot('gold', false);
    const boots = (PLAYERS[2] && BUILDS[PLAYERS[2].champion]?.standard.boots) as string;
    const pb = buildPlan(beta.ctx);
    const po = buildPlan(old.ctx);
    expect(po).toContain(boots);
    expect(pb.indexOf('stiefel')).toBeGreaterThanOrEqual(0);
    expect(pb.indexOf('stiefel')).toBeLessThan(pb.indexOf(boots));
    expect(po).not.toContain('stiefel');
    expect(pb.length).toBe(po.length + 1);
  });

  it('free boots (Inspiration) are not bought a second time, and the price of the next entry skips them', () => {
    const bot = midBot('gold', true);
    const plan = buildPlan(bot.ctx);
    const boots = BUILDS[PLAYERS[2]!.champion]!.standard.boots;
    const at = plan.indexOf('stiefel');
    bot.mem.buyIdx = at;
    const owned = { ...hud(2, { gold: 5000 }), items: ['zauberring', 'stiefel_hast', null, null, null, null, null] };
    const out = shop(owned as never, bot.ctx, bot.mem);
    const bought = out.map((a) => (a.cmd as { item: string }).item);
    expect(bought).not.toContain('stiefel');
    expect(bought).not.toContain(boots);
    expect(bot.mem.buyIdx).toBeGreaterThan(plan.indexOf(boots));
  });

  it('a purchase is settled two decisions later (the gold of the first decision after the order is not the verdict)', () => {
    const bot = midBot('gold', true);
    const me0 = hud(2, { gold: 1000 });
    const out = shop(me0 as never, bot.ctx, bot.mem);
    expect(out.length).toBeGreaterThan(0);
    expect(bot.mem.pendingBuy).not.toBeNull();
    settleBuys(me0 as never, bot.mem); // gold unchanged: still pending
    expect(bot.mem.pendingBuy).not.toBeNull();
    settleBuys(me0 as never, bot.mem);
    expect(bot.mem.pendingBuy).not.toBeNull();
    settleBuys(me0 as never, bot.mem); // verdict: nothing was charged
    expect(bot.mem.pendingBuy).toBeNull();
    expect(bot.mem.phantomGold).toBeGreaterThan(0);
    expect(nextItemPrice(bot.ctx, bot.mem)).toBeGreaterThan(0);
  });

  it('the default brain settles at once (bit-identical to the old behaviour)', () => {
    const bot = midBot('gold', false);
    shop(hud(2, { gold: 1000 }) as never, bot.ctx, bot.mem);
    settleBuys(hud(2, { gold: 1000 }) as never, bot.mem);
    expect(bot.mem.pendingBuy).toBeNull();
  });
});

describe('closing multiplier and wave override', () => {
  it('structure value grows from 14:00 to the cap and is 1 before', () => {
    expect(closingMult(600)).toBe(1);
    expect(closingMult(VALUES.closing.fromS)).toBe(1);
    expect(closingMult(VALUES.closing.fromS + VALUES.closing.rampS / 2)).toBeCloseTo(1 + (VALUES.closing.mult - 1) / 2, 6);
    expect(closingMult(5000)).toBe(VALUES.closing.mult);
  });

  it('the selector clears only the wave override that an intent set, not a test / trainer override', () => {
    const bot = midBot('gold', true);
    const st = reflexState(bot.mem);
    st.waveOverride = 'freeze';
    clearForcedWave(bot.mem);
    expect(st.waveOverride).toBe('freeze');
  });
});
