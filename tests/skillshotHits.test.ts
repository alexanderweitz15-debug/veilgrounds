import { describe, expect, it } from 'vitest';
import { step } from '../src/sim/sim';
import { Kind, Team } from '../src/sim/types';
import { spawnDummy } from '../src/sim/systems/champions';
import { spawnMinion } from '../src/sim/systems/minions';
import { spawnProjectile, sweepHit, type Payload } from '../src/sim/systems/projectiles';
import { CX, CY, makeSim, mira, place } from './combat-helpers';

describe('sweepHit (edge-to-edge)', () => {
  it('grazing: hit at exactly r, miss just beyond', () => {
    expect(sweepHit(0, 0, 100, 0, 50, 40, 40)).toBeGreaterThanOrEqual(0);
    expect(sweepHit(0, 0, 100, 0, 50, 40.01, 40)).toBe(-1);
  });
  it('no tunnelling: one step far longer than the target diameter still hits, at the leading edge', () => {
    const t = sweepHit(0, 0, 5000, 0, 2500, 0, 30);
    expect(t).toBeCloseTo((2500 - 30) / 5000, 6);
  });
  it('segment end (max range) counts: target edge touching the end hits', () => {
    expect(sweepHit(0, 0, 100, 0, 130, 0, 30)).toBeGreaterThanOrEqual(0);
    expect(sweepHit(0, 0, 100, 0, 130.01, 0, 30)).toBe(-1);
  });
});

type S = ReturnType<typeof makeSim>;

function shot(sim: S, flags: string[], speed: number, width: number, maxDist: number): number[] {
  const c = mira(sim);
  const payload: Payload = {
    t: 'ability', caster: c, casterSerial: sim.c.Unit.serial[c]!, slot: 0, rank: 1, flags, hit: [],
    dx: 1, dy: 0, cx: 0, cy: 0, tag: '', ret: 0,
  };
  spawnProjectile(sim, { kind: 1, src: c, team: Team.Blue, x: CX, y: CY, dx: 1, dy: 0, speed, width, maxDist, payload });
  return payload.hit;
}

describe('line projectile in sim', () => {
  const setup = (): S => {
    const sim = makeSim();
    place(sim, mira(sim), CX - 2000, CY - 2000);
    return sim;
  };
  const run = (sim: S, n: number): void => { for (let i = 0; i < n; i++) step(sim); };

  it('fast projectile (133/tick, far above target diameter) does not tunnel', () => {
    const sim = setup();
    const d = spawnDummy(sim, CX + 500, CY, Team.Red);
    const hit = shot(sim, [], 4000, 40, 1000);
    run(sim, 20);
    expect(hit).toEqual([d]);
  });
  it('edge hit by width: offset radius + width/2 hits, a bit more misses', () => {
    for (const [extra, hitExpected] of [[-0.01, true], [1, false]] as const) {
      const sim = setup();
      const d = spawnDummy(sim, CX + 400, CY, Team.Red);
      const r = sim.c.Unit.radius[d]!;
      place(sim, d, CX + 400, CY + r + 30 + extra);
      const hit = shot(sim, [], 1500, 60, 800);
      run(sim, 30);
      expect(hit.length).toBe(hitExpected ? 1 : 0);
    }
  });
  it('max range: target edge just inside range hits, just outside misses', () => {
    for (const [extra, hitExpected] of [[-0.5, true], [0.5, false]] as const) {
      const sim = setup();
      const d = spawnDummy(sim, CX, CY, Team.Red);
      const r = sim.c.Unit.radius[d]!;
      place(sim, d, CX + 600 + r + 30 + extra, CY);
      const hit = shot(sim, [], 1500, 60, 600);
      run(sim, 40);
      expect(hit.length).toBe(hitExpected ? 1 : 0);
    }
  });
  it('blocked_by_minions: first unit along the path is hit', () => {
    const sim = setup();
    const front = spawnMinion(sim, Kind.MinionMelee, Team.Red, 0, CX + 300, CY);
    spawnDummy(sim, CX + 600, CY, Team.Red);
    const hit = shot(sim, ['blocked_by_minions'], 1500, 60, 1000);
    run(sim, 30);
    expect(hit).toEqual([front]);
  });
  it('minion behind the champion is not hit (champion consumes the shot)', () => {
    const sim = setup();
    const champ = spawnDummy(sim, CX + 300, CY, Team.Red);
    spawnMinion(sim, Kind.MinionMelee, Team.Red, 0, CX + 600, CY);
    const hit = shot(sim, ['blocked_by_minions'], 1500, 60, 1000);
    run(sim, 30);
    expect(hit).toEqual([champ]);
  });
  it('without blocked_by_minions minions are ignored', () => {
    const sim = setup();
    spawnMinion(sim, Kind.MinionMelee, Team.Red, 0, CX + 300, CY);
    const champ = spawnDummy(sim, CX + 600, CY, Team.Red);
    const hit = shot(sim, [], 1500, 60, 1000);
    run(sim, 30);
    expect(hit).toEqual([champ]);
  });
});
