// Phase 5 trainers (src/sim/trainer): last-hit, dodge, kiting/combo, duels, arena, sandbox cheats, determinism.
import { describe, expect, it } from 'vitest';
import { query } from 'bitecs';
import { createSim, step, stateHash, type Sim } from '../src/sim/sim';
import { Recorder, playReplay } from '../src/replay/replay';
import { Rng } from '../src/sim/rng';
import { Kind, Lane, isMinion, type Command, type PlayerSetup, type SimConfig, type TickInput } from '../src/sim/types';
import { trainerHud, trainerState } from '../src/sim/trainer';
import { dodgeInterval } from '../src/sim/trainer/dodge';
import { updateDuel } from '../src/sim/trainer/duel';
import { kill } from '../src/sim/damage';
import { dealDamage } from '../src/sim/damage';
import { jungleState } from '../src/sim/systems/jungle';
import { buildSnapshot } from '../src/sim/snapshot';
import { cooldownLeft } from '../src/sim/systems/abilities';
import { inventory } from '../src/sim/items/inventory';

const human = (champion = 'mira', role: PlayerSetup['role'] = 'mid'): PlayerSetup => ({ slot: 0, team: 0, champion, role, summoners: ['sprung', 'heilen'], isHuman: true });
const dummyPlayer = (slot: number, team: 0 | 1, champion: string): PlayerSetup => ({ slot, team, champion, role: 'mid', summoners: ['sprung', 'heilen'], isHuman: false });

const run = (sim: Sim, ticks: number, inputs: (sim: Sim) => TickInput[] = () => []): void => {
  for (let i = 0; i < ticks; i++) step(sim, inputs(sim));
};

/** Scripted last-hitter: attacks the lowest enemy minion near the champion once it is in one-auto range. */
function lastHitter(sim: Sim): TickInput[] {
  const me = sim.slots[0]!;
  const { Unit, Hp, Pos, Stats, Atk } = sim.c;
  if (Atk.target[me]! >= 0 && Unit.alive[Atk.target[me]!]) return [];
  let best = -1;
  for (const e of query(sim.world, [Unit])) {
    if (!Unit.alive[e] || !isMinion(Unit.kind[e]!) || Unit.team[e] === 0) continue;
    const d2 = (Pos.x[e]! - Pos.x[me]!) ** 2 + (Pos.y[e]! - Pos.y[me]!) ** 2;
    if (d2 > 900 * 900 || Hp.cur[e]! > Stats.ad[me]! * 1.1) continue;
    if (best < 0 || Hp.cur[e]! < Hp.cur[best]!) best = e;
  }
  if (best >= 0) return [{ slot: 0, cmd: { t: 'attack', target: best } }];
  // idle: stand in the middle of the lane, near the wave clash
  return sim.tick % 30 === 0 ? [{ slot: 0, cmd: { t: 'move', x: 7500, y: 7500 } }] : [];
}

describe('last-hit trainer', () => {
  const cfg = (tower = false): SimConfig => ({ seed: 5, mode: 'lastHit', players: [human()], minionLanes: [Lane.Mid], ...(tower ? { minionTeams: [1] } : {}), trainer: { durationSec: 90, tower } });

  it('counts CS and missed CS, ends after the duration', () => {
    const sim = createSim(cfg());
    run(sim, 30 * 95, lastHitter);
    const h = trainerHud(sim)!;
    expect(h.kind).toBe('lastHit');
    expect(h.done).toBe(true);
    expect(h.time).toBeCloseTo(90, 0);
    const st = trainerState(sim)!.lastHit!;
    expect(st.cs).toBeGreaterThan(0);
    expect(st.cs).toBe(sim.c.Champ.cs[sim.slots[0]!]);
    expect(st.cs + st.missed).toBeGreaterThan(st.cs);
    expect(h.score).toBe(Math.round((st.cs / (st.cs + st.missed)) * 100));
    expect(st.csGold).toBeGreaterThan(0);
  });

  it('tower mode: enemy waves only, structures invulnerable', () => {
    const sim = createSim(cfg(true));
    run(sim, 30 * 40);
    expect(sim.flags.towersInvulnerable).toBe(true);
    const { Unit } = sim.c;
    const minions = [...query(sim.world, [Unit])].filter((e) => Unit.alive[e] && isMinion(Unit.kind[e]!));
    expect(minions.length).toBeGreaterThan(0);
    expect(minions.every((e) => Unit.team[e] === 1)).toBe(true);
  });
});

describe('dodge trainer', () => {
  const cfg = (difficulty: 1 | 2 | 3 = 2, lives = 5): SimConfig => ({ seed: 9, mode: 'dodge', players: [human()], minionsEnabled: false, trainer: { difficulty, lives } });

  it('spawn interval shrinks over time and with difficulty', () => {
    expect(dodgeInterval(2, 60)).toBeLessThan(dodgeInterval(2, 0));
    expect(dodgeInterval(3, 0)).toBeLessThan(dodgeInterval(1, 0));
    expect(dodgeInterval(3, 1000)).toBeGreaterThan(0);
  });

  it('a standing player gets hit until the lives are gone; never dies', () => {
    const sim = createSim(cfg(2, 30));
    const me = sim.slots[0]!;
    let projSeen = 0;
    let zones = 0;
    for (let i = 0; i < 30 * 120 && !trainerHud(sim)!.done; i++) {
      step(sim);
      projSeen = Math.max(projSeen, buildSnapshot(sim, 0, 0).projectiles.length);
      zones += sim.events.filter((e) => e.e === 'zone').length;
      expect(sim.c.Unit.alive[me]).toBe(1);
    }
    const h = trainerHud(sim)!;
    expect(h.done).toBe(true);
    expect(trainerState(sim)!.dodge!.hits).toBe(30);
    expect(projSeen).toBeGreaterThan(0); // shots are visible to the player (telegraph strip)
    expect(zones).toBeGreaterThan(0);
    expect(h.score).toBeGreaterThan(0);
  });

  it('a moving player survives longer than a standing one (easy)', () => {
    const still = createSim(cfg(1));
    const moving = createSim(cfg(1));
    const zig = (sim: Sim): TickInput[] => {
      if (sim.tick % 20 !== 0) return [];
      const r = new Rng(sim.tick);
      return [{ slot: 0, cmd: { t: 'move', x: 2000 + r.range(-500, 500), y: 14000 + r.range(-500, 500) } }];
    };
    run(still, 30 * 60);
    run(moving, 30 * 60, zig);
    expect(trainerState(moving)!.dodge!.hits).toBeLessThanOrEqual(trainerState(still)!.dodge!.hits);
  });
});

describe('kiting / combo trainer', () => {
  it('chasing dummy closes in and touches a standing player', () => {
    const sim = createSim({ seed: 3, mode: 'kite', players: [human()], minionsEnabled: false, trainer: { dummy: 'chase', durationSec: 30 } });
    run(sim, 30 * 10);
    expect(trainerState(sim)!.kite!.touches).toBeGreaterThan(0);
    expect(sim.c.Unit.alive[sim.slots[0]!]).toBe(1);
  });

  it('measures auto uptime, DPS and combo time against a standing dummy', () => {
    const sim = createSim({ seed: 3, mode: 'kite', players: [human()], minionsEnabled: false, trainer: { dummy: 'stand', durationSec: 20, level: 6 } });
    const st = trainerState(sim)!.kite!;
    const me = sim.slots[0]!;
    expect(sim.c.Champ.level[me]).toBe(6);
    const d = st.dummy;
    const { Pos } = sim.c;
    run(sim, 30 * 8, () => [{ slot: 0, cmd: { t: 'attack', target: d } }]);
    const h1 = trainerHud(sim)!;
    const uptime = h1.stats.find((s) => s.k === 'uptime')!.v;
    expect(st.attacks).toBeGreaterThan(3);
    expect(uptime).toBeGreaterThan(60);
    expect(h1.stats.find((s) => s.k === 'dps')!.v).toBeGreaterThan(0);
    // combo: cast every learned ability at the dummy, one per few ticks
    let k = 0;
    run(sim, 30 * 6, (s) => (s.tick % 10 === 0 && k < 4 ? [{ slot: 0, cmd: { t: 'cast', slot: k++ as 0 | 1 | 2 | 3, x: Pos.x[d]!, y: Pos.y[d]!, target: d } }] : []));
    expect(st.combos).toBeGreaterThanOrEqual(1);
    expect(st.comboBest).toBeGreaterThan(0);
    run(sim, 30 * 10);
    expect(trainerHud(sim)!.done).toBe(true);
  });
});

describe('duels', () => {
  it('lane duel ends at the first kill and reports the winner', () => {
    const sim = createSim({ seed: 2, mode: 'laneDuel', players: [human(), dummyPlayer(5, 1, 'lysa')], minionLanes: [Lane.Mid], trainer: { kills: 1, cs: 100 } });
    run(sim, 10);
    const st = trainerState(sim)!.duel!;
    kill(sim, sim.slots[5]!, sim.slots[0]!);
    updateDuel(sim, st);
    const h = trainerHud(sim)!;
    expect(h.done).toBe(true);
    expect(h.won).toBe(true);
    expect(h.stats.find((s) => s.k === 'killsMe')!.v).toBe(1);
  });

  it('jungle duel: side camps spawn after 3 s, monster kills score points', () => {
    const sim = createSim({ seed: 2, mode: 'jungleDuel', minionsEnabled: false, players: [human('mira', 'jungle'), dummyPlayer(5, 1, 'lysa')], trainer: { durationSec: 30 } });
    run(sim, 30 * 4);
    const up = jungleState(sim).camps.filter((c) => c.side <= 1 && c.spawnAt < 0);
    expect(up.length).toBeGreaterThan(4);
    const crab = up.find((c) => c.id === 'schattenkrabbe')!;
    kill(sim, crab.members[0]!.eid, sim.slots[0]!);
    const st = trainerState(sim)!.duel!;
    updateDuel(sim, st); // kill() outside step(): events are cleared by the next step
    expect(st.monsters[0]).toBe(1);
    expect(st.crabs[0]).toBe(1);
    run(sim, 30 * 30);
    const h = trainerHud(sim)!;
    expect(h.done).toBe(true);
    expect(h.won).toBe(true);
  });
});

describe('teamfight arena', () => {
  it('preset level/items, wipe scores a round, next round revives everyone', () => {
    const players = [human(), dummyPlayer(1, 0, 'brom'), dummyPlayer(5, 1, 'lysa'), dummyPlayer(6, 1, 'tobin')];
    const sim = createSim({ seed: 4, mode: 'arena', minionsEnabled: false, players, trainer: { level: 11, rounds: 2, roundSec: 30, items: { '0': ['stiefel_schnelligkeit'] } } });
    const me = sim.slots[0]!;
    expect(sim.c.Champ.level[me]).toBe(11);
    expect(inventory(sim, me)).toContain('stiefel_schnelligkeit');
    run(sim, 5);
    kill(sim, sim.slots[5]!, me);
    kill(sim, sim.slots[6]!, me);
    run(sim, 2);
    const st = trainerState(sim)!.arena!;
    expect(st.score).toEqual([1, 0]);
    expect(st.phase).toBe('pause');
    run(sim, 30 * 4);
    expect(st.round).toBe(2);
    expect(sim.c.Unit.alive[sim.slots[5]!]).toBe(1);
    // round 2 times out: blue keeps more HP after red takes damage
    dealDamage(sim, me, sim.slots[5]!, 300, 'true');
    run(sim, 30 * 31);
    expect(trainerHud(sim)!.done).toBe(true);
    expect(trainerHud(sim)!.won).toBe(true);
  });
});

describe('sandbox cheats', () => {
  const sandbox = (): Sim => createSim({ seed: 1, mode: 'sandbox', minionsEnabled: false, players: [human()] });
  const cheat = (op: Extract<Command, { t: 'cheat' }>['op'], value?: number): TickInput[] => [{ slot: 0, cmd: { t: 'cheat', op, ...(value !== undefined ? { value } : {}) } }];

  it('set level, god mode, permanent cooldown reset, camps now', () => {
    const sim = sandbox();
    const me = sim.slots[0]!;
    step(sim, cheat('setLevel', 9));
    expect(sim.c.Champ.level[me]).toBe(9);
    step(sim, cheat('godMode'));
    dealDamage(sim, -1, me, 1e6, 'true');
    step(sim);
    expect(sim.c.Unit.alive[me]).toBe(1);
    step(sim, [{ slot: 0, cmd: { t: 'levelUp', slot: 0 } }]);
    step(sim, cheat('noCooldowns'));
    step(sim, [{ slot: 0, cmd: { t: 'cast', slot: 0, x: 3000, y: 3000 } }]);
    run(sim, 20);
    expect(cooldownLeft(sim, me, 0)).toBe(0);
    expect(buildSnapshot(sim, 0, 0).me!.sandbox).toEqual({ noCd: true, god: true });
    step(sim, cheat('respawnCamps'));
    run(sim, 2);
    // every camp is up except the Schleierwaechter: it shares the pit with the Kesselbrut (only one at a time)
    const camps = jungleState(sim).camps;
    expect(camps.filter((c) => c.id !== 'schleierwaechter').every((c) => c.spawnAt < 0)).toBe(true);
    expect(camps.find((c) => c.id === 'schleierwaechter')!.spawnAt).toBeGreaterThan(sim.tick);
    expect(camps.find((c) => c.id === 'kesselbrut')!.spawnAt).toBe(-1);
  });

  it('scored trainers ignore cheats', () => {
    const sim = createSim({ seed: 1, mode: 'lastHit', players: [human()], minionLanes: [Lane.Mid] });
    step(sim, cheat('setLevel', 9));
    expect(sim.c.Champ.level[sim.slots[0]!]).toBe(1);
  });

  it('classic / sandbox games get no trainer state', () => {
    const sim = sandbox();
    run(sim, 3);
    expect(trainerState(sim)).toBeUndefined();
    expect(buildSnapshot(sim, 0, 0).trainer).toBeUndefined();
  });
});

describe('trainer determinism', () => {
  const configs: SimConfig[] = [
    { seed: 11, mode: 'lastHit', players: [human()], minionLanes: [Lane.Mid], trainer: { durationSec: 60 } },
    { seed: 12, mode: 'dodge', players: [human()], minionsEnabled: false, trainer: { difficulty: 3 } },
    { seed: 13, mode: 'kite', players: [human()], minionsEnabled: false, trainer: { dummy: 'strafe' } },
    { seed: 14, mode: 'arena', minionsEnabled: false, players: [human(), dummyPlayer(5, 1, 'lysa')], trainer: { level: 9 } },
  ];
  const inputs = (seed: number, tick: number): TickInput[] => {
    const r = new Rng(seed * 31 + tick);
    if (!r.chance(0.1)) return [];
    const x = r.range(1000, 9000);
    const y = r.range(7000, 15000);
    const cmds: Command[] = [{ t: 'move', x, y }, { t: 'attackMove', x, y }, { t: 'cast', slot: r.int(4) as 0 | 1 | 2 | 3, x, y }];
    return [{ slot: 0, cmd: cmds[r.int(cmds.length)]! }];
  };
  for (const cfg of configs) {
    it(`${cfg.mode}: replay reproduces the state hash`, () => {
      const sim = createSim(structuredClone(cfg));
      const rec = new Recorder(structuredClone(cfg));
      while (sim.tick < 30 * 40) {
        const i = inputs(cfg.seed, sim.tick);
        rec.record(sim.tick, i);
        step(sim, i);
      }
      const r = rec.finish(sim);
      expect(stateHash(playReplay(r))).toBe(r.hash);
      expect(Kind.Champion).toBe(1);
    });
  }
});
