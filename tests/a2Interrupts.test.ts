// A2 bug hunt (docs/BUGS.md): ability interruptions. Systematic sweep: every champion x ability, killed at several
// moments of the cast (wind-up, channel, dash, recast window); afterwards the champion must be clean.
// structuresHelpers first: it imports sim.ts before any system module (systems <-> sim import cycle).
import { newSim } from './structuresHelpers';
import { describe, expect, it } from 'vitest';
import { createSim, step, type Sim } from '../src/sim/sim';
import { CHAMPION_DATA } from '../src/sim/champions';
import { kill } from '../src/sim/damage';
import { addBuff } from '../src/sim/buffs';
import { abilityHud, armedSlot, channelOf, isBusy, isDisplacing, levelAbility } from '../src/sim/systems/abilities';
import { spawnDummy } from '../src/sim/systems/champions';
import { NO_RUNES } from './combat-helpers';

void newSim;

const CX = 6000;
const CY = 8750;

function setup(id: string): { sim: Sim; e: number; dummy: number } {
  const sim = createSim({
    seed: 9,
    mode: 'sandbox',
    minionsEnabled: false,
    players: [{ slot: 0, team: 0, champion: id, role: 'mid', summoners: ['sprung', 'heilen'], isHuman: true, runes: NO_RUNES }],
  });
  const e = sim.slots[0]!;
  sim.c.Champ.level[e] = 18;
  sim.c.Champ.skillPoints[e] = 30;
  sim.c.Pos.x[e] = sim.c.Pos.px[e] = CX;
  sim.c.Pos.y[e] = sim.c.Pos.py[e] = CY;
  for (let s = 0; s < 4; s++) for (let i = 0; i < 3; i++) levelAbility(sim, e, s);
  const dummy = spawnDummy(sim, CX + 350, CY, 1);
  step(sim);
  return { sim, e, dummy };
}

describe('death during a cast leaves nothing behind', () => {
  it('every champion x ability x moment: no busy / channel / dash / recast / empowerment after the respawn', () => {
    const bad: string[] = [];
    for (const id of Object.keys(CHAMPION_DATA)) {
      for (let slot = 0; slot < 4; slot++) {
        for (const delay of [6]) {
          const { sim, e, dummy } = setup(id);
          if (abilityHud(sim, e)[slot]!.rank === 0) continue;
          sim.c.Mana.cur[e] = sim.c.Mana.max[e]!;
          step(sim, [{ slot: 0, cmd: { t: 'cast', slot: slot as 0 | 1 | 2 | 3, x: CX + 350, y: CY, target: dummy } }]);
          for (let i = 0; i < delay; i++) step(sim);
          const tag = `${id} slot ${slot} +${delay}`;
          kill(sim, e, -1);
          step(sim);
          step(sim);
          if (isBusy(sim, e)) bad.push(`${tag}: busy while dead`);
          if (channelOf(sim, e)) bad.push(`${tag}: channel while dead`);
          if (isDisplacing(sim, e)) bad.push(`${tag}: displacing while dead`);
          let guard = 0;
          while (!sim.c.Unit.alive[e] && guard++ < 30 * 60) step(sim);
          for (let i = 0; i < 4; i++) step(sim);
          const hud = abilityHud(sim, e);
          if (isBusy(sim, e)) bad.push(`${tag}: busy after respawn`);
          if (channelOf(sim, e)) bad.push(`${tag}: channel after respawn`);
          if (armedSlot(sim, e) >= 0) bad.push(`${tag}: empowerment armed after respawn`);
          for (let s = 0; s < 4; s++) if (hud[s]!.recast) bad.push(`${tag}: recast window of slot ${s} open after respawn`);
          if (!(sim.c.Stats.ms[e]! > 0)) bad.push(`${tag}: ms ${sim.c.Stats.ms[e]} after respawn`);
          const p = { x: sim.c.Pos.x[e]!, y: sim.c.Pos.y[e]! };
          if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) bad.push(`${tag}: non-finite position`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('CC during a cast', () => {
  it('every champion x ability: a stun in the wind-up / channel / dash leaves the champion free once it ends', () => {
    const bad: string[] = [];
    for (const id of Object.keys(CHAMPION_DATA)) {
      for (let slot = 0; slot < 4; slot++) {
        for (const delay of [2, 14]) {
          const { sim, e, dummy } = setup(id);
          if (abilityHud(sim, e)[slot]!.rank === 0) continue;
          sim.c.Mana.cur[e] = sim.c.Mana.max[e]!;
          step(sim, [{ slot: 0, cmd: { t: 'cast', slot: slot as 0 | 1 | 2 | 3, x: CX + 350, y: CY, target: dummy } }]);
          for (let i = 0; i < delay; i++) step(sim);
          const tag = `${id} slot ${slot} +${delay}`;
          addBuff(sim, e, { kind: 'stun', id: 'sweep', src: -1, ticks: 45 });
          for (let i = 0; i < 3; i++) step(sim);
          if (channelOf(sim, e) && delay >= 2) bad.push(`${tag}: channel survives a stun`);
          for (let i = 0; i < 150; i++) step(sim);
          if (isBusy(sim, e)) bad.push(`${tag}: still busy 3 s after the stun`);
          if (!(sim.c.Stats.ms[e]! > 0)) bad.push(`${tag}: ms ${sim.c.Stats.ms[e]} 3 s after the stun`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
