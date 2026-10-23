// S1 / FEATURE-GAP 2.10: surrender vote. Sim rules (src/sim/surrender.ts), bot voting rule (social.ts), client fold.
import { describe, expect, it } from 'vitest';
import { createSim, step, type Sim } from '../src/sim/sim';
import { votesNeeded, SURRENDER } from '../src/sim/surrender';
import { buildSnapshot } from '../src/sim/snapshot';
import { BotRunner, classicConfig } from '../src/ai/runner';
import { surrenderScore, votesYes, type FfFeatures } from '../src/ai/bot/social';
import { ffReduce, ffSecondsLeft, myVote } from '../src/game/surrender';
import type { Command, SimEvent } from '../src/sim/types';

const MIN = 30 * 60;
const cfg = classicConfig('mira', 'adc', 'gold', { seed: 3, summoners: ['sprung', 'heilen'], variance: 'stable' });
type Ff = Extract<SimEvent, { e: 'ff' }>;

/** Steps one tick with the given commands (slot -> cmd) and returns this tick's ff events. */
function tick(sim: Sim, ...cmds: [number, Command][]): Ff[] {
  step(sim, cmds.map(([slot, cmd]) => ({ slot, cmd })));
  return sim.events.filter((e): e is Ff => e.e === 'ff');
}
const team0 = cfg.players.filter((p) => p.team === 0).map((p) => p.slot);
const yes = (slot: number): [number, Command] => [slot, { t: 'ffVote', yes: true }];
const no = (slot: number): [number, Command] => [slot, { t: 'ffVote', yes: false }];

describe('votes needed', () => {
  it('all voters before 20:00, 4 of 5 afterwards, a lone voter decides', () => {
    expect(votesNeeded(5, 15 * 60)).toBe(5);
    expect(votesNeeded(5, 19 * 60 + 59)).toBe(5);
    expect(votesNeeded(5, 20 * 60)).toBe(4);
    expect(votesNeeded(1, 16 * 60)).toBe(1);
    expect(votesNeeded(3, 25 * 60)).toBe(3);
  });
});

describe('surrender vote in the sim', () => {
  it('is refused before 15:00 and in other modes, only humans can start it', () => {
    const sim = createSim(cfg);
    expect(tick(sim, [0, { t: 'ff' }]).map((e) => [e.phase, e.reason])).toEqual([['denied', 'early']]);
    sim.tick = 16 * MIN;
    expect(tick(sim, [1, { t: 'ff' }])).toEqual([]); // a bot cannot start one
    const arena = createSim({ ...cfg, mode: 'laneOnly' });
    arena.tick = 16 * MIN;
    expect(tick(arena, [0, { t: 'ff' }]).map((e) => e.reason)).toEqual(['mode']);
  });

  it('15-20 min: all five must agree; one no fails, then a 3 minute pause', () => {
    const sim = createSim(cfg);
    sim.tick = 16 * MIN;
    const [s] = tick(sim, [0, { t: 'ff' }]);
    expect(s).toMatchObject({ phase: 'start', need: 5, yes: [0], team: 0 });
    tick(sim, yes(team0[1]!), yes(team0[2]!));
    tick(sim, yes(team0[3]!));
    const r = tick(sim, no(team0[4]!));
    expect(r.map((e) => e.phase)).toEqual(['vote', 'fail']);
    expect(sim.state.winner).toBeUndefined();
    expect(tick(sim, [0, { t: 'ff' }]).map((e) => e.reason)).toEqual(['cooldown']);
    sim.tick += SURRENDER.cooldownS * 30;
    expect(tick(sim, [0, { t: 'ff' }])[0]!.phase).toBe('start');
  });

  it('after 20 min four yes votes end the game as a loss for the surrendering team', () => {
    const sim = createSim(cfg);
    sim.tick = 21 * MIN;
    expect(tick(sim, [0, { t: 'ff' }])[0]).toMatchObject({ need: 4 });
    expect(tick(sim, yes(team0[1]!), yes(team0[2]!)).map((e) => e.phase)).toEqual(['vote', 'vote']);
    const out = tick(sim, yes(team0[3]!));
    expect(out.map((e) => e.phase)).toEqual(['vote', 'pass']);
    expect(sim.state.winner).toBe(1);
    expect(sim.events.some((e) => e.e === 'gameOver' && e.winner === 1)).toBe(true);
  });

  it('times out after voteS: missing votes count as no; double votes are ignored', () => {
    const sim = createSim(cfg);
    sim.tick = 21 * MIN;
    tick(sim, [0, { t: 'ff' }]);
    tick(sim, yes(team0[1]!), yes(team0[1]!), no(team0[1]!));
    expect(ffOf(sim)).toBe(0); // vote still open
    let last: Ff[] = [];
    for (let i = 0; i < SURRENDER.voteS * 30 + 2 && !last.length; i++) last = tick(sim);
    expect(last.map((e) => e.phase)).toEqual(['fail']);
    expect(last[0]).toMatchObject({ yes: [0, team0[1]!], no: [] });
  });

  it('the opposing team does not see the vote (team-private events)', () => {
    const sim = createSim(cfg);
    sim.tick = 21 * MIN;
    tick(sim, [0, { t: 'ff' }]);
    const enemy = cfg.players.find((p) => p.team === 1)!.slot;
    expect(buildSnapshot(sim, 1, enemy).events.some((e) => e.e === 'ff')).toBe(false);
    expect(buildSnapshot(sim, 0, 0).events.some((e) => e.e === 'ff')).toBe(true);
  });

  it('bots answer a started vote with their own ffVote command', () => {
    const sim = createSim(cfg);
    const bots = new BotRunner(cfg);
    sim.tick = 16 * MIN;
    const votes: Ff[] = [];
    step(sim, [{ slot: 0, cmd: { t: 'ff' } }, ...bots.tick(sim)]);
    for (let i = 0; i < 40 * 30; i++) {
      step(sim, bots.tick(sim));
      votes.push(...sim.events.filter((e): e is Ff => e.e === 'ff'));
    }
    // equal teams: the first bot votes no; at 16:00 all five must agree, so the vote fails at once
    const cast = votes.filter((e) => e.phase === 'vote');
    expect(cast.length).toBeGreaterThanOrEqual(1);
    expect(cast[0]!.no).toContain(cast[0]!.slot);
    expect(cast[0]!.slot).not.toBe(0);
    expect(votes.some((e) => e.phase === 'fail')).toBe(true);
    expect(sim.state.winner).toBeUndefined();
  }, 120_000);
});

function ffOf(sim: Sim): number {
  return (sim.state.winner as number | undefined) ?? 0;
}

describe('bot vote rule', () => {
  const even: FfFeatures = { goldDeficit: 0, killDeficit: 0, towerDeficit: 0, tilt: 0 };
  const hopeless: FfFeatures = { goldDeficit: 9000, killDeficit: 14, towerDeficit: 5, tilt: 0 };

  it('even game: nobody votes yes; hopeless game: everybody does', () => {
    for (const r of ['iron', 'gold', 'challenger'] as const) {
      expect(votesYes(even, r)).toBe(false);
      expect(votesYes(hopeless, r)).toBe(true);
    }
  });

  it('low ranks give up earlier than high ranks; tilt tips borderline games', () => {
    const behind: FfFeatures = { goldDeficit: 5000, killDeficit: 6, towerDeficit: 1, tilt: 0 };
    expect(surrenderScore(behind)).toBeGreaterThan(0.3);
    expect(votesYes(behind, 'iron')).toBe(true);
    expect(votesYes(behind, 'challenger')).toBe(false);
    const borderline: FfFeatures = { goldDeficit: 4000, killDeficit: 4, towerDeficit: 0, tilt: 0 };
    expect(votesYes(borderline, 'gold')).toBe(false);
    expect(votesYes({ ...borderline, tilt: 3 }, 'gold')).toBe(true);
  });

  it('score grows with every deficit and saturates', () => {
    expect(surrenderScore({ ...even, goldDeficit: 2000 })).toBeLessThan(surrenderScore({ ...even, goldDeficit: 4000 }));
    expect(surrenderScore({ ...even, killDeficit: -5, towerDeficit: -3 })).toBe(0);
    expect(surrenderScore({ ...hopeless, goldDeficit: 1e9 })).toBeCloseTo(surrenderScore({ ...hopeless, goldDeficit: 9e9 }));
  });
});

describe('client fold', () => {
  const base: Ff = { e: 'ff', team: 0, phase: 'start', slot: 0, yes: [0], no: [], voters: [0, 1, 2, 3, 4], need: 4, until: 900 };

  it('start/vote open, pass/fail close, denied keeps the vote', () => {
    const v = ffReduce(null, base)!;
    expect(v).toMatchObject({ need: 4, until: 900 });
    expect(myVote(v, 0)).toBe('yes');
    expect(myVote(v, 1)).toBeNull();
    const v2 = ffReduce(v, { ...base, phase: 'vote', slot: 1, no: [1] })!;
    expect(myVote(v2, 1)).toBe('no');
    expect(ffReduce(v2, { ...base, phase: 'denied', reason: 'active' })).toBe(v2);
    expect(ffReduce(v2, { ...base, phase: 'fail' })).toBeNull();
    expect(ffReduce(v2, { ...base, phase: 'pass' })).toBeNull();
    expect(ffSecondsLeft(v, 0)).toBe(30);
    expect(ffSecondsLeft(v, 1000)).toBe(0);
  });
});
