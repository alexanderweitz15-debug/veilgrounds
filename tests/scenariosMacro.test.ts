// Macro scenarios (FEATURE-GAP 7.3): waveCatch, baronCall, shoveRecall - setup and grading logic.
import { describe, expect, it } from 'vitest';
import { createSim, step, type Sim } from '../src/sim/sim';
import { trainerHud, trainerState } from '../src/sim/trainer';
import { BARON_CALL, SHOVE_RECALL, updateScenario, baronScore, shoveScore, waveCatchScore, type ScenarioId } from '../src/sim/trainer/scenarios';
import { scenarioConfig } from '../src/game/scenarioConfig';
import { kill } from '../src/sim/damage';
import { jungleState } from '../src/sim/systems/jungle';
import { isRevealed } from '../src/sim/buffs';
import { Kind } from '../src/sim/types';
import type { SimConfig } from '../src/sim/types';

const cfg = (id: ScenarioId, seed = 11): SimConfig => scenarioConfig({ scenario: id }, { champion: 'mira', summoners: ['sprung', 'heilen'] }, 'gold', seed);
const st = (sim: Sim) => trainerState(sim)!.scenario!;
const me = (sim: Sim): number => sim.slots[0]!;
const minionsOf = (sim: Sim, team: number): number[] => {
  const out: number[] = [];
  const { Unit } = sim.c;
  for (let e = 0; e < Unit.team.length; e++) {
    const k = Unit.kind[e]!;
    if (Unit.alive[e] === 1 && Unit.team[e] === team && k >= Kind.MinionMelee && k <= Kind.MinionSuper) out.push(e);
  }
  return out;
};
const baronOf = (sim: Sim): number => jungleState(sim).camps.find((c) => c.id === 'schleierwaechter')!.members[0]!.eid;

describe('waveCatch', () => {
  it('setup: big enemy wave at the tower, no own wave, jungler on the minimap', () => {
    const sim = createSim(cfg('waveCatch'));
    step(sim);
    expect(minionsOf(sim, 1).length).toBe(12);
    expect(minionsOf(sim, 0).length).toBe(0);
    expect(isRevealed(sim, 0, st(sim).foe)).toBe(true);
    const t = sim.map.sides[0]!.towers.mid[0]!;
    for (const m of minionsOf(sim, 1)) expect(Math.hypot(sim.c.Pos.x[m]! - t.x, sim.c.Pos.y[m]! - t.y)).toBeLessThan(1500);
  });

  it('grading: died / passive / caught / caughtRisky; score trades CS against exposure', () => {
    const run = (cs: number, exposedTicks: number, die = false) => {
      const sim = createSim(cfg('waveCatch'));
      step(sim);
      const s = st(sim);
      s.n.exposedTicks = exposedTicks;
      sim.c.Champ.cs[s.me] = s.cs0 + cs;
      if (die) kill(sim, s.me, s.foe);
      else for (const m of minionsOf(sim, 1)) kill(sim, m, -1);
      sim.tick += 30 * 5; // the wave is resolved after 4 s
      step(sim);
      return trainerHud(sim)!;
    };
    expect(run(0, 0, true).why).toBe('died');
    expect(run(2, 0).why).toBe('passive');
    const good = run(8, 0);
    expect([good.won, good.why, good.score]).toEqual([true, 'caught', 100]);
    const risky = run(4, 30 * 6);
    expect([risky.won, risky.why]).toEqual([true, 'caughtRisky']);
    expect(risky.score).toBeLessThan(good.score);
    expect(waveCatchScore(8, 0)).toBeGreaterThan(waveCatchScore(4, 0));
    expect(waveCatchScore(4, 0)).toBeGreaterThan(waveCatchScore(4, 8));
  });
});

describe('baronCall', () => {
  const fresh = () => {
    const sim = createSim(cfg('baronCall'));
    step(sim);
    step(sim);
    return { sim, s: st(sim), baron: baronOf(sim) };
  };

  it('setup: Schleierwaechter up, enemy jungler dead, 4k gold lead, enemies far away', () => {
    const { sim, s, baron } = fresh();
    expect(sim.c.Unit.alive[baron]).toBe(1);
    expect(s.allies.length).toBe(2);
    expect(s.foes.length).toBe(3);
    expect(sim.c.Unit.alive[s.foes[0]!]).toBe(0);
    expect(s.n.foeJglIn).toBeGreaterThan(20);
    expect(s.n.goldLead).toBe(BARON_CALL.goldLead);
    const pit = sim.map.objectives.schleierwaechter;
    for (const f of s.foes.slice(1)) expect(Math.hypot(sim.c.Pos.x[f]! - pit.x, sim.c.Pos.y[f]! - pit.y)).toBeGreaterThan(1800);
  });

  it('grading: clean kill, costly kill, stolen, died, time', () => {
    // sim.events is cleared by step(): evaluate right after kill() with the scenario update itself
    const eval_ = (sim: Sim): void => updateScenario(sim, st(sim));
    let { sim, s, baron } = fresh();
    kill(sim, baron, s.me);
    eval_(sim);
    expect([trainerHud(sim)!.won, trainerHud(sim)!.why]).toEqual([true, 'baronClean']);

    ({ sim, s, baron } = fresh());
    kill(sim, s.allies[0]!, s.foes[1]!);
    eval_(sim);
    expect(s.n.alliesDown).toBe(1);
    kill(sim, baron, s.me);
    eval_(sim);
    expect(trainerHud(sim)!.why).toBe('baronCost');

    ({ sim, s, baron } = fresh());
    kill(sim, baron, s.foes[1]!);
    eval_(sim);
    expect([trainerHud(sim)!.won, trainerHud(sim)!.why]).toEqual([false, 'baronStolen']);

    ({ sim, s } = fresh());
    kill(sim, s.me, s.foes[1]!);
    eval_(sim);
    expect(trainerHud(sim)!.why).toBe('died');

    ({ sim, s } = fresh());
    sim.tick = s.start + s.limit;
    eval_(sim);
    expect(trainerHud(sim)!.why).toBe('time');
  });

  it('score: faster and cleaner is higher, floor 50', () => {
    expect(baronScore(0, 2700, 0)).toBe(100);
    expect(baronScore(1350, 2700, 0)).toBeLessThan(100);
    expect(baronScore(1350, 2700, 2)).toBeLessThan(baronScore(1350, 2700, 0));
    expect(baronScore(2700, 2700, 3)).toBe(50);
  });

  it('the allies hit the Schleierwaechter', () => {
    const sim = createSim(cfg('baronCall'));
    for (let i = 0; i < 120; i++) step(sim);
    expect(st(sim).n.baronHp).toBeLessThan(100);
  });
});

describe('shoveRecall', () => {
  it('setup: both waves meet, item gold in the pocket, no enemy champion', () => {
    const sim = createSim(cfg('shoveRecall'));
    step(sim);
    expect(minionsOf(sim, 1).length).toBe(6);
    expect(minionsOf(sim, 0).length).toBe(6);
    expect(sim.c.Champ.gold[me(sim)]!).toBeGreaterThanOrEqual(SHOVE_RECALL.gold);
    expect(st(sim).foes.length).toBe(0);
  });

  it('grading: shoved / early / lostMinions / noRecall', () => {
    const run = (prep: (sim: Sim) => void, lost = 0) => {
      const sim = createSim(cfg('shoveRecall'));
      step(sim);
      prep(sim);
      step(sim, [{ slot: 0, cmd: { t: 'recall' } }]); // recall starts: the scenario snapshots the wave
      st(sim).n.lost = lost;
      sim.c.Champ.recallAt[me(sim)] = sim.tick + 1; // channel ends next tick: teleport home
      step(sim);
      step(sim);
      return trainerHud(sim)!;
    };
    const clearFoes = (sim: Sim): void => minionsOf(sim, 1).forEach((m) => kill(sim, m, me(sim)));
    const ok = run(clearFoes, 1);
    expect([ok.won, ok.why, ok.score]).toEqual([true, 'shoved', 80]);
    expect(run(clearFoes, 3).why).toBe('lostMinions');
    expect(run(() => undefined).why).toBe('early');
    expect(run((sim) => { clearFoes(sim); minionsOf(sim, 0).forEach((m) => kill(sim, m, -1)); }).why).toBe('early');
    expect(shoveScore(0)).toBe(100);
    expect(shoveScore(2)).toBe(60);
  });

  it('never recalling runs into the time limit', () => {
    const sim = createSim(cfg('shoveRecall'));
    for (let i = 0; i < 71 * 30 && !trainerHud(sim)!.done; i++) step(sim);
    expect(trainerHud(sim)!.why).toBe('noRecall');
  });
});
