// A13: combos from the champion hints (choice by readiness and reach, execution every tick).

import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/rng';
import { chooseHintCombo, comboTick } from '../src/ai/combat/combo';
import { ScriptedBot, champEnt, hud, paramsFor, snapshot } from './botScenario';

describe('combos from the hints', () => {
  it('a trade combo avoids the ultimate and abilities on cooldown', () => {
    const bot = new ScriptedBot(3, paramsFor('challenger', {}, 3), 5); // mira: combos Q-AA-AA | E-AA-W | W-R
    (bot.ctx as { utility?: boolean }).utility = true;
    const me = champEnt(3, 3000, 3000);
    const t = champEnt(8, 3500, 3000);
    const h = hud(3);
    const n = bot.node(snapshot({ tick: 3000, team: 0, entities: [me, t], me: h }));
    for (let seed = 1; seed <= 6; seed++) {
      const combo = chooseHintCombo(n.v, bot.ctx, new Rng(seed), 'trade', t);
      expect(combo).not.toContain('R');
      expect(combo.length).toBeGreaterThan(0);
    }
    // an all-in may use the ultimate
    expect(chooseHintCombo(n.v, bot.ctx, new Rng(3), 'allin', t).length).toBeGreaterThan(0);
    // W on cooldown: the combo that opens with W is not taken
    h.abilities[1]!.cdLeft = 5;
    const n2 = bot.node(snapshot({ tick: 3000, team: 0, entities: [me, t], me: h }));
    const c = chooseHintCombo(n2.v, bot.ctx, new Rng(3), 'trade', t);
    expect(c[0]).not.toBe('W');
  });

  it('comboTick casts the next ability of a running trade and advances the step; nothing without a trade or while busy', () => {
    const bot = new ScriptedBot(3, paramsFor('challenger', {}, 3), 5);
    (bot.ctx as { utility?: boolean }).utility = true;
    const me = champEnt(3, 3000, 3000);
    const t = champEnt(8, 3600, 3000);
    bot.node(snapshot({ tick: 3000, team: 0, entities: [me, t], me: hud(3) })); // the bot notices the enemy ...
    const n = bot.node(snapshot({ tick: 3100, team: 0, entities: [me, t], me: hud(3) })); // ... after its reaction time
    const cc = { ultKillThreshold: 0.6, executeChance: 1 };
    expect(n.v.enemies.length).toBe(1);
    expect(comboTick(n.v, bot.ctx, bot.mem, new Rng(1), cc)).toEqual([]);
    bot.mem.ext.trade = { serial: t.serial, id: t.id, kind: 'trade', start: 3100, trigger: 'test', combo: ['W', 'AA'], step: 0, stepAt: 3100, comboDone: false, flash: false, ignite: false, win: 0.6, kill: 0, death: 0 };
    const out = comboTick(n.v, bot.ctx, bot.mem, new Rng(1), cc);
    expect(out.length).toBe(1);
    expect(out[0]!.cmd.t).toBe('cast');
    expect(bot.mem.ext.trade.step).toBe(1);
    // the cast made the bot busy: the next tick issues nothing
    expect(comboTick(n.v, bot.ctx, bot.mem, new Rng(1), cc)).toEqual([]);
  });
});
