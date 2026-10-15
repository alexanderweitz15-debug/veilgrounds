import { describe, expect, it } from 'vitest';
import { createSim, step } from '../src/sim/sim';
import { BotRunner, classicConfig } from '../src/ai/runner';
import { kill } from '../src/sim/damage';

describe('rage pings', () => {
  it('bronze allies spam "?" when the human keeps dying; nothing with toxicity off', () => {
    const run = (toxic: boolean): number => {
      const cfg = { ...classicConfig('mira', 'adc', 'bronze', { seed: 11, summoners: ['sprung', 'heilen'], variance: 'stable' }), botToxicity: toxic };
      const sim = createSim(cfg);
      const bots = new BotRunner(cfg);
      const me = sim.slots[0]!;
      let q = 0;
      for (let t = 0; t < 30 * 200; t++) {
        if (t % (30 * 25) === 30 * 20 && sim.c.Unit.alive[me]) kill(sim, me, -1);
        step(sim, bots.tick(sim));
        q += sim.events.filter((e) => e.e === 'ping' && e.kind === 'question' && e.team === 0).length;
      }
      return q;
    };
    expect(run(true)).toBeGreaterThan(0);
    expect(run(false)).toBe(0);
  }, 120_000);
});
