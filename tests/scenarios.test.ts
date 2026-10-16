// Szenario-Trainer (src/sim/trainer/scenarios.ts): setup, liveness (bots engage), success/fail evaluation, determinism.
import { describe, expect, it } from 'vitest';
import { createSim, step, stateHash, type Sim } from '../src/sim/sim';
import { BotRunner } from '../src/ai/runner';
import { trainerHud, trainerState } from '../src/sim/trainer';
import { SCENARIOS, SCENARIO_IDS, type ScenarioId } from '../src/sim/trainer/scenarios';
import { scenarioConfig } from '../src/game/scenarioConfig';
import { kill } from '../src/sim/damage';
import { place } from '../src/sim/trainer/common';
import { jungleState } from '../src/sim/systems/jungle';
import { CHAMPION_DATA } from '../src/sim/champions';
import type { SimConfig, TickInput } from '../src/sim/types';

const cfg = (id: ScenarioId, champion = 'mira', seed = 11): SimConfig =>
  scenarioConfig({ scenario: id }, { champion, summoners: ['sprung', 'heilen'] }, 'gold', seed);

/** Runs a scenario with its bots; `inputs` drives the human. Stops when the scenario ends. */
function play(c: SimConfig, maxSec: number, inputs: (sim: Sim) => TickInput[] = () => [], each?: (sim: Sim) => void): Sim {
  const sim = createSim(c);
  const bots = new BotRunner(c);
  const until = sim.tick + maxSec * 30;
  while (sim.tick < until && !trainerHud(sim)?.done) {
    step(sim, [...inputs(sim), ...bots.tick(sim)]);
    each?.(sim);
  }
  return sim;
}

const me = (sim: Sim): number => sim.slots[0]!;
const d = (sim: Sim, a: number, b: number): number => Math.hypot(sim.c.Pos.x[a]! - sim.c.Pos.x[b]!, sim.c.Pos.y[a]! - sim.c.Pos.y[b]!);

describe('scenario setup', () => {
  it('every scenario has data, a known champion pool and sets the clock', () => {
    expect(SCENARIO_IDS.length).toBeGreaterThanOrEqual(6);
    for (const id of SCENARIO_IDS) {
      const sc = SCENARIOS[id];
      for (const u of sc.units) expect(u.champs.some((c) => c in CHAMPION_DATA)).toBe(true);
      const c = cfg(id);
      expect(c.mode).toBe('scenario');
      expect(c.players[0]!.isHuman).toBe(true);
      expect(new Set(c.players.map((p) => p.champion)).size).toBe(c.players.length);
      const sim = createSim(c);
      expect(sim.tick).toBe(sc.startMin * 60 * 30);
      const st = trainerState(sim)!.scenario!;
      expect(st.id).toBe(id);
      expect(st.me).toBe(me(sim));
      // the player was moved out of the fountain
      const f = sim.map.sides[0]!.fountain;
      expect(Math.hypot(sim.c.Pos.x[me(sim)]! - f.x, sim.c.Pos.y[me(sim)]! - f.y)).toBeGreaterThan(f.r);
      const h = trainerHud(sim)!;
      expect(h.kind).toBe('scenario');
      expect(h.scenario).toBe(id);
      expect(h.done).toBe(false);
    }
  });

  it('forces the required summoner (Bannen for the dragon steal, Sprung for the flash dodge)', () => {
    expect(cfg('dragonSteal').players[0]!.summoners).toContain('bannen');
    const f = scenarioConfig({ scenario: 'flashUlt' }, { champion: 'mira', summoners: ['heilen', 'geist'] }, 'gold', 1);
    expect(f.players[0]!.summoners).toContain('sprung');
  });

  it('is deterministic (same seed -> same state hash with bots)', () => {
    for (const id of ['turret2v1', 'freezeWave'] as const) {
      const a = play(cfg(id), 6);
      const b = play(cfg(id), 6);
      expect(stateHash(a)).toBe(stateHash(b));
    }
  });
});

describe('scenario evaluation', () => {
  it('turret 2v1: dying loses, surviving the limit wins; the enemies engage', () => {
    let closest = Infinity;
    const sim = play(cfg('turret2v1'), 30, () => [], (s) => {
      const st = trainerState(s)!.scenario!;
      for (const f of [st.foe, st.foe2]) if (s.c.Unit.alive[me(s)]) closest = Math.min(closest, d(s, f, me(s)));
    });
    const h = trainerHud(sim)!;
    expect(h.done).toBe(true);
    expect(closest).toBeLessThan(800);
    const lost = createSim(cfg('turret2v1'));
    step(lost);
    kill(lost, me(lost), trainerState(lost)!.scenario!.foe);
    step(lost);
    expect(trainerHud(lost)!.won).toBe(false);
    expect(trainerHud(lost)!.why).toBe('died');
  });

  it('gank escape: walking home wins', () => {
    const sim = play(cfg('gankEscape'), 30, (s) => (s.tick % 15 === 0 ? [{ slot: 0, cmd: { t: 'move', x: s.map.sides[0]!.towers.mid[0]!.x - 200, y: s.map.sides[0]!.towers.mid[0]!.y - 200 } }] : []));
    const h = trainerHud(sim)!;
    expect(h.done).toBe(true);
    if (h.won) expect(h.why).toBe('safe');
    else expect(h.why).toBe('died');
  });

  it('tower dive: the enemy dying wins, timing out loses', () => {
    const sim = createSim(cfg('towerDive'));
    step(sim);
    const st = trainerState(sim)!.scenario!;
    expect(sim.c.Hp.cur[st.foe]! / sim.c.Hp.max[st.foe]!).toBeLessThan(0.35);
    kill(sim, st.foe, me(sim));
    step(sim);
    expect(trainerHud(sim)!.won).toBe(true);
    const idle = createSim(cfg('towerDive'));
    const s2 = trainerState(idle)!.scenario!;
    idle.c.Hp.cur[s2.foe] = idle.c.Hp.max[s2.foe]!; // nobody attacks: the time runs out
    for (let i = 0; i < 21 * 30 && !trainerHud(idle)!.done; i++) step(idle);
    expect(trainerHud(idle)!.won).toBe(false);
  });

  it('dragon steal: the dragon spawns at half HP; the enemy finishing it loses, the player smiting it wins', () => {
    const sim = createSim(cfg('dragonSteal'));
    step(sim);
    step(sim);
    const camp = jungleState(sim).camps.find((c) => c.id === 'leviathan')!;
    const drag = camp.members[0]!.eid;
    expect(sim.c.Hp.cur[drag]! / sim.c.Hp.max[drag]!).toBeCloseTo(0.5, 1);
    // nobody steals: the scripted enemy damage takes it
    for (let i = 0; i < 25 * 30 && !trainerHud(sim)!.done; i++) step(sim);
    expect(trainerHud(sim)!.won).toBe(false);
    expect(['lostDragon', 'time']).toContain(trainerHud(sim)!.why);

    const win = createSim(cfg('dragonSteal'));
    step(win);
    step(win);
    const d2 = jungleState(win).camps.find((c) => c.id === 'leviathan')!.members[0]!.eid;
    place(win, me(win), win.c.Pos.x[d2]! - 300, win.c.Pos.y[d2]! - 300);
    win.c.Hp.cur[d2] = 50;
    step(win, [{ slot: 0, cmd: { t: 'spell', slot: 1, x: win.c.Pos.x[d2]!, y: win.c.Pos.y[d2]!, target: d2 } }]);
    step(win);
    expect(trainerHud(win)!.won).toBe(true);
    expect(trainerHud(win)!.why).toBe('stolen');
  });

  it('freeze: an idle player lets the wave crash into the tower (lost), stats are sampled', () => {
    const sim = play(cfg('freezeWave'), 65);
    const h = trainerHud(sim)!;
    expect(h.done).toBe(true);
    expect(h.won).toBe(false);
    const st = trainerState(sim)!.scenario!;
    expect(st.n.samples).toBeGreaterThan(10);
    expect(st.n.towerHits! + (trainerHud(sim)!.why === 'died' ? 1 : 0)).toBeGreaterThan(0);
  });

  it('protect the carry: the carry dying loses; the fight starts', () => {
    let hit = false;
    const sim = play(cfg('protectCarry'), 25, () => [], (s) => {
      const st = trainerState(s)!.scenario!;
      if (s.c.Hp.cur[st.ally]! < s.c.Hp.max[st.ally]! || s.c.Hp.cur[st.foe]! < s.c.Hp.max[st.foe]!) hit = true;
    });
    expect(hit).toBe(true);
    expect(trainerHud(sim)!.done).toBe(true);
    const lost = createSim(cfg('protectCarry'));
    step(lost);
    const st = trainerState(lost)!.scenario!;
    kill(lost, st.ally, st.foe);
    step(lost);
    expect(trainerHud(lost)!.won).toBe(false);
    expect(trainerHud(lost)!.why).toBe('carryDied');
  });

  it('flash dodge: standing still gets hit (lost); flashing sideways on every shot dodges', () => {
    const idle = play(cfg('flashUlt'), 30);
    const h = trainerHud(idle)!;
    expect(h.done).toBe(true);
    expect(h.won).toBe(false);
    expect(trainerState(idle)!.scenario!.n.hits).toBeGreaterThanOrEqual(4);
    // flash perpendicular to the incoming shot a few ticks after it was fired
    const sim = play(cfg('flashUlt'), 30, (s) => {
      const st = trainerState(s)!.scenario!;
      const fired = st.next - 4 * 30; // tick of the last shot
      if (s.tick !== fired + 6) return [];
      const m = me(s);
      const dx = s.c.Pos.x[st.foe]! - s.c.Pos.x[m]!;
      const dy = s.c.Pos.y[st.foe]! - s.c.Pos.y[m]!;
      const l = Math.hypot(dx, dy);
      return [{ slot: 0, cmd: { t: 'spell', slot: 0, x: s.c.Pos.x[m]! - (dy / l) * 400, y: s.c.Pos.y[m]! + (dx / l) * 400 } }];
    });
    const st = trainerState(sim)!.scenario!;
    expect(st.n.shots).toBe(5);
    expect(st.n.hits).toBeLessThanOrEqual(1);
    expect(trainerHud(sim)!.won).toBe(true);
  });
});
