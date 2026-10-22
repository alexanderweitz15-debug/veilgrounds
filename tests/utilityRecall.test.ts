// Test 8 in full-game form (docs/BRAIN-REWORK.md §10): Diamond laners with the utility flag recall for items only
// after the wave crashed - the enemy lane minions left alive near the bot when it recalls are the minions its own
// tower / wave loses meanwhile (absence loss), <= 2 on average.
import { describe, expect, it } from 'vitest';
import { Kind } from '../src/sim/types';
import { botGameConfig } from '../src/ai/runner';
import type { DecisionLogEntry } from '../src/ai/contract';
import { INTENT_NODE } from '../src/ai/utility/select';
import { runUtilityGame } from './utilityHarness';

describe('test 8 (full game): shove-and-recall, Diamond', () => {
  it('item recalls of laners leave <= 2 enemy minions near the bot on average', () => {
    const cfg = botGameConfig(2, 'diamond');
    const recalls: { tick: number; slot: number; foes: number }[] = [];
    const g = runUtilityGame(cfg, 12 * 1800, (sim, inputs) => {
      const { Unit, Pos } = sim.c;
      for (const i of inputs) {
        if (i.cmd.t !== 'recall') continue;
        const p = cfg.players.find((q) => q.slot === i.slot)!;
        if (p.role === 'jungle' || p.role === 'support') continue;
        const eid = sim.slots[i.slot]!;
        let foes = 0;
        for (let e = 0; e < Unit.kind.length; e++) {
          const k = Unit.kind[e];
          if (!Unit.alive[e] || Unit.team[e] === p.team || (k !== Kind.MinionMelee && k !== Kind.MinionCaster && k !== Kind.MinionSiege)) continue;
          if ((Pos.x[e]! - Pos.x[eid]!) ** 2 + (Pos.y[e]! - Pos.y[eid]!) ** 2 <= 1500 * 1500) foes++;
        }
        recalls.push({ tick: sim.tick, slot: i.slot, foes });
      }
    });
    // item recalls = recall commands governed by a utility recall decision without the HP term
    const item = recalls.filter((r) => {
      let e: DecisionLogEntry | null = null;
      for (const x of g.bots.log.entries(r.slot)) {
        if (x.tick > r.tick) break;
        if (x.node === INTENT_NODE) e = x;
      }
      return !!e && e.chosen === 'recall' && (e.inputs.t_item as number) > 0 && (e.inputs.t_hp as number) === 0;
    });
    expect(item.length).toBeGreaterThan(0);
    const mean = item.reduce((a, r) => a + r.foes, 0) / item.length;
    expect(mean, JSON.stringify(item)).toBeLessThanOrEqual(2);
  }, 600_000);
});
