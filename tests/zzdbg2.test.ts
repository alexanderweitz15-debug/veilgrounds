import { it } from 'vitest';
import { createSim, step } from '../src/sim/sim';
import { trainerHud, trainerState } from '../src/sim/trainer';
import { scenarioConfig } from '../src/game/scenarioConfig';

it('dbg shove', () => {
  const c = scenarioConfig({ scenario: 'shoveRecall' }, { champion: 'mira', summoners: ['sprung', 'heilen'] }, 'gold', 11);
  const sim = createSim(c);
  const s = trainerState(sim)!.scenario!;
  const et = sim.map.sides[1]!.towers.mid[0]!;
  const ht = sim.map.sides[0]!.towers.mid[0]!;
  let recallAt = -1;
  while (!trainerHud(sim)!.done && sim.tick < 8 * 60 * 30 + 70 * 30) {
    const inp = [] as any[];
    const t = (sim.tick - s.start) / 30;
    if (recallAt < 0 && s.n.foeMinions! <= 2 && s.n.ownMinions! >= 3 && t > 5) {
      // walk back out of tower range first
      const px = sim.c.Pos.x[s.me]!, py = sim.c.Pos.y[s.me]!;
      const d = Math.hypot(px - et.x, py - et.y);
      if (d < 900) inp.push({ slot: 0, cmd: { t: 'move', x: et.x + (ht.x - et.x) * 0.5, y: et.y + (ht.y - et.y) * 0.5 } });
      else {
        inp.push({ slot: 0, cmd: { t: 'recall' } });
        recallAt = sim.tick;
      }
    } else if (recallAt < 0 && sim.tick % 15 === 0) {
      inp.push({ slot: 0, cmd: { t: 'attackMove', x: et.x, y: et.y } });
    }
    step(sim, inp);
    if (sim.tick % 150 === 0) console.log(t.toFixed(0), JSON.stringify(s.n));
  }
  console.log('shove', JSON.stringify(trainerHud(sim)), JSON.stringify(s.n), 'recallAt', (recallAt - s.start) / 30);
});
