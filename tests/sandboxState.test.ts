// Sandbox checkpoint (worker cheats saveState / loadState): freezeSim + thawSim give back the saved game, and the
// thawed copy keeps running exactly like the original would have.
import { describe, expect, it } from 'vitest';
import { createSim, step, stateHash } from '../src/sim/sim';
import { freezeSim, thawSim } from '../src/replay/cloneSim';
import { configFor } from '../src/game/modes';

describe('sandbox checkpoint', () => {
  it('thaw restores gold and tick, and replays identically', () => {
    const sim = createSim(configFor('sandbox'));
    for (let i = 0; i < 30; i++) step(sim, []);
    const frozen = freezeSim(sim);
    const me = sim.config.players.findIndex((p) => p.isHuman);
    step(sim, [{ slot: me, cmd: { t: 'cheat', op: 'gold', value: 5000 } }]);
    for (let i = 0; i < 29; i++) step(sim, []);
    const h = stateHash(sim);
    const back = thawSim(frozen);
    expect(back.tick).toBe(30);
    step(back, [{ slot: me, cmd: { t: 'cheat', op: 'gold', value: 5000 } }]);
    for (let i = 0; i < 29; i++) step(back, []);
    expect(stateHash(back)).toBe(h);
  });
});
