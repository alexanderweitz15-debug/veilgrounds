import { it } from 'vitest';
import { createSim, step } from '../src/sim/sim';
import { BotRunner } from '../src/ai/runner';
import { trainerHud, trainerState } from '../src/sim/trainer';
import { scenarioConfig } from '../src/game/scenarioConfig';

it('dbg waveCatch', () => {
  for (const mode of ['idle', 'attackMove']) {
    const c = scenarioConfig({ scenario: 'waveCatch' }, { champion: 'mira', summoners: ['sprung', 'heilen'] }, 'gold', 11);
    const sim = createSim(c);
    const bots = new BotRunner(c);
    const t = sim.map.sides[0]!.towers.mid[0]!;
    while (!trainerHud(sim)!.done && sim.tick < 40 * 30 + 8 * 60 * 30) {
      const inp = mode === 'attackMove' && sim.tick % 10 === 0 ? [{ slot: 0, cmd: { t: 'attackMove' as const, x: t.x + 300, y: t.y + 300 } }] : [];
      step(sim, [...inp, ...bots.tick(sim)]);
    }
    console.log(mode, JSON.stringify(trainerHud(sim)), JSON.stringify(trainerState(sim)!.scenario!.n));
  }
});

it('dbg baron', () => {
  const c = scenarioConfig({ scenario: 'baronCall' }, { champion: 'mira', summoners: ['sprung', 'heilen'] }, 'gold', 11);
  const sim = createSim(c);
  const bots = new BotRunner(c);
  const s = trainerState(sim)!.scenario!;
  let t0 = sim.tick;
  while (!trainerHud(sim)!.done && sim.tick < t0 + 95 * 30 && true) {
    const b = (sim.tick % 15 === 0 && s.obj >= 0) ? [{ slot: 0, cmd: { t: 'attack' as const, target: s.obj } }] : [];
    step(sim, [...b, ...bots.tick(sim)]);
  }
  console.log('baron idle', JSON.stringify(trainerHud(sim)), JSON.stringify(s.n), (sim.tick - t0) / 30);
});
