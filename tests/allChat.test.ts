// S1 / FEATURE-GAP 2.8: all chat. Parser (Shift+Enter, /all), sim event + snapshot filter, enemy bot answers.
import { describe, expect, it } from 'vitest';
import { parseChat } from '../src/ui/chatCommands';
import { createSim, step } from '../src/sim/sim';
import { buildSnapshot } from '../src/sim/snapshot';
import { BotRunner, classicConfig } from '../src/ai/runner';
import type { PlayerSetup, SimEvent } from '../src/sim/types';

const P = (slot: number, team: 0 | 1, champion: string): PlayerSetup => ({ slot, team, champion, role: 'mid', summoners: ['sprung', 'heilen'], isHuman: slot === 0 });
const PLAYERS = [P(0, 0, 'mira'), P(5, 1, 'wren')];

describe('all chat parser', () => {
  it('Shift+Enter turns a plain line into an all-chat line, commands stay commands', () => {
    expect(parseChat('gg wp', PLAYERS, 0, true)).toEqual({ kind: 'all', text: 'gg wp' });
    expect(parseChat('gg wp', PLAYERS, 0)).toEqual({ kind: 'send', text: 'gg wp' });
    expect(parseChat('/all hi', PLAYERS, 0, true)).toEqual({ kind: 'all', text: 'hi' });
    expect(parseChat('/all', PLAYERS, 0)).toEqual({ kind: 'all', text: '' });
    expect(parseChat('/help', PLAYERS, 0, true)).toEqual({ kind: 'help' });
  });
});

describe('all chat in the sim', () => {
  const cfg = classicConfig('mira', 'adc', 'bronze', { seed: 5, summoners: ['sprung', 'heilen'], variance: 'stable' });

  it('team chat stays in the team, all chat reaches the enemy snapshot', () => {
    const sim = createSim(cfg);
    step(sim, [
      { slot: 0, cmd: { t: 'chat', text: 'team only' } },
      { slot: 0, cmd: { t: 'chat', text: 'to everyone', all: true } },
    ]);
    const lines = (team: number): SimEvent[] => buildSnapshot(sim, team, team === 0 ? 0 : 5).events.filter((e) => e.e === 'chat');
    expect(lines(0).map((e) => (e as { text: string }).text)).toEqual(['team only', 'to everyone']);
    expect(lines(1).map((e) => (e as { text: string }).text)).toEqual(['to everyone']);
    expect((lines(1)[0] as { all?: boolean }).all).toBe(true);
    expect((lines(1)[0] as { team: number }).team).toBe(0); // the sender's team stays on the event (UI tags it as enemy)
  });

  it('enemy bots may answer the human all chat (as all chat); team chat gets no answer from the enemy', () => {
    const run = (all: boolean): { replies: string[]; leaked: number } => {
      const sim = createSim(cfg);
      const bots = new BotRunner(cfg);
      const replies: string[] = [];
      let leaked = 0;
      for (let t = 0; t < 30 * 90; t++) {
        const human = t > 60 && t % 100 === 0 ? [{ slot: 0, cmd: { t: 'chat' as const, text: 'gl hf', ...(all ? { all: true } : {}) } }] : [];
        step(sim, [...human, ...bots.tick(sim)]);
        for (const e of sim.events) {
          if (e.e !== 'chat' || e.team !== 1) continue;
          if (e.all) replies.push(e.text);
          else if (/gl hf|hi|lol|gg|Danke|Nexus/.test(e.text)) leaked++;
        }
      }
      return { replies, leaked };
    };
    const a = run(true);
    expect(a.replies.length).toBeGreaterThan(0);
    expect(a.replies.every((r) => r.length > 0 && r.length <= 120)).toBe(true);
    // enemy bots only ever answer with all chat; without an all-chat line they say nothing in reply
    expect(run(false).replies).toEqual([]);
  }, 120_000);
});
