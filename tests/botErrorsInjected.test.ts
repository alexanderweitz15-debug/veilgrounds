// Spec-bots §6 named errors that need a game situation: ignore_minion_aggro (Iron-Silver), chase_third_kill (Gold),
// overcommit_after_kill (Iron). Each is injected at its rank rate (data/bots/errors.json) and logged as injectedError.
import { describe, expect, it } from 'vitest';
import { ScriptedBot, champEnt, eidOf, hud, minion, MAP, paramsFor, PLAYERS, snapshot } from './botScenario';
import { laneLeaf } from '../src/ai/bot/brain';
import { tradeRun } from '../src/ai/bot/trade';
import { TeamAI } from '../src/ai/bot/teamai';
import type { Rank } from '../src/ai/profiles/schema';
import type { DecisionLogEntry } from '../src/ai/contract';

const TRIALS = 200;

function bot(rank: Rank, slot: number, seed: number): ScriptedBot {
  const b = new ScriptedBot(slot, paramsFor(rank, {}, slot), seed);
  const log: DecisionLogEntry[] = [];
  (b.ctx as { teamAI: TeamAI }).teamAI = new TeamAI(PLAYERS[slot]!.team as 0 | 1, MAP, PLAYERS, seed, { push: (e) => void log.push(e), entries: () => log });
  return b;
}

/** The enemy is already noticed (reaction delay passed). */
const notice = (b: ScriptedBot, slot: number, x: number, y: number, tick: number): void => void b.mem.aware.set(eidOf(slot), { from: 0, lastSeen: tick, x, y });

const errs = (b: ScriptedBot, id: string): number => b.log.filter((e) => e.injectedError === id).length;

describe('ignore_minion_aggro: auto-attacks the enemy champion inside the enemy wave', () => {
  const rate = (rank: Rank): number => {
    let hits = 0;
    for (let i = 0; i < TRIALS; i++) {
      const b = bot(rank, 0, 1000 + i);
      const tick = 4 * 60 * 30;
      // mid of the top lane, three enemy minions around the bot, enemy top laner in auto range
      const p = MAP.sides[0].lanes.top[1]!;
      const ents = [champEnt(0, p.x, p.y), champEnt(5, p.x + 120, p.y + 60), minion(1, p.x + 150, p.y - 100), minion(1, p.x - 120, p.y + 140), minion(1, p.x + 60, p.y + 200)];
      notice(b, 5, p.x + 120, p.y + 60, tick);
      const n = b.node(snapshot({ tick, team: 0, entities: ents, me: hud(0) }));
      laneLeaf(n);
      const hit = n.out.some((a) => a.cmd.t === 'attack' && a.cmd.target === eidOf(5));
      if (hit) {
        hits++;
        expect(errs(b, 'ignore_minion_aggro')).toBe(1);
      }
    }
    return hits / TRIALS;
  };
  it('Iron about 60 %, Silver about 30 %, Gold never', () => {
    expect(rate('iron')).toBeGreaterThan(0.45);
    expect(rate('iron')).toBeLessThan(0.75);
    expect(rate('silver')).toBeGreaterThan(0.18);
    expect(rate('silver')).toBeLessThan(0.42);
    expect(rate('gold')).toBe(0);
  });
});

describe('chase_third_kill / overcommit_after_kill after kills', () => {
  const tick = 10 * 60 * 30;
  const p = MAP.sides[0].lanes.mid[1]!;

  it('chase_third_kill: Gold chases a vanished target into the fog after two kills (~40 %), Diamond never', () => {
    const rate = (rank: Rank): number => {
      let n0 = 0;
      for (let i = 0; i < TRIALS; i++) {
        const b = bot(rank, 2, 2000 + i);
        b.mem.ext.killStreak = 2;
        b.mem.ext.lastKillAt = tick - 60;
        b.mem.ext.trade = { serial: eidOf(7), id: eidOf(7), kind: 'allin', start: tick - 90, trigger: 'low_hp', combo: ['AA'], step: 0, stepAt: tick, comboDone: false, flash: false, ignite: false, win: 0.7 };
        b.mem.aware.set(eidOf(7), { from: 0, lastSeen: tick - 10, x: p.x + 600, y: p.y + 600 });
        // own HP 30 %: the normal fog chase (needs > 40 % HP) does not happen, only the injected error
        const me = champEnt(2, p.x, p.y);
        me.hp = me.maxHp * 0.3;
        const n = b.node(snapshot({ tick, team: 0, entities: [me], me: hud(2) }));
        tradeRun(n);
        if (errs(b, 'chase_third_kill')) {
          n0++;
          expect(n.out.some((a) => a.cmd.t === 'move')).toBe(true);
        }
      }
      return n0 / TRIALS;
    };
    const gold = rate('gold');
    expect(gold).toBeGreaterThan(0.28);
    expect(gold).toBeLessThan(0.52);
    expect(rate('diamond')).toBe(0);
  });

  it('overcommit_after_kill: Iron keeps diving the tower after a kill (~50 %), Gold ends the all-in', () => {
    const enemyTower = MAP.sides[1].towers.mid[0]!;
    const rate = (rank: Rank): number => {
      let n0 = 0;
      for (let i = 0; i < TRIALS; i++) {
        const b = bot(rank, 2, 3000 + i);
        b.mem.ext.killStreak = 1;
        b.mem.ext.lastKillAt = tick - 30;
        b.mem.ext.trade = { serial: eidOf(7), id: eidOf(7), kind: 'allin', start: tick - 60, trigger: 'low_hp', combo: ['AA'], step: 0, stepAt: tick, comboDone: false, flash: false, ignite: false, win: 0.7 };
        const t = champEnt(7, enemyTower.x - 150, enemyTower.y - 150);
        t.hp = t.maxHp * 0.8;
        notice(b, 7, t.x, t.y, tick);
        const me = champEnt(2, enemyTower.x - 500, enemyTower.y - 500);
        me.hp = me.maxHp * 0.2;
        const n = b.node(snapshot({ tick, team: 0, entities: [me, t], me: hud(2) }));
        const r = tradeRun(n);
        if (errs(b, 'overcommit_after_kill')) {
          n0++;
          expect(r).toBe('running');
          expect(b.mem.ext.trade).not.toBeNull();
        }
      }
      return n0 / TRIALS;
    };
    const iron = rate('iron');
    expect(iron).toBeGreaterThan(0.35);
    expect(iron).toBeLessThan(0.65);
    expect(rate('gold')).toBe(0);
  });

});
