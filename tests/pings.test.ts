import { describe, expect, it } from 'vitest';
import { createSim, step } from '../src/sim/sim';
import { buildSnapshot } from '../src/sim/snapshot';

const cfg = () => createSim({ seed: 4, mode: 'sandbox', minionsEnabled: false, players: [
  { slot: 0, team: 0, champion: 'mira', role: 'adc', summoners: ['sprung', 'heilen'], isHuman: true },
  { slot: 5, team: 1, champion: 'brom', role: 'top', summoners: ['sprung', 'entflammen'], isHuman: false },
] });

describe('pings', () => {
  it('team-only, rate-limited, targets only when visible', () => {
    const sim = cfg();
    step(sim);
    const red = sim.slots[5]!;
    // red champion is far away (red fountain) -> a focus ping on it must drop the target
    step(sim, [{ slot: 0, cmd: { t: 'ping', kind: 'focus', x: 8000, y: 8000, target: red } }]);
    const blue = buildSnapshot(sim, 0, 0).events.filter((e) => e.e === 'ping');
    const redView = buildSnapshot(sim, 1, 5).events.filter((e) => e.e === 'ping');
    expect(blue.length).toBe(1);
    expect(redView.length).toBe(0);
    expect(blue[0]!.e === 'ping' && blue[0]!.target).toBe(-1);
    // rate limit: 10 pings in one tick -> at most 6 delivered within the window
    let n = 0;
    for (let i = 0; i < 10; i++) {
      step(sim, [{ slot: 0, cmd: { t: 'ping', kind: 'danger', x: 1000 + i, y: 1000 } }]);
      n += sim.events.filter((e) => e.e === 'ping').length;
    }
    expect(n).toBe(5); // 1 earlier + 5 more = 6 per 4 s
  });
});
